// Anti-stuck-notes safety — active-note tracker + best-effort noteOff helpers.
//
// Companion to the Story 5.5 fail-safe. The fail-safe stops the scheduler when an
// output is lost / the link drops; this module tracks the notes ACTUALLY sent to a
// listener MIDI output (AFTER channel remap) so that on a port change / channel
// change / Panic / output-lost / leave we can send EXPLICIT noteOffs for the still
// sounding notes — not just the CC 123 "all notes off" sweep (some synths ignore
// CC 123, whereas an explicit `[0x80|ch, note, 0]` is always honored). This kills
// stuck notes on the OLD output / OLD channel that the CC sweep alone might miss.
//
// KEY INVARIANT — track AFTER remap, keyed by `outputId + channel + note`:
//   - noteOn (status 0x90) with velocity > 0  → add `(channel, note)` for outputId;
//   - noteOff (status 0x80) OR noteOn velocity 0 → remove `(channel, note)`;
//   - everything else (CC / program / pitchBend / SysEx / too-short) → ignored.
// The bytes fed in are the POST-`encodeForOutput` bytes (the channel is already
// the listener's forced channel baked into the status byte), so the tracker
// reflects what the synth actually received. `outputId` is the listener store's
// `selectedOutputId` (a real port id OR `MOCK_OUTPUT_ID`) — the key is what makes
// a port change send noteOffs to the OLD output, not the new one.
//
// All `send*` helpers are BEST-EFFORT: each individual `output.send` is wrapped in
// its own try/catch so ONE throw (a port that died mid-sweep) never aborts the
// rest and never propagates to the UI. They are PURE (depend only on the
// `MidiSendable` contract + an injectable `now`) — no store, no socket, no timing
// layer — so they are unit-testable in node without DOM/network.
//
// No SysEx is ever produced here (only channel-voice noteOff / CC 120+123). No
// network emit, no server handler. This module imports only the local
// `MidiSendable` type (a contract) — it has no runtime dependency on anything
// network, store, or timing related. The orchestration that calls these helpers
// (port change / channel change / Panic / output-lost / leave) lives in
// `api/connection.ts`, which owns the module-singleton tracker instance.

import type { MidiSendable } from "./sendable";

/** Status-byte high nibble: noteOn. */
const NOTE_ON = 0x90;
/** Status-byte high nibble: noteOff. */
const NOTE_OFF = 0x80;
/** Status-byte high nibble: control-change (used for CC 120 / 123 all-notes-off). */
const CONTROL_CHANGE = 0xb0;
/** CC 120 — all sound off (cuts envelopes + oscillators on the channel). */
const CC_ALL_SOUND_OFF = 120;
/** CC 123 — all notes off (turns off all notes on the channel). */
const CC_ALL_NOTES_OFF = 123;

/**
 * Per-output active-note map: `channel (0–15) → set of sounding notes (0–127)`.
 * A note is "active" between its noteOn and its noteOff (or noteOn velocity 0).
 */
export type PerChannelNotes = Map<number, Set<number>>;

/**
 * The active-note tracker. Records notes actually sent to each output (after
 * remap) so safety paths can send explicit noteOffs for the still-sounding ones.
 * Storage is `Map<outputId, PerChannelNotes>` (the outputId key is what lets a
 * port change target the OLD output). Pure in-memory state — no sends, no I/O.
 */
export interface ActiveNoteTracker {
  /** Record a POST-remap MIDI message for `outputId` (noteOn adds, noteOff removes). */
  trackMidiBytes(data: Uint8Array, outputId: string): void;
  /** All active `(channel, notes)` for an output (empty map if none). */
  getNotesForOutput(outputId: string): PerChannelNotes;
  /** The active notes for one `(output, channel)` (empty set if none). */
  getNotesForChannel(outputId: string, channel: number): Set<number>;
  /** Read-only snapshot of the whole tracker (output → channel → notes). */
  getAllNotes(): ReadonlyMap<string, ReadonlyMap<number, ReadonlySet<number>>>;
  /** Forget all active notes for an output (e.g. after sending them as noteOffs). */
  clearOutput(outputId: string): void;
  /** Forget all active notes for one `(output, channel)` (e.g. on a channel change). */
  clearChannel(outputId: string, channel: number): void;
  /** Forget every active note on every output (e.g. on Panic / leave). */
  clearAll(): void;
  /** Total active notes across all outputs (0 = nothing sounding). */
  readonly size: number;
}

/**
 * Create a fresh active-note tracker (pure in-memory state). One module-singleton
 * instance lives in `api/connection.ts` for the listener; tests create their own.
 */
