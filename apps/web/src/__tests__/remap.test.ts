// Story 4.2 — `remap.ts` unit tests (AD-12, FR-13). Pure logic, node env.
//
// Proves:
//   - `uiChannelToData` : 1→0, 16→15, middle 8→7, clamps out-of-range (never wraps).
//   - `dataChannelToUi`: 0→1, 15→16, middle 7→8, clamps out-of-range (never wraps).
//   - `remapChannel`   : replaces `channel` on ALL 5 variants, returns a NEW
//     object (original NOT mutated), preserves type + type-specific fields.
//   - round-trip: `dataChannelToUi(uiChannelToData(n))` identity in range.
import { describe, it, expect } from "vitest";
import {
  remapChannel,
  uiChannelToData,
  dataChannelToUi,
  UI_CHANNEL_MIN,
  UI_CHANNEL_MAX,
} from "../features/listener/lib/remap";
import type { MidiEvent } from "../entities/MidiEvent";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

function noteOn(): MidiEvent {
  return {
    type: "noteOn",
    channel: 5,
    note: 60,
    velocity: 100,
    seq: 1,
    ts: 1000,
    v: PROTOCOL_VERSION,
    roomId: ROOM,
  };
}

const VARIANTS: Array<{ name: string; event: MidiEvent }> = [
  { name: "noteOn", event: noteOn() },
  {
    name: "noteOff",
    event: {
      type: "noteOff",
      channel: 5,
      note: 60,
      velocity: 0,
      seq: 1,
      ts: 1000,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
    },
  },
  {
    name: "controlChange",
    event: {
      type: "controlChange",
      channel: 5,
      controller: 7,
      value: 90,
      seq: 1,
      ts: 1000,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
    },
  },
  {
    name: "programChange",
    event: {
      type: "programChange",
      channel: 5,
      program: 42,
      seq: 1,
      ts: 1000,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
    },
  },
  {
    name: "pitchBend",
    event: {
      type: "pitchBend",
      channel: 5,
      pitchBend: 8192,
      seq: 1,
      ts: 1000,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
    },
  },
];

describe("uiChannelToData — UI 1–16 → data 0–15 (clamped)", () => {
  it("canal 1 → 0", () => {
    expect(uiChannelToData(1)).toBe(0);
  });
  it("canal 16 → 15", () => {
    expect(uiChannelToData(16)).toBe(15);
  });
  it("middle canal 8 → 7", () => {
    expect(uiChannelToData(8)).toBe(7);
  });
  it("clamps below 1 to 0 (no wrap)", () => {
    expect(uiChannelToData(0)).toBe(0);
    expect(uiChannelToData(-5)).toBe(0);
  });
  it("clamps above 16 to 15 (no wrap)", () => {
    expect(uiChannelToData(17)).toBe(15);
    expect(uiChannelToData(99)).toBe(15);
  });
});

describe("dataChannelToUi — data 0–15 → UI 1–16 (clamped)", () => {
  it("data 0 → UI 1", () => {
    expect(dataChannelToUi(0)).toBe(1);
  });
  it("data 15 → UI 16", () => {
    expect(dataChannelToUi(15)).toBe(16);
  });
  it("middle data 7 → UI 8", () => {
    expect(dataChannelToUi(7)).toBe(8);
  });
  it("clamps below 0 to UI 1 (no wrap)", () => {
    expect(dataChannelToUi(-1)).toBe(1);
    expect(dataChannelToUi(-99)).toBe(1);
  });
  it("clamps above 15 to UI 16 (no wrap)", () => {
    expect(dataChannelToUi(16)).toBe(16);
    expect(dataChannelToUi(99)).toBe(16);
  });
});

describe("uiChannelToData / dataChannelToUi — round-trip in range", () => {
  it("every UI channel round-trips through data and back", () => {
    for (let ui = UI_CHANNEL_MIN; ui <= UI_CHANNEL_MAX; ui++) {
      expect(dataChannelToUi(uiChannelToData(ui))).toBe(ui);
    }
  });
});

describe("remapChannel — replaces channel on all 5 variants, no mutation", () => {
  for (const { name, event } of VARIANTS) {
    it(`${name}: channel 5 → 0, original not mutated, type preserved`, () => {
      const snapshot = { ...event };
      const remapped = remapChannel(event, 0);
      // Channel replaced.
      expect(remapped.channel).toBe(0);
      // Original event NOT mutated.
      expect(event).toEqual(snapshot);
      expect(event.channel).toBe(5);
      // New object (not the same reference).
      expect(remapped).not.toBe(event);
      // Type + type-specific fields preserved.
      expect(remapped.type).toBe(event.type);
      expect(remapped).toMatchObject({ ...event, channel: 0 });
    });
  }

  it("incoming canal 5 + listener canal 1 (data 0) → event channel === 0 (AC)", () => {
    const event = noteOn(); // channel 5
    const remapped = remapChannel(event, 0);
    expect(remapped.channel).toBe(0);
    // AC verbatim: the original channel is replaced.
    expect(remapped.channel).not.toBe(event.channel);
  });

  it("is pure: calling twice with the same input yields equal, independent objects", () => {
    const event = noteOn();
    const a = remapChannel(event, 3);
    const b = remapChannel(event, 3);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a).not.toBe(event);
  });
});