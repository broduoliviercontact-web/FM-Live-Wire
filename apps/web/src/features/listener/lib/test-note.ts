// Story 4.4 — local test note (FR-14, UX-DR9, Q-UX6).
//
// A LOCAL, direct MIDI note played on the listener's chosen output — NOT a
// relayed `midi:event`. The standard (Q-UX6) is fixed: note 60, velocity 100,
// duration 300 ms. It sends the noteOn immediately and the noteOff after
// 300 ms via `MIDIOutput.send`. The test note does NOT use the Story 4.3
// lookahead scheduler: the AC asks for an immediate noteOn + a noteOff after
// 300 ms, so a plain `send` (no timestamp = immediate) + `setTimeout` is the
// simplest sufficient implementation.
//
// `channel` is a WIRE/DATA value 0–15 (taken from the listener store; the
// `ChannelSelector` derives it from UI 1–16). It is masked to 0–15 defensively
// before being OR'd into the status byte. No SysEx is ever sent.

/** Q-UX6 standard: middle C, forte. */
export const TEST_NOTE = 60 as const;
export const TEST_VELOCITY = 100 as const;
/** NoteOff fires this many milliseconds after the noteOn (Q-UX6). */
export const TEST_NOTE_DURATION_MS = 300 as const;

import type { MidiSendable } from "./sendable";

/**
 * Play the local test note on `output` forced to `channel` (wire/data 0–15):
 * immediately sends `noteOn [0x90|ch, 60, 100]`, then after
 * `TEST_NOTE_DURATION_MS` sends `noteOff [0x80|ch, 60, 0]`.
 *
 * `output` is the minimal `MidiSendable` (Story 5.1): a real `MIDIOutput` or the
 * `MockMidiOutput`. The noteOff is scheduled with `setTimeout` so tests can
 * drive the 300 ms gap with fake timers deterministically.
 */
export function playTestNote(output: MidiSendable, channel: number): void {
  const ch = channel & 0x0f; // wire/data 0–15, defensive mask
  const noteOn = new Uint8Array([0x90 | ch, TEST_NOTE, TEST_VELOCITY]);
  output.send(noteOn);
  const noteOff = new Uint8Array([0x80 | ch, TEST_NOTE, 0]);
  setTimeout(() => {
    output.send(noteOff);
  }, TEST_NOTE_DURATION_MS);
}