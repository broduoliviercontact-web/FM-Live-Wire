// CC rate-limiter / coalescer — listener-side. Plumbing (NOT coverage-gated,
// like `encode.ts` / `remap.ts` / `timing-debug.ts`).
//
// Reduces the density of continuous-controller MIDI (CC74 filter cutoff, CC1
// modwheel, CC11 expression, CC7 volume, …) sent toward MIDIOutput / IAC / the
// synth — the cause of the CC74-deluge sonic bug (≈194 CC/s, peaks 416 CC/s) —
// WITHOUT touching NOTE timing. The scheduler wraps its live output with this
// coalescer; everything else (Panic / Force Panic / anti-stuck-notes /
// output-lost / port-change / channel-change / test-note) calls the raw output
// directly and is therefore never delayed nor filtered.
//
// Per (channel, controller) key the coalescer keeps the LAST received value and
// forwards at most every `minIntervalMs` (Smooth 60 Hz ≈ 17 ms, Safe 30 Hz ≈ 33
// ms). A value held back while throttled is flushed by a single global timer so
// the final value always reaches the synth even if the burst stops. Identical-
// value duplicates are dropped. Mode `raw` bypasses all coalescing.
//
// Pass-through (no throttle):
//   - Non-CC (`(status & 0xf0) !== 0xb0`): noteOn / noteOff / programChange /
//     pitchBend — forwarded immediately, unchanged, NO counter. Notes are NEVER
//     filtered or delayed. Pitch bend is NEVER coalesced (spec = controlChange
//     only).
//   - Bypass CC (64 sustain, 120 all-sound-off, 121 reset-controllers, 123
//     all-notes-off): forwarded immediately regardless of mode + `onSent` (they
//     ARE controlChange messages sent to the raw MIDIOutput). They NEVER
//     increment `onCoalesced` and are NEVER throttled.
//
// Counters (NO double counting — `ccReceived` is incremented by the caller in
// `handleMidiEvent` for every controlChange; the coalescer never counts
// receptions):
//   - `onSent`     : a CC actually forwarded to the raw MIDIOutput — an
//                    immediate eligible forward (smooth/safe), a raw-mode
//                    forward, a bypass forward, or a timer/flush send of a held
//                    pending value.
//   - `onCoalesced`: a CC dropped — either an identical-value duplicate of the
//                    last forwarded value, OR a pending value replaced by a
//                    newer value before it could flush. Bypass CC never reach
//                    this path.
// A throttled value sits pending UNCOUNTED until it flushes (→ `onSent`) or is
// replaced (→ `onCoalesced`). So at steady state (no held pending):
//   ccReceived = ccSent + ccCoalesced   (reset-dropped pending are received but
//   neither sent nor coalesced). In raw mode ccCoalesced stays at 0 (every CC
//   forwards).

import type { MidiSendable } from "./sendable";

/** Coalescer mode selectable from the listener UI. */
export type CcMode = "raw" | "smooth" | "safe";

/**
 * Controllers that ALWAYS bypass the throttle and forward immediately, in every
 * mode: 64 sustain pedal, 120 all-sound-off, 121 reset-controllers, 123
 * all-notes-off. Never counted in `onSent` / `onCoalesced`.
 */
export const BYPASS_CONTROLLERS: ReadonlySet<number> = new Set([64, 120, 121, 123]);

/** `true` for sustain / channel-mode controllers that bypass the coalescer. */
export function isBypassCc(controller: number): boolean {
  return BYPASS_CONTROLLERS.has(controller);
}

/** A CC held back while throttled, awaiting flush. */
interface PendingEntry {
  /** The raw output to flush to (captured at submit time; never used after reset). */
  readonly inner: MidiSendable;
  /** Copied bytes (`new Uint8Array(data)`) — safe from later caller mutation. */
  readonly data: Uint8Array;
  /** The deferred send timestamp (~1.5 s future) preserved through the wrapper. */
  readonly ts: number;
  /** The controller value (kept so duplicate detection vs lastValue works). */
  readonly value: number;
}

