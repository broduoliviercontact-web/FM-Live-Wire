// Story 4.3 — listener wire → output bytes (AD-12, AD-5).
//
// Pure chain applied to each received `midi:event` BEFORE scheduling it to the
// selected `MIDIOutput`:
//
//   remapChannel(event, chosenChannelData)  → toMidiBytes(remapped)
//
// `remapChannel` (lib/remap.ts, Story 4.2) REPLACES the original channel with
// the listener's forced channel (wire/data 0–15) and returns a NEW object (the
// original event is never mutated). `toMidiBytes` (@fmlw/shared, Story 1.3,
// re-exported via entities) encodes the remapped event to raw MIDI bytes; it
// only reads `type` / `channel` / the type-specific fields, so any
// server-added envelope fields (`performerId`, `srvTs`) carried by the relayed
// event are ignored at the wire edge (AD-5: the contract is the single source).
//
// No client-side Zod re-validation here: the server already validated the
// event (ValidationService, Story 2.6) before relaying it. Trusting the
// server is the simplest sufficient defence for the MVP.

import type { MidiEvent } from "../../../entities/MidiEvent";
import { toMidiBytes } from "../../../entities/MidiEvent";
import { remapChannel } from "./remap";

/**
 * Remap an incoming `MidiEvent` to the listener's forced channel (data 0–15)
 * and encode it to raw MIDI bytes. Pure: returns a fresh `Uint8Array` and never
 * mutates `event`.
 *
 * @param event   the relayed `midi:event` (the server may add `performerId` /
 *                `srvTs`; those are ignored at the wire edge).
 * @param channel the listener's forced output channel as a WIRE/DATA value
 *                (0–15) — taken from the listener store.
 */
export function encodeForOutput(event: MidiEvent, channel: number): Uint8Array {
  return toMidiBytes(remapChannel(event, channel));
}