import {
  io,
  type Socket,
  type ManagerOptions,
  type SocketOptions,
} from "socket.io-client";
import type { MidiEvent } from "../../../entities/MidiEvent";
import { resolveClientTransports, isProdClient } from "../../../lib/socket-client";

// Story 4.3 — listener Socket.IO client (AD-10: no secret on the listener).
//
// A listener connects with `auth: { role: "listener" }` ONLY — no token (the
// server accepts a listener at the role handshake without one, Story 2.2).
// `performerId` is server-authoritative and never sent by the client. The
// listener's room is imposed by the server (`ROOM`, Story 2.7): the client
// emits `room:join` with a MINIMAL payload (`{}`) so the server's
// `(_payload, ack)` handler receives the ack as its 2nd arg (the established,
// tested pattern — see `apps/server/src/__tests__/socket.test.ts`). The client
// never requests a custom room (no public multi-room).
//
// `reconnection: true` (bounded, same knobs as the performer Story 3.5) so a
// network loss after a successful join is recovered automatically. There is
// NO replay of the past: events received after a reconnect are forwarded as
// they arrive; the listener does not buffer or retry old events (AD-17).
//
// Same-origin by default: omitting `url` connects to the page origin; in
// production the server serves the web build on one origin, so the WebSocket
// handshake satisfies the server's origin allowlist (AD-15).

/** Auth payload sent in `socket.auth` (AD-10: no secret on the listener). */
export interface ListenerAuth {
  readonly role: "listener";
}

/** Bounded reconnection knobs (mirrors the performer Story 3.5). */
export const RECONNECTION_ATTEMPTS = 20;
export const RECONNECTION_DELAY = 500;
export const RECONNECTION_DELAY_MAX = 5000;

/** Stable ack shape for `room:join` / `room:leave` (AD-19, server Story 2.7). */
export type RoomAck = { ok: true };

export interface ConnectListenerOptions {
  /** Server URL. Omit for same-origin (production). */
  readonly url?: string;
}

/**
 * Connection + reception handlers wired by `connectListener` onto the socket.
 * The caller (JoinButton) drives the join/leave UI + the remap→encode→send
 * pipeline from `onMidiEvent`. The optional handlers are guarded so the caller
 * wires only what it needs.
 */
export interface ListenerSocketHandlers {
  /** Fired when the socket connects (initial + each successful reconnect). */
  readonly onConnect?: () => void;
  /** Fired when the socket disconnects (network loss, server-side close, or own). */
  readonly onDisconnect?: (reason: string) => void;
  /**
   * Fired for each `midi:event` broadcast the listener receives. The event is
   * the relayed wire payload (the server adds `performerId` + `srvTs`; those
   * are ignored at the wire edge by `encodeForOutput`).
   */
  readonly onMidiEvent?: (event: MidiEvent) => void;
  /**
   * Story 4.5 — E7: the server reports the performer (owner) disconnected.
   * Emitted to `ROOM` by the server (Story 2.3) with `{ performerId, reason }`.
   * The listener only receives it while joined to `ROOM`.
   */
  readonly onPerformerDisconnected?: (payload: {
    performerId: string;
    reason?: string;
  }) => void;
  /**
   * Story 4.5 — server-down: the connection failed or the manager gave up
   * (`connect_error` / `reconnect_error`). Drives the server-down pill.
   */
  readonly onConnectError?: (err: unknown) => void;
  /** Story 4.5 — a reconnect attempt is starting (backoff in progress). */
  readonly onReconnectAttempt?: (attempt: number) => void;
  /**
   * Story 4.5 — the socket reconnected after a loss. The caller re-joins the
   * room (no replay: only future events are forwarded, AD-17).
   */
  readonly onReconnect?: () => void;
}

/**
 * Open a listener Socket.IO connection and wire the connection + reception
 * handlers. The caller emits `room:join` / `room:leave` via the helpers below.
 *
 * @param handlers connection + `midi:event` callbacks.
 * @param opts     optional URL (same-origin when omitted).
 * @returns the connected `Socket`.
 */
export function connectListener(
  handlers: ListenerSocketHandlers,
  opts: ConnectListenerOptions = {},
): Socket {
  const auth: ListenerAuth = { role: "listener" };
  const socketOpts: Partial<ManagerOptions & SocketOptions> = {
    auth,
    reconnection: true,
    reconnectionAttempts: RECONNECTION_ATTEMPTS,
    reconnectionDelay: RECONNECTION_DELAY,
    reconnectionDelayMax: RECONNECTION_DELAY_MAX,
    // Story 6.8 hotfix / NFR-14: prod forces WebSocket-only so the client never
    // opens a polling handshake the prod server rejects with 400 (Render). Mirrors
    // the server's `resolveTransports(isProd)`; dev/test keeps polling + websocket.
    transports: resolveClientTransports(isProdClient()),
  };
  const socket = opts.url ? io(opts.url, socketOpts) : io(socketOpts);

  socket.on("connect", () => handlers.onConnect?.());
  socket.on("disconnect", (reason: string) => handlers.onDisconnect?.(reason));
  socket.on("midi:event", (event: MidiEvent) => handlers.onMidiEvent?.(event));
  // Story 4.5 — lifecycle + performer-disconnected (E7) handlers. No new
  // server event is created: `performer:disconnected` is emitted by the server
  // (Story 2.3); `connect_error` / `reconnect_attempt` / `reconnect` are
  // Socket.IO manager events.
  socket.on("performer:disconnected", (payload: { performerId: string; reason?: string }) =>
    handlers.onPerformerDisconnected?.(payload),
  );
  socket.on("connect_error", (err: unknown) => handlers.onConnectError?.(err));
  socket.on("reconnect_attempt", (attempt: number) =>
    handlers.onReconnectAttempt?.(attempt),
  );
  socket.on("reconnect", () => handlers.onReconnect?.());

  return socket;
}

/**
 * Emit `room:join` with a minimal payload so the server's `(_payload, ack)`
 * handler receives the ack as its 2nd arg (tested pattern, Story 2.7). The
 * server joins the listener to `ROOM` (the client never requests a custom
 * room). The optional ack receives `{ ok: true }`.
 */
export function emitRoomJoin(
  socket: Socket,
  ack?: (res: RoomAck) => void,
): void {
  socket.emit("room:join", {}, ack);
}

/**
 * Emit `room:leave` (mirrors `emitRoomJoin`). The optional ack receives
 * `{ ok: true }`.
 */
export function emitRoomLeave(
  socket: Socket,
  ack?: (res: RoomAck) => void,
): void {
  socket.emit("room:leave", {}, ack);
}