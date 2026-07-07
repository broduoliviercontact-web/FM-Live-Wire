// Story 5.3 — Force Panic (AD-7, FR-17, AC-U14, UX-DR16, UX-DR23).
//
// An EXTENDED local all-notes-off for the stubborn case: a noteOff sweep over
// EVERY note (0–127) on EVERY channel (0–15) = 128 × 16 = 2048 messages, sent
// straight to the listener's selected output. Like the Story 5.2 Panic, it
// depends ONLY on the local `MidiSendable` output (a real `MIDIOutput` or the
// Story 5.1 `MockMidiOutput`) — never on the live network link, the backend,
// the join state, or the Story 4.3 timing layer. It still works with the
// backend killed (S-2).
//
// Why a separate function + a confirmation dialog: 2048 messages is a lot — the
// `ForcePanicDialog` confirms BEFORE any send (AC-U14) so a misclick never
// fires the full sweep. The normal Story 5.2 Panic (64 messages) stays the
// always-available escape hatch; Force Panic is opt-in and secondary.
//
// The sweep order is channel-major: channel 0 notes 0..127, then channel 1
// notes 0..127, … channel 15 notes 0..127. Each message is
// `[0x80 | channel, note, 0]` (noteOff, velocity 0) sent with
// `output.send(bytes, performance.now())` — IMMEDIATE (no timing offset, no
// buffer, no timing layer). `now` is injectable for deterministic tests.
//
// No SysEx, no network emit, no server handler, no join/leave handshake. This
// module imports only the `MidiSendable` type (a local contract) — it has no
// runtime dependency on anything network, store, or timing related.

import type { MidiSendable } from "./sendable";

/** Number of notes swept per channel (0–127). */
export const FORCE_PANIC_NOTE_COUNT = 128 as const;
/** Number of MIDI channels swept (0–15). */
export const FORCE_PANIC_CHANNEL_COUNT = 16 as const;
/** Total messages sent by one Force Panic: 128 notes × 16 channels. */
export const FORCE_PANIC_MESSAGE_COUNT = FORCE_PANIC_NOTE_COUNT * FORCE_PANIC_CHANNEL_COUNT;

/**
 * Send the extended local noteOff sweep to `output`: noteOff on every note
 * (0–127) for every channel (0–15) = 2048 messages, channel-major order, each
 * `send(bytes, now)` — immediate, with no timing offset. `output` is the
 * minimal `MidiSendable` (real `MIDIOutput` or `MockMidiOutput`); `now`
 * defaults to `performance.now()` and is injectable for tests.
 */
export function sendForcePanic(output: MidiSendable, now: number = performance.now()): void {
  for (let channel = 0; channel < FORCE_PANIC_CHANNEL_COUNT; channel += 1) {
    const status = 0x80 | channel; // noteOff on this channel
    for (let note = 0; note < FORCE_PANIC_NOTE_COUNT; note += 1) {
      output.send(new Uint8Array([status, note, 0]), now);
    }
  }
}