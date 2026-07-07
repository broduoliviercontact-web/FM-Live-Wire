// Story 5.2 — local Panic (AD-7, FR-16, FR-18, S-2, AC-U13, UX-DR15).
//
// A LOCAL all-notes-off sent straight to the listener's selected output. It
// depends ONLY on the local `MidiSendable` output (a real `MIDIOutput` or the
// Story 5.1 `MockMidiOutput`) — never on the live network link, the backend,
// the join state, or the Story 4.3 timing layer. This is the product's safety
// promise (S-2): even with the backend killed, the listener can always cut
// stuck notes on their own synth.
//
// The sweep is the AD-7 sequence: control-change 64 (sustain off), 120 (all
// sound off), 121 (reset all controllers), 123 (all notes off), sent on EVERY
// one of the 16 MIDI channels = 4 × 16 = 64 messages. The chosen output channel
// in the store does NOT limit the sweep — Panic covers all 16 channels so a
// stuck note on any channel is cut.
//
// Each message is `[0xB0 | channel, controller, 0]` sent with
// `output.send(bytes, performance.now())` — IMMEDIATE (no timing offset, no
// buffer, no timing layer). `now` is injectable for deterministic tests.
//
// No SysEx, no network emit, no server handler, no join/leave handshake. This
// module imports only the `MidiSendable` type (a local contract) — it has no
// runtime dependency on anything network, store, or timing related.

import type { MidiSendable } from "./sendable";

/** The AD-7 Panic control-change sweep, in order, per channel. */
export const PANIC_CONTROLLERS = [64, 120, 121, 123] as const;
/** Number of MIDI channels covered by the sweep (0–15). */
export const PANIC_CHANNEL_COUNT = 16 as const;
/** Total messages sent by one Panic press: 4 controllers × 16 channels. */
export const PANIC_MESSAGE_COUNT = PANIC_CONTROLLERS.length * PANIC_CHANNEL_COUNT;

/**
 * Send the local Panic sweep to `output`: CC 64 → 120 → 121 → 123 on each of
 * the 16 channels (64 messages), each `send(bytes, now)` — immediate, with no
 * timing offset. `output` is the minimal `MidiSendable` (real `MIDIOutput` or
 * `MockMidiOutput`); `now` defaults to `performance.now()` and is injectable
 * for tests. The chosen listener channel does NOT limit the sweep.
 */
export function sendLocalPanic(output: MidiSendable, now: number = performance.now()): void {
  for (let channel = 0; channel < PANIC_CHANNEL_COUNT; channel += 1) {
    const status = 0xb0 | channel; // control-change on this channel
    for (const controller of PANIC_CONTROLLERS) {
      output.send(new Uint8Array([status, controller, 0]), now);
    }
  }
}