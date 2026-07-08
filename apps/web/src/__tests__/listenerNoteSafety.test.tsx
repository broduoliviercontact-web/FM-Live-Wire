// @vitest-environment jsdom
// Anti-stuck-notes safety — end-to-end integration through the real `ListenerPanel`.
//
// Proves the safety orchestration wired in `api/connection.ts`:
//   (port change)   switching o1 → o2 sends EXPLICIT noteOffs + the CC panic to
//                   the OLD output (o1), NOT the new one (o2); old output's notes
//                   are cleared; the next event lands on o2;
//   (channel change) changing channel 0 → 5 sends noteOffs on the OLD channel +
//                    CC 120/123 on the OLD channel on the CURRENT output; old
//                    channel notes cleared; the next event lands on the new ch;
//   (normal Panic)   after a noteOn, Panic sends the tracked noteOffs + the 64-CC
//                    sweep (NOT 2048), then clears the tracker;
//   (Force Panic)    unchanged — still the 2048-message noteOff sweep;
//   (output lost)    a `state:"disconnected"` port sends a best-effort tracked
//                    noteOff and NEVER throws to the UI even if the dying port's
//                    `send` throws;
//   (non-regression) no socket event beyond the join lifecycle, no server change,
//                    LOCAL PUR (FR-27).
//
// Two REAL outputs are mocked, each with its OWN `send` spy so a port change can
// prove the noteOffs went to the OLD output. socket.io-client is mocked (fake
// socket). `performance.now()` is spied to 5000 for deterministic timestamps.
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
import { MemoryRouter } from "react-router-dom";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { ListenerPanel } from "../features/listener";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";
import { __resetMockMidiOutput } from "../features/listener/lib/mock-output";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

// Zero-grep policy (FR-27): build the overload event name from parts.
const OVERLOAD_EVENT = ["listener", "overload"].join(":");

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

// --- Web MIDI mock: TWO real outputs, each with its OWN send spy -------------
interface FakeMIDIPort {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  send: (data: Uint8Array, ts: number) => void;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIPort>;
  outputs: Map<string, FakeMIDIPort>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIPort }) => void) | null;
}

/** Per-port send spies (keyed by port id) so we can prove OLD vs NEW targeting. */
const portSpies: Record<string, ReturnType<typeof vi.fn>> = {};

const midiMock = {
  nextOutputs: [] as Omit<FakeMIDIPort, "send">[],
  lastAccess: null as FakeMIDIAccess | null,
  spy: vi.fn(async () => {
    const outputs = new Map<string, FakeMIDIPort>();
    for (const p of midiMock.nextOutputs) {
      const spy = vi.fn((_data: Uint8Array, _ts: number) => undefined);
      portSpies[p.id] = spy;
      outputs.set(p.id, { ...p, send: spy });
    }
    const access: FakeMIDIAccess = {
      inputs: new Map(),
      outputs,
      sysexEnabled: false,
      onstatechange: null,
    };
    midiMock.lastAccess = access;
    return access as unknown as MIDIAccess;
  }),
};

function makePort(id: string, name = id): Omit<FakeMIDIPort, "send"> {
  return {
    id,
    name,
    manufacturer: "TestMfg",
    state: "connected",
    connection: "closed",
  };
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/listener"]}>
      <MidiAccessProvider>
        <ListenerPanel />
      </MidiAccessProvider>
    </MemoryRouter>,
  );
}

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
}

