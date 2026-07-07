// @fmlw/shared — toMidiBytes unit tests (Story 1.3).
// Deterministic 1:1 wire→bytes mapping. Inputs are produced via
// MidiEventSchema.parse (i.e. genuinely validated MidiEvent instances).
import { describe, it, expect } from "vitest";
import { toMidiBytes } from "../encode";
import { MidiEventSchema, type MidiEvent, ROOM } from "../index";

const base = { v: 1, roomId: ROOM, seq: 1, ts: 123.4 } as const;

// Build a validated MidiEvent from a plain payload.
function ev(payload: Record<string, unknown>): MidiEvent {
  const r = MidiEventSchema.parse(payload);
  return r;
}

const noteOn = (channel: number, note: number, velocity: number) =>
  ev({ ...base, type: "noteOn", channel, note, velocity });
const noteOff = (channel: number, note: number, velocity: number) =>
  ev({ ...base, type: "noteOff", channel, note, velocity });
const controlChange = (channel: number, controller: number, value: number) =>
  ev({ ...base, type: "controlChange", channel, controller, value });
const programChange = (channel: number, program: number) =>
  ev({ ...base, type: "programChange", channel, program });
const pitchBend = (channel: number, pitchBend: number) =>
  ev({ ...base, type: "pitchBend", channel, pitchBend });

const u = (...xs: number[]): Uint8Array => new Uint8Array(xs);

describe("toMidiBytes — channel 0 (canonical AC cases)", () => {
  it("noteOn ch0 note60 velocity100 → [0x90, 60, 100]", () => {
    expect(toMidiBytes(noteOn(0, 60, 100))).toEqual(u(0x90, 60, 100));
  });

  it("noteOff ch0 note60 velocity0 → [0x80, 60, 0]", () => {
    expect(toMidiBytes(noteOff(0, 60, 0))).toEqual(u(0x80, 60, 0));
  });

  it("controlChange ch3 controller74 value91 → [0xB3, 74, 91]", () => {
    expect(toMidiBytes(controlChange(3, 74, 91))).toEqual(u(0xb3, 74, 91));
  });

  it("programChange ch0 program42 → [0xC0, 42]", () => {
    expect(toMidiBytes(programChange(0, 42))).toEqual(u(0xc0, 42));
  });

  it("pitchBend ch0 value8192 → [0xE0, 0x00, 0x40] (lsb=0, msb=64)", () => {
    expect(toMidiBytes(pitchBend(0, 8192))).toEqual(u(0xe0, 0x00, 0x40));
  });
});

describe("toMidiBytes — channel 15 (wire upper bound, 0x?F status bytes)", () => {
  it("noteOn ch15 → status 0x9F", () => {
    expect(toMidiBytes(noteOn(15, 60, 100))).toEqual(u(0x9f, 60, 100));
  });
  it("noteOff ch15 → status 0x8F", () => {
    expect(toMidiBytes(noteOff(15, 60, 0))).toEqual(u(0x8f, 60, 0));
  });
  it("controlChange ch15 → status 0xBF", () => {
    expect(toMidiBytes(controlChange(15, 74, 91))).toEqual(u(0xbf, 74, 91));
  });
  it("programChange ch15 → status 0xCF", () => {
    expect(toMidiBytes(programChange(15, 42))).toEqual(u(0xcf, 42));
  });
  it("pitchBend ch15 → status 0xEF", () => {
    expect(toMidiBytes(pitchBend(15, 8192))).toEqual(u(0xef, 0x00, 0x40));
  });
});

describe("toMidiBytes — programChange is exactly 2 bytes", () => {
  it("programChange length === 2 (status + program, no data2)", () => {
    const bytes = toMidiBytes(programChange(0, 42));
    expect(bytes.length).toBe(2);
    expect(bytes).toEqual(u(0xc0, 42));
  });
  it("programChange ch7 program0 → [0xC7, 0] (program lower bound)", () => {
    expect(toMidiBytes(programChange(7, 0))).toEqual(u(0xc7, 0));
  });
  it("programChange ch7 program127 → [0xC7, 127] (program upper bound)", () => {
    expect(toMidiBytes(programChange(7, 127))).toEqual(u(0xc7, 127));
  });
});

