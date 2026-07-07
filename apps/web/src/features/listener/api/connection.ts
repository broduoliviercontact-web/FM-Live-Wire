import { useEffect } from "react";
import type { Socket } from "socket.io-client";
import type { MidiEvent } from "../../../entities/MidiEvent";
import { PROTOCOL_VERSION } from "../../../entities/MidiEvent";
import { useListenerStore } from "../store/listenerStore";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import {
  connectListener,
  emitRoomJoin,
  emitRoomLeave,
  type RoomAck,
} from "./socket";
import { encodeForOutput } from "../lib/encode";
import { createMidiScheduler, type ScheduleResult } from "../lib/scheduler";
import type { MidiSendable } from "../lib/sendable";

// Story 4.4 / 4.5 — shared listener Socket.IO connection (AD-10, AD-11, AD-12,
// AD-17).
//
// In 4.3 the `JoinButton` owned the socket in a local ref. Story 4.4 moved it
// to a module singleton so `JoinButton` and `TestNoteButton` share ONE socket
// (no two concurrent listener sockets). Story 4.5 extends the lifecycle wiring
// to drive the new flux states from the socket events:
//   - `performer:disconnected` (server, Story 2.3) → flux `performer-disconnected`
//     (E7: not an app crash — the listener stays joined).
//   - `disconnect` / `connect_error` (involuntary) → flux `server-down` (the
//     pill shows « Serveur déconnecté. Reconnexion automatique en cours… »,
//     Socket.IO backoff runs, no blocking dialog).
//   - `connect` (reconnect) → re-enter `ROOM` (the server lost the membership
//     on disconnect, Story 2.7) and clear `server-down`. No replay:
//     only future events are forwarded (AD-17).
//
// `ensureListenerSocket()` connects a listener socket with `onMidiEvent` only
// (NO `room:join`): joining is the explicit `joinFlux()` action, so the
// `TestNoteButton` can open a connection for `midi:test` without joining.
//
// The `midi:event` pipeline is the Story 4.3 chain with the Story 5.4
// backpressure layer + the Story 5.5 musical fail-safe:
//   protocol check (4.5) → remap → encode (`encodeForOutput`) → schedule
//   (`createMidiScheduler` → bounded buffer 256 + per-type late fallback/drop,
//   5.4) on the selected raw `MIDIOutput`. Story 4.4 added counters / activity
//   / status BEFORE the output lookup (an event with no selected output still
//   counts as received). Story 4.5 adds the protocol check BEFORE the counters:
//   an incompatible `v` sets `protocolError` (E13 Alert) and is NOT
//   scheduled/counted. Story 5.4 adds, AFTER the send, the LOCAL telemetry
//   update (fallbackCount / droppedCount / lateWarning / lastLatencyMs) — LOCAL
//   PUR (FR-27): no server overload event (or any network event) is emitted.
//   No replay, no queue of old events, no retry (AD-17). The late noteOn/noteOff/
//   programChange are sent via the immediate fallback path (not lost, FR-26);
//   late controlChange / pitchBend are dropped (FR-26); the buffer is bounded
//   at `BUFFER_CAP` with drop-oldest (FR-25).
//
// Story 5.5 — musical fail-safe (AD-17, FR-24, UX-DR14 E5/E6, AC-U9/U10):
//   - involuntary `disconnect` / `connect_error` → `scheduler.stop()` (server-
//     down: no in-flight bytes) AND the server-down pill (4.5). The Panic stays
//     local + active (5.2) — it does not need the scheduler or the server.
//   - `connect` (initial + reconnect) → `scheduler.start()` (resume LIVE — no
//     replay: nothing is queued, the pending count is reset to 0) + re-enter
//     ROOM on a reconnect where the listener was joined (4.5).
//   - voluntary `leaveFlux` → `scheduler.stop()` (clean idle, no server-down).
//   - output lost (port unplugged / `state:"disconnected"` / `send()` threw
//     `InvalidStateError`) → `handleOutputLost()`: stop the scheduler, clear
//     `selectedOutputId` (the `MidiPortPicker` reopens), raise the E5
//     `outputLost` flag. Picking a new sortie clears the alert (store action)
//     and the first event after that auto-resumes the scheduler (live, no
//     replay). LOCAL: no network event is ever emitted for any of these.

