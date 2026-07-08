// Story 5.4 / 5.5 — listener scheduler with backpressure + musical fail-safe
// (AD-11, AD-17, FR-24/25/26/27, NFR-2, NFR-19).
//
// Extends the Story 4.3 minimal lookahead scheduler with a bounded pending
// buffer + per-type late fallback/drop + a LOCAL late warning (5.4), AND a
// musical fail-safe gate (5.5): the scheduler can be STOPPED so it sends
// NOTHING (no in-flight bytes, no orphan notes), then STARTED again to resume
// the LIVE flux without replaying the past (AD-17). The decision logic is split
// into PURE functions (testable in isolation, no DOM / no clock / no output)
// and a thin stateful factory that holds only the transient pending-buffer
// length + the stopped flag.
//
// Constants come from `config/runtime.ts` (LOOKAHEAD_MS=40, MAX_LATE_MS=200,
// BUFFER_CAP=256) — consumed here for the first time (Epic 5). They are
// tunable constants (FR-25..27); the per-type policy is figée (FR-26).
//
// Per-type late policy (FR-26, figé):
//   - noteOn / noteOff / programChange late → fallback IMMEDIATE
//     `output.send(data, now)` (the note / program is NOT lost).
//   - controlChange / pitchBend late → DROP (high-frequency, droppable late).
//
// "Late" means `receivedAtMs - srvTs > MAX_LATE_MS` (strictly greater). 200 ms
// exact is NOT late (boundary), 201 ms IS late. `srvTs` is optional on a relayed
// event (absent → no latency check → normal lookahead path — preserves the
// existing calm-reception behavior).
//
// CLOCK DOMAINS (Story 6.8 hotfix — cross-client latency bug, NFR-2/NFR-19):
// There are TWO distinct clocks and they MUST NOT be mixed:
//   - Scheduling target: the LOCAL high-res MONOTONIC clock `performance.now()`
//     (passed as `now`). `sendAt = now + LOOKAHEAD_MS` goes to `output.send`.
//     This is a LOCAL listener value — never compared across clients.
//   - Latency / late: the COMPARABLE EPOCH clock `Date.now()`. The server stamps
//     `srvTs = Date.now()` at relay (epoch ms, ~1.78e12 in 2026); the listener
//     stamps `receivedAtMs = Date.now()` at reception. Both are wall-clock epoch
//     ms (NTP-synced within tens of ms across machines), so
//     `receivedAtMs - srvTs` is a sane downstream relay→listener latency.
//
// The performer's `event.ts` is `event.timeStamp` (DOMHighResTimeStamp, i.e. a
// `performance.now()`-relative MONOTONIC value from the PERFORMER's time origin).
// It is NOT comparable to either the server's `srvTs` (epoch) or the listener's
// `Date.now()`/`performance.now()` (different time origins). Subtracting it from
// `srvTs` produced ~1.78e12 ms of garbage latency on Render → every event was
// flagged late → 5783 fallbacks + 5527 drops (the prod symptom). The performer
// `ts` is therefore NOT used for late/fallback — it stays on the event as origin
// info only. Late is now driven solely by the comparable epoch pair above.
//
// Bounded buffer (FR-25): a pending count. When it reaches `BUFFER_CAP`, the
// OLDEST pending event is dropped to make room (the count stays capped at
// `BUFFER_CAP` — never an infinite queue), and a local warning is signaled.
//
// LOCAL ONLY (FR-27, AC-U11): NO network event is ever raised here. This
// module imports neither the live network link nor the join/leave handshake;
// the late warning is raised purely in the listener store. No replay, no
// retry (AD-17). `srvTs` is read for telemetry only (AD-11), never re-loged.
//
// Story 5.5 — musical fail-safe (AD-17, FR-24, AC-U9/U10):
//   - `stop()`  : a TRUE gate. Once stopped, every future `schedule` call is a
//                 no-op (no `output.send`, no buffer growth, no replay, no
//                 retry). Used on involuntary disconnect / server-down AND on
//                 output lost (port closed / unplugged / `send()` throws).
//   - `start()`: resume LIVE reception. Clears the stopped flag AND resets the
//                 pending count to 0 (fresh — no stale backlog is ever flushed).
//                 No past event is ever re-scheduled after a start (AD-17):
//                 nothing is queued, so there is nothing to replay.
//   - `send()`  : wrapped in a try/catch. A throw (e.g. `InvalidStateError`
//                 when the port is closed) stops the scheduler and signals
//                 output lost via the optional `onOutputLost` callback — the
//                 error never reaches the UI (no crash, no throw up).
//
// The scheduler does NOT distinguish Mock vs real output: it depends only on
// the minimal `MidiSendable` contract (Story 5.1), so the pipeline
// `event → remap → encode → schedule → output.send` is identical for the Mock
// singleton and a hardware port. No Mock-specific branch lives here.

