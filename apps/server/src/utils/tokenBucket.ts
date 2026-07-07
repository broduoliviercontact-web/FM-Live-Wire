// Pure token bucket (AD-13, FR-22, NFR-3). Per-socket rate limiting for
// `midi:event`: capacity burst 200, refill 100/s.
//
// This module is a boundaries leaf (`srv-utils -> []`): no internal imports,
// no side effects, NO `Date.now()` — time is always injected by the caller so
// the bucket is deterministic and unit-testable in isolation. Given the same
// state + same `nowMs` + same cost, the output is identical (no hidden state,
// no mutation of the input — `consumeToken` returns a NEW state).

/** Bucket capacity (burst size). Default 200 (AD-13, NFR-3). */
export const DEFAULT_CAPACITY = 200;
/** Refill rate in tokens per second. Default 100 (AD-13, NFR-3). */
export const DEFAULT_REFILL_PER_SECOND = 100;

/**
 * Immutable bucket state. `tokens` is a float (refill is fractional per ms);
 * comparisons use `>=` so partial refills still gate correctly. `lastRefillMs`
 * is the timestamp of the last refill/consume attempt — the caller's clock.
 */
export interface TokenBucketState {
  readonly capacity: number;
  readonly refillPerSecond: number;
  readonly tokens: number;
  readonly lastRefillMs: number;
}

/**
 * Create a fresh bucket state, full to capacity. `nowMs` is the caller's
 * injected clock (defaults to 0 — the caller SHOULD pass its current time so
 * the first `consumeToken` computes a correct elapsed delta). No clock is read
 * inside this module.
 */
export function createTokenBucketState(opts?: {
  capacity?: number;
  refillPerSecond?: number;
  nowMs?: number;
}): TokenBucketState {
  const capacity = opts?.capacity ?? DEFAULT_CAPACITY;
  const refillPerSecond = opts?.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND;
  return {
    capacity,
    refillPerSecond,
    tokens: capacity,
    lastRefillMs: opts?.nowMs ?? 0,
  };
}

/**
 * Try to consume `cost` (default 1) token at `nowMs`. PURE: returns a NEW
 * state; never mutates the input.
 *
 * Refill model: `elapsed = max(0, nowMs - lastRefillMs)` seconds ×
 * `refillPerSecond`, added to `tokens` and capped at `capacity`. A non-positive
 * elapsed (clock jumped backwards) yields zero refill — never a negative one.
 *
 * Whether allowed OR denied, `lastRefillMs` advances to `nowMs` and `tokens`
 * is set to the refilled level (minus `cost` if allowed). Advancing the clock
 * on a denial is what prevents double-counting the same refill on the next
 * call — the refill is "banked" even when nothing is consumed.
 *
 * Determinism: same `state` + same `nowMs` + same `cost` → same result, always.
 */
export function consumeToken(
  state: TokenBucketState,
  nowMs: number,
  cost = 1,
): { allowed: boolean; state: TokenBucketState } {
  const elapsedMs = Math.max(0, nowMs - state.lastRefillMs);
  const refill = (elapsedMs / 1000) * state.refillPerSecond;
  const refilled = Math.min(state.capacity, state.tokens + refill);

  if (refilled >= cost) {
    return {
      allowed: true,
      state: { ...state, tokens: refilled - cost, lastRefillMs: nowMs },
    };
  }
  // Denied: bank the refill (tokens = refilled) and advance the clock so the
  // next call does not re-add the same elapsed refill.
  return {
    allowed: false,
    state: { ...state, tokens: refilled, lastRefillMs: nowMs },
  };
}