// --- module singleton state -------------------------------------------------

let socketRef: Socket | null = null;

/**
 * Story 5.4 / 5.5 — the shared backpressure + fail-safe scheduler. Holds the
 * transient pending-buffer length (bounded at `BUFFER_CAP`) + the stopped gate
 * (5.5); the reactive telemetry counters live in the listener store and are
 * updated from each `ScheduleResult`. The `onOutputLost` callback is raised when
 * `output.send` throws (e.g. `InvalidStateError`) — it routes to
 * `handleOutputLost` (defined below; hoisted, so it is safe to reference here).
 * Reset to factory on test isolation.
 */
const listenerScheduler = createMidiScheduler({
  onOutputLost: () => handleOutputLost(),
});

/**
 * Story 5.5 — LOCAL output-lost fail-safe (AD-17, FR-24, UX-DR14 E5, AC-U9).
 * Stop the scheduler (no in-flight bytes / no orphan notes), clear the selected
 * output so the `MidiPortPicker` reopens (the listener can pick another sortie
 * or the Mock), and raise the E5 `outputLost` flag. LOCAL PUR (FR-27): no network
 * event is emitted. Called by the `useOutputState` watcher (port unplugged /
 * `state:"disconnected"`) and by the scheduler's `onOutputLost` (a `send()`
 * throw — `InvalidStateError`). Idempotent.
 */
export function handleOutputLost(): void {
  const store = useListenerStore.getState();
  listenerScheduler.stop();
  if (store.selectedOutputId !== null) store.setSelectedOutput(null);
  store.setOutputLost(true);
}

/**
 * Story 5.5 — resume LIVE reception when the listener picks a NEW sortie after a
 * loss (the scheduler was stopped by `handleOutputLost`). Called by the
 * `useOutputState` watcher on a non-null selection change. Guarded by
 * `isStopped()` so a normal hot-switch (scheduler running) does NOT reset the
 * pending count. No replay: `start()` resets the count to 0 and nothing is
 * queued. This does NOT fire on server-down (the selection is unchanged), so
 * events that arrive while the link is down still produce no send.
 */
export function resumeListenerScheduler(): void {
  if (listenerScheduler.isStopped()) listenerScheduler.start();
}

/**
 * The sendable-output lookup from `useMidiOutputs` (stable callback). Returns a
 * real `MIDIOutput` for a port id, or the `MockMidiOutput` for `MOCK_OUTPUT_ID`
 * (Story 5.1). Set by `useListenerConnection` on mount so the `midi:event`
 * handler — wired once at socket creation — can reach the live output at event
 * time. Typed as `MidiSendable` so the scheduler treats Mock and real identically.
 */
let getOutputRef: ((id: string) => MidiSendable | null) | null = null;

/** Mount refcount: disconnect only when the LAST listener consumer unmounts. */
let mountCount = 0;

/**
 * Story 4.5 — marks a DISCONNECT as intentional (voluntary `leaveFlux`, unmount,
 * test reset) so the `disconnect` handler does NOT flip the flux to
 * `server-down`. Only an involuntary loss (network failure / server close) shows
 * the server-down pill. Set just before `socket.disconnect()` on the voluntary
 * paths; cleared by the `disconnect` handler.
 */
let intentionalClose = false;

/**
 * Story 4.5 — defensive protocol check at the wire edge. The server validates
 * `v` (Story 2.6) and only relays events with `v === PROTOCOL_VERSION`, but a
 * stale client build may receive a newer protocol. Read `v` without TS narrowing
 * the literal `1` to always-match, so the check is live at runtime.
 */
