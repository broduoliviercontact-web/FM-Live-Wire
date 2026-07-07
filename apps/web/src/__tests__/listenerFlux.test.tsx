// @vitest-environment jsdom
// Story 4.4 — end-to-end flux integration:
//   join (no event) → `waiting`;
//   receive a `noteOn` → `active` + eventsReceived counter + activity pulse;
//   « Quitter le flux » → `room:leave` emitted + UI back to `idle`.
//
// Drives the REAL JoinButton + StatusPill + MidiActivityIndicator + the shared
// `useListenerConnection` + listenerStore + scheduler + encode. socket.io-client
// is mocked (fake socket). Web MIDI is mocked home-typed so reception forwards
// to an observable output. No real network, no hardware port.
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
import { MidiActivityIndicator } from "../features/listener/components/MidiActivityIndicator";
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

function renderFlow() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <JoinButton />
      <StatusPill />
      <MidiActivityIndicator />
    </MidiAccessProvider>,
  );
}

/** Grant MIDI access, select the output, join the room, return the fake socket. */
async function join() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
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
    fireEvent.click(screen.getByTestId("listener-join-button"));
  });
  const socket = lastConnect.socket!;
  expect(socket).toBeDefined();
  // joinFlux emits room:join immediately; fire connect then ack.
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
  // matchMedia absent (reduced-motion = false default).
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

describe("Listener flux — waiting → active → idle", () => {
  it("join (no event) → StatusPill `waiting` + indicator off", async () => {
    renderFlow();
    // Before join: idle.
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Inactif",
    );
    expect(screen.getByTestId("listener-activity-indicator")).toHaveAttribute(
      "data-state",
      "idle",
    );

    await join();

    // After join ack: waiting (joined, no event yet).
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "En attente du performer…",
    );
    expect(screen.getByTestId("listener-status-pill")).toHaveAttribute(
      "data-state",
      "waiting",
    );
    expect(useListenerStore.getState().fluxStatus).toBe("waiting");
    // Indicator still off (no noteOn yet).
    expect(
      screen.getByTestId("listener-activity-indicator"),
    ).toHaveAttribute("data-state", "idle");
  });

  it("receiving a noteOn → StatusPill `active` + counter + activity pulse + send", async () => {
    renderFlow();
    const socket = await join();

    const relayed = {
      type: "noteOn" as const,
      channel: 5,
      note: 60,
      velocity: 100,
      seq: 1,
      ts: 1000,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
      performerId: "srv-owner",
      srvTs: 9999,
    };
    act(() => {
      socket.fireServer("midi:event", relayed);
    });

    // Flux active, counter = 1, pulse = 1.
    expect(useListenerStore.getState().fluxStatus).toBe("active");
    expect(useListenerStore.getState().eventsReceived).toBe(1);
    expect(useListenerStore.getState().noteOnPulse).toBe(1);
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Réception active — 1 event reçu",
    );
    // Indicator active + pulse recorded.
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-state", "active");
    expect(dot).toHaveAttribute("data-pulse", "1");

    // The 4.3 pipeline still ran (noteOn remapped to canal 0 → 0x90).
    expect(outSend).toHaveBeenCalledTimes(1);
    const [data] = outSend.mock.calls[0] as [Uint8Array, number];
    expect(Array.from(data)).toEqual([0x90, 60, 100]);
  });

  it("a non-noteOn event counts but does NOT pulse", async () => {
    renderFlow();
    const socket = await join();
    act(() => {
      socket.fireServer("midi:event", {
        type: "controlChange",
        channel: 5,
        controller: 7,
        value: 90,
        seq: 2,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
      });
    });
    expect(useListenerStore.getState().fluxStatus).toBe("active");
    expect(useListenerStore.getState().eventsReceived).toBe(1);
    expect(useListenerStore.getState().noteOnPulse).toBe(0);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-state", "active");
    expect(dot).toHaveAttribute("data-pulse", "0");
  });

  it("« Quitter le flux » emits room:leave and returns the UI to idle", async () => {
    renderFlow();
    const socket = await join();
    // Receive an event so the flux is active first.
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
    expect(useListenerStore.getState().fluxStatus).toBe("active");

    // Leave.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-join-button")); // « Quitter »
    });
    const leaveCall = socket.emitCalls.find((c) => c.ev === "room:leave");
    expect(leaveCall).toBeDefined();
    expect(leaveCall!.payload).toEqual({});
    // Before ack: still joined/active.
    expect(useListenerStore.getState().joined).toBe(true);
    act(() => {
      leaveCall!.ack!({ ok: true });
    });
    // After ack: joined false, flux idle, counters reset, socket disconnected.
    expect(useListenerStore.getState().joined).toBe(false);
    expect(useListenerStore.getState().fluxStatus).toBe("idle");
    expect(useListenerStore.getState().eventsReceived).toBe(0);
    expect(useListenerStore.getState().noteOnPulse).toBe(0);
    expect(socket.disconnectCount).toBe(1);
    // UI back to idle.
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Inactif",
    );
    expect(screen.getByTestId("listener-join-button")).toHaveTextContent(
      "Rejoindre le flux",
    );
    expect(
      screen.getByTestId("listener-activity-indicator"),
    ).toHaveAttribute("data-state", "idle");
  });
});