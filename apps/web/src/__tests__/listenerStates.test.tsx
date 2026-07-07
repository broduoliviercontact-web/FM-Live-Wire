// @vitest-environment jsdom
// Story 4.5 — listener states integration (UX-DR13/14, AC-U10/U13/U18).
//
// Proves the end-to-end flux state machine driven by the shared
// `useListenerConnection` + listenerStore + StatusPill + EmptyState +
// MidiActivityIndicator + ProtocolVersionAlert:
//   - waiting (joined, no performer): StatusPill « En attente du performer… »,
//     EmptyState hint « Dès que le performer démarre, le flux arrive. »,
//     MidiActivityIndicator OFF;
//   - performer:disconnected (E7): StatusPill « Performer déconnecté »;
//   - unsupported-version (E13): Alert « Version de protocole incompatible…
//     » AND the incompatible event is NOT scheduled (no `MIDIOutput.send`);
//   - active 0 event: StatusPill « ● Réception active — 0 event reçu »;
//   - server-down (disconnect / connect_error): StatusPill « Serveur
//     déconnecté. Reconnexion automatique en cours… », `window.confirm` NEVER
//     called (no blocking dialog);
//   - reconnect: flux returns to waiting, NO replay (only NEW events after
//     reconnect trigger `MIDIOutput.send`);
//   - « Quitter le flux »: emits `room:leave`, store back to idle, StatusPill
//     idle, NO server-down on the voluntary leave.
//
// socket.io-client is mocked (fake socket: records emits, fires server events
// + acks). Web MIDI is mocked home-typed so reception forwards to an observable
// output. `window.confirm` is spied to assert it is never called. No real
// network, no hardware port.
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
import { EmptyState } from "../features/listener/components/EmptyState";
import { ProtocolVersionAlert } from "../features/listener/components/ProtocolVersionAlert";
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
      <EmptyState />
      <ProtocolVersionAlert />
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

let confirmSpy: ReturnType<typeof vi.spyOn>;

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
  // matchMedia absent → reduced-motion = false default.
  try {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } catch {
    /* already absent */
  }
  // Assert NO blocking dialog is ever used for the server-down/reconnect flow.
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  __resetListenerConnection();
  confirmSpy.mockRestore();
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

describe("Story 4.5 — waiting (joined, no performer) empty state", () => {
  it("after join (no event): StatusPill « En attente du performer… » + EmptyState hint + indicator OFF", async () => {
    renderFlow();
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Inactif",
    );
    // EmptyState hint absent before join (idle).
    expect(screen.queryByTestId("listener-empty-state")).not.toBeInTheDocument();

    await join();

    // Waiting: non-error empty state.
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "En attente du performer…",
    );
    expect(screen.getByTestId("listener-status-pill")).toHaveAttribute(
      "data-state",
      "waiting",
    );
    // Exact empty-state hint.
    expect(screen.getByTestId("listener-empty-state")).toHaveTextContent(
      "Dès que le performer démarre, le flux arrive.",
    );
    // Indicator OFF in waiting.
    expect(screen.getByTestId("listener-activity-indicator")).toHaveAttribute(
      "data-state",
      "idle",
    );
    expect(
      screen.getByTestId("listener-activity-indicator").className,
    ).not.toContain("animate-pulse");
  });
});

describe("Story 4.5 — E7 performer:disconnected", () => {
  it("receiving `performer:disconnected` → StatusPill « Performer déconnecté »", async () => {
    renderFlow();
    const socket = await join();
    act(() => {
      socket.fireServer("performer:disconnected", {
        performerId: "srv-owner",
        reason: "transport close",
      });
    });
    expect(useListenerStore.getState().fluxStatus).toBe(
      "performer-disconnected",
    );
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "Performer déconnecté",
    );
    // Not an app crash: the listener stays joined.
    expect(useListenerStore.getState().joined).toBe(true);
  });
});

describe("Story 4.5 — E13 unsupported-version", () => {
  it("an incompatible `v` shows the E13 Alert and does NOT schedule (no send)", async () => {
    renderFlow();
    const socket = await join();
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 1,
        ts: 1000,
        v: 2, // incompatible with PROTOCOL_VERSION (1)
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 9999,
      });
    });
    // E13 Alert shown with the EXACT text.
    expect(screen.getByTestId("listener-protocol-alert")).toHaveTextContent(
      "Version de protocole incompatible. Rafraîchissez la page.",
    );
    // The incompatible event was NOT scheduled.
    expect(outSend).not.toHaveBeenCalled();
    // And NOT counted as received (not processed).
    expect(useListenerStore.getState().eventsReceived).toBe(0);
    expect(useListenerStore.getState().fluxStatus).not.toBe("active");
  });

  it("a compatible `v` still flows through the 4.3 chain (send) and clears no alert", async () => {
    renderFlow();
    const socket = await join();
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
    expect(outSend).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("listener-protocol-alert"),
    ).not.toBeInTheDocument();
  });
});

