// @vitest-environment jsdom
// Listener leave → rejoin integration (no prod change, test-only).
//
// Drives the REAL `useListenerConnection` + `connection.ts` + `listenerStore`
// through the `JoinButton` (« Rejoindre » / « Quitter ») to pin the leave→rejoin
// contract end-to-end:
//   - Preferences (`selectedOutputId`, `channel`, `ccMode`) SURVIVE leave and
//     rejoin (they live outside `FLUX_IDLE`).
//   - Session flux state + telemetry (`fluxStatus`, `eventsReceived`,
//     `noteOnPulse`) are RESET to idle/0 by the leave (`resetFlux()`), so a
//     rejoin starts a fresh session count. (`ccReceived`/`ccSent`/`ccCoalesced`
//     follow the same reset path but are pinned by listenerStore.reset-
//     contract.test.ts — this integration test fires only noteOns so the CC
//     coalescer's 60 Hz flush interval cannot leak `outSend` across tests.)
//   - NO replay: events received before the leave are NOT re-sent after the
//     rejoin; only NEW post-rejoin events trigger `MIDIOutput.send` (AD-17).
//
// socket.io-client is mocked (fake socket: records emits, fires server events
// + acks). Web MIDI is mocked home-typed so reception forwards to an observable
// output. No real network, no hardware port. Mirrors listenerStates.test.tsx.
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
import { StatusPill } from "../features/listener/components/StatusPill";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

// --- socket.io-client fake (records emits; fires server events + acks) ------
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

// --- Web MIDI mock (home-typed, with a sendable output) ---------------------
const outSend = vi.fn((_data: Uint8Array, _ts: number) => undefined);
const fakeOutput = {
  id: "o1",
  name: "Volca FM",
  manufacturer: "Korg",
  state: "connected",
  connection: "closed",
  send: outSend,
};
const midiSpy = vi.fn(async () => {
  const access = {
    inputs: new Map(),
    outputs: new Map([["o1", fakeOutput]]),
    sysexEnabled: false,
    onstatechange: null,
  } as unknown as MIDIAccess;
  return access;
});

/** Count `outSend` calls whose MIDI bytes exactly match `bytes`. Used by the
 *  no-replay test to ignore the AD-7 panic sweep `leaveFlux` fires on leave
 *  (`[0xB0|ch, controller, 0]` control-change bytes — they never collide with a
 *  performer noteOn `[0x90, note, velocity]`, so filtering on the exact event
 *  bytes isolates "was the performer event replayed?" from the legitimate
 *  fail-safe panic). */
function callsWith(...bytes: number[]): number {
  const want = bytes.join(",");
  return outSend.mock.calls.filter(
    (c) => Array.from(c[0] as Uint8Array).join(",") === want,
  ).length;
}

function renderFlow() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <JoinButton />
      <StatusPill />
    </MidiAccessProvider>,
  );
}

/** Grant MIDI (if not already authorized — on rejoin the ready Badge is already
 *  shown, so the permission button is gone), select output `o1`, click
 *  « Rejoindre », ack the join. Returns the CURRENT fake socket (a fresh one is
 *  created on each join). */
