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

/**
 * A minimal MIDI byte sink: something with a `send(bytes, timestamp?)` method.
 * Abstraction point so the scheduler / test note are agnostic to Mock vs real.
 */
export interface MidiSendable {
  /** Forward raw MIDI bytes (an optional scheduling timestamp). */
  send(data: Uint8Array, timestamp?: number): void;
}