describe("toMidiBytes — pitchBend 14-bit split", () => {
  it("value 0 → [0xE0, 0x00, 0x00]", () => {
    expect(toMidiBytes(pitchBend(0, 0))).toEqual(u(0xe0, 0x00, 0x00));
  });
  it("value 8192 (center) → [0xE0, 0x00, 0x40]", () => {
    expect(toMidiBytes(pitchBend(0, 8192))).toEqual(u(0xe0, 0x00, 0x40));
  });
  it("value 16383 (max) → [0xE0, 0x7F, 0x7F]", () => {
    expect(toMidiBytes(pitchBend(0, 16383))).toEqual(u(0xe0, 0x7f, 0x7f));
  });
  it("lsb/msb split is bit-accurate for an asymmetric value (8193)", () => {
    // 8193 = 0x2001 → lsb = 0x01, msb = 0x40
    expect(toMidiBytes(pitchBend(0, 8193))).toEqual(u(0xe0, 0x01, 0x40));
  });
});

describe("toMidiBytes — 7-bit data bounds", () => {
  it("note 0 and 127 round-trip on noteOn", () => {
    expect(toMidiBytes(noteOn(0, 0, 100))).toEqual(u(0x90, 0, 100));
    expect(toMidiBytes(noteOn(0, 127, 100))).toEqual(u(0x90, 127, 100));
  });
  it("velocity 0 and 127 on noteOn", () => {
    expect(toMidiBytes(noteOn(0, 60, 0))).toEqual(u(0x90, 60, 0));
    expect(toMidiBytes(noteOn(0, 60, 127))).toEqual(u(0x90, 60, 127));
  });
  it("controller 0/127 and value 0/127 on controlChange", () => {
    expect(toMidiBytes(controlChange(0, 0, 0))).toEqual(u(0xb0, 0, 0));
    expect(toMidiBytes(controlChange(0, 127, 127))).toEqual(u(0xb0, 127, 127));
  });
  it("noteOff velocity bounds 0/127", () => {
    expect(toMidiBytes(noteOff(0, 60, 0))).toEqual(u(0x80, 60, 0));
    expect(toMidiBytes(noteOff(0, 60, 127))).toEqual(u(0x80, 60, 127));
  });
});

describe("toMidiBytes — noteOn velocity 0 is NOT converted to noteOff", () => {
  it("noteOn velocity 0 keeps status 0x90 (wire preserves it; listener decides)", () => {
    const bytes = toMidiBytes(noteOn(0, 60, 0));
    expect(bytes).toEqual(u(0x90, 60, 0));
    expect(bytes[0]).toBe(0x90); // explicitly NOT 0x80
    expect(bytes[0]).not.toBe(0x80);
  });
  it("same on channel 15 → status 0x9F (not 0x8F)", () => {
    const bytes = toMidiBytes(noteOn(15, 60, 0));
    expect(bytes).toEqual(u(0x9f, 60, 0));
    expect(bytes[0]).not.toBe(0x8f);
  });
});

describe("toMidiBytes — determinism", () => {
  it("same input produces equal output across calls", () => {
    const e = pitchBend(2, 1234);
    const a = toMidiBytes(e);
    const b = toMidiBytes(e);
    expect(a).toEqual(b);
  });
  it("outputs are separate instances (no shared buffer aliasing)", () => {
    const e = noteOn(0, 60, 100);
    const a = toMidiBytes(e);
    const b = toMidiBytes(e);
    expect(a).not.toBe(b);
    a[0] = 0xff; // mutate one
    expect(b[0]).toBe(0x90); // the other is unaffected
  });
});

describe("toMidiBytes — purity (input not mutated)", () => {
  it("does not mutate a noteOn event", () => {
    const e = noteOn(0, 60, 100);
    const before = JSON.stringify(e);
    toMidiBytes(e);
    expect(JSON.stringify(e)).toBe(before);
  });
  it("does not mutate a pitchBend event (pitchBend value unchanged)", () => {
    const e = pitchBend(0, 8192);
    const before = JSON.stringify(e);
    toMidiBytes(e);
    expect(JSON.stringify(e)).toBe(before);
    expect(e.pitchBend).toBe(8192);
  });
  it("does not mutate a controlChange event", () => {
    const e = controlChange(3, 74, 91);
    const before = JSON.stringify(e);
    toMidiBytes(e);
    expect(JSON.stringify(e)).toBe(before);
  });
});