import { LOOKAHEAD_MS, MAX_LATE_MS, BUFFER_CAP, PLAYBACK_DELAY_MS } from "../../../config/runtime";
import type { MidiSendable } from "./sendable";
import {
  computeTargetLocalMs,
  isScheduleLate,
  scheduleLateMs,
  type Anchor,
} from "./playback";

/** The 5 channel-voice message types (mirrors `MidiEvent["type"]`). */
export type MidiEventType =
  | "noteOn"
  | "noteOff"
  | "controlChange"
  | "programChange"
  | "pitchBend";

/** The fate of the NEW event being scheduled. */
export type ScheduleOutcome = "sent" | "fallback" | "dropped";

/** Result of a `schedule` call — drives the listener-store telemetry updates. */
export interface ScheduleResult {
  /** The new event's fate: sent (lookahead), fallback (immediate), or dropped. */
  readonly outcome: ScheduleOutcome;
  /** `true` when `effectiveLatencyMs > MAX_LATE_MS` (strict). `false` when `srvTs` absent. */
  readonly late: boolean;
  /**
   * Effective (non-negative) downstream latency `max(0, receivedAtMs - srvTs)`
   * (epoch ms, comparable), or `null` when `srvTs` is absent. Clamped to 0 so
   * clock skew (server ahead of client → negative raw delta) never reads as a
   * delay and never drives the late decision. The UI shows this value.
   */
  readonly latencyMs: number | null;
  /** The buffer was full → the OLDEST pending event was dropped (FR-25). */
  readonly bufferOverflow: boolean;
  /**
   * Story 5.5 — `true` when the scheduler was STOPPED so the event was NOT sent
   * (fail-safe gate). Omitted / `false` for a normally-scheduled event. The
   * reception wiring checks this to skip telemetry + alerts for a stopped event.
   */
  readonly stopped?: boolean;
  /**
   * Hotfix fidélité musicale — how far past its musical slot the event was, in ms
   * (`max(0, now - targetLocalMs)`; 0 when on time). The reception wiring stores
   * this as `lastLatencyMs` so `LateAlert` / `LatencyStat` display the restitution
   * retard, coherent with the schedule-late trigger (the buffer could not absorb
   * the jitter). Distinct from the epoch network latency (`latencyMs`).
   */
  readonly scheduleLateMs: number;
  /**
   * Hotfix audit — le slot musical reconstruit (`anchor.localMs +
   * max(0, performerTs - anchor.performerTs)`), l'instant local absolu ciblé par
   * la restitution différée. Exposé pour le diagnostic timing (trace listener) ;
   * pour un event `stopped` (pas de send), reflète `now` et n'est pas un vrai
   * target. Toujours défini (aucune nouvelle branche).
   */
  readonly targetLocalMs: number;
  /**
   * Hotfix audit — l'instant local de scheduling (`now`) utilisé par cette
   * décision. Sert au diagnostic (colonne `now` + `sentTimestamp` pour le
   * fallback) et au miroir d'ancre du module debug. Toujours défini.
   */
  readonly now: number;
}

