import type { Socket, Event } from "socket.io";
import type { ServerSocketData } from "./roleAuth.js";
import {
  createTokenBucketState,
  consumeToken,
  type TokenBucketState,
} from "../../utils/tokenBucket.js";

// Per-socket token-bucket rate limiter (AD-13, FR-22, NFR-3). Installed with
// `socket.use` AFTER the event gate (Story 2.4). Because the gate already
// refuses non-owner `midi:event` with `forbidden` and `next(err)` short-circuits
// the socket.use chain, this middleware only ever sees `midi:event` from the
// CURRENT owner performer (listeners never reach it). It rate-limits ONLY
// `midi:event` — `room:join` / `room:leave` / `midi:test` pass through untouched
// (this story does not rate-limit public listener events).
//
// On exhaustion: the event is blocked (`next(new Error("rate:limited"))`), an
// explicit `{ ok:false, error:"rate:limited" }` is handed to the client ack IF
// one was provided (`next(err)` alone does NOT invoke the ack — same pattern as
// the gate), and a SAMPLED log is emitted (NOT one per rejection). The socket
// is NOT disconnected in this story (no persistent ban — the bucket is per
// socket and resets on reconnect).
//
// middlewares element (leaf-ish): imports `srv-utils` (the pure bucket) only.
// The logger is injected via a LOCAL structural port so this module does NOT
// import `srv-shared` directly (same pattern as roleAuth's OwnerRegistryPort).
// `rateLimit` may import `roleAuth` (same element — intra-element, allowed).

/** Stable ack response handed back to a client that used an emit-with-ack. */
export interface RateLimitedAck {
  readonly ok: false;
  readonly error: "rate:limited";
}

/**
 * Local structural logger port — what this middleware actually needs. The
 * concrete `Logger` from `srv-shared` is injected by the socket-wiring layer
 * (which is allowed to import `srv-shared`), so this module stays a leaf.
 */
export interface RateLimitLoggerPort {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** The single event this limiter polices (FR-19, one-way). */
const RATE_LIMITED_EVENT = "midi:event";

/** Sampled-log interval: log the 1st rejection, then every 50th per socket. */
const LOG_SAMPLE_EVERY = 50;

export interface RateLimitOptions {
  socket: Socket;
  /** Injected clock. Defaults to `Date.now()` at runtime; tests inject a
   *  deterministic clock (the pure bucket never reads a clock itself). */
  now?: () => number;
  /** Injected logger (sampled). Optional — wiring passes the socket logger. */
  logger?: RateLimitLoggerPort;
  /** Bucket capacity (burst). Defaults to 200 (AD-13). */
  capacity?: number;
  /** Refill rate (tokens/s). Defaults to 100 (AD-13). */
  refillPerSecond?: number;
}

/**
 * Build the per-socket `socket.use` rate-limit middleware. The bucket state
 * lives in the closure (one bucket per socket → resets naturally on reconnect,
 * no global state, no persistent ban).
 */
export function createRateLimitMiddleware(opts: RateLimitOptions) {
  const { socket } = opts;
  const now = opts.now ?? (() => Date.now());
  const logger = opts.logger;
  const bucketOpts: { capacity?: number; refillPerSecond?: number; nowMs: number } = { nowMs: now() };
  if (opts.capacity !== undefined) bucketOpts.capacity = opts.capacity;
  if (opts.refillPerSecond !== undefined) bucketOpts.refillPerSecond = opts.refillPerSecond;
  let state: TokenBucketState = createTokenBucketState(bucketOpts);
  let limitedCount = 0;

  return function rateLimit(event: Event, next: (err?: Error) => void): void {
    const eventName = event[0];
    // Only `midi:event` is policed; everything else passes straight through.
    if (eventName !== RATE_LIMITED_EVENT) {
      next();
      return;
    }

    const result = consumeToken(state, now());
    state = result.state;
    if (result.allowed) {
      next();
      return;
    }

    // Exhausted: count, log SAMPLED (1st + every 50th — NOT one per rejection),
    // ack the client deterministically, then block the handler.
    limitedCount += 1;
    if (logger && (limitedCount === 1 || limitedCount % LOG_SAMPLE_EVERY === 0)) {
      const data = socket.data as ServerSocketData;
      logger.warn("rate:limited", {
        socketId: socket.id,
        role: data.role,
        limitedCount,
      });
    }

    const ack = event[event.length - 1];
    if (typeof ack === "function") {
      (ack as (resp: RateLimitedAck) => void)({ ok: false, error: "rate:limited" });
    }

    // Block the event from reaching any handler (Socket.IO short-circuits on err).
    next(new Error("rate:limited"));
  };
}