import {
  PROTOCOL_VERSION,
  ROOM,
  type MidiEvent,
} from "../../../entities/MidiEvent";

// Story 3.3 — pure MIDI bytes → `MidiEvent` decoder (AD-3, AD-5, AD-8, AD-12).
//
// Decodes a single Web MIDI `MIDIMessageEvent.data` (status byte + data bytes)
// into the shared `MidiEvent` contract for the 5 allowed channel-voice types:
//   noteOn (0x90), noteOff (0x80), controlChange (0xB0),
//   programChange (0xC0), pitchBend (0xE0).
//
// Invariants:
//   - `v` = PROTOCOL_VERSION (1), `roomId` = ROOM; `seq` and `ts` are passed in.
//   - `channel` is the low nibble (0–15) — AD-12 (no UI 1–16 conversion here).
//   - `performerId` is NEVER set (AD-5: the server attaches `socket.id`).
//   - SysEx (`data[0] === 0xF0`) → null (AD-8: silently filtered, never sent,
//     never displayed, never logged).
//   - Types outside the 5 (polyphonicKeyPressure 0xA0, channelPressure 0xD0,
//     system/realtime/unknown status) → null (ignored).
//   - `noteOn` with velocity 0 → `noteOff` (FR-15 convention).
//   - pitchBend = (msb << 7) | lsb, range 0..16383 (center 8192).
//
// Pure: no I/O, no globals, no `Date.now()` — `ts` is the caller's
// `event.timeStamp`.

/** Inputs needed to decode one captured MIDI message. */
export interface DecodeInput {
  /** Web MIDI message bytes (status + data). `null` per the DOM lib. */
  readonly data: Uint8Array | null;
  /** `event.timeStamp` (DOMHighResTimeStamp, ms) — NEVER `Date.now()`. */
  readonly ts: number;
  /** Monotone uint32 sequence value for this event. */
  readonly seq: number;
}

/** The 5 channel-voice status high-nibbles this decoder recognises. */
const STATUS_NOTE_ON = 0x90;
const STATUS_NOTE_OFF = 0x80;
const STATUS_CONTROL_CHANGE = 0xb0;
const STATUS_PROGRAM_CHANGE = 0xc0;
const STATUS_PITCH_BEND = 0xe0;

/** SysEx start byte (AD-8: filtered, never decoded). */
const STATUS_SYSEX_START = 0xf0;

/**
 * Decode a Web MIDI message into a `MidiEvent`, or `null` if the message is
 * SysEx, an out-of-scope type, malformed/short, or has no status byte.
 */
export function decodeMidiEvent(input: DecodeInput): MidiEvent | null {
  const { data, ts, seq } = input;
  if (data === null) return null;

  // `noUncheckedIndexedAccess` makes every index `number | undefined`; reading
  // the status byte and guarding `undefined` also covers the empty/short cases.
  const status = data[0];
  if (status === undefined) return null; // no status byte
  // AD-8: SysEx is silently filtered — never produced, sent, or displayed.
  if (status === STATUS_SYSEX_START) return null;

  const typeNibble = status & 0xf0;
  const channel = status & 0x0f;

  switch (typeNibble) {
    case STATUS_NOTE_ON: {
      const note = data[1];
      const velocity = data[2];
      if (note === undefined || velocity === undefined) return null;
      // FR-15: noteOn with velocity 0 is a noteOff.
      if (velocity === 0) {
        return noteOffEvent(channel, seq, ts, note, velocity);
      }
      return noteOnEvent(channel, seq, ts, note, velocity);
    }
    case STATUS_NOTE_OFF: {
      const note = data[1];
      const velocity = data[2];
      if (note === undefined || velocity === undefined) return null;
      return noteOffEvent(channel, seq, ts, note, velocity);
    }
    case STATUS_CONTROL_CHANGE: {
      const controller = data[1];
      const value = data[2];
      if (controller === undefined || value === undefined) return null;
      return controlChangeEvent(channel, seq, ts, controller, value);
    }
    case STATUS_PROGRAM_CHANGE: {
      // programChange is 2 bytes only (status + program).
      const program = data[1];
      if (program === undefined) return null;
      return programChangeEvent(channel, seq, ts, program);
    }
    case STATUS_PITCH_BEND: {
      const lsb = data[1];
      const msb = data[2];
      if (lsb === undefined || msb === undefined) return null;
      const pitchBend = (msb << 7) | lsb; // 14-bit, 0..16383
      return pitchBendEvent(channel, seq, ts, pitchBend);
    }
    default:
      // 0xA0 (polyphonicKeyPressure), 0xD0 (channelPressure), 0xF1–0xFF
      // (system/realtime — 0xF0 already returned above), or any unknown
      // high-nibble: ignored.
      return null;
  }
}

// --- Variant builders (each returns the strict `MidiEvent` variant) ----------

type NoteOnEvent = Extract<MidiEvent, { type: "noteOn" }>;
type NoteOffEvent = Extract<MidiEvent, { type: "noteOff" }>;
type ControlChangeEvent = Extract<MidiEvent, { type: "controlChange" }>;
type ProgramChangeEvent = Extract<MidiEvent, { type: "programChange" }>;
type PitchBendEvent = Extract<MidiEvent, { type: "pitchBend" }>;

function noteOnEvent(
  channel: number,
  seq: number,
  ts: number,
  note: number,
  velocity: number,
): NoteOnEvent {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    type: "noteOn",
    channel,
    seq,
    ts,
    note,
    velocity,
  };
}

function noteOffEvent(
  channel: number,
  seq: number,
  ts: number,
  note: number,
  velocity: number,
): NoteOffEvent {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    type: "noteOff",
    channel,
    seq,
    ts,
    note,
    velocity,
  };
}

function controlChangeEvent(
  channel: number,
  seq: number,
  ts: number,
  controller: number,
  value: number,
): ControlChangeEvent {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    type: "controlChange",
    channel,
    seq,
    ts,
    controller,
    value,
  };
}

function programChangeEvent(
  channel: number,
  seq: number,
  ts: number,
  program: number,
): ProgramChangeEvent {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    type: "programChange",
    channel,
    seq,
    ts,
    program,
  };
}

function pitchBendEvent(
  channel: number,
  seq: number,
  ts: number,
  pitchBend: number,
): PitchBendEvent {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    type: "pitchBend",
    channel,
    seq,
    ts,
    pitchBend,
  };
}