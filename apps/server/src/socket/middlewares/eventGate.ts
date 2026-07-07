import type { Socket, Event } from "socket.io";
import type { ServerSocketData } from "./roleAuth.js";

// Per-event gate (AD-2, AD-16, FR-18, FR-19). Installed with `socket.use`, which
// runs on EVERY inbound client event (not just at handshake). It enforces the
// one-way model per-event: a non-owner `midi:event` never reaches a handler, and
// a listener may only emit a small allow-list (`room:join` / `room:leave` /
// `midi:test`). Forbidden events increment a PER-SOCKET counter; on the 3rd the
// socket is disconnected — but the counter lives on `socket.data`, so a fresh
// connection starts at zero (NO persistent ban, AD-16).
//
// middlewares element (leaf, `middlewares -> []`): the owner id is read via a
// LOCAL port injected by the socket-wiring layer (never imports `services`).
// `eventGate` may import `roleAuth` (same element — intra-element, allowed).

/** Read-only port the gate needs from the owner registry. */
export interface OwnerStatusPort {
  getOwnerPerformerId(): string | null;
}

/** Stable ack response handed back to a client that used an emit-with-ack. */
export interface ForbiddenAck {
  readonly ok: false;
  readonly error: "forbidden";
}

/** Events a LISTENER may emit inbound (FR-18). Everything else is forbidden. */
const LISTENER_ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  "room:join",
  "room:leave",
  "midi:test",
]);

/** Disconnect threshold (AD-16). Below it, the event is refused but the socket stays. */
const FORBIDDEN_LIMIT = 3;

/** The single event the gate polices for ownership (FR-19, one-way). */
const OWNER_ONLY_EVENT = "midi:event";

/**
 * Decide whether `eventName` from `data` is permitted, given the current owner.
 * Pure — unit-tested directly via the middleware below.
 *
 * - `midi:event`: only the current owner (role `performer` AND `performerId`
 *   matches the registry). A non-owner performer is refused (defense-in-depth:
 *   a 2nd performer is already refused at handshake in Story 2.3, but the gate
 *   re-checks `performerId === ownerPerformerId` regardless).
 * - Any other event from a `listener`: allowed iff in the listener allow-list.
 * - Any other event from a `performer`: not restricted by this gate (the spec
 *   gates only `midi:event` for performers).
 */
export function isEventAllowed(
  eventName: string,
  data: ServerSocketData,
  registry: OwnerStatusPort,
): boolean {
  if (eventName === OWNER_ONLY_EVENT) {
    return data.role === "performer" && data.performerId === registry.getOwnerPerformerId();
  }
  if (data.role === "listener") {
    return LISTENER_ALLOWED_EVENTS.has(eventName);
  }
  return true;
}

/**
 * Build the per-event `socket.use` middleware with the owner registry injected.
 * On a forbidden event: increment the per-socket counter, hand a stable
 * `{ ok:false, error:"forbidden" }` to the client ack IF one was provided (so the
 * client can observe the refusal deterministically — `next(err)` alone does NOT
 * call the ack), then `next(new Error("forbidden"))` to block the handler. On the
 * 3rd forbidden, disconnect the socket (no persistent ban — counter is per-socket).
 */
export function createEventGateMiddleware(opts: { socket: Socket; registry: OwnerStatusPort }) {
  const { socket, registry } = opts;
  return function eventGate(event: Event, next: (err?: Error) => void): void {
    const eventName = event[0];
    const data = socket.data as ServerSocketData;

    if (isEventAllowed(eventName, data, registry)) {
      next();
      return;
    }

    // Forbidden: per-socket counter (resets on reconnect — no ban, AD-16).
    data.forbiddenCount = (data.forbiddenCount ?? 0) + 1;

    // If the client emitted with an ack, respond deterministically. `next(err)`
    // short-circuits the handler but does NOT invoke the ack on its own.
    const ack = event[event.length - 1];
    if (typeof ack === "function") {
      (ack as (resp: ForbiddenAck) => void)({ ok: false, error: "forbidden" });
    }

    // Block the event from reaching any handler (Socket.IO short-circuits on err).
    next(new Error("forbidden"));

    // On the 3rd forbidden, cut the socket off. Order: ack → block → disconnect,
    // so the client observes the refusal before the drop.
    if (data.forbiddenCount >= FORBIDDEN_LIMIT) {
      socket.disconnect(true);
    }
  };
}