/** Render + grant + select a real output + join + connect + ack. Returns socket. */
async function joinReal(portId = "o1"): Promise<FakeSocket> {
  renderPanel();
  await grant();
  act(() => {
    useListenerStore.getState().setSelectedOutput(portId);
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-join-button")).not.toBeDisabled(),
  );
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

/** A compatible noteOn relayed by the server (channel 5 → remapped to store.channel). */
function noteOn(seq: number, note = 60) {
  return {
    type: "noteOn" as const,
    channel: 5,
    note,
    velocity: 100,
    seq,
    ts: 1000,
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    performerId: "srv-owner",
    srvTs: 1050,
  };
}

/** Helper: the data bytes captured by a port spy. */
function sentBytes(spy: ReturnType<typeof vi.fn>): number[][] {
  return spy.mock.calls.map((c) => Array.from(c[0] as Uint8Array));
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  __resetMockMidiOutput();
  lastConnect.socket = undefined;
  midiMock.nextOutputs = [];
  midiMock.lastAccess = null;
  midiMock.spy.mockClear();
  for (const k of Object.keys(portSpies)) delete portSpies[k];
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
  vi.spyOn(performance, "now").mockReturnValue(5000);
});

afterEach(() => {
  cleanup();
  __resetListenerConnection();
  __resetMockMidiOutput();
  vi.restoreAllMocks();
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

// ============================================================================
// (port change) — noteOffs + CC panic to the OLD output, NOT the new one
// ============================================================================
describe("anti-stuck-notes — port change sends noteOffs to the OLD output", () => {
  it("switching o1 → o2: o1 receives the tracked noteOff + 64-CC panic; o2 receives nothing from the switch", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM"), makePort("o2", "DX7")];
    const socket = await joinReal("o1");
    // Sound a note on o1 (channel 5 → remapped to store channel 0).
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(1); // the noteOn
    expect(sentBytes(portSpies["o1"]!)[0]).toEqual([0x90, 60, 100]);

    // Switch the output to o2 via the picker dropdown.
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: "o2" },
      });
    });
    expect(useListenerStore.getState().selectedOutputId).toBe("o2");

    // OLD output o1 got the explicit noteOff for note 60 (0x80|0) ...
    const o1After = sentBytes(portSpies["o1"]!);
    expect(o1After.some((b) => b[0] === 0x80 && b[1] === 60 && b[2] === 0)).toBe(
      true,
    );
    // ... AND the 64-CC panic sweep on o1 (noteOn + noteOff + 64 CC = 66).
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(1 + 1 + 64);
    expect(o1After[1]).toEqual([0x80, 60, 0]); // explicit noteOff (right after the noteOn)
    expect(o1After[2]).toEqual([0xb0, 64, 0]); // first CC of the panic sweep
    expect(o1After[o1After.length - 1]).toEqual([0xbf, 123, 0]);

    // NEW output o2 received NOTHING from the switch (no noteOff, no panic).
    expect(portSpies["o2"]!).not.toHaveBeenCalled();

    // The next event lands on o2 (and is tracked under o2, not o1).
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62));
    });
    expect(portSpies["o2"]!).toHaveBeenCalledTimes(1);
    expect(sentBytes(portSpies["o2"]!)[0]).toEqual([0x90, 62, 100]);
    // o1 is untouched by the new event.
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(1 + 1 + 64);
  });
});

// ============================================================================
// (channel change) — noteOffs + CC all-notes-off on the OLD channel
// ============================================================================
describe("anti-stuck-notes — channel change sends noteOffs on the OLD channel", () => {
  it("changing channel 0 → 5: noteOff + CC 120/123 on ch0 (OLD); next event on ch5", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    // Sound a note on the current channel (store channel 0).
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    expect(sentBytes(portSpies["o1"]!)[0]).toEqual([0x90, 60, 100]);

    // Change the channel to UI 6 (data 5) via the radiogroup button.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-channel-button-6"));
    });
    expect(useListenerStore.getState().channel).toBe(5);

    // OLD channel 0 got: noteOff [0x80,60,0] + CC120 [0xb0,120,0] + CC123 [0xb0,123,0].
    const o1After = sentBytes(portSpies["o1"]!);
    expect(o1After).toHaveLength(1 + 3); // noteOn + noteOff + 2 CC
    expect(o1After[1]).toEqual([0x80, 60, 0]); // explicit noteOff on ch0
    expect(o1After[2]).toEqual([0xb0, 120, 0]); // CC 120 on ch0
    expect(o1After[3]).toEqual([0xb0, 123, 0]); // CC 123 on ch0

    // The next event is remapped to the NEW channel 5 (status 0x95).
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62));
    });
    expect(sentBytes(portSpies["o1"]!).at(-1)).toEqual([0x95, 62, 100]);
  });

  it("changing to the SAME channel is a no-op (no safety send, no store write)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    const callsBefore = portSpies["o1"]!.mock.calls.length;
    // Click the already-active channel 1 (data 0) → no change.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-channel-button-1"));
    });
    expect(useListenerStore.getState().channel).toBe(0);
    expect(portSpies["o1"]!.mock.calls.length).toBe(callsBefore); // no safety send
  });
});

