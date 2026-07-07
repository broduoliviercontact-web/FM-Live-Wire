// Story 3.3 — `decodeMidiEvent` unit tests (AD-3, AD-5, AD-8, AD-12).
//
// Pure decoder: bytes + ts + seq → `MidiEvent | null`. Covers the 5 allowed
// channel-voice types, the velocity-0→noteOff convention (FR-15), 14-bit
// pitchBend, channel 0–15, SysEx + out-of-scope filtering, short/null messages,
// and proves every produced payload matches the shared `MidiEventSchema` (AD-5)
// with `performerId` absent.
import { describe, it, expect } from "vitest";
import { decodeMidiEvent } from "../features/performer/lib/decode";
import {
  MidiEventSchema,
  ROOM,
  type MidiEvent,
} from "../entities/MidiEvent";

const TS = 1234.5;
const SEQ = 7;

function u(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

/** Shorthand: decode raw bytes. */
function dec(data: Uint8Array | null, seq: number = SEQ, ts: number = TS) {
  return decodeMidiEvent({ data, seq, ts });
}

/** Assert the event is schema-valid AND has the pinned common fields. */
function expectValid(event: MidiEvent | null): MidiEvent {
  expect(event).not.toBeNull();
  const ev = event as MidiEvent;
  const parsed = MidiEventSchema.safeParse(ev);
  expect(parsed.success).toBe(true);
  expect(ev.v).toBe(1);
  expect(ev.roomId).toBe(ROOM);
  expect(ev.seq).toBe(SEQ);
  expect(ev.ts).toBe(TS);
  // AD-5: performerId must NEVER be present on the client payload.
  expect("performerId" in ev).toBe(false);
  return ev;
}

describe("decodeMidiEvent — noteOn / noteOff", () => {
  it("decodes a normal noteOn (velocity > 0)", () => {
    const ev = expectValid(dec(u(0x90, 60, 100)));
    expect(ev.type).toBe("noteOn");
    if (ev.type === "noteOn") {
      expect(ev.channel).toBe(0);
      expect(ev.note).toBe(60);
      expect(ev.velocity).toBe(100);
    }
  });

  it("noteOn with velocity 0 → noteOff (FR-15)", () => {
    const ev = expectValid(dec(u(0x90, 60, 0)));
    expect(ev.type).toBe("noteOff");
    if (ev.type === "noteOff") {
      expect(ev.note).toBe(60);
      expect(ev.velocity).toBe(0);
      expect(ev.channel).toBe(0);
    }
  });

  it("decodes an explicit noteOff (0x80)", () => {
    const ev = expectValid(dec(u(0x80, 72, 64)));
    expect(ev.type).toBe("noteOff");
    if (ev.type === "noteOff") {
      expect(ev.channel).toBe(0);
      expect(ev.note).toBe(72);
      expect(ev.velocity).toBe(64);
    }
  });

  it("decodes noteOn on channel 15 (0x9F)", () => {
    const ev = expectValid(dec(u(0x9f, 60, 100)));
    expect(ev.type).toBe("noteOn");
    if (ev.type === "noteOn") {
      expect(ev.channel).toBe(15);
    }
  });
});

describe("decodeMidiEvent — controlChange / programChange", () => {
  it("decodes a controlChange (0xB0)", () => {
    const ev = expectValid(dec(u(0xb0, 7, 99)));
    expect(ev.type).toBe("controlChange");
    if (ev.type === "controlChange") {
      expect(ev.channel).toBe(0);
      expect(ev.controller).toBe(7);
      expect(ev.value).toBe(99);
    }
  });

  it("decodes a controlChange on channel 15 (0xBF)", () => {
    const ev = expectValid(dec(u(0xbf, 7, 99)));
    expect(ev).not.toBeNull();
    expect((ev as MidiEvent).channel).toBe(15);
  });

  it("decodes a programChange (0xC0, 2 bytes only)", () => {
    const ev = expectValid(dec(u(0xc0, 42)));
    expect(ev.type).toBe("programChange");
    if (ev.type === "programChange") {
      expect(ev.channel).toBe(0);
      expect(ev.program).toBe(42);
    }
  });
});

describe("decodeMidiEvent — pitchBend (14-bit, 0..16383)", () => {
  it("decodes pitchBend 0 (lsb=0, msb=0)", () => {
    const ev = expectValid(dec(u(0xe0, 0x00, 0x00)));
    expect(ev.type).toBe("pitchBend");
    if (ev.type === "pitchBend") expect(ev.pitchBend).toBe(0);
  });

  it("decodes pitchBend 8192 = center (msb=0x40, lsb=0)", () => {
    const ev = expectValid(dec(u(0xe0, 0x00, 0x40)));
    if (ev.type === "pitchBend") expect(ev.pitchBend).toBe(8192);
  });

  it("decodes pitchBend 16383 = max (msb=0x7f, lsb=0x7f)", () => {
    const ev = expectValid(dec(u(0xe0, 0x7f, 0x7f)));
    if (ev.type === "pitchBend") expect(ev.pitchBend).toBe(16383);
  });

  it("decodes an arbitrary 14-bit value (msb<<7 | lsb)", () => {
    // msb=0x20 (32), lsb=0x10 (16) → 32*128 + 16 = 4112
    const ev = expectValid(dec(u(0xe0, 0x10, 0x20)));
    if (ev.type === "pitchBend") expect(ev.pitchBend).toBe((0x20 << 7) | 0x10);
  });
});

describe("decodeMidiEvent — filtering (null results)", () => {
  it("filters SysEx (0xF0) silently → null", () => {
    expect(dec(u(0xf0, 0x43, 0x1a, 0xf7))).toBeNull();
  });

  it("ignores polyphonicKeyPressure (0xA0) → null", () => {
    expect(dec(u(0xa0, 60, 90))).toBeNull();
  });

  it("ignores channelPressure (0xD0) → null", () => {
    expect(dec(u(0xd0, 90))).toBeNull();
  });

  it("ignores an unknown status (0x50) → null", () => {
    expect(dec(u(0x50, 0x00))).toBeNull();
  });

  it("ignores system-realtime bytes (0xF8 timing clock) → null", () => {
    expect(dec(u(0xf8))).toBeNull();
  });

  it("returns null for a too-short noteOn (no velocity byte)", () => {
    expect(dec(u(0x90, 60))).toBeNull();
  });

  it("returns null for a too-short noteOff", () => {
    expect(dec(u(0x80, 60))).toBeNull();
  });

  it("returns null for a too-short controlChange", () => {
    expect(dec(u(0xb0, 7))).toBeNull();
  });

  it("returns null for a too-short programChange (status only)", () => {
    expect(dec(u(0xc0))).toBeNull();
  });

  it("returns null for a too-short pitchBend", () => {
    expect(dec(u(0xe0, 0x00))).toBeNull();
  });

  it("returns null for an empty message (no status byte)", () => {
    expect(dec(u())).toBeNull();
  });

  it("returns null when data is null", () => {
    expect(dec(null)).toBeNull();
  });
});

describe("decodeMidiEvent — AD-5 performerId forbidden", () => {
  it("never includes performerId on a produced event", () => {
    const ev = dec(u(0x90, 60, 100)) as MidiEvent;
    expect("performerId" in ev).toBe(false);
  });

  it("the shared schema rejects a performerId field (proof the contract enforces it)", () => {
    const ev = dec(u(0x90, 60, 100)) as MidiEvent;
    const r = MidiEventSchema.safeParse({ ...ev, performerId: "sock#42" });
    expect(r.success).toBe(false);
  });
});