async function join(): Promise<FakeSocket> {
  // First join: the « Connecter MIDI » button is present (status idle). On
  // rejoin: MIDI is already authorized → MidiPermissionButton renders the ready
  // Badge (`listener-midi-status-pill`) and the permission button is absent.
  const permButton = screen.queryByTestId("listener-midi-permission-button");
  if (permButton !== null) {
    await act(async () => {
      fireEvent.click(permButton);
    });
  }
  // Confirm MIDI access is granted (the ready Badge) before selecting an output
  // — this also confirms the `getOutput` used by handleMidiEvent is wired, so
  // sends reach outSend.
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
  act(() => {
    useListenerStore.getState().setSelectedOutput("o1");
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-join-button")).not.toBeDisabled(),
  );
  act(() => {
    fireEvent.click(screen.getByTestId("listener-join-button")); // joinFlux
  });
  const socket = lastConnect.socket!;
  expect(socket).toBeDefined();
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

/** Click « Quitter le flux » and ack the `room:leave`. */
function leave(socket: FakeSocket): void {
  act(() => {
    fireEvent.click(screen.getByTestId("listener-join-button")); // leaveFlux
  });
  const leaveCall = socket.emitCalls.find((c) => c.ev === "room:leave")!;
  act(() => {
    leaveCall.ack!({ ok: true });
  });
  expect(useListenerStore.getState().joined).toBe(false);
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  lastConnect.socket = undefined;
  outSend.mockClear();
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
  try {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } catch {
    /* already absent */
  }
});

afterEach(() => {
  cleanup();
  __resetListenerConnection();
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

describe("listener leave → rejoin", () => {
  it("preserves selectedOutputId, channel, ccMode across leave and rejoin", async () => {
    renderFlow();
    await join();

    // Set user preferences after joining (channel + CC mode).
    act(() => {
      useListenerStore.getState().setChannel(7);
      useListenerStore.getState().setCcMode("raw");
    });

    // Leave: flux state resets, preferences survive.
    const socket = lastConnect.socket!;
    leave(socket);
    const afterLeave = useListenerStore.getState();
    expect(afterLeave.joined).toBe(false);
    expect(afterLeave.fluxStatus).toBe("idle");
    expect(afterLeave.selectedOutputId).toBe("o1");
    expect(afterLeave.channel).toBe(7);
    expect(afterLeave.ccMode).toBe("raw");

    // Rejoin (a fresh socket is created): preferences still intact.
    await join();
    const afterRejoin = useListenerStore.getState();
    expect(afterRejoin.joined).toBe(true);
    expect(afterRejoin.fluxStatus).toBe("waiting");
    expect(afterRejoin.selectedOutputId).toBe("o1");
    expect(afterRejoin.channel).toBe(7);
    expect(afterRejoin.ccMode).toBe("raw");
  });

  it("resets session flux telemetry on leave; rejoin starts a fresh count", async () => {
    renderFlow();
    const socket = await join();

    // Active session: two noteOns. (CC is intentionally NOT fired here — the
    // CC coalescer's 60 Hz flush interval would leak `outSend` calls across
    // tests; `ccReceived` reset is already pinned by listenerStore.reset-
    // contract.test.ts, so this integration test sticks to synchronous noteOns.)
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
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 62,
        velocity: 100,
        seq: 2,
        ts: 2000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 10000,
      });
    });
    expect(useListenerStore.getState().fluxStatus).toBe("active");
    expect(useListenerStore.getState().eventsReceived).toBe(2);
    expect(useListenerStore.getState().noteOnPulse).toBe(2);

    // Leave → session telemetry reset.
    leave(socket);
    const afterLeave = useListenerStore.getState();
    expect(afterLeave.fluxStatus).toBe("idle");
    expect(afterLeave.eventsReceived).toBe(0);
    expect(afterLeave.noteOnPulse).toBe(0);

    // Rejoin + one new noteOn → fresh session count (1, not 3).
    const socket2 = await join();
    act(() => {
      socket2.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 64,
        velocity: 100,
        seq: 4,
        ts: 4000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 12000,
      });
    });
    const afterRejoin = useListenerStore.getState();
    expect(afterRejoin.fluxStatus).toBe("active");
    expect(afterRejoin.eventsReceived).toBe(1);
    expect(afterRejoin.noteOnPulse).toBe(1);
  });

  it("NO replay after rejoin — only NEW events trigger MIDIOutput.send", async () => {
    renderFlow();
    const socket = await join();

    // One event before the leave → sent exactly once (note 60, forced to the
    // store channel 0 → status 0x90).
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
    expect(callsWith(0x90, 60, 100)).toBe(1);

    // Leave fires the AD-7 panic sweep (`sendSafetyPanicOnCurrentOutput` —
    // control-change bytes, a legitimate fail-safe, NOT a replay of the
    // performer's noteOn). None of the panic bytes match the performer event,
    // so the pre-leave noteOn count is unchanged across the leave.
    leave(socket);
    expect(callsWith(0x90, 60, 100)).toBe(1);

    // Rejoin: the pre-leave event is NOT replayed (still exactly one send of
    // note 60 — the original pre-leave one; nothing is queued for replay).
    const socket2 = await join();
    expect(callsWith(0x90, 60, 100)).toBe(1);

    // Only a NEW post-rejoin event triggers a new send (note 62).
    act(() => {
      socket2.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 62,
        velocity: 100,
        seq: 2,
        ts: 2000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 10000,
      });
    });
    expect(callsWith(0x90, 60, 100)).toBe(1); // pre-leave event still not replayed
    expect(callsWith(0x90, 62, 100)).toBe(1); // only the NEW event
    // The new send is forced to store.channel (default 0) — 0x90 = noteOn ch 0.
    const newCall = outSend.mock.calls.find(
      (c) =>
        Array.from(c[0] as Uint8Array).join(",") === [0x90, 62, 100].join(","),
    )!;
    expect(Array.from(newCall[0] as Uint8Array)).toEqual([0x90, 62, 100]);
  });
});