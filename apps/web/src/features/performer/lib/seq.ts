// Story 3.3 — monotone uint32 sequence counter (AD-5).
//
// One counter per performer (created in `useMidiInput`). The performer advances
// it ONLY when a captured message is decoded into a produced `MidiEvent` (the 5
// allowed types). Filtered messages (SysEx, out-of-scope types) do NOT consume a
// sequence number, so `seq` is contiguous over the events that actually reach the
// wire.
//
// Wrapping: the value is kept in the unsigned 32-bit range with a bitwise
// `>>> 0`. After `0xFFFFFFFF` the next produced event gets `0`, then `1`, `2`…
// (the wrap target is `0`, per the story). `>>> 0` also guarantees the stored
// value is always a non-negative uint32, never a float or a negative int.

/** Recommended first sequence value (the story suggests starting at 1). */
export const SEQ_START = 1 as const;

/** Upper bound of the uint32 range (2^32 - 1). */
export const SEQ_UINT32_MAX = 0xffffffff as const; // 4294967295

/**
 * A monotone uint32 counter. `current()` peeks WITHOUT advancing; `advance()`
 * moves to the next value. Splitting peek from commit lets the caller discard a
 * sequence number when a message is filtered (no gaps on the wire).
 */
export interface SeqCounter {
  /** Current sequence value (does NOT advance). */
  readonly current: () => number;
  /** Advance to the next value (wraps modulo uint32). */
  readonly advance: () => void;
}

/**
 * Create a monotone uint32 counter starting at `start` (default `SEQ_START`).
 * Deterministic: two counters created with the same start produce the same
 * sequence.
 */
export function createSeqCounter(start: number = SEQ_START): SeqCounter {
  let value = toUint32(start);
  return {
    current: () => value,
    advance: () => {
      value = toUint32(value + 1);
    },
  };
}

/** Clamp/wrap a number into the unsigned 32-bit range [0, 4294967295]. */
function toUint32(n: number): number {
  return n >>> 0;
}