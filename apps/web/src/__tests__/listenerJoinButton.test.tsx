// @vitest-environment jsdom
// Story 4.3 — JoinButton tests (UX-DR10, AC-U3).
//
// Proves:
//   - without a selected output: « Rejoindre le flux » is disabled, the EXACT
//     hint « Choisissez une sortie MIDI pour rejoindre. » is shown, and NO
//     socket is opened / NO `room:join` is emitted;
//   - with a selected output: clicking « Rejoindre le flux » connects the
//     listener socket, emits `room:join` (minimal `{}` payload + ack), and on
//     the `{ok:true}` ack the button becomes « Quitter le flux »;
//   - clicking « Quitter le flux » emits `room:leave`, flips `joined` to false,
//     and disconnects the socket.
//
// socket.io-client is mocked with a fake socket that records emits + can fire
// server events (`connect`) and ack callbacks. No real network. No MIDI access
// needed for join/leave (the output port is only touched on `midi:event`,
// covered in listenerReception.test.tsx).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { JoinButton } from "../features/listener/components/JoinButton";
import { useListenerStore } from "../features/listener/store/listenerStore";

const HINT = "Choisissez une sortie MIDI pour rejoindre.";

// vi.hoisted so the mock factory can reference the fake socket + shared state.
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

function renderButton() {
  return render(
    <MidiAccessProvider>
      <JoinButton />
    </MidiAccessProvider>,
  );
}

beforeEach(() => {
  useListenerStore.getState().reset();
  lastConnect.socket = undefined;
});

afterEach(() => {
  cleanup();
});

describe("JoinButton — disabled without an output (AC-U3)", () => {
  it("renders « Rejoindre le flux » disabled with the EXACT hint, no socket", () => {
    renderButton();
    const btn = screen.getByTestId("listener-join-button") as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Rejoindre le flux");
    expect(screen.getByTestId("listener-join-hint")).toHaveTextContent(HINT);
    // No socket opened (handleJoin early-returns on null selection).
    expect(lastConnect.socket).toBeUndefined();
  });

  it("does NOT emit room:join when disabled (click is a no-op)", () => {
    renderButton();
    const btn = screen.getByTestId("listener-join-button") as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn); // disabled click is ignored by the browser, but
      // assert even a forced handler path would emit nothing.
    });
    expect(lastConnect.socket).toBeUndefined();
    expect(useListenerStore.getState().joined).toBe(false);
  });
});