/** Info needed to schedule one event (besides the raw bytes + the output). */
export interface ScheduleInfo {
  readonly type: MidiEventType;
  /**
   * Hotfix fidélité musicale — the performer's `event.ts` (its `event.timeStamp`,
   * a `performance.now()`-relative MONOTONIC value from the PERFORMER's time
   * origin). Used ONLY as RELATIVE musical time: the scheduler anchors the first
   * event to `now + PLAYBACK_DELAY_MS` and plays each event at
   * `anchorLocalMs + max(0, performerTs - anchorPerformerTs)`. It is NEVER
   * compared absolutely to the listener's `now` / the epoch `srvTs` / `receivedAtMs`
   * (cross-client `performance.now()` origins are not comparable — Story 6.8
   * hotfix principle). Non-finite (NaN/Infinity) → safe imminent fallback.
   */
  readonly performerTs: number;
  /** Server relay timestamp, epoch ms (`Date.now()` server-side). Telemetry only, AD-11. Absent → no latency check. */
  readonly srvTs?: number;
  /**
   * Listener receipt time, epoch ms (`Date.now()` at reception). Comparable to
   * `srvTs` (both wall-clock epoch, NTP-synced) → `receivedAtMs - srvTs` is a
   * sane downstream latency. NOT the performer `event.ts` (a `performance.now()`
   * from a different time origin — never comparable across clients).
   */
  readonly receivedAtMs: number;
}

/**
 * Compute the RAW downstream relay latency `receivedAtMs - srvTs` (epoch ms −
 * epoch ms, comparable), or `null` when `srvTs` is absent. Pure: no clock, no
 * output, no side effect. MAY BE NEGATIVE under server/client clock skew (the
 * server's `Date.now()` runs a few hundred ms ahead of the listener's) — a
 * negative one-way estimate is meaningless, so callers that drive the late
 * decision or the UI MUST go through {@link effectiveLatencyMs} instead.
 *
 * NOTE: this deliberately does NOT use the performer `event.ts`. The server's
 * `srvTs` is epoch `Date.now()` while the performer's `ts` is a
 * `performance.now()`-relative monotonic value — subtracting them yields
 * ~1.78e12 ms of garbage (the Render prod symptom). Only the comparable epoch
 * pair (`receivedAtMs`, `srvTs`) is used.
 */
export function computeLatencyMs(
  srvTs: number | undefined,
  receivedAtMs: number,
): number | null {
  if (srvTs === undefined) return null;
  return receivedAtMs - srvTs;
}

/**
 * Effective (non-negative) latency used by the late decision AND the UI:
 * `Math.max(0, computeLatencyMs(srvTs, receivedAtMs))`, or `null` when `srvTs`
 * is absent. Clock skew between the Render server and the listener machine can
 * make the raw `receivedAtMs - srvTs` NEGATIVE (the listener clock runs behind
 * the server) — that does NOT mean the event arrived "before" it was relayed.
 * Clamping to 0 guarantees: (a) `isLate` never fires on skew, (b) the stat /
 * LateAlert never reads "−162 ms". Pure.
 */
export function effectiveLatencyMs(
  srvTs: number | undefined,
  receivedAtMs: number,
): number | null {
  const raw = computeLatencyMs(srvTs, receivedAtMs);
  return raw === null ? null : Math.max(0, raw);
}

/**
 * `true` when the effective latency is late (strictly greater than
 * `MAX_LATE_MS`). 200 ms exact is NOT late (boundary); `null` (no `srvTs`) is
 * NOT late; a clamped-to-0 (clock-skew) value is NOT late. Pure.
 */
export function isLate(latencyMs: number | null): boolean {
  return latencyMs !== null && latencyMs > MAX_LATE_MS;
}

/**
 * Per-type late policy (FR-26, figée). `noteOn` / `noteOff` / `programChange`
 * are structurally musical — better applied than lost → fallback. `controlChange`
 * / `pitchBend` are high-frequency / droppable when late → drop. Pure.
 */
