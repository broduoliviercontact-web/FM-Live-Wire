import type { MidiEvent } from "../../../entities/MidiEvent";
import { WIRE_CHANNEL_MIN, WIRE_CHANNEL_MAX } from "../../../entities/Channel";

// Story 4.2 — channel remapping (AD-12, FR-13).
//
// The listener owns a single output channel (single-timbral synth). Every
// received event is forced onto that channel: the event's original channel is
// REPLACED (not merged) before encoding. UI shows channels 1–16; the wire/data
// channel is 0–15, converted at the edge.
//
// All functions here are PURE: they never mutate their input and have no side
// effects. The MidiEvent contract (`@fmlw/shared`) is the single source of truth
// — we only override `channel`, the rest of the event is forwarded unchanged.

/** UI channel range (1–16, shown to the user). */
export const UI_CHANNEL_MIN = 1 as const;
export const UI_CHANNEL_MAX = 16 as const;

/**
 * Convert a UI channel (1–16) to a wire/data channel (0–15), clamped to the
 * valid range. `1 → 0`, `16 → 15`. Out-of-range values are clamped, never wrap.
 */
export function uiChannelToData(ui: number): number {
  if (ui <= UI_CHANNEL_MIN) return WIRE_CHANNEL_MIN;
  if (ui >= UI_CHANNEL_MAX) return WIRE_CHANNEL_MAX;
  return ui - 1;
}

/**
 * Convert a wire/data channel (0–15) to a UI channel (1–16), clamped to the
 * valid range. `0 → 1`, `15 → 16`. Out-of-range values are clamped, never wrap.
 */
export function dataChannelToUi(data: number): number {
  if (data <= WIRE_CHANNEL_MIN) return UI_CHANNEL_MIN;
  if (data >= WIRE_CHANNEL_MAX) return UI_CHANNEL_MAX;
  return data + 1;
}

/**
 * Return a NEW `MidiEvent` with its channel replaced by `channel` (a wire/data
 * value 0–15). The original event is NOT mutated. Works for all 5 channel-voice
 * variants (noteOn / noteOff / controlChange / programChange / pitchBend) —
 * `channel` is a common field on every variant, so a shallow spread preserves
 * the discriminator and all type-specific fields.
 *
 * The caller is responsible for passing a valid 0–15 channel (the
 * `ChannelSelector` derives it via `uiChannelToData`); this function does not
 * re-validate the contract.
 */
export function remapChannel(event: MidiEvent, channel: number): MidiEvent {
  return { ...event, channel };
}