function hasProtocolMismatch(event: MidiEvent): boolean {
  const v = (event as unknown as { v?: unknown }).v;
  return v !== PROTOCOL_VERSION;
}

/** Forward a received `midi:event` to the output + update flux state (4.4/4.5). */
function handleMidiEvent(event: MidiEvent): void {
  // Story 4.5 — E13: an incompatible protocol version is NOT scheduled. Set the
  // `protocolError` flag (drives the Alert) and stop. The event is not counted
  // (it was not processed).
  if (hasProtocolMismatch(event)) {
    useListenerStore.getState().setProtocolError(true);
    return;
  }
  const store = useListenerStore.getState();
  // Story 4.4 — count + activity + status BEFORE the output lookup, so an
  // event received with no output selected still counts as received.
  store.incEventsReceived();
  if (event.type === "noteOn") store.pulseNoteOn();
  store.setFluxStatus("active");
  // Story 4.3 pipeline + Story 5.4 backpressure: remap → encode → schedule on
  // the selected raw output (real `MIDIOutput` or the Story 5.1 Mock singleton
  // — the scheduler is agnostic, it depends only on `MidiSendable`). Skip (no
  // crash, no buffer) if no output / hot-unplug.
  const outputId = store.selectedOutputId;
  if (outputId === null) return;
  const getOutput = getOutputRef;
  if (getOutput === null) return;
  const output = getOutput(outputId);
  if (output === null) return; // selected output gone (hot-unplug) → skip
  const bytes = encodeForOutput(event, store.channel);
  // Story 5.4 — bounded buffer + per-type late fallback/drop. `srvTs` is an
  // optional server-added envelope field (telemetry only, AD-11) stamped as
  // `Date.now()` (epoch ms) at relay. `receivedAtMs` is the listener's OWN
  // `Date.now()` at reception — comparable to `srvTs` (both epoch), so
  // `receivedAtMs - srvTs` is a sane downstream latency (Story 6.8 hotfix,
  // NFR-2/NFR-19). The performer `event.ts` (a `performance.now()`-relative
  // monotonic value from the PERFORMER's time origin) is deliberately NOT used
  // for late/fallback: subtracting it from the epoch `srvTs` produced ~1.78e12 ms
  // of garbage latency on Render → every event flagged late. `event.type` drives
  // the per-type policy (FR-26). The conditional spread keeps `srvTs` absent when
  // undefined (`exactOptionalPropertyTypes`).
  const srvTs = (event as unknown as { srvTs?: number }).srvTs;
  const result: ScheduleResult = listenerScheduler.schedule(output, bytes, {
    type: event.type,
    receivedAtMs: Date.now(),
    ...(srvTs !== undefined ? { srvTs } : {}),
  });
  // Story 5.5 — fail-safe no-op: a stopped `schedule` (scheduler stopped on
  // disconnect / server-down / output lost) sends nothing and touches no
  // telemetry / no alert. The flux status / E5 flag already reflect the cause.
  if (result.stopped === true) return;
  // Story 5.4 — LOCAL telemetry update (FR-27: no network event emitted).
  // Buffer overflow → the oldest was dropped. Late + fallbackType → the new
  // event was sent immediately. Late + dropType → the new event was dropped.
  // `lateWarning` is recomputed each event (calm reception clears it, UX-DR12).
  if (result.bufferOverflow) store.incDropped();
  if (result.outcome === "fallback") store.incFallback();
  if (result.outcome === "dropped") store.incDropped();
  store.setLastLatencyMs(result.latencyMs);
  store.setLateWarning(result.late || result.bufferOverflow);
}

/**
 * Story 4.5 — `connect` handler (initial + each reconnect). On a reconnect
 * where the listener was joined, re-enter `ROOM` (the server lost the membership
 * on disconnect, Story 2.7) and clear the server-down pill. No
 * replay — only future events are forwarded (AD-17). On the initial connect
 * `joined` is still false (the `joinFlux` ack has not fired yet), so this just
 * clears any transient `server-down` from prior failed attempts.
 */
