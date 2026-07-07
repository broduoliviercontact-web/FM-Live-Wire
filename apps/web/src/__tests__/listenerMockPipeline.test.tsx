// @vitest-environment jsdom
// Story 5.1 — Mock / Debug end-to-end: picker option + hot switch + the full
// pipeline `socket → remap → encode → schedule → MockMidiOutput.send` WITHOUT
// any MIDI device (NFR-19), + `TestNoteButton` driving the Mock.
//
// socket.io-client is mocked (fake socket: records emits, fires server events +
// acks). Web MIDI is mocked home-typed (the CI-pipeline case returns ZERO real
// outputs, so only the Mock is available). The shared `MockMidiOutput` singleton
// captures the scheduled bytes; `MockByteStream` displays them. No real network,
// no hardware port.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { MidiPermissionButton } from "../features/listener/components/MidiPermissionButton";
import { MidiPortPicker } from "../features/listener/components/MidiPortPicker";
import { JoinButton } from "../features/listener/components/JoinButton";
import { TestNoteButton } from "../features/listener/components/TestNoteButton";
import { MockBadge } from "../features/listener/components/MockBadge";
import { MockByteStream } from "../features/listener/components/MockByteStream";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

// --- socket.io-client fake (records emits; fires server events + acks) --------
const { lastConnect, FakeSocket } = vi.hoisted(() => {
  interface EmitCall {
    ev: string;
    payload: unknown;
    ack: ((a: unknown) => void) | undefined;
  }
  class FakeSocket {
    listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    emitCalls: EmitCall[] = [];
    disconnectCount = 0;
    on(ev: string, cb: (arg?: unknown) => void): this {
      (this.listeners[ev] ??= []).push(cb);
      return this;
    }
    off(): this {
      return this;
    }
    disconnect(): this {
      this.disconnectCount += 1;
      return this;
    }
    connect(): this {
      return this;
    }
    fireServer(ev: string, arg?: unknown): void {
      (this.listeners[ev] ??= []).forEach((cb) => cb(arg));
    }
    emit(ev: string, payload?: unknown, ack?: (a: unknown) => void): void {
      this.emitCalls.push({ ev, payload, ack });
    }
  }
  const lastConnect = { socket: undefined as FakeSocket | undefined };
  return { lastConnect, FakeSocket };
});

vi.mock("socket.io-client", () => ({
  io: () => {
    const socket = new FakeSocket();
    lastConnect.socket = socket;
    return socket;
  },
}));

// --- Web MIDI mock (home-typed; 0 or 1 real outputs) -------------------------
interface FakeMIDIPort {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIPort>;
  outputs: Map<string, FakeMIDIPort>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIPort }) => void) | null;
}

const midiMock = {
  nextOutputs: [] as FakeMIDIPort[],
  lastAccess: null as FakeMIDIAccess | null,
  spy: vi.fn(async () => {
    const access: FakeMIDIAccess = {
      inputs: new Map(),
      outputs: new Map(midiMock.nextOutputs.map((p) => [p.id, p])),
      sysexEnabled: false,
      onstatechange: null,
    };
    midiMock.lastAccess = access;
    return access as unknown as MIDIAccess;
  }),
};

function makePort(id: string, name = id): FakeMIDIPort {
  return { id, name, manufacturer: "TestMfg", state: "connected", connection: "closed" };
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  __resetMockMidiOutput();
  lastConnect.socket = undefined;
  midiMock.nextOutputs = [];
  midiMock.lastAccess = null;
  midiMock.spy.mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  __resetListenerConnection();
  __resetMockMidiOutput();
  try {
    delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  } catch {
    /* already absent */
  }
  try {
    delete (window as unknown as Record<string, unknown>).isSecureContext;
  } catch {
    /* already absent */
  }
});

// --- helpers -----------------------------------------------------------------

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
}

/** Select Mock (via the store — the pipeline render has no picker), join, fire
 *  connect + room:join ack. Returns the fake socket. */
async function joinMock() {
  await grant();
  act(() => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
  });
  expect(useListenerStore.getState().selectedOutputId).toBe(MOCK_OUTPUT_ID);
  act(() => {
    fireEvent.click(screen.getByTestId("listener-join-button"));
  });
  const socket = lastConnect.socket!;
  act(() => {
    socket.fireServer("connect");
  });
  const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
  act(() => {
    joinCall.ack!({ ok: true });
  });
  expect(useListenerStore.getState().joined).toBe(true);
  return socket;
}