describe("JoinButton — join / leave with an output selected", () => {
  beforeEach(() => {
    useListenerStore.getState().setSelectedOutput("o1");
  });

  it("clicking « Rejoindre le flux » connects + emits room:join, then becomes « Quitter le flux » on {ok:true}", () => {
    renderButton();
    const btn = screen.getByTestId("listener-join-button") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    act(() => {
      fireEvent.click(btn);
    });
    // Socket opened.
    const socket = lastConnect.socket;
    expect(socket).toBeDefined();
    // Server fires `connect` → onConnect → emitRoomJoin.
    act(() => {
      socket!.fireServer("connect");
    });
    const joinCall = socket!.emitCalls.find((c) => c.ev === "room:join");
    expect(joinCall).toBeDefined();
    // Minimal `{}` payload (server (_payload, ack) handler pattern).
    expect(joinCall!.payload).toEqual({});
    expect(joinCall!.ack).toBeTypeOf("function");
    // Button is still « Rejoindre » until the ack resolves.
    expect(btn).toHaveTextContent("Rejoindre le flux");
    // Ack {ok:true} → joined true → button flips.
    act(() => {
      joinCall!.ack!({ ok: true });
    });
    expect(useListenerStore.getState().joined).toBe(true);
    expect(screen.getByTestId("listener-join-button")).toHaveTextContent(
      "Quitter le flux",
    );
    // Hint gone once joined (button shows Quitter).
    expect(screen.queryByTestId("listener-join-hint")).not.toBeInTheDocument();
  });

  it("the join flow never touches `joining` (characterization — field is dead in prod)", () => {
    // Audit (Phase F): `joining` is a dead field — nothing in the join path
    // sets it true, nothing reads it. Pin this so a future wiring of `joining`
    // (an in-flight guard / "joining…" UI) is an intentional, visible change —
    // not a silent side-effect. The current path drives `joined` + `fluxStatus`
    // only. (Does NOT pin double-click / no-ack / navigation-in-flight — out of
    // scope for this minimal characterization.)
    renderButton();
    expect(useListenerStore.getState().joining).toBe(false); // baseline after reset

    const btn = screen.getByTestId("listener-join-button");
    act(() => {
      fireEvent.click(btn);
    });
    const socket = lastConnect.socket!;
    act(() => {
      socket.fireServer("connect");
    });
    const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;

    // Before the ack: `room:join` is emitted, but `joining` stays false (the
    // in-flight window is NOT flagged — `joined` is still false too).
    expect(useListenerStore.getState().joining).toBe(false);
    expect(useListenerStore.getState().joined).toBe(false);

    act(() => {
      joinCall.ack!({ ok: true });
    });

    // After the ack: `joined` flips to true, `joining` STILL false (never set).
    expect(useListenerStore.getState().joined).toBe(true);
    expect(useListenerStore.getState().joining).toBe(false);
  });

  // --- G1 — no-ack join characterization (silent failure, NOT yet fixed) -------
  // `emitRoomJoin(socket, ack)` has NO client-side timeout. If the server never
  // calls the ack (mid-flight disconnect, middleware drop, server crash), the
  // join flow stays SILENT: nothing flips `joined`, no error state, the button
  // keeps offering « Rejoindre ». These tests pin that current behaviour so a
  // future timeout / error UI is an intentional change, not a silent drift.
  // They do NOT add a timeout, do NOT add an error message, do NOT change any
  // user-facing behaviour.

  it("room:join WITHOUT ack leaves the listener un-joined (silent failure, not yet fixed)", () => {
    renderButton();
    const btn = screen.getByTestId("listener-join-button");
    act(() => {
      fireEvent.click(btn);
    });
    const socket = lastConnect.socket!;
    act(() => {
      socket.fireServer("connect"); // handleConnect (joined still false → idle)
    });
    const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
    // `room:join` was emitted WITH an ack callback — the server just never
    // calls it (the no-ack scenario).
    expect(joinCall.ack).toBeTypeOf("function");

    // DELIBERATELY never call `joinCall.ack(...)`.

    const s = useListenerStore.getState();
    expect(s.joined).toBe(false);
    expect(s.joining).toBe(false); // not wired (Phase F characterization)
    // Button stays « Rejoindre le flux » — no false « Quitter » state.
    expect(screen.getByTestId("listener-join-button")).toHaveTextContent(
      "Rejoindre le flux",
    );
  });

  it("room:join WITHOUT ack stays silent — NO server-down (characterization, not yet fixed)", () => {
    renderButton();
    const btn = screen.getByTestId("listener-join-button");
    act(() => {
      fireEvent.click(btn);
    });
    const socket = lastConnect.socket!;
    act(() => {
      socket.fireServer("connect");
    });
    const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
    // Never ack.

    // The no-ack is a SILENT failure today: no server-down pill, no error state.
    // `fluxStatus` stays `idle` — `handleConnect` sets `idle` when `joined` is
    // still false (the join ack would have flipped it to `waiting`, but it
    // never fired). Pinning the current (silent) value so a future fix is
    // visible.
    expect(useListenerStore.getState().fluxStatus).not.toBe("server-down");
    expect(useListenerStore.getState().fluxStatus).toBe("idle");
    expect(useListenerStore.getState().joined).toBe(false);
  });

  it("clicking « Quitter le flux » emits room:leave, flips joined false, disconnects", () => {
    renderButton();
    const btn = screen.getByTestId("listener-join-button") as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn);
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

    // Now leave.
    const quitBtn = screen.getByTestId("listener-join-button");
    act(() => {
      fireEvent.click(quitBtn);
    });
    const leaveCall = socket.emitCalls.find((c) => c.ev === "room:leave");
    expect(leaveCall).toBeDefined();
    expect(leaveCall!.payload).toEqual({});
    expect(leaveCall!.ack).toBeTypeOf("function");
    // Before ack: still joined.
    expect(useListenerStore.getState().joined).toBe(true);
    // Ack {ok:true} → joined false + disconnect.
    act(() => {
      leaveCall!.ack!({ ok: true });
    });
    expect(useListenerStore.getState().joined).toBe(false);
    expect(socket.disconnectCount).toBe(1);
    expect(screen.getByTestId("listener-join-button")).toHaveTextContent(
      "Rejoindre le flux",
    );
  });
});