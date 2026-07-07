// @fmlw/shared — MidiEventSchema unit tests (Story 1.2).
// Pure contract tests: no DOM, no server. Imports the schema straight from
// source (no build step needed for these). A separate import-shared test in
// apps/* proves the built package resolves via workspace:*.
import { describe, it, expect } from "vitest";
import { MidiEventSchema, type MidiEvent } from "../midi-event";
import { ROOM, PROTOCOL_VERSION, ERROR_CODES } from "../constants";

// Common valid fields shared by every variant.
const base = {
  v: PROTOCOL_VERSION,
  roomId: ROOM,
  channel: 0,
  seq: 1,
  ts: 123.4,
} as const;

const validNoteOn = { ...base, type: "noteOn", note: 60, velocity: 100 } as const;
const validNoteOff = { ...base, type: "noteOff", note: 60, velocity: 0 } as const;
const validControlChange = { ...base, type: "controlChange", controller: 74, value: 91 } as const;
const validProgramChange = { ...base, type: "programChange", program: 42 } as const;
const validPitchBend = { ...base, type: "pitchBend", pitchBend: 8192 } as const;

describe("MidiEventSchema — valid events", () => {
  it("parses a valid noteOn and returns typed data", () => {
    const r = MidiEventSchema.safeParse(validNoteOn);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("noteOn");
      expect(r.data.note).toBe(60);
      expect(r.data.velocity).toBe(100);
      expect(r.data.channel).toBe(0);
      expect(r.data.roomId).toBe(ROOM);
      expect(r.data.v).toBe(1);
      // Compile-time proof the inferred type is the noteOn variant.
      const _typed: MidiEvent = r.data;
      void _typed;
    }
  });

  it("parses a valid noteOff", () => {
    const r = MidiEventSchema.safeParse(validNoteOff);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("noteOff");
  });

  it("parses a valid controlChange", () => {
    const r = MidiEventSchema.safeParse(validControlChange);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("controlChange");
      expect(r.data.controller).toBe(74);
      expect(r.data.value).toBe(91);
    }
  });

  it("parses a valid programChange", () => {
    const r = MidiEventSchema.safeParse(validProgramChange);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.program).toBe(42);
  });

  it("parses a valid pitchBend (center, min, max)", () => {
    for (const pitchBend of [0, 8192, 16383]) {
      const r = MidiEventSchema.safeParse({ ...base, type: "pitchBend", pitchBend });
      expect(r.success).toBe(true);
    }
  });

  it("accepts channel 15 (wire upper bound)", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, channel: 15 });
    expect(r.success).toBe(true);
  });
});

describe("MidiEventSchema — strictness (unknown fields / performerId)", () => {
  it("rejects an unknown field with an unrecognized_keys issue", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, foo: "bar" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("rejects performerId as an unknown field (AD-5: forbidden on the wire)", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, performerId: "sock#42" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const hit = r.error.issues.find((i) => i.code === "unrecognized_keys");
      expect(hit).toBeDefined();
      // In Zod 3, `unrecognized_keys` issues list rejected key names in `keys`
      // (the `path` points at the object, which is the root here).
      expect((hit as { keys?: string[] } | undefined)?.keys).toContain("performerId");
    }
  });
});

describe("MidiEventSchema — version (v)", () => {
  it("rejects v !== 1 and the ZodIssue points at the `v` field", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, v: 2 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const vIssue = r.error.issues.find((i) => i.path[0] === "v");
      expect(vIssue, "expected a ZodIssue whose path points to `v`").toBeDefined();
      expect(vIssue?.code).toBe("invalid_literal");
      // The stable application code is exposed as a constant only — no mapping
      // is performed in Story 1.2 (deferred to Story 2.6 ValidationService).
      expect(ERROR_CODES.UNSUPPORTED_VERSION).toBe("unsupported-version");
    }
  });

  it("rejects a missing v field", () => {
    const { v: _v, ...noV } = validNoteOn;
    void _v;
    const r = MidiEventSchema.safeParse(noV);
    expect(r.success).toBe(false);
  });
});

describe("MidiEventSchema — roomId", () => {
  it("rejects roomId !== ROOM", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, roomId: "other-room" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "roomId")).toBe(true);
    }
  });
});

describe("MidiEventSchema — range rejections", () => {
  it("rejects channel = 16 (above wire max 15)", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, channel: 16 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "channel")).toBe(true);
  });

  it("rejects note = 128", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, note: 128 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "note")).toBe(true);
  });

  it("rejects velocity = 128", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, velocity: 128 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "velocity")).toBe(true);
  });

  it("rejects controlChange controller = 128", () => {
    const r = MidiEventSchema.safeParse({ ...validControlChange, controller: 128 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "controller")).toBe(true);
  });

  it("rejects controlChange value = 128", () => {
    const r = MidiEventSchema.safeParse({ ...validControlChange, value: 128 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "value")).toBe(true);
  });

  it("rejects programChange program = 128", () => {
    const r = MidiEventSchema.safeParse({ ...validProgramChange, program: 128 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "program")).toBe(true);
  });

  it("rejects pitchBend = 16384 (above 14-bit max 16383)", () => {
    const r = MidiEventSchema.safeParse({ ...validPitchBend, pitchBend: 16384 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "pitchBend")).toBe(true);
  });

  it("rejects a non-integer channel", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, channel: 1.5 });
    expect(r.success).toBe(false);
  });

  it("rejects a negative seq (uint32)", () => {
    const r = MidiEventSchema.safeParse({ ...validNoteOn, seq: -1 });
    expect(r.success).toBe(false);
  });
});

describe("MidiEventSchema — no SysEx type (AD-8)", () => {
  it("rejects type: 'sysex' — the discriminator is not in the schema", () => {
    // Build a sysex-shaped payload; `type` alone must be enough to reject it.
    const r = MidiEventSchema.safeParse({
      ...base,
      type: "sysex",
      data: [0xf0, 0x00, 0xf7],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The failure must point at the discriminator (`type`), proving the union
      // has no sysex variant.
      expect(r.error.issues.some((i) => i.path[0] === "type")).toBe(true);
    }
  });

  it("the 5 accepted type literals are exactly the channel-voice set", () => {
    const accepted = ["noteOn", "noteOff", "controlChange", "programChange", "pitchBend"];
    for (const type of accepted) {
      const r = MidiEventSchema.safeParse({ ...base, type });
      // They won't all parse (missing type-specific fields), but the failure must
      // NOT be an invalid discriminator — it must be a missing required field,
      // proving the type literal itself is accepted.
      expect(r.success).toBe(false);
      if (!r.success) {
        const invalidDisc = r.error.issues.find((i) => i.code === "invalid_union_discriminator");
        expect(invalidDisc, `type "${type}" should be a known discriminator`).toBeUndefined();
      }
    }
    // And `sysex` is rejected at the discriminator level specifically.
    const sysexR = MidiEventSchema.safeParse({ ...base, type: "sysex" });
    if (!sysexR.success) {
      expect(sysexR.error.issues.some((i) => i.code === "invalid_union_discriminator")).toBe(true);
    }
  });
});