// ============================================================================
// Group A — picker: Mock option + hot switch
// ============================================================================
describe("MidiPortPicker — Mock / Debug option + hot switch", () => {
  function renderPicker() {
    return render(
      <MidiAccessProvider>
        <MidiPermissionButton />
        <MidiPortPicker />
      </MidiAccessProvider>,
    );
  }

  it("shows the Mock / Debug option alongside real outputs", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    expect(
      screen.getByTestId("listener-output-mock-option"),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mock / Debug" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Volca FM" })).toBeInTheDocument();
  });

  it("Mock is selectable when there are NO real ports (no blocking error)", async () => {
    midiMock.nextOutputs = []; // no device
    renderPicker();
    await grant();
    // The Mock option is present even with zero real outputs.
    expect(
      screen.getByTestId("listener-output-mock-option"),
    ).toBeInTheDocument();
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: MOCK_OUTPUT_ID },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe(MOCK_OUTPUT_ID);
    // Selecting Mock hides the "no device" info Alert (non-blocking while Mock active).
    expect(
      screen.queryByTestId("listener-output-empty-alert"),
    ).not.toBeInTheDocument();
  });

  it("hot switch real → Mock without reload (select o1, then Mock, same render)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: "o1" },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe("o1");
    // Hot switch to Mock — same mounted picker, no reload.
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: MOCK_OUTPUT_ID },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe(MOCK_OUTPUT_ID);
  });

  it("hot switch Mock → real (select Mock, then a real port)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: MOCK_OUTPUT_ID },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe(MOCK_OUTPUT_ID);
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: "o1" },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe("o1");
  });

  it("Mock selection survives hot-plug (not cleared when outputs change)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: MOCK_OUTPUT_ID },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe(MOCK_OUTPUT_ID);
    // Hot-unplug the only real port; Mock must stay selected (it is not a device).
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe(MOCK_OUTPUT_ID);
  });

  it("a real selection is still cleared when the selected real port disappears", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM"), makePort("o2", "DX7")];
    renderPicker();
    await grant();
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: "o1" },
      });
    });
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
  });
});

// ============================================================================
// Group B — pipeline socket → scheduler → encode → MockMidiOutput.send (no device)
// ============================================================================
describe("Mock pipeline — socket → encode → MockMidiOutput.send (NFR-19, no device)", () => {
  function renderPipeline() {
    return render(
      <MidiAccessProvider>
        <MidiPermissionButton />
        <JoinButton />
        <MockBadge />
        <MockByteStream />
      </MidiAccessProvider>,
    );
  }

  it("select Mock → join → midi:event noteOn → captured + 'noteOn · ch1 · 60 · 100'", async () => {
    midiMock.nextOutputs = []; // NO real device — only Mock is available.
    renderPipeline();
    const socket = await joinMock();

    // The Mock badge is visible (Mock is the selected output).
    expect(screen.getByTestId("listener-mock-badge")).toHaveTextContent(
      "Sortie Mock / Debug — les bytes s'affichent à l'écran, aucun son n'est produit.",
    );
    // MockByteStream shows the placeholder before any event.
    expect(
      screen.getByTestId("listener-mock-byte-stream-empty"),
    ).toHaveTextContent("— en attente d'événements —");

    // Server relays a midi:event (noteOn, channel 0 → UI ch1 after remap to canal 0).
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 1,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 9999,
      });
    });

    // The shared Mock singleton captured exactly one send (the scheduled bytes).
    const mock = getMockMidiOutput();
    expect(mock.messages).toHaveLength(1);
    // Status byte 0x90 (noteOn, canal 0 — the relayed canal 5 was remapped to the
    // listener's forced canal data 0). The Mock captured the SAME bytes a real
    // output would have received.
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x90, 60, 100]);

    // MockByteStream decoded + displayed the line.
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("noteOn · ch1 · 60 · 100");
    expect(lines[0]).toHaveAttribute("data-type", "noteOn");
  });

  it("the Mock produces no sound — the pipeline only calls .send on the Mock singleton", async () => {
    midiMock.nextOutputs = [];
    renderPipeline();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 1,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
      });
    });
    // The only effect of the pipeline is a captured message on the Mock
    // singleton (a plain object with no audio/device access). No real output
    // exists (0 device ports), so no hardware send is possible.
    expect(getMockMidiOutput().messages).toHaveLength(1);
  });
});

// ============================================================================
// Group C — TestNoteButton drives the Mock (local note displayed as bytes)
// ============================================================================
describe("TestNoteButton with Mock — noteOn then noteOff appear in MockByteStream", () => {
  function renderTestNote() {
    return render(
      <MidiAccessProvider>
        <TestNoteButton />
        <MockBadge />
        <MockByteStream />
      </MidiAccessProvider>,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clicking « Note de test » with Mock selected → noteOn then noteOff (300 ms) in the stream", () => {
    renderTestNote();
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    const btn = screen.getByTestId("listener-test-note-button") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();

    act(() => {
      fireEvent.click(btn);
    });
    // Immediate noteOn on the Mock (canal data 0 → status 0x90 → UI ch1).
    const afterOn = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(afterOn).toHaveLength(1);
    expect(afterOn[0]).toHaveTextContent("noteOn · ch1 · 60 · 100");
    expect(getMockMidiOutput().messages).toHaveLength(1);

    // noteOff fires after exactly 300 ms (Q-UX6).
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const afterOff = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(afterOff).toHaveLength(2);
    expect(afterOff[1]).toHaveTextContent("noteOff · ch1 · 60 · 0");
    expect(getMockMidiOutput().messages).toHaveLength(2);
  });
});