/** Per-(channel, controller) state. */
interface KeyState {
  /** Last value actually FORWARDED to the raw output (`null` = never sent). */
  lastValue: number | null;
  /** `now()` of the last forward on this key (eligible window = +minInterval). */
  lastSentAt: number;
  /** A value held back while throttled, or `null` if none pending. */
  pending: PendingEntry | null;
}

/** Factory options. All callbacks optional except the mode + interval readers. */
export interface CcCoalescerOptions {
  /** Current mode (`raw` bypasses; `smooth`/`safe` throttle). */
  readonly getMode: () => CcMode;
  /** Min ms between forwards on the same key in `smooth`/`safe` (e.g. 17 / 33). */
  readonly getMinIntervalMs: () => number;
  /** Fired when a CC is forwarded to the raw MIDIOutput (→ `ccSent`). */
  readonly onSent?: () => void;
  /** Fired when a CC is dropped / replaced (→ `ccCoalesced`). */
  readonly onCoalesced?: () => void;
  /** Injectable clock (default `Date.now()`) for deterministic tests. */
  readonly now?: () => number;
  /** Injectable timer (default `globalThis.setTimeout`) for deterministic tests. */
  readonly setTimeout?: (cb: () => void, ms: number) => number;
  /** Injectable clearer (default `globalThis.clearTimeout`). */
  readonly clearTimeout?: (handle: number) => void;
}

/** The coalescer handle. */
export interface CcCoalescer {
  /** Wrap a raw output as a `MidiSendable` view (state lives in the singleton). */
  wrap(inner: MidiSendable): MidiSendable;
  /** Core entry: classify + forward / throttle / drop. Exposed for tests. */
  submit(inner: MidiSendable, data: Uint8Array, ts?: number): void;
  /** Forward ALL held pending NOW (used on mode change — preserves last value). */
  flush(): void;
  /** Drop ALL pending + clear the timer + forget per-key state (port/channel/output-lost/leave). */
  reset(): void;
  /** Timer tick: flush eligible pending, rearm if non-eligible pending remains. Exposed for tests. */
  __tick(): void;
}

