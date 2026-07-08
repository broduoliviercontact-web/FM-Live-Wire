// Hotfix fidélité musicale — deferred playback anchor math (pure).
//
// The listener used to schedule each received `midi:event` at
// `sendAt = performance.now() + LOOKAHEAD_MS` (`scheduler.ts`). That made the
// RELATIVE musical spacing between events depend on network arrival jitter: even
// though WebSocket preserves message order, irregular arrival intervals
// distorted the inter-event timing the performer intended. On a second machine
// the restitution was perceptibly drifted.
//
// Fix: use the performer's `event.ts` (its `event.timeStamp`, a
// `performance.now()`-relative MONOTONIC value from the PERFORMER's time origin)
// as RELATIVE musical time ONLY — never compared absolutely to the listener's
// `performance.now()` (the Story 6.8 hotfix principle: cross-client
// `performance.now()` origins are never comparable). Instead, anchor the FIRST
// received event locally and reconstruct each event's slot from DIFFERENCES:
//
//   anchorPerformerTs = firstEvent.ts
//   anchorLocalMs     = performance.now() + PLAYBACK_DELAY_MS
//   targetLocalMs     = anchorLocalMs + max(0, event.ts - anchorPerformerTs)
//   output.send(bytes, targetLocalMs)
//
// The `PLAYBACK_DELAY_MS` buffer absorbs network jitter: a stable ~1.5 s
// restitution latency trades for inter-event spacing that mirrors the performer.
// The anchor is reset on join / leave / reconnect / output change / channel
// change / Panic / output-lost / performer-disconnect (the wiring in
// `api/connection.ts` calls `scheduler.resetAnchor()`).
//
// PURE module: no DOM, no clock, no output, no socket, no store. Only
// `config/runtime` (the tunable constants) is imported. Every function is
// deterministic + unit-testable; the stateful bit (holding the anchor) lives in
// the scheduler factory, which calls `computeTargetLocalMs` with the current
// anchor and stores the (possibly new) anchor it returns.

import { LOOKAHEAD_MS, PLAYBACK_DELAY_MS } from "../../../config/runtime";

/**
 * The deferred-playback anchor: the performer `ts` of the first event in the
 * current session + the LOCAL `performance.now()`-relative time it should play
 * at (`now + PLAYBACK_DELAY_MS` at establishment). `null` before the first
 * finite event (the scheduler holds this; reset on lifecycle points).
 */
export interface Anchor {
  /** The performer `event.ts` the anchor was established from. */
  readonly performerTs: number;
  /** The LOCAL `performance.now()`-relative play time of that first event. */
  readonly localMs: number;
}

/**
 * Establish a fresh anchor: the first event's `performerTs` plays at
 * `now + PLAYBACK_DELAY_MS` locally. Pure.
 */
export function establishAnchor(
  performerTs: number,
  now: number,
  delay: number = PLAYBACK_DELAY_MS,
): Anchor {
  return { performerTs, localMs: now + delay };
}

/**
 * The RELATIVE musical offset of `performerTs` from `anchorPerformerTs`, clamped
 * to 0 so a performer `ts` that goes backwards (clock reset / incoherent stamp /
 * a new performer after turnover whose `performance.now()` restarted near 0) is
 * treated as "now" rather than producing a negative — hence past — target. Pure.
 *
 * Note: `Math.max(0, NaN) === NaN`, so callers MUST guard non-finite
 * `performerTs` BEFORE calling this (see {@link computeTargetLocalMs}).
 */
export function relativeMs(performerTs: number, anchorPerformerTs: number): number {
  return Math.max(0, performerTs - anchorPerformerTs);
}

/**
 * Compute the LOCAL play target for one event, establishing the anchor on the
 * first finite event. Returns the target AND the anchor to store (the scheduler
 * keeps the anchor in its own state).
 *
 * Non-finite `performerTs` (NaN / Infinity — the schema's `z.number()` accepts
 * them): safe fallback — send IMMINENT at `now + LOOKAHEAD_MS` and do NOT
 * establish / poison the anchor (a NaN must not contaminate subsequent events).
 * The returned `anchor` is the input `anchor` unchanged in that case.
 *
 * `delay` defaults to `PLAYBACK_DELAY_MS` (1500); tests inject other values.
 * Pure.
 */
export function computeTargetLocalMs(
  performerTs: number,
  anchor: Anchor | null,
  now: number,
  delay: number = PLAYBACK_DELAY_MS,
): { targetLocalMs: number; anchor: Anchor | null } {
  // Non-finite performer ts → safe fallback, anchor untouched.
  if (!Number.isFinite(performerTs)) {
    return { targetLocalMs: now + LOOKAHEAD_MS, anchor };
  }
  const nextAnchor = anchor ?? establishAnchor(performerTs, now, delay);
  const targetLocalMs = nextAnchor.localMs + relativeMs(performerTs, nextAnchor.performerTs);
  return { targetLocalMs, anchor: nextAnchor };
}

/**
 * `true` when the event's musical slot is already past (or within the lookahead
 * window): `targetLocalMs < now + LOOKAHEAD_MS`. This is the deferred-mode
 * "late": the `PLAYBACK_DELAY_MS` buffer could not absorb the arrival jitter, so
 * the event cannot keep its intended slot. The scheduler then falls back
 * (noteOn/noteOff/programChange → imminent send) or drops (CC/pitchBend). Pure.
 */
export function isScheduleLate(targetLocalMs: number, now: number): boolean {
  return targetLocalMs < now + LOOKAHEAD_MS;
}

/**
 * How far past its slot the event is, in ms: `max(0, now - targetLocalMs)`.
 * `0` when on time. Shown in `LateAlert` / `LatencyStat` as the restitution
 * retard (coherent with the schedule-late trigger). Pure.
 */
export function scheduleLateMs(targetLocalMs: number, now: number): number {
  return Math.max(0, now - targetLocalMs);
}