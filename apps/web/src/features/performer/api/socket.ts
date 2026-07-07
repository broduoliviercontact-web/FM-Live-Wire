import { io, type Socket, type ManagerOptions, type SocketOptions } from "socket.io-client";

// Story 3.1 + 3.5 — performer Socket.IO client (AD-10: token never in the URL).
//
// The performer connects with `auth: { role: "performer", token }`. The token
// travels ONLY in `socket.auth` (the handshake CONNECT payload) — it is NEVER
// appended to the URL, query string, or sent as a header. `performerId` is
// server-authoritative (`socket.id`); the client NEVER sends it.
//
// Reconnection policy (Story 3.5, UX-DR23):
//   - `reconnection: true` so a network drop AFTER a successful connect is
//     recovered automatically with backoff (no replay of the past — AD-17).
//   - Terminal handshake errors (`invalid` / `performer:busy`, and a generic
//     initial-handshake failure) are NOT retried: the caller's `onConnectError`
//     calls `socket.disconnect()` which stops the backoff loop, then renders a
//     terminal UI state. The user drives the next action (fix token / wait).
//   - Reconnection is bounded (`RECONNECTION_ATTEMPTS`); on exhaustion the
//     socket stays disconnected and the indicator shows "Déconnecté".
//
// Same-origin by default: omitting `url` makes socket.io-client connect to the
// page origin. In production the server serves the web build on one origin, so
// the WebSocket handshake satisfies the server's origin allowlist (AD-15).

/** Auth payload sent in `socket.auth` (AD-10: token never in URL/headers). */
export interface PerformerAuth {
  readonly role: "performer";
  readonly token: string;
}

/** Backoff knobs (Story 3.5: reasonable, bounded reconnection). */
export const RECONNECTION_ATTEMPTS = 20;
export const RECONNECTION_DELAY = 500; // ms, initial delay before the 1st retry
export const RECONNECTION_DELAY_MAX = 5000; // ms, cap between retries

export interface ConnectPerformerOptions {
  /**
   * Server URL. Omit for same-origin (production). The token is NEVER appended
   * here — it lives only in `auth`.
   */
  url?: string;
}

/**
 * Connection lifecycle handlers wired by `connectPerformer` onto the socket
 * (Story 3.5). The caller (PerformerPanel) updates the React handshake UI +
 * the performer store from these.
 */
export interface PerformerSocketHandlers {
  /** Fired when the socket connects (initial + each successful reconnect). */
  readonly onConnect: () => void;
  /** Fired when the socket disconnects (network drop, server drop, or own disconnect). */
  readonly onDisconnect: (reason: string) => void;
  /** Fired before each reconnection attempt (1-based attempt number). */
  readonly onReconnectAttempt: (attempt: number) => void;
  /** Fired on a successful reconnection. */
  readonly onReconnect: () => void;
  /** Fired when a reconnection attempt fails. */
  readonly onReconnectError: (err: Error) => void;
  /** Fired on a connection error (initial handshake AND each failed reconnect). */
  readonly onConnectError: (err: Error) => void;
}

/**
 * Open a performer Socket.IO connection and wire the connection lifecycle
 * handlers (Story 3.5). The token is sent only via `socket.auth`.
 *
 * @param token    the admin token (the server-side shared secret).
 * @param handlers connection lifecycle callbacks (connect/disconnect/reconnect…).
 * @param opts     optional URL (same-origin when omitted).
 * @returns the connected `Socket`.
 */
export function connectPerformer(
  token: string,
  handlers: PerformerSocketHandlers,
  opts: ConnectPerformerOptions = {},
): Socket {
  const auth: PerformerAuth = { role: "performer", token };
  const socketOpts: Partial<ManagerOptions & SocketOptions> = {
    auth,
    reconnection: true,
    reconnectionAttempts: RECONNECTION_ATTEMPTS,
    reconnectionDelay: RECONNECTION_DELAY,
    reconnectionDelayMax: RECONNECTION_DELAY_MAX,
  };
  // `io(opts)` → same-origin; `io(uri, opts)` → explicit URL. Both overloads
  // exist on socket.io-client's `lookup`.
  const socket = opts.url ? io(opts.url, socketOpts) : io(socketOpts);

  // Wire the connection lifecycle (Story 3.5). The caller interprets these; this
  // module only forwards the raw Socket.IO events so the UI/store stay decoupled
  // from socket.io-client internals.
  socket.on("connect", () => handlers.onConnect());
  socket.on("disconnect", (reason: string) => handlers.onDisconnect(reason));
  socket.on("reconnect_attempt", (attempt: number) => handlers.onReconnectAttempt(attempt));
  socket.on("reconnect", () => handlers.onReconnect());
  socket.on("reconnect_error", (err: Error) => handlers.onReconnectError(err));
  socket.on("connect_error", (err: Error) => handlers.onConnectError(err));

  return socket;
}