export function shouldFallbackOnLate(type: MidiEventType): boolean {
  return type === "noteOn" || type === "noteOff" || type === "programChange";
}

/** Input to the pure backpressure decision. */
export interface BackpressureInput {
  readonly type: MidiEventType;
  readonly latencyMs: number | null;
  readonly late: boolean;
  /** Pending buffer length BEFORE this event (caps at `BUFFER_CAP`). */
  readonly bufferLength: number;
}

/**
 * The backpressure decision WITHOUT the deferred-restitution retard. The
 * scheduler factory merges `scheduleLateMs` in after the send (it depends on
 * the deferred target, which the pure decision does not know). Tests of the
 * pure `decideBackpressure` see exactly these four fields.
 */
export type BackpressureResult = Omit<
  ScheduleResult,
  "scheduleLateMs" | "targetLocalMs" | "now"
>;

/**
 * Pure backpressure decision: given the event (type + latency) and the current
 * pending-buffer length, decide the new event's fate. No clock, no output, no
 * side effect — fully deterministic and unit-testable.
 *
 * The `bufferOverflow` flag is independent of the outcome: a full buffer drops
 * the OLDEST pending event to make room, and the new event is STILL processed
 * per its own latency/type (sent / fallback / dropped).
 */
export function decideBackpressure(
  input: BackpressureInput,
): BackpressureResult {
  const bufferOverflow = input.bufferLength >= BUFFER_CAP;
  if (input.late) {
    if (shouldFallbackOnLate(input.type)) {
      return {
        outcome: "fallback",
        late: true,
        latencyMs: input.latencyMs,
        bufferOverflow,
      };
    }
    return {
      outcome: "dropped",
      late: true,
      latencyMs: input.latencyMs,
      bufferOverflow,
    };
  }
  return {
    outcome: "sent",
    late: false,
    latencyMs: input.latencyMs,
    bufferOverflow,
  };
}

/** A stateful scheduler: holds only the transient pending-buffer length. */
export interface MidiScheduler {
  /**
   * Schedule `data` on `output` for `info`. Performs the send / fallback / drop
   * and returns the result (drives the listener-store telemetry). `now` is the
   * LOCAL scheduling clock (`performance.now()` by default; tests inject a fixed
   * value) used ONLY for `sendAt = now + LOOKAHEAD_MS` — it is never compared
   * across clients. The late/latency check uses `info.receivedAtMs` (epoch)
   * vs `info.srvTs` (epoch), a separate, comparable clock pair.
   *
   * Story 5.5: when STOPPED, this is a no-op — it returns a `stopped` result and
   * performs NO `output.send` (true fail-safe gate).
   */
  schedule(
    output: MidiSendable,
    data: Uint8Array,
    info: ScheduleInfo,
    now?: number,
  ): ScheduleResult;
  /** Current pending-buffer length (caps at `BUFFER_CAP`). */
  getBufferLength(): number;
  /**
   * Story 5.5 — STOP the scheduler (fail-safe gate). Every future `schedule`
   * call is a no-op (no `output.send`, no buffer growth, no replay, no retry).
   * Used on involuntary disconnect / server-down AND on output lost.
   */
  stop(): void;
  /**
   * Story 5.5 — resume LIVE reception. Clears the stopped flag AND resets the
   * pending count to 0 (no stale backlog is ever flushed). No past event is ever
   * re-scheduled after a start (nothing is queued, so there is nothing to replay,
   * AD-17).
   */
  start(): void;
  /** Story 5.5 — `true` when the scheduler is STOPPED (fail-safe gate active). */
  isStopped(): boolean;
  /**
   * Hotfix fidélité musicale — forget the deferred-playback anchor ONLY (the
   * pending buffer + stopped flag are untouched). The next event re-establishes
   * the anchor (`anchorLocalMs = now + PLAYBACK_DELAY_MS`). Called on output
   * change / channel change / normal Panic / Force Panic / performer-disconnect,
   * where the scheduler is NOT stopped (so `stop`/`start` cannot do the reset).
   * The leave / output-lost / reconnect paths clear the anchor via `stop()` /
   * `start()` / `reset()`.
   */
  resetAnchor(): void;
  /** Reset the pending buffer + stopped flag + anchor (factory reset / test isolation). */
  reset(): void;
}