describe("Story 4.5 — server-down + reconnect (no replay)", () => {
  it("involuntary disconnect → StatusPill « Serveur déconnecté… » + no window.confirm", async () => {
    renderFlow();
    await join();
    // Involuntary network drop (the FakeSocket fires the disconnect event,
    // unlike its `disconnect()` method which only counts).
    act(() => {
      lastConnect.socket!.fireServer("disconnect", "transport close");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("server-down");
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "Serveur déconnecté. Reconnexion automatique en cours…",
    );
    // No blocking dialog.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("connect_error → server-down pill (no blocking dialog)", async () => {
    renderFlow();
    await join();
    act(() => {
      lastConnect.socket!.fireServer("connect_error", new Error("x"));
    });
    expect(useListenerStore.getState().fluxStatus).toBe("server-down");
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "Serveur déconnecté. Reconnexion automatique en cours…",
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("reconnect: flux returns to waiting and re-emits room:join (resume)", async () => {
    renderFlow();
    const socket = await join();
    // Drop then reconnect.
    act(() => {
      socket.fireServer("disconnect", "transport close");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("server-down");
    const emitsBefore = socket.emitCalls.filter(
      (c) => c.ev === "room:join",
    ).length;
    act(() => {
      socket.fireServer("connect"); // reconnect
    });
    // Flux back to waiting (joined, no event yet on the new connection).
    expect(useListenerStore.getState().fluxStatus).toBe("waiting");
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "En attente du performer…",
    );
    // A new room:join was emitted to re-enter ROOM after reconnect.
    const emitsAfter = socket.emitCalls.filter(
      (c) => c.ev === "room:join",
    ).length;
    expect(emitsAfter).toBe(emitsBefore + 1);
  });

  it("reconnect: NO replay — only NEW events after reconnect trigger send", async () => {
    renderFlow();
    const socket = await join();
    // One event before the drop → scheduled once.
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
    expect(outSend).toHaveBeenCalledTimes(1);
    // Drop → server-down (no send during the outage).
    act(() => {
      socket.fireServer("disconnect", "transport close");
    });
    expect(outSend).toHaveBeenCalledTimes(1);
    // Reconnect → waiting (NO replay: the pre-disconnect event is NOT re-sent).
    act(() => {
      socket.fireServer("connect");
    });
    expect(outSend).toHaveBeenCalledTimes(1); // still 1 — nothing replayed
    // Only a NEW event after reconnect triggers a new send.
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
    expect(outSend).toHaveBeenCalledTimes(2); // only the new event
    const second = outSend.mock.calls[1] as [Uint8Array, number];
    expect(Array.from(second[0])).toEqual([0x90, 62, 100]);
  });
});

describe("Story 4.5 — « Quitter le flux » stays clean (no server-down)", () => {
  it("voluntary leave: emits room:leave, store idle, StatusPill idle, no server-down", async () => {
    renderFlow();
    const socket = await join();
    // Make the flux active first so we can see it reset to idle on leave.
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

    act(() => {
      fireEvent.click(screen.getByTestId("listener-join-button")); // « Quitter »
    });
    const leaveCall = socket.emitCalls.find((c) => c.ev === "room:leave");
    expect(leaveCall).toBeDefined();
    expect(leaveCall!.payload).toEqual({});
    act(() => {
      leaveCall!.ack!({ ok: true });
    });
    // Voluntary leave → idle, NOT server-down.
    expect(useListenerStore.getState().joined).toBe(false);
    expect(useListenerStore.getState().fluxStatus).toBe("idle");
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Inactif",
    );
    expect(screen.getByTestId("listener-status-pill")).toHaveAttribute(
      "data-state",
      "idle",
    );
    // Even if a disconnect event were to fire after the voluntary leave, the
    // intentionalClose guard prevents server-down (verify via the FakeSocket
    // firing disconnect after leave: no server-down).
    act(() => {
      socket.fireServer("disconnect", "client namespace disconnect");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("idle");
  });
});