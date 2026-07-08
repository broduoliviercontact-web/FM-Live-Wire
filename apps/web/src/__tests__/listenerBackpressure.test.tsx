// @vitest-environment jsdom
// Story 5.4 — end-to-end backpressure integration: midi:event → scheduler →
// Mock output + listener store + LateAlert, with NO server overload event
// (FR-27 / AC-U11) and NO extra `socket.emit`.
//
// Drives the REAL JoinButton + MidiAccessProvider + listenerStore + scheduler
// (via the connection layer) + Mock output. socket.io-client is mocked (fake
// socket: records emits, fires server events + acks). Web MIDI is mocked with
// ZERO real outputs, so only the Mock singleton is the sink. `performance.now()`
// is spied to 5000 so the scheduled timestamp is deterministic:
//   - normal (calm) → 5000 + 40 = 5040 (lookahead);
//   - late noteOn → 5000 (immediate fallback);
//   - late controlChange → dropped (no capture).
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
import { JoinButton } from "../features/listener/components/JoinButton";
import { LateAlert } from "../features/listener/components/LateAlert";
import { LatencyStat } from "../features/listener/components/LatencyStat";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

// Forbidden server-overload event name, built from parts so the test file never
// contains the literal (repo-wide grep → 0, FR-27 / AC-U11).
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

// --- Web MIDI mock: ZERO real outputs (only the Mock is available) -----------
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
  onstatechange: (() => void) | null;
}
const midiSpy = vi.fn(async () => {
  const access: FakeMIDIAccess = {
    inputs: new Map(),
    outputs: new Map(), // NO real device — only the Mock singleton
    sysexEnabled: false,
    onstatechange: null,
  };
  return access as unknown as MIDIAccess;
});

function renderPanel() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <JoinButton />
      <LateAlert />
      <LatencyStat />
    </MidiAccessProvider>,
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

async function joinMock() {
  await grant();
  act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
  act(() => fireEvent.click(screen.getByTestId("listener-join-button")));
  const socket = lastConnect.socket!;
  act(() => socket.fireServer("connect"));
  const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
  act(() => joinCall.ack!({ ok: true }));
  expect(useListenerStore.getState().joined).toBe(true);
  return socket;
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  __resetMockMidiOutput();
  lastConnect.socket = undefined;
  midiSpy.mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiSpy,
    configurable: true,
    writable: true,
  });
  vi.spyOn(performance, "now").mockReturnValue(5000);
  // Story 6.8 hotfix — latency = receivedAtMs(Date.now()) - srvTs (both epoch).
  // Mock Date.now() to 2000 so a relayed srvTs yields the intended latency:
  //   srvTs 1700 → 300 (late), srvTs 1799 → 201 (late), srvTs 1800 → 200 (calm).
  // The performer `ts` on the relayed event is ignored (cross-client
  // performance.now() is never compared).
  vi.spyOn(Date, "now").mockReturnValue(2000);
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