/**
 * Story 5.5 — options for `createMidiScheduler`. `onOutputLost` is the LOCAL
 * callback raised when `output.send` throws (e.g. `InvalidStateError` — port
 * closed): the scheduler stops itself, then calls this so the reception wiring
 * can clear the selection + raise the E5 alert. The error never reaches the UI.
 */
export interface MidiSchedulerOptions {
  readonly onOutputLost?: () => void;
}

/**
 * Create a stateful scheduler. The pending-buffer length + the stopped flag live
 * here (transient); the reactive telemetry counters (`fallbackCount` /
 * `droppedCount` / `lateWarning` / `lastLatencyMs`) live in the listener store
 * and are updated from each `ScheduleResult` by the reception wiring.
 *
 * Buffer accounting: a sent or fallback event occupies a pending slot (count
 * grows up to `BUFFER_CAP`); a dropped event never enters the buffer; on
 * overflow the oldest is evicted (count stays at `BUFFER_CAP` — never grows
 * beyond it, so the queue is bounded, FR-25).
 *
 * Story 5.5 fail-safe: `stop()` is a true gate (a stopped `schedule` is a no-op,
 * no `output.send`). `start()` resumes live reception and resets the pending
 * count (no replay — nothing is queued). A `send()` that throws (e.g.
 * `InvalidStateError`) stops the scheduler and raises `onOutputLost`; the error
 * is never thrown up to the UI.
 */
