// @fmlw/shared — wire → raw MIDI bytes encoding (Story 1.3).
//
// Pure, deterministic 1:1 mapping (FR-15, AD-12 table). The input is an already
// validated `MidiEvent` (Story 1.2) — no Zod re-validation here. The channel is
// encoded AS PROVIDED (0–15 wire). Listener channel remapping (AD-12) happens
// upstream in Epic 4, before this function is called.
//
// Conventions:
//   - status byte = STATUS_X | channel  (channel 0–15 → 0x?0..0x?F)
//   - noteOn velocity 0 is NOT converted to noteOff here — the wire preserves it
//     (`[0x90 | ch, note, 0]`); the listener decides (FR-15 / scaffolding).
//   - programChange = 2 bytes (status + program).
//   - pitchBend = status + lsb + msb (14-bit split: lsb = v & 0x7F, msb = (v>>7) & 0x7F).
import type { MidiEvent } from "./midi-event.js";
import {
  STATUS_NOTE_OFF,
  STATUS_NOTE_ON,
  STATUS_CONTROL_CHANGE,
  STATUS_PROGRAM_CHANGE,
  STATUS_PITCH_BEND,
} from "./constants.js";

/**
 * Encode a validated MIDI event into raw MIDI bytes (deterministic 1:1).
 * Pure: returns a fresh `Uint8Array` and never mutates `event`.
 */
export function toMidiBytes(event: MidiEvent): Uint8Array {
  switch (event.type) {
    case "noteOn":
      return new Uint8Array([STATUS_NOTE_ON | event.channel, event.note, event.velocity]);
    case "noteOff":
      return new Uint8Array([STATUS_NOTE_OFF | event.channel, event.note, event.velocity]);
    case "controlChange":
      return new Uint8Array([
        STATUS_CONTROL_CHANGE | event.channel,
        event.controller,
        event.value,
      ]);
    case "programChange":
      // 2 bytes only: status + program (no data2 byte).
      return new Uint8Array([STATUS_PROGRAM_CHANGE | event.channel, event.program]);
    case "pitchBend": {
      const lsb = event.pitchBend & 0x7f;
      const msb = (event.pitchBend >> 7) & 0x7f;
      return new Uint8Array([STATUS_PITCH_BEND | event.channel, lsb, msb]);
    }
  }
}