describe("Backpressure integration — midi:event → scheduler → Mock + store", () => {
  it("a CALM noteOn (no srvTs) → Mock receives 1 msg with lookahead (5040); no alert", async () => {
    renderPanel();
    const socket = await joinMock();
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
      });
    });
    const mock = getMockMidiOutput();
    expect(mock.messages).toHaveLength(1);
    expect(mock.messages[0]!.timestamp).toBe(5040); // 5000 + LOOKAHEAD_MS(40)
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x90, 60, 100]);
    // Calm reception → no alert, no stat.
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("listener-latency-stat")).not.toBeInTheDocument();
    expect(useListenerStore.getState().lateWarning).toBe(false);
    expect(useListenerStore.getState().fallbackCount).toBe(0);
  });

  it("a LATE noteOn (receivedAtMs - srvTs = 300 > 200) → Mock receives 1 msg IMMEDIATE (5000); fallback counter ++", async () => {
    renderPanel();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 2,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700, // latency 300 (2000 - 1700) > 200 → late → fallback immediate
      });
    });
    const mock = getMockMidiOutput();
    expect(mock.messages).toHaveLength(1); // noteOn NOT lost (fallback)
    expect(mock.messages[0]!.timestamp).toBe(5000); // immediate (not 5040)
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x90, 60, 100]);
    // Late → alert + stat visible, fallback counter incremented.
    expect(useListenerStore.getState().lateWarning).toBe(true);
    expect(useListenerStore.getState().fallbackCount).toBe(1);
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
    expect(screen.getByTestId("listener-latency-stat")).toBeInTheDocument();
    expect(screen.getByTestId("listener-latency-stat-fallbacks")).toHaveTextContent(
      "Fallbacks : 1",
    );
  });

  it("a LATE noteOff (receivedAtMs - srvTs = 300) → Mock receives 1 msg IMMEDIATE (fallback)", async () => {
    renderPanel();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOff",
        channel: 0,
        note: 60,
        velocity: 0,
        seq: 3,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1);
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(5000); // immediate
    expect(useListenerStore.getState().fallbackCount).toBe(1);
  });

  it("a LATE programChange (receivedAtMs - srvTs = 300) → Mock receives 1 msg IMMEDIATE (fallback)", async () => {
    renderPanel();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "programChange",
        channel: 0,
        program: 42,
        seq: 4,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1);
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(5000);
    expect(useListenerStore.getState().fallbackCount).toBe(1);
  });

  it("a LATE controlChange (receivedAtMs - srvTs = 300) → Mock receives NOTHING (dropped)", async () => {
    renderPanel();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "controlChange",
        channel: 0,
        controller: 74,
        value: 91,
        seq: 5,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700, // latency 300 (2000 - 1700) > 200 → late CC → drop
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(0); // dropped
    expect(useListenerStore.getState().droppedCount).toBe(1);
    expect(useListenerStore.getState().fallbackCount).toBe(0);
    expect(useListenerStore.getState().lateWarning).toBe(true);
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
  });

  it("a LATE pitchBend (receivedAtMs - srvTs = 300) → Mock receives NOTHING (dropped)", async () => {
    renderPanel();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "pitchBend",
        channel: 0,
        pitchBend: 8192,
        seq: 6,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(0); // dropped
    expect(useListenerStore.getState().droppedCount).toBe(1);
  });

  it("latency 200 ms exact → NOT late (lookahead 5040); 201 ms → late (immediate 5000)", async () => {
    renderPanel();
    const socket = await joinMock();
    // 200 ms exact → calm → lookahead.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 7,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1800, // latency 200 (2000 - 1800, === MAX_LATE_MS) → not late
      });
    });
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(5040);
    expect(useListenerStore.getState().lateWarning).toBe(false);

    // 201 ms → late → fallback immediate.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 61,
        velocity: 100,
        seq: 8,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1799, // latency 201 (2000 - 1799) → late
      });
    });
    expect(getMockMidiOutput().messages[1]!.timestamp).toBe(5000);
    expect(useListenerStore.getState().lateWarning).toBe(true);
  });

  it("a calm event AFTER a late one clears the warning (alerte-only)", async () => {
    renderPanel();
    const socket = await joinMock();
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 9,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700, // late → warning on
      });
    });
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
    // A calm event (no srvTs) → warning cleared.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 62,
        velocity: 100,
        seq: 10,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
      });
    });
    expect(useListenerStore.getState().lateWarning).toBe(false);
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("listener-latency-stat")).not.toBeInTheDocument();
  });

  it("Story 6.8 hotfix — a WILD performer ts does NOT cause absurd latency / fallback explosion", async () => {
    renderPanel();
    const socket = await joinMock();
    // Reproduce the prod bug shape: the performer `ts` is a tiny
    // performance.now()-relative value (5 ms from page load) while the server
    // `srvTs` is an epoch Date.now() (~1.78e12). BEFORE the fix, the listener
    // computed srvTs - ts ≈ 1.78e12 → every event flagged late → fallback/drop
    // explosion. AFTER the fix, the performer ts is IGNORED and latency uses the
    // comparable epoch pair receivedAtMs(Date.now()=2000) - srvTs.
    // Use a calm srvTs (1950 → latency 50) so the event stays on the lookahead
    // path: no fallback, no drop, no alert, sane latency.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 42,
        ts: 5, // wild performer performance.now() — would have caused 1.78e12 ms
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1950, // epoch; receivedAtMs 2000 → latency 50 (calm)
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1);
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(5040); // lookahead, NOT immediate
    expect(useListenerStore.getState().fallbackCount).toBe(0);
    expect(useListenerStore.getState().droppedCount).toBe(0);
    expect(useListenerStore.getState().lateWarning).toBe(false);
    expect(useListenerStore.getState().lastLatencyMs).toBe(50); // sane, NOT 1.78e12
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
  });

  it("Story 6.8 negative-latency hotfix — clock skew (receivedAtMs - srvTs = -162) → NOT late, no fallback/drop, no LateAlert", async () => {
    renderPanel();
    const socket = await joinMock();
    // Reproduce the post-Render-retest symptom: the listener clock runs behind
    // the server, so receivedAtMs(Date.now()=2000) - srvTs(2162) = -162. A
    // negative one-way estimate is meaningless (it does NOT mean the event
    // arrived "before" relay) and must NOT read as a delay. The scheduler clamps
    // to effectiveLatencyMs = 0 → not late → sent on lookahead → no alert.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 77,
        ts: 5, // wild performer ts — ignored
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 2162, // epoch; 2000 - 2162 = -162 (clock skew) → effective 0
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1); // kept (sent, not dropped)
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(5040); // lookahead, NOT immediate
    expect(useListenerStore.getState().fallbackCount).toBe(0);
    expect(useListenerStore.getState().droppedCount).toBe(0);
    expect(useListenerStore.getState().lateWarning).toBe(false); // no alert from latency
    expect(useListenerStore.getState().lastLatencyMs).toBe(0); // clamped, NOT -162
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
  });
});

describe("Backpressure — NO server overload event, NO extra socket.emit (FR-27 / AC-U11)", () => {
  it("a late event does NOT emit a server overload event (nor any extra event) on the socket", async () => {
    renderPanel();
    const socket = await joinMock();
    const emitCountBefore = socket.emitCalls.length;
    act(() => {
      socket.fireServer("midi:event", {
        type: "controlChange",
        channel: 0,
        controller: 1,
        value: 2,
        seq: 11,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700, // late → dropped + LOCAL warning
      });
    });
    // No new emit was produced by the backpressure layer (no server overload).
    expect(socket.emitCalls.length).toBe(emitCountBefore);
    expect(socket.emitCalls.some((c) => c.ev === OVERLOAD_EVENT)).toBe(false);
    // The local warning is raised in the store only (no network event).
    expect(useListenerStore.getState().lateWarning).toBe(true);
  });

  it("a buffer-overflow burst (300 calm noteOns) raises the LOCAL warning with NO emit", async () => {
    renderPanel();
    const socket = await joinMock();
    const emitCountBefore = socket.emitCalls.length;
    for (let i = 0; i < 300; i += 1) {
      act(() => {
        socket.fireServer("midi:event", {
          type: "noteOn",
          channel: 0,
          note: 60,
          velocity: 100,
          seq: 100 + i,
          ts: 1000,
          v: PROTOCOL_VERSION,
          roomId: ROOM,
        });
      });
    }
    // The 257th+ events drop oldest → local warning on; no network emit.
    expect(useListenerStore.getState().lateWarning).toBe(true);
    expect(useListenerStore.getState().droppedCount).toBe(300 - 256);
    expect(socket.emitCalls.length).toBe(emitCountBefore);
    expect(socket.emitCalls.some((c) => c.ev === OVERLOAD_EVENT)).toBe(false);
  });
});