function handleConnect(): void {
  const store = useListenerStore.getState();
  // Story 5.5 — resume LIVE reception (no replay: `start()` resets the pending
  // count to 0 and clears the fail-safe gate). Runs on the initial connect AND
  // on each reconnect; on the initial connect the scheduler was already running
  // (factory), so this is a harmless fresh reset.
  listenerScheduler.start();
  if (store.joined) {
    // Resume live reception: optimistic `waiting` (clears server-down) +
    // re-emit `room:join` to re-enter ROOM. The ack re-confirms `joined`.
    store.setFluxStatus("waiting");
    const socket = socketRef;
    if (socket !== null) {
      emitRoomJoin(socket, () => {
        useListenerStore.getState().setJoined(true);
      });
    }
  } else {
    // Not joined (e.g. a TestNoteButton-only socket reconnected): clear any
    // server-down from the prior failed attempts, no join.
    store.setFluxStatus("idle");
  }
}

/** Story 4.5 — involuntary disconnect → server-down (unless intentional).
 *  Story 5.5 — also STOP the scheduler (no in-flight bytes while down, AD-17). */
function handleDisconnect(): void {
  if (intentionalClose) {
    intentionalClose = false; // voluntary leave/unmount → no server-down
    return;
  }
  listenerScheduler.stop(); // fail-safe: no sends while the link is down
  useListenerStore.getState().setFluxStatus("server-down");
}

/** Open the listener socket if none is open yet; return the current socket. */
export function ensureListenerSocket(): Socket {
  if (socketRef !== null) return socketRef;
  const socket = connectListener({
    onMidiEvent: handleMidiEvent,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onConnectError: () => {
      // Cannot reach the server → server-down pill (backoff retries).
      // Story 5.5 — also stop the scheduler (no in-flight bytes while down).
      listenerScheduler.stop();
      useListenerStore.getState().setFluxStatus("server-down");
    },
    onPerformerDisconnected: () => {
      // E7: the performer (owner) left. Not an app crash — stay joined.
      useListenerStore.getState().setFluxStatus("performer-disconnected");
    },
    // reconnect_attempt: the server-down pill already says "Reconnexion
    // automatique en cours…"; no separate state needed (visible indicator).
  });
  socketRef = socket;
  return socket;
}

/**
 * Join the room: ensure a socket, then emit `room:join` (minimal `{}` payload +
 * ack). On `{ok:true}` flip `joined` and set the flux to `waiting` (AC-U18:
 * joined, no event yet). Self-gates on a selected output (AC-U3) — no join
 * without an output, even if called directly.
 */
export function joinFlux(): void {
  const store = useListenerStore.getState();
  if (store.selectedOutputId === null) return; // AC-U3: no join without output
  if (store.joined) return; // already joined
  const socket = ensureListenerSocket();
  emitRoomJoin(socket, (res: RoomAck) => {
    if (res?.ok === true) {
      const s = useListenerStore.getState();
      s.setJoined(true);
      s.setFluxStatus("waiting");
    }
  });
}

/**
 * Leave the room: emit `room:leave` (minimal `{}` payload + ack), then flip
 * `joined` to false, reset the flux to idle, and disconnect the socket. The
 * disconnect is marked intentional so it does NOT trigger the server-down pill
 * (Story 4.5). If no socket is open, just reset to idle.
 */
export function leaveFlux(): void {
  const socket = socketRef;
  if (socket === null) {
    const s = useListenerStore.getState();
    s.setJoined(false);
    s.resetFlux();
    return;
  }
  emitRoomLeave(socket, () => {
    const s = useListenerStore.getState();
    s.setJoined(false);
    s.resetFlux();
    // Story 5.5 — STOP the scheduler on voluntary leave (clean idle, no
    // in-flight bytes). `resetFlux` already cleared the 5.4 telemetry; the
    // pending buffer is reset to factory on the next `start()` (rejoin).
    listenerScheduler.stop();
    intentionalClose = true; // voluntary leave → no server-down on disconnect
    socket.disconnect();
    socketRef = null;
  });
}

