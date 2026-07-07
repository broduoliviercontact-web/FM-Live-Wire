// Story 4.3 — listener encode chain unit tests (AD-12, AD-5).
//
// `encodeForOutput(event, channel)` = `toMidiBytes(remapChannel(event, channel))`.
// Pure: returns a fresh `Uint8Array`, never mutates `event`. The remap REPLACES
// the original channel (forced), and `toMidiBytes` only reads the wire fields, so
// any server-added envelope (`performerId`, `srvTs`) is ignored at the edge.
import { describe, it, expect } from "vitest";
import { encodeForOutput } from "../features/listener/lib/encode";
import type { MidiEvent } from "../entities/MidiEvent";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

function noteOn(channel: number): MidiEvent {
  return {
    type: "noteOn",
    channel,
    note: 60,
    velocity: 100,
    seq: 1,
    ts: 1000,
    v: PROTOCOL_VERSION,
    roomId: ROOM,
  };
}

const VARIANTS: Array<{ name: string; event: MidiEvent; expected: (ch: number) => Uint8Array }> = [
  { name: "noteOn", event: noteOn(5), expected: (ch) => new Uint8Array([0x90 | ch, 60, 100]) },
  {
    name: "noteOff",
    event: { type: "noteOff", channel: 5, note: 60, velocity: 0, seq: 1, ts: 1000, v: PROTOCOL_VERSION, roomId: ROOM },
    expected: (ch) => new Uint8Array([0x80 | ch, 60, 0]),
  },
  {
    name: "controlChange",
    event: { type: "controlChange", channel: 5, controller: 7, value: 90, seq: 1, ts: 1000, v: PROTOCOL_VERSION, roomId: ROOM },
    expected: (ch) => new Uint8Array([0xb0 | ch, 7, 90]),
  },
  {
    name: "programChange",
    event: { type: "programChange", channel: 5, program: 42, seq: 1, ts: 1000, v: PROTOCOL_VERSION, roomId: ROOM },
    expected: (ch) => new Uint8Array([0xc0 | ch, 42]),
  },
  {
    name: "pitchBend",
    event: { type: "pitchBend", channel: 5, pitchBend: 8192, seq: 1, ts: 1000, v: PROTOCOL_VERSION, roomId: ROOM },
    expected: (ch) => new Uint8Array([0xe0 | ch, 0x00, 0x40]),
  },
];

describe("encodeForOutput — remap THEN toMidiBytes (5 types)", () => {
  for (const { name, event, expected } of VARIANTS) {
    it(`${name}: original canal 5 → listener canal data 0 gives status byte for canal 0`, () => {
      const bytes = encodeForOutput(event, 0);
      expect(Array.from(bytes)).toEqual(Array.from(expected(0)));
      // Original event NOT mutated (remap returns a new object).
      expect(event.channel).toBe(5);
    });

    it(`${name}: listener canal data 15 → status byte uses canal 15`, () => {
      const bytes = encodeForOutput(event, 15);
      expect(Array.from(bytes)).toEqual(Array.from(expected(15)));
    });
  }

  it("noteOn canal 5 + listener canal 1 (data 0) → status byte 0x90 (AC verbatim)", () => {
    const bytes = encodeForOutput(noteOn(5), 0);
    expect(bytes[0]).toBe(0x90);
  });

  it("returns a fresh Uint8Array each call (purity)", () => {
    const event = noteOn(5);
    const a = encodeForOutput(event, 0);
    const b = encodeForOutput(event, 0);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("ignores server envelope fields (performerId / srvTs) at the wire edge", () => {
    // The server relays `MidiEvent & { performerId, srvTs }`. encodeForOutput
    // only reads the wire fields, so the envelope must NOT affect the bytes.
    const relayed = {
      ...noteOn(5),
      performerId: "srv-xyz",
      srvTs: 99999,
    } as unknown as MidiEvent;
    const bytes = encodeForOutput(relayed, 0);
    expect(Array.from(bytes)).toEqual([0x90, 60, 100]);
  });
});