export function createMidiScheduler(
  options: MidiSchedulerOptions = {},
): MidiScheduler {
  let bufferLength = 0;
  let stopped = false;
  // Hotfix fidélité musicale — the deferred-playback anchor (null until the
  // first finite event). Reset by `resetAnchor()` (output/channel change, Panic,
  // performer-disconnect) and by `stop()`/`start()`/`reset()` (leave, output-lost,
  // reconnect, test isolation). The next event re-establishes it.
  let anchor: Anchor | null = null;

  /**
   * Send `data` to `output` at `ts`, wrapped in a fail-safe try/catch (Story
   * 5.5). A throw (e.g. `InvalidStateError` — the port is closed / gone) stops
   * the scheduler and signals output lost via the LOCAL `onOutputLost` callback;
   * the error is NOT rethrown (the UI never sees a crash).
   */
  const safeSend = (
    output: MidiSendable,
    data: Uint8Array,
    ts: number,
  ): void => {
    try {
      output.send(data, ts);
    } catch {
      // Port unusable (InvalidStateError / closed / gone). Fail-safe: stop and
      // signal output lost locally. No throw to the UI, no replay, no retry.
      stopped = true;
      options.onOutputLost?.();
    }
  };

  return {
    schedule(output, data, info, now = performance.now()): ScheduleResult {
      // Story 5.5 — fail-safe gate: when stopped, send NOTHING. No in-flight
      // bytes, no buffer growth, no replay, no retry. Return a `stopped` result
      // so the reception wiring skips telemetry + alerts for this event.
      if (stopped) {
        return {
          outcome: "dropped",
          late: false,
          latencyMs: effectiveLatencyMs(info.srvTs, info.receivedAtMs),
          bufferOverflow: false,
          stopped: true,
          scheduleLateMs: 0,
          targetLocalMs: now, // pas de send (stopped) ; reflète `now`, pas un vrai target
          now,
        };
      }
      // Hotfix fidélité musicale — deferred playback target. The performer
      // `event.ts` is used ONLY as RELATIVE musical time (anchored locally); it
      // is never compared absolutely to `now` / `srvTs` / `receivedAtMs`. The
      // anchor is established on the first finite event and stored for the next
      // call. A non-finite `performerTs` falls back to an imminent send and does
      // NOT poison the anchor (see `lib/playback.ts`).
      const { targetLocalMs, anchor: nextAnchor } = computeTargetLocalMs(
        info.performerTs,
        anchor,
        now,
        PLAYBACK_DELAY_MS,
      );
      anchor = nextAnchor;
      // "Late" is now SCHEDULE-late: the deferred buffer could not absorb the
      // arrival jitter, so the event's musical slot is already past (or within
      // the lookahead). This drives the fallback/drop decision + the LateAlert
      // trigger. The EPOCH network latency (`effectiveLatencyMs`) is computed
      // separately as telemetry only (it no longer drives the decision).
      const late = isScheduleLate(targetLocalMs, now);
      const latencyMs = effectiveLatencyMs(info.srvTs, info.receivedAtMs);
      const result = decideBackpressure({
        type: info.type,
        latencyMs,
        late,
        bufferLength,
      });
      // Buffer accounting (FR-25): on overflow the oldest is evicted (count
      // unchanged); otherwise a sent / fallback event takes a slot. A dropped
      // event never enters the buffer.
      if (!result.bufferOverflow && result.outcome !== "dropped") {
        bufferLength += 1;
      }
      // Execute the fate (wrapped so a throw triggers the fail-safe).
      if (result.outcome === "sent") {
        // Deferred: send at the reconstructed musical slot (anchor + relative).
        safeSend(output, data, targetLocalMs);
      } else if (result.outcome === "fallback") {
        // Schedule-late noteOn/noteOff/programChange → imminent (NOT lost, FR-26).
        safeSend(output, data, now);
      }
      // outcome === "dropped" → no send (schedule-late CC / pitchBend).
      return {
        ...result,
        scheduleLateMs: scheduleLateMs(targetLocalMs, now),
        targetLocalMs,
        now,
      };
    },
    getBufferLength(): number {
      return bufferLength;
    },
    stop(): void {
      stopped = true;
      anchor = null; // a fresh session re-anchors on the first event after start
    },
    start(): void {
      // Resume LIVE reception: clear the gate AND reset the pending count (no
      // stale backlog is ever flushed — nothing is queued, so no replay, AD-17).
      stopped = false;
      bufferLength = 0;
      anchor = null; // re-anchor on the first event after a reconnect
    },
    isStopped(): boolean {
      return stopped;
    },
    resetAnchor(): void {
      // Forget the deferred-playback anchor ONLY (buffer + gate untouched). The
      // next event re-anchors. Used on output/channel change / Panic /
      // performer-disconnect where the scheduler is NOT stopped.
      anchor = null;
    },
    reset(): void {
      // Full factory reset (test isolation): buffer cleared + gate open + anchor.
      bufferLength = 0;
      stopped = false;
      anchor = null;
    },
  };
}

// --- Story 4.3 minimal lookahead (backward-compatible) ----------------------

/**
 * Schedule `data` on `output` with a `LOOKAHEAD_MS` lookahead and send it
 * immediately (driver-level scheduling via `output.send(data, target)`).
 *
 * Backward-compatible minimal scheduler (Story 4.3). The live `midi:event`
 * pipeline now uses `createMidiScheduler` (5.4 backpressure); this is kept for
 * direct lookahead-only unit tests and any caller that does not need the
 * bounded buffer / late fallback/drop.
 *
 * @param output the selected sendable output (real `MIDIOutput` or `MockMidiOutput`).
 * @param data   the raw MIDI bytes to send (from `encodeForOutput`).
 * @param now    optional clock value (defaults to `performance.now()`); tests
 *               inject a fixed value for deterministic assertions.
 */
export function scheduleMidiBytes(
  output: MidiSendable,
  data: Uint8Array,
  now: number = performance.now(),
): void {
  const target = now + LOOKAHEAD_MS;
  output.send(data, target);
}