/**
 * Story 6.1 — CLEAN leave-before-navigation for the listener `BackToHome`
 * (Q-UX10, UX-DR1). Synchronous so the leave/disconnect completes BEFORE the
 * route change (the `BackToHome` component calls this, THEN `navigate("/")`).
 *
 * Unlike `leaveFlux` (the « Quitter le flux » button, which waits for the
 * `room:leave` ack before disconnecting), this is a best-effort
 * `room:leave` emit followed by an immediate intentional disconnect: the
 * listener is navigating away, so the socket is torn down regardless and the
 * server removes the socket from `ROOM` on disconnect (no ghost membership).
 * `intentionalClose` is set BEFORE the disconnect so the `disconnect` handler
 * does NOT flip the flux to `server-down` (the listener left voluntarily).
 *
 * The scheduler is STOPPED (Story 5.5 — no in-flight bytes) and the flux is
 * reset to idle (no `server-down` pill, no stale `joined`). Idempotent + safe
 * when not joined / no socket (no-op). LOCAL: no network event beyond the
 * best-effort `room:leave`.
 */
export function leaveListenerForNavigation(): void {
  const socket = socketRef;
  const store = useListenerStore.getState();
  if (socket !== null) {
    if (store.joined) {
      // Best-effort `room:leave` (no ack wait — we disconnect right after).
      emitRoomLeave(socket, () => {});
    }
    listenerScheduler.stop();
    intentionalClose = true; // voluntary → no server-down pill on the disconnect
    socket.disconnect();
    socketRef = null;
  } else {
    // No socket (e.g. never joined) — still stop the scheduler if it exists.
    listenerScheduler.stop();
  }
  store.setJoined(false);
  store.resetFlux();
}

/**
 * Emit `midi:test` (listener→server, FR-18/2.7). Ensures a socket is open
 * (creating one WITHOUT joining — no implicit `room:join`) so the test tone can
 * be sent before the listener joins the room. The server acks `{ok:true}` and
 * does NOT broadcast (the note plays locally on the listener's output).
 */
export function emitMidiTest(): void {
  const socket = ensureListenerSocket();
  socket.emit("midi:test", {});
}

// --- React hook (mount refcount + getOutput wiring) ------------------------

export interface ListenerConnectionActions {
  readonly joinFlux: () => void;
  readonly leaveFlux: () => void;
  readonly emitMidiTest: () => void;
}

/**
 * Bind the shared listener connection to a component's lifecycle: keep the
 * `getOutput` lookup wired (so `handleMidiEvent` can reach the live output) and
 * refcount the mount so the socket is disconnected only when the last listener
 * consumer unmounts. Returns the imperative connection actions.
 *
 * Must be called from components rendered under `MidiAccessProvider` (the hook
 * reads `getOutput` from `useMidiOutputs`).
 */
export function useListenerConnection(): ListenerConnectionActions {
  const { getOutput } = useMidiOutputs();

  useEffect(() => {
    getOutputRef = getOutput;
    mountCount += 1;
    return () => {
      mountCount -= 1;
      if (mountCount <= 0 && socketRef !== null) {
        intentionalClose = true; // unmount → no server-down
        socketRef.disconnect();
        socketRef = null;
      }
      if (mountCount <= 0) getOutputRef = null;
      mountCount = Math.max(mountCount, 0);
    };
  }, [getOutput]);

  return { joinFlux, leaveFlux, emitMidiTest };
}

/** Test-only reset of the module singleton (no socket leak between tests). */
export function __resetListenerConnection(): void {
  if (socketRef !== null) {
    intentionalClose = true; // test reset → no server-down side-effect
    socketRef.disconnect();
    socketRef = null;
  }
  getOutputRef = null;
  mountCount = 0;
  intentionalClose = false;
  listenerScheduler.reset(); // Story 5.4 — clear the pending buffer between tests
}