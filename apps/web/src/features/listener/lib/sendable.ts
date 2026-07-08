// Story 5.1 — the minimal "sendable" output contract (AD-14).
//
// Both a real Web MIDI `MIDIOutput` and the `MockMidiOutput` (Story 5.1) satisfy
// this contract: they accept raw MIDI bytes (an optional timestamp) and
// forward them. The scheduler (`lib/scheduler.ts`) and the local test note
// (`lib/test-note.ts`) depend on THIS minimal interface — not on the full DOM
// `MIDIOutput` type — so they do NOT distinguish a real port from the Mock: the
// pipeline `socket → remap → encode → schedule → output.send` is identical.
//
// `MIDIOutput.send(data: number[] | Uint8Array, timestamp?: number)` is
// structurally assignable to `MidiSendable.send` (it accepts a wider `data`
// type), so a real `MIDIOutput` can be passed wherever a `MidiSendable` is
// expected without a cast.
//
// Hotfix fidélité musicale — the OPTIONAL `clear()` mirrors Web MIDI
// `MIDIOutput.clear()`: it cancels all pending SCHEDULED sends (those handed to
// `send(data, futureTimestamp)` but not yet fired). This is required by the
// deferred-playback safety: before a port change / channel change / Panic /
// output-lost / leave, the wiring cancels pending deferred noteOns/noteOffs on
// the OLD output so they cannot fire AFTER the immediate safety noteOffs (which
// would re-trigger a stuck note). `MockMidiOutput` does NOT implement `clear`
// (it records sends immediately for display — there is no real pending queue),
// so callers guard with `typeof output.clear === "function"`.

/**
 * A minimal MIDI byte sink: something with a `send(bytes, timestamp?)` method.
 * Abstraction point so the scheduler / test note are agnostic to Mock vs real.
 */
export interface MidiSendable {
  /** Forward raw MIDI bytes (an optional scheduling timestamp). */
  send(data: Uint8Array, timestamp?: number): void;
  /**
   * Optional: cancel all pending SCHEDULED sends (Web MIDI `MIDIOutput.clear()`).
   * Used by the deferred-playback safety before cutting stuck notes. Absent on
   * the Mock output; callers MUST guard with a typeof check.
   */
  clear?(): void;
}