/** Build a coalescer. */
export function createCcCoalescer(options: CcCoalescerOptions): CcCoalescer {
  const getMode = options.getMode;
  const getMinIntervalMs = options.getMinIntervalMs;
  const onSent = options.onSent;
  const onCoalesced = options.onCoalesced;
  const now = options.now ?? (() => Date.now());
  const setTimeoutFn = options.setTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
  const clearTimeoutFn = options.clearTimeout ?? ((h) => globalThis.clearTimeout(h));

  const states = new Map<string, KeyState>();
  let timerHandle: number | null = null;

  function keyOf(channel: number, controller: number): string {
    return `${channel}/${controller}`;
  }

  /** Arm the single global timer for the earliest eligible pending; no-op if none. */
  function armForNextFlush(minInterval: number): void {
    if (timerHandle !== null) {
      clearTimeoutFn(timerHandle);
      timerHandle = null;
    }
    const t = now();
    let earliest: number | null = null;
    for (const state of states.values()) {
      if (state.pending !== null) {
        const wait = minInterval - (t - state.lastSentAt);
        const w = wait < 0 ? 0 : wait;
        if (earliest === null || w < earliest) earliest = w;
      }
    }
    if (earliest !== null) {
      timerHandle = setTimeoutFn(() => {
        __tick();
      }, earliest);
    }
  }

  function __tick(): void {
    timerHandle = null;
    const minInterval = getMinIntervalMs();
    const t = now();
    for (const state of states.values()) {
      const pending = state.pending;
      if (pending === null) continue;
      if (t - state.lastSentAt >= minInterval) {
        // Eligible → flush the held value to the raw output (best-effort: a
        // missed CC is not a stuck-note; hot-unplug is handled by the
        // `useOutputState` watcher → `handleOutputLost` → `reset()`).
        try {
          pending.inner.send(pending.data, pending.ts);
        } catch {
          /* swallow — stale output / hot-unplug */
        }
        state.lastValue = pending.value;
        state.lastSentAt = t;
        state.pending = null;
        onSent?.();
      }
    }
    // Rearm if non-eligible pending remains (a single tick does NOT always
    // empty every pending — a key forwarded very recently may not be eligible).
    armForNextFlush(minInterval);
  }

  function submit(inner: MidiSendable, data: Uint8Array, ts?: number): void {
    const status = data[0];
    // Non-CC (noteOn/noteOff/programChange/pitchBend) or malformed → pass
    // through immediately, unchanged, NO counter. Notes are never filtered.
    if (status === undefined || (status & 0xf0) !== 0xb0) {
      inner.send(data, ts);
      return;
    }
    const controller = data[1];
    const value = data[2];
    // Malformed CC (missing data bytes) → pass through, no counter.
    if (controller === undefined || value === undefined) {
      inner.send(data, ts);
      return;
    }
    // Bypass CC (sustain / channel-mode) → immediate, no throttle. It IS a
    // controlChange sent to the raw output → count `onSent`. NEVER coalesced.
    if (isBypassCc(controller)) {
      inner.send(data, ts);
      onSent?.();
      return;
    }
    // Raw mode → forward every CC immediately + count as sent (no coalescing).
    if (getMode() === "raw") {
      inner.send(data, ts);
      onSent?.();
      return;
    }
    // Smooth / safe — per-key throttle.
    const minInterval = getMinIntervalMs();
    const key = keyOf(status & 0x0f, controller);
    let state = states.get(key);
    if (state === undefined) {
      state = { lastValue: null, lastSentAt: 0, pending: null };
      states.set(key, state);
    }
    // Identical-value duplicate of the last FORWARDED value → drop (coalesced).
    if (state.lastValue !== null && value === state.lastValue) {
      onCoalesced?.();
      return;
    }
    const t = now();
    const eligible = state.lastValue === null || t - state.lastSentAt >= minInterval;
    if (eligible) {
      // A held pending (if any) is replaced by this newer eligible value → it
      // was suppressed → count it coalesced (correction 2: "remplacés").
      if (state.pending !== null) {
        onCoalesced?.();
      }
      // Forward immediately (let exceptions propagate to the scheduler's
      // `safeSend` → `onOutputLost`; the immediate path is already wrapped).
      inner.send(data, ts);
      state.lastValue = value;
      state.lastSentAt = t;
      state.pending = null;
      onSent?.();
      return;
    }
    // Throttled → hold the latest value. If a value was already pending, it is
    // replaced (suppressed) → count it coalesced. The new value is uncounted
    // until it flushes (sent) or is itself replaced (coalesced).
    if (state.pending !== null) {
      onCoalesced?.();
    }
    state.pending = { inner, data: new Uint8Array(data), ts: ts as number, value };
    armForNextFlush(minInterval);
  }

  function flush(): void {
    if (timerHandle !== null) {
      clearTimeoutFn(timerHandle);
      timerHandle = null;
    }
    const t = now();
    for (const state of states.values()) {
      const pending = state.pending;
      if (pending === null) continue;
      try {
        pending.inner.send(pending.data, pending.ts);
      } catch {
        /* swallow — stale output / hot-unplug */
      }
      state.lastValue = pending.value;
      state.lastSentAt = t;
      state.pending = null;
      onSent?.();
    }
  }

  function reset(): void {
    if (timerHandle !== null) {
      clearTimeoutFn(timerHandle);
      timerHandle = null;
    }
    states.clear();
  }

  function wrap(inner: MidiSendable): MidiSendable {
    return {
      send: (data, ts) => submit(inner, data, ts),
      clear: () => {
        inner.clear?.();
      },
    };
  }

  return { wrap, submit, flush, reset, __tick };
}