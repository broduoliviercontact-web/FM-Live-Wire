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
// "Late" means `srvTs - ts > MAX_LATE_MS` (strictly greater). 200 ms exact is
// NOT late (boundary), 201 ms IS late. `srvTs` is optional on a relayed event
// (absent → no latency check → normal lookahead path — preserves the existing
// calm-reception behavior).
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

import { LOOKAHEAD_MS, MAX_LATE_MS, BUFFER_CAP } from "../../../config/runtime";
import type { MidiSendable } from "./sendable";

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
  /** `true` when `srvTs - ts > MAX_LATE_MS` (strict). `false` when `srvTs` absent. */
  readonly late: boolean;
  /** `srvTs - ts`, or `null` when `srvTs` is absent (no latency info). */
  readonly latencyMs: number | null;
  /** The buffer was full → the OLDEST pending event was dropped (FR-25). */
  readonly bufferOverflow: boolean;
  /**
   * Story 5.5 — `true` when the scheduler was STOPPED so the event was NOT sent
   * (fail-safe gate). Omitted / `false` for a normally-scheduled event. The
   * reception wiring checks this to skip telemetry + alerts for a stopped event.
   */
  readonly stopped?: boolean;
}

/** Info needed to schedule one event (besides the raw bytes + the output). */
export interface ScheduleInfo {
  readonly type: MidiEventType;
  /** Server relay timestamp (telemetry only, AD-11). Absent → no latency check. */
  readonly srvTs?: number;
  /** Performer capture timestamp (ms). */
  readonly ts: number;
}

/**
 * Compute the relay latency `srvTs - ts`, or `null` when `srvTs` is absent.
 * Pure: no clock, no output, no side effect.
 */
export function computeLatencyMs(
  srvTs: number | undefined,
  ts: number,
): number | null {
  if (srvTs === undefined) return null;
  return srvTs - ts;
}

/**
 * `true` when the latency is late (strictly greater than `MAX_LATE_MS`).
 * 200 ms exact is NOT late (boundary); `null` (no `srvTs`) is NOT late. Pure.
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
): ScheduleResult {
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
   * and returns the result (drives the listener-store telemetry). `now` defaults
   * to `performance.now()`; tests inject a fixed clock for deterministic asserts.
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
  /** Reset the pending buffer + stopped flag (factory reset / test isolation). */
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
          latencyMs: computeLatencyMs(info.srvTs, info.ts),
          bufferOverflow: false,
          stopped: true,
        };
      }
      const latencyMs = computeLatencyMs(info.srvTs, info.ts);
      const late = isLate(latencyMs);
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
        safeSend(output, data, now + LOOKAHEAD_MS);
      } else if (result.outcome === "fallback") {
        safeSend(output, data, now); // immediate — the note / program is NOT lost
      }
      // outcome === "dropped" → no send (late CC / pitchBend).
      return result;
    },
    getBufferLength(): number {
      return bufferLength;
    },
    stop(): void {
      stopped = true;
    },
    start(): void {
      // Resume LIVE reception: clear the gate AND reset the pending count (no
      // stale backlog is ever flushed — nothing is queued, so no replay, AD-17).
      stopped = false;
      bufferLength = 0;
    },
    isStopped(): boolean {
      return stopped;
    },
    reset(): void {
      // Full factory reset (test isolation): buffer cleared + gate open.
      bufferLength = 0;
      stopped = false;
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