export function createActiveNoteTracker(): ActiveNoteTracker {
  const byOutput = new Map<string, PerChannelNotes>();

  function getOrInit(outputId: string): PerChannelNotes {
    let perCh = byOutput.get(outputId);
    if (perCh === undefined) {
      perCh = new Map();
      byOutput.set(outputId, perCh);
    }
    return perCh;
  }

  function add(outputId: string, channel: number, note: number): void {
    const perCh = getOrInit(outputId);
    let notes = perCh.get(channel);
    if (notes === undefined) {
      notes = new Set();
      perCh.set(channel, notes);
    }
    notes.add(note);
  }

  function remove(outputId: string, channel: number, note: number): void {
    const perCh = byOutput.get(outputId);
    if (perCh === undefined) return;
    const notes = perCh.get(channel);
    if (notes === undefined) return;
    notes.delete(note);
    if (notes.size === 0) perCh.delete(channel);
    if (perCh.size === 0) byOutput.delete(outputId);
  }

  return {
    trackMidiBytes(data, outputId) {
      if (data.length < 1) return;
      const status = data[0]!;
      const high = status & 0xf0;
      const channel = status & 0x0f;
      if (high === NOTE_ON) {
        if (data.length < 3) return; // no note+velocity → not a real noteOn
        const note = data[1]!;
        const velocity = data[2]!;
        if (velocity > 0) add(outputId, channel, note);
        else remove(outputId, channel, note); // noteOn vel 0 = release
      } else if (high === NOTE_OFF) {
        if (data.length < 2) return; // no note → not a real noteOff
        remove(outputId, channel, data[1]!);
      }
      // CC / program / pitchBend / SysEx / system-realtime → not note-tracked.
    },
    getNotesForOutput(outputId) {
      return byOutput.get(outputId) ?? new Map();
    },
    getNotesForChannel(outputId, channel) {
      return byOutput.get(outputId)?.get(channel) ?? new Set();
    },
    getAllNotes() {
      return byOutput;
    },
    clearOutput(outputId) {
      byOutput.delete(outputId);
    },
    clearChannel(outputId, channel) {
      const perCh = byOutput.get(outputId);
      if (perCh === undefined) return;
      perCh.delete(channel);
      if (perCh.size === 0) byOutput.delete(outputId);
    },
    clearAll() {
      byOutput.clear();
    },
    get size() {
      let total = 0;
      for (const perCh of byOutput.values()) {
        for (const notes of perCh.values()) total += notes.size;
      }
      return total;
    },
  };
}

/**
 * Send explicit noteOff `[0x80|channel, note, 0]` for each note in `notes`, each
 * `output.send(bytes, now)` — immediate, best-effort. Each send is wrapped in its
 * OWN try/catch so a throw on one note (a dying port) never aborts the rest and
 * never propagates to the UI. `notes` is consumed as-is (the caller clears the
 * tracker afterwards). Pure: depends only on `MidiSendable` + an injectable `now`.
 */
export function sendTrackedNoteOffs(
  output: MidiSendable,
  notes: Set<number>,
  channel: number,
  now: number,
): void {
  const status = 0x80 | channel; // noteOff on this channel
  for (const note of notes) {
    try {
      output.send(new Uint8Array([status, note, 0]), now);
    } catch {
      // Best-effort: a throw on one note does not abort the rest.
    }
  }
}

/**
 * Send a targeted all-notes-off on ONE channel: CC 120 (all sound off) + CC 123
 * (all notes off), each `output.send(bytes, now)` immediate, best-effort (per-send
 * try/catch). This is the channel-change safety — a 2-message sweep on the OLD
 * channel only (not the full 64-message 16-channel Panic). Pure + injectable `now`.
 */
export function sendChannelAllNotesOff(
  output: MidiSendable,
  channel: number,
  now: number,
): void {
  const status = CONTROL_CHANGE | channel; // control-change on this channel
  for (const controller of [CC_ALL_SOUND_OFF, CC_ALL_NOTES_OFF]) {
    try {
      output.send(new Uint8Array([status, controller, 0]), now);
    } catch {
      // Best-effort: a throw on one CC does not abort the other.
    }
  }
}

/**
 * Send explicit noteOffs for ALL active notes of an output, per channel. Iterates
 * the `PerChannelNotes` map and calls `sendTrackedNoteOffs` for each channel's
 * note set. Used by the port-change / Panic / output-lost safety paths. Best-effort
 * (each note's send is individually guarded inside `sendTrackedNoteOffs`).
 */
export function sendOutputTrackedNoteOffs(
  output: MidiSendable,
  perChannel: PerChannelNotes,
  now: number,
): void {
  for (const [channel, notes] of perChannel) {
    sendTrackedNoteOffs(output, notes, channel, now);
  }
}