// ============================================================================
// (normal Panic) — tracked noteOffs + 64-CC sweep (NOT 2048) + clear
// ============================================================================
describe("anti-stuck-notes — normal Panic sends tracked noteOffs + 64 CC, not 2048", () => {
  it("after a noteOn, Panic sends the explicit noteOff + the 64-CC sweep, then clears", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(1); // noteOn

    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    // Baseline noteOn (1) + safety: 1 tracked noteOff + 64 CC = 66 total (NOT 2048).
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(1 + 1 + 64);
    const o1After = sentBytes(portSpies["o1"]!);
    // First safety send is the explicit noteOff for the sounding note 60.
    expect(o1After[1]).toEqual([0x80, 60, 0]);
    // Then the 64-CC sweep (CC 64..123 × 16 channels).
    expect(o1After[2]).toEqual([0xb0, 64, 0]);
    expect(o1After[o1After.length - 1]).toEqual([0xbf, 123, 0]);
    // NOT 2048 (Force Panic is the only 2048 path — see the next describe block).
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(66);
  });

  it("Panic with NO sounding note still sends the 64-CC sweep (tracker empty)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    await joinReal("o1");
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(64); // 0 tracked + 64 CC
  });
});

// ============================================================================
// (Force Panic) — unchanged: still the 2048-message noteOff sweep
// ============================================================================
describe("anti-stuck-notes — Force Panic unchanged (2048 noteOff sweep)", () => {
  it("confirm Force Panic → 2048 noteOff on the current output (channel-major)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    await joinReal("o1");
    // Sound a note first (the tracker has it; Force Panic clears it after the sweep).
    act(() => {
      lastConnect.socket!.fireServer("midi:event", noteOn(1, 60));
    });
    const before = portSpies["o1"]!.mock.calls.length; // 1 noteOn
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-confirm"));
    });
    // Exactly 2048 noteOff (no extra tracked-noteOff pass — the sweep covers all).
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(before + 2048);
    const o1After = sentBytes(portSpies["o1"]!);
    expect(o1After[before]).toEqual([0x80, 0, 0]);
    expect(o1After[o1After.length - 1]).toEqual([0x8f, 127, 0]);
  });
});

// ============================================================================
// (output lost) — best-effort tracked noteOff, never throws to the UI
// ============================================================================
describe("anti-stuck-notes — output lost: best-effort noteOff, no UI throw", () => {
  it("state:disconnected sends a best-effort tracked noteOff then clears + E5", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    expect(portSpies["o1"]!).toHaveBeenCalledTimes(1); // noteOn
    // The port stays in the map but flips to "disconnected".
    await act(async () => {
      const port = midiMock.lastAccess!.outputs.get("o1")!;
      port.state = "disconnected";
      midiMock.lastAccess!.onstatechange!({ port });
    });
    // Fail-safe: a best-effort noteOff for the sounding note 60 was sent to o1.
    const o1After = sentBytes(portSpies["o1"]!);
    expect(o1After.some((b) => b[0] === 0x80 && b[1] === 60)).toBe(true);
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(useListenerStore.getState().outputLost).toBe(true);
  });

  it("a dying port whose send throws on the noteOff → no UI throw, still clears + E5", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    // Make every subsequent send on o1 throw (the port is gone at send time).
    portSpies["o1"]!.mockImplementation(() => {
      throw new DOMException("port closed", "InvalidStateError");
    });
    // The disconnect fail-safe must not throw to the UI even though the noteOff
    // send throws — if handleOutputLost let the throw escape, this `act` would
    // throw and fail the test. The best-effort per-note try/catch swallows it.
    await act(async () => {
      const port = midiMock.lastAccess!.outputs.get("o1")!;
      port.state = "disconnected";
      midiMock.lastAccess!.onstatechange!({ port });
    });
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(useListenerStore.getState().outputLost).toBe(true);
  });
});

// ============================================================================
// (non-regression) — LOCAL PUR: no socket event, no server change
// ============================================================================
describe("anti-stuck-notes — non-regression (LOCAL, no socket event)", () => {
  it("a port change + Panic emit NO new socket event (no overload, no server change)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM"), makePort("o2", "DX7")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    const emitsBefore = socket.emitCalls.length;
    // Port change.
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: "o2" },
      });
    });
    // Panic on the new output.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    // No new emit at all (safety is fully local — FR-27 / AC-U11).
    expect(socket.emitCalls.length).toBe(emitsBefore);
    expect(socket.emitCalls.some((c) => c.ev === OVERLOAD_EVENT)).toBe(false);
  });
});