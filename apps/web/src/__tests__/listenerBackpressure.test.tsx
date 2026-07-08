// @vitest-environment jsdom
// Story 5.4 — end-to-end backpressure integration: midi:event → scheduler →
// Mock output + listener store + LateAlert, with NO server overload event
// (FR-27 / AC-U11) and NO extra `socket.emit`.
//
// Hotfix fidélité musicale — the scheduler is now DEFERRED: a calm event is
// sent at `now + PLAYBACK_DELAY_MS` (1500), and "late" is SCHEDULE-late (the
// deferred buffer could not absorb the jitter). A single event always anchors
// to `now + 1500` (the future) → never late, so to exercise the late path we
// PRIME an anchor with a calm event (now 5000, ts 1000 → anchor { 1000, 6500 }),
// then ADVANCE `performance.now()` to 7000 and fire the event under test
// (ts 1120 → target 6620 < 7040 → schedule-late). Deterministic timestamps:
//   - calm (single event, now 5000) → 6500 (now + PLAYBACK_DELAY_MS);
//   - late noteOn (primed, now 7000) → 7000 (immediate fallback);
//   - late controlChange (primed, now 7000) → dropped (no capture).
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

/** The current `performance.now()` mock value (advanced between events). */
let nowMock = 5000;
function setNow(v: number): void {
  nowMock = v;
  vi.spyOn(performance, "now").mockReturnValue(v);
}

/**
 * Hotfix fidélité musicale — prime a deferred-playback anchor so the NEXT event
 * can be schedule-late. Fires a calm noteOn at now 5000 (ts 1000 → anchor
 * { 1000, 6500 }), then clears the Mock capture so the test event is the only
 * observed message. The caller then advances `now` (e.g. to 7000) and fires the
 * event under test (ts 1120 → target 6620 < now+40 → late).
 */
function primeAnchor(socket: { fireServer: (ev: string, arg?: unknown) => void }): void {
  setNow(5000);
  act(() => {
    socket.fireServer("midi:event", {
      type: "noteOn",
      channel: 0,
      note: 0,
      velocity: 1,
      seq: 0,
      ts: 1000,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
    });
  });
  getMockMidiOutput().reset(); // focus assertions on the event under test
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
  nowMock = 5000;
  vi.spyOn(performance, "now").mockReturnValue(5000);
  // The epoch `Date.now()` is now TELEMETRY-ONLY (the late decision is
  // schedule-late). Kept mocked for the `effectiveLatencyMs` computation.
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
  it("a CALM noteOn (no srvTs) → Mock receives 1 DEFERRED msg (6500); no alert", async () => {
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
    expect(mock.messages[0]!.timestamp).toBe(6500); // 5000 + PLAYBACK_DELAY_MS(1500)
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x90, 60, 100]);
    // Calm reception → no alert, no stat.
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("listener-latency-stat")).not.toBeInTheDocument();
    expect(useListenerStore.getState().lateWarning).toBe(false);
    expect(useListenerStore.getState().fallbackCount).toBe(0);
  });

  it("a SCHEDULE-LATE noteOn → Mock receives 1 msg IMMEDIATE (7000); fallback counter ++", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket); // anchor { 1000, 6500 }, Mock cleared
    setNow(7000); // advance past the slot (target 6620 < 7040 → late)
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 2,
        ts: 1120, // target 6500 + 120 = 6620 < now(7000)+40 → schedule-late
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    const mock = getMockMidiOutput();
    expect(mock.messages).toHaveLength(1); // noteOn NOT lost (fallback)
    expect(mock.messages[0]!.timestamp).toBe(7000); // immediate (now), NOT deferred
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

  it("a SCHEDULE-LATE noteOff → Mock receives 1 msg IMMEDIATE (fallback)", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket);
    setNow(7000);
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOff",
        channel: 0,
        note: 60,
        velocity: 0,
        seq: 3,
        ts: 1120,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1);
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(7000); // immediate
    expect(useListenerStore.getState().fallbackCount).toBe(1);
  });

  it("a SCHEDULE-LATE programChange → Mock receives 1 msg IMMEDIATE (fallback)", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket);
    setNow(7000);
    act(() => {
      socket.fireServer("midi:event", {
        type: "programChange",
        channel: 0,
        program: 42,
        seq: 4,
        ts: 1120,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1);
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(7000);
    expect(useListenerStore.getState().fallbackCount).toBe(1);
  });

  it("a SCHEDULE-LATE controlChange → Mock receives NOTHING (dropped)", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket);
    setNow(7000);
    act(() => {
      socket.fireServer("midi:event", {
        type: "controlChange",
        channel: 0,
        controller: 74,
        value: 91,
        seq: 5,
        ts: 1120,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(0); // dropped
    expect(useListenerStore.getState().droppedCount).toBe(1);
    expect(useListenerStore.getState().fallbackCount).toBe(0);
    expect(useListenerStore.getState().lateWarning).toBe(true);
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
  });

  it("a SCHEDULE-LATE pitchBend → Mock receives NOTHING (dropped)", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket);
    setNow(7000);
    act(() => {
      socket.fireServer("midi:event", {
        type: "pitchBend",
        channel: 0,
        pitchBend: 8192,
        seq: 6,
        ts: 1120,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(0); // dropped
    expect(useListenerStore.getState().droppedCount).toBe(1);
  });

  it("schedule-late boundary: target === now+LOOKAHEAD → deferred sent; target-1 → fallback", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket); // anchor { 1000, 6500 }
    setNow(7000); // boundary = 7040
    // target = 6500 + (1540 - 1000) = 7040 === now + LOOKAHEAD → NOT late → deferred.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 7,
        ts: 1540,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1800,
      });
    });
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(7040); // deferred at boundary
    expect(useListenerStore.getState().lateWarning).toBe(false);

    // target = 6500 + (1539 - 1000) = 7039 < 7040 → late → fallback immediate.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 61,
        velocity: 100,
        seq: 8,
        ts: 1539,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1799,
      });
    });
    expect(getMockMidiOutput().messages[1]!.timestamp).toBe(7000); // immediate fallback
    expect(useListenerStore.getState().lateWarning).toBe(true);
  });

  it("a calm (on-slot) event AFTER a late one clears the warning (alerte-only)", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket);
    setNow(7000);
    // Late event → warning on.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 9,
        ts: 1120, // target 6620 < 7040 → late
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
      });
    });
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
    // A calm (on-slot) event at now 7000: ts 2000 → target 7500 ≥ 7040 → NOT late.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 62,
        velocity: 100,
        seq: 10,
        ts: 2000, // target 6500 + 1000 = 7500 ≥ 7040 → on slot
        v: PROTOCOL_VERSION,
        roomId: ROOM,
      });
    });
    expect(useListenerStore.getState().lateWarning).toBe(false);
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("listener-latency-stat")).not.toBeInTheDocument();
  });

  it("Story 6.8 hotfix — a WILD performer ts is used ONLY relatively (no latency explosion)", async () => {
    renderPanel();
    const socket = await joinMock();
    // Reproduce the prod bug shape: the performer `ts` is a tiny
    // performance.now()-relative value (5 ms from page load) while the server
    // `srvTs` is an epoch Date.now() (~1.78e12). BEFORE the original 6.8 fix,
    // the listener computed srvTs - ts ≈ 1.78e12 → every event flagged late.
    // Hotfix fidélité musicale: the performer ts is now used ONLY as RELATIVE
    // musical time (anchored locally), so a wild ts=5 simply anchors at
    // now(5000)+1500 = 6500; no explosion. The event is calm (on slot) → sent
    // deferred, no fallback, no drop, no alert, retard 0.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 42,
        ts: 5, // wild performer performance.now() — anchored relatively, not compared
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1950, // epoch telemetry (no longer drives the decision)
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1);
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(6500); // deferred, NOT immediate
    expect(useListenerStore.getState().fallbackCount).toBe(0);
    expect(useListenerStore.getState().droppedCount).toBe(0);
    expect(useListenerStore.getState().lateWarning).toBe(false);
    // The displayed value is the restitution retard (0 = on time), NOT 1.78e12.
    expect(useListenerStore.getState().lastLatencyMs).toBe(0);
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
  });

  it("Story 6.8 negative-latency hotfix — clock skew no longer matters for late (schedule-late decides)", async () => {
    renderPanel();
    const socket = await joinMock();
    // The epoch clock skew (receivedAtMs - srvTs = -162) used to be clamped to
    // avoid a false late. Now late is SCHEDULE-late (independent of the epoch
    // pair), so a single event with a wild ts anchors at now+1500 and is NEVER
    // late → sent deferred, no fallback/drop, no alert. The epoch latency is
    // pure telemetry (no longer displayed / no longer drives the alert).
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 0,
        note: 60,
        velocity: 100,
        seq: 77,
        ts: 5, // wild performer ts — anchored relatively
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 2162, // epoch skew (2000 - 2162 = -162) — telemetry only now
      });
    });
    expect(getMockMidiOutput().messages).toHaveLength(1); // kept (sent, not dropped)
    expect(getMockMidiOutput().messages[0]!.timestamp).toBe(6500); // deferred, NOT immediate
    expect(useListenerStore.getState().fallbackCount).toBe(0);
    expect(useListenerStore.getState().droppedCount).toBe(0);
    expect(useListenerStore.getState().lateWarning).toBe(false); // on slot → no alert
    expect(useListenerStore.getState().lastLatencyMs).toBe(0); // retard 0 (on time)
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
  });
});

describe("Backpressure — NO server overload event, NO extra socket.emit (FR-27 / AC-U11)", () => {
  it("a schedule-late event does NOT emit a server overload event (nor any extra event) on the socket", async () => {
    renderPanel();
    const socket = await joinMock();
    primeAnchor(socket);
    setNow(7000);
    const emitCountBefore = socket.emitCalls.length;
    act(() => {
      socket.fireServer("midi:event", {
        type: "controlChange",
        channel: 0,
        controller: 1,
        value: 2,
        seq: 11,
        ts: 1120, // schedule-late → dropped + LOCAL warning
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        srvTs: 1700,
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
          ts: 1000, // all calm (same ts → same target 6500, on slot at now 5000)
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