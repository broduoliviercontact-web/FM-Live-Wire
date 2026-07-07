import { timingSafeEqual } from "node:crypto";
import type { Socket, ExtendedError } from "socket.io";

// AD-2: server-side identity is pinned at handshake and is non-modifiable by
// the client. `performerId` is ALWAYS `socket.id` (server-authoritative) and
// NEVER a client-supplied value.
//
// AD-10: performer auth uses a shared secret (`OWNER_SECRET`), compared with
// `crypto.timingSafeEqual` (length-guarded so it never throws on mismatched
// lengths). Failures are reported with a SINGLE generic message `"invalid"` —
// no distinction between "missing" and "incorrect" (anti-enumeration). The
// secret is server-only; it is injected here by the socket-wiring layer, so
// this module stays a boundaries leaf (no internal imports).

/** Roles accepted at handshake. `owner` is not a client-declared role. */
export type AuthRole = "listener" | "performer";

/** Shape pinned onto `socket.data` by the middleware. */
export interface ServerSocketData {
  role?: AuthRole;
  performerId?: string;
  /** Per-socket `forbidden` counter (event gate, AD-16). Lives on the socket,
   *  so it resets naturally on reconnect — NO persistent ban. */
  forbiddenCount?: number;
}

/** Generic role error (bad/missing role). Distinct from token auth failure. */
export class ForbiddenRoleError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenRoleError";
  }
}

/** Generic token-auth error — same message for every failure (AD-10). */
export class InvalidAuthError extends Error {
  constructor() {
    super("invalid");
    this.name = "InvalidAuthError";
  }
}

/** Single-slot owner conflict (AD-2, FR-4): a second performer is refused. */
export class PerformerBusyError extends Error {
  constructor() {
    super("performer:busy");
    this.name = "PerformerBusyError";
  }
}

/**
 * Write-side port the middleware needs from the owner registry. Defined LOCALLY
 * (not imported from `services`) so this module stays a boundaries leaf
 * (`middlewares -> []`): the concrete `PerformerRegistry` is injected by the
 * socket-wiring layer, which is allowed to import `services`. Structural typing
 * — any object with these methods satisfies the port.
 */
export interface OwnerRegistryPort {
  tryTakeOwner(performerId: string): boolean;
}

/** Read a well-typed role from the opaque `handshake.auth` bag. */
function readRole(auth: unknown): AuthRole | undefined {
  if (typeof auth !== "object" || auth === null) return undefined;
  if (!("role" in auth)) return undefined;
  const role = (auth as { role: unknown }).role;
  if (role === "listener" || role === "performer") return role;
  return undefined;
}

/**
 * Pure, deterministic timing-safe token check (AD-10). Returns `false` for every
 * failure — non-string token, empty secret, or mismatched length (guarded so
 * `timingSafeEqual` is never called with unequal lengths and never throws).
 * Only equal-length strings reach `timingSafeEqual`. Never exposes the reason.
 *
 * Empty `ownerSecret` → always `false`: in dev (no secret set) performers are
 * rejected generically; listeners are unaffected (they need no token).
 */
export function isTokenValidTimingSafe(token: unknown, ownerSecret: string): boolean {
  if (typeof token !== "string") return false;
  if (ownerSecret.length === 0) return false;
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(ownerSecret);
  if (tokenBuf.length !== secretBuf.length) return false; // length guard, no throw
  return timingSafeEqual(tokenBuf, secretBuf);
}

/**
 * Build the `io.use` middleware with the server-side `OWNER_SECRET` and the
 * owner registry injected. Listeners need no token; performers must present a
 * timing-safe-valid token AND claim the single owner slot — a second performer
 * is refused with `performer:busy` (AD-2, FR-4; the existing owner is never
 * replaced). On success, `socket.data.role` + `socket.data.performerId =
 * socket.id` are pinned (any client-supplied `performerId` is ignored).
 */
export function createRoleAuthMiddleware(opts: {
  ownerSecret: string;
  registry: OwnerRegistryPort;
}) {
  return function roleAuthMiddleware(socket: Socket, next: (err?: ExtendedError) => void): void {
    const role = readRole(socket.handshake.auth);
    if (role === undefined) {
      next(new ForbiddenRoleError());
      return;
    }
    // Performer: validate the shared secret (AD-10), THEN claim the owner slot
    // (AD-2). Listeners skip both. Token failure is reported BEFORE the slot
    // check so a wrong token yields `invalid` (not `performer:busy`).
    if (role === "performer") {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (!isTokenValidTimingSafe(token, opts.ownerSecret)) {
        next(new InvalidAuthError());
        return;
      }
      // `socket.id` is server-assigned and available during the handshake
      // middleware. Claiming here means a rejected 2nd performer never takes
      // the slot (tryTakeOwner returns false → refuse, no replacement).
      if (!opts.registry.tryTakeOwner(socket.id)) {
        next(new PerformerBusyError());
        return;
      }
    }
    const data = socket.data as ServerSocketData;
    data.role = role;
    if (role === "performer") {
      // Server-authoritative identity; client-supplied `performerId` is ignored.
      data.performerId = socket.id;
    }
    next();
  };
}