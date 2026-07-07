// Story 2.6 — ValidationService unit tests (AD-5, AD-9, FR-21, E8/E13).
//
// Pure unit tests: `validateMidiEvent` wraps `MidiEventSchema.safeParse` (shared,
// single source) and maps ZodIssue → stable codes (`invalid` /
// `unsupported-version`). Covers every valid variant, every required rejection,
// the `v !== 1` → `unsupported-version` path, `issues` presence, and proves the
// schema is consumed from `@fmlw/shared`.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect } from "vitest";
import {
  validateMidiEvent,
  ValidationService,
  type ValidationResult,
} from "../socket/services/ValidationService";
import {
  ROOM,
  PROTOCOL_VERSION,
  CHANNEL_MAX,
  DATA_MAX,
  PITCH_BEND_MAX,
  MidiEventSchema,
} from "@fmlw/shared";

/** Base valid noteOn payload; overrides applied per test. */
function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    channel: 0,
    seq: 1,
    ts: 100,
    type: "noteOn",
    note: 60,
    velocity: 100,
    ...over,
  };
}

/** Assert a result is a rejection with the given code + non-empty issues. */
function expectRejected(
  res: ValidationResult,
  code: "invalid" | "unsupported-version",
) {
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe(code);
    expect(Array.isArray(res.issues)).toBe(true);
    expect(res.issues.length).toBeGreaterThan(0);
  }
}

describe("validateMidiEvent — valid events return { ok:true, data }", () => {
  it("noteOn", () => {
    const res = validateMidiEvent(base());
    expect(res).toEqual({ ok: true, data: base() });
  });

  it("noteOff", () => {
    const input = base({ type: "noteOff", velocity: 0 });
    const res = validateMidiEvent(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(input);
  });

  it("controlChange", () => {
    const input = base({ type: "controlChange", controller: 7, value: 100, note: undefined, velocity: undefined });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    const res = validateMidiEvent(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(input);
  });

  it("programChange", () => {
    const input = base({ type: "programChange", program: 42 });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    const res = validateMidiEvent(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(input);
  });

  it("pitchBend", () => {
    const input = base({ type: "pitchBend", pitchBend: 8192 });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    const res = validateMidiEvent(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(input);
  });

  it("validates every channel-voice variant through the shared schema", () => {
    // Sanity: the 5 variants are exactly the shared schema's options.
    const variants = ["noteOn", "noteOff", "controlChange", "programChange", "pitchBend"];
    for (const type of variants) {
      const input = base({ type });
      // Strip note/velocity for variants that don't take them; add their fields.
      if (type === "controlChange") Object.assign(input, { controller: 7, value: 10 });
      if (type === "programChange") Object.assign(input, { program: 0 });
      if (type === "pitchBend") Object.assign(input, { pitchBend: 0 });
      if (type !== "noteOn" && type !== "noteOff") {
        delete (input as Record<string, unknown>).note;
        delete (input as Record<string, unknown>).velocity;
      }
      expect(validateMidiEvent(input).ok).toBe(true);
    }
  });
});

describe("validateMidiEvent — rejections map to `invalid`", () => {
  it("unknown field → invalid", () => {
    expectRejected(validateMidiEvent(base({ extra: 1 })), "invalid");
  });

  it("performerId present → invalid (forbidden field, AD-5)", () => {
    const res = validateMidiEvent(base({ performerId: "P1" }));
    expectRejected(res, "invalid");
  });

  it("channel out of range (high) → invalid", () => {
    expectRejected(validateMidiEvent(base({ channel: CHANNEL_MAX + 1 })), "invalid");
  });

  it("channel out of range (negative) → invalid", () => {
    expectRejected(validateMidiEvent(base({ channel: -1 })), "invalid");
  });

  it("note out of range → invalid", () => {
    expectRejected(validateMidiEvent(base({ note: DATA_MAX + 1 })), "invalid");
  });

  it("velocity out of range → invalid", () => {
    expectRejected(validateMidiEvent(base({ velocity: DATA_MAX + 1 })), "invalid");
  });

  it("controller out of range → invalid", () => {
    const input = base({ type: "controlChange", controller: DATA_MAX + 1, value: 10 });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    expectRejected(validateMidiEvent(input), "invalid");
  });

  it("value out of range → invalid", () => {
    const input = base({ type: "controlChange", controller: 7, value: DATA_MAX + 1 });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    expectRejected(validateMidiEvent(input), "invalid");
  });

  it("program out of range → invalid", () => {
    const input = base({ type: "programChange", program: DATA_MAX + 1 });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    expectRejected(validateMidiEvent(input), "invalid");
  });

  it("pitchBend out of range → invalid", () => {
    const input = base({ type: "pitchBend", pitchBend: PITCH_BEND_MAX + 1 });
    delete (input as Record<string, unknown>).note;
    delete (input as Record<string, unknown>).velocity;
    expectRejected(validateMidiEvent(input), "invalid");
  });

  it("roomId different from ROOM → invalid", () => {
    expectRejected(validateMidiEvent(base({ roomId: "some-other-room" })), "invalid");
  });

  it("type sysex → invalid (no sysex variant, AD-8)", () => {
    const res = validateMidiEvent(base({ type: "sysex" }));
    expectRejected(res, "invalid");
    // sysex is rejected at the discriminator → invalid_union_discriminator.
    if (!res.ok) {
      expect(res.issues.some((i) => i.code === "invalid_union_discriminator")).toBe(true);
    }
  });

  it("non-object input (string) → invalid", () => {
    expectRejected(validateMidiEvent("not-an-event"), "invalid");
  });
});

describe("validateMidiEvent — `v !== 1` maps to `unsupported-version`", () => {
  it("v = 2 → unsupported-version with an issue on path ['v']", () => {
    const res = validateMidiEvent(base({ v: 2 }));
    expectRejected(res, "unsupported-version");
    if (!res.ok) {
      expect(res.issues.some((i) => i.path[0] === "v")).toBe(true);
    }
  });

  it("v = 0 → unsupported-version", () => {
    expectRejected(validateMidiEvent(base({ v: 0 })), "unsupported-version");
  });

  it("a valid event with v = 1 is accepted (regression)", () => {
    expect(validateMidiEvent(base({ v: PROTOCOL_VERSION })).ok).toBe(true);
  });
});

describe("validateMidiEvent — uses @fmlw/shared as the single schema source", () => {
  it("rejects performerId with unrecognized_keys keys=['performerId'] (shared .strict() behavior)", () => {
    // This issue shape is produced ONLY by the shared strict schema — proving
    // ValidationService consumes @fmlw/shared (zero drift, AD-5).
    const res = validateMidiEvent(base({ performerId: "X" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const unk = res.issues.find((i) => i.code === "unrecognized_keys");
      expect(unk).toBeDefined();
      expect((unk as { keys: string[] }).keys).toContain("performerId");
    }
  });

  it("accepts exactly what the shared MidiEventSchema accepts", () => {
    // Cross-check: the service and the raw shared schema agree on a valid event.
    const input = base();
    const direct = MidiEventSchema.safeParse(input);
    const via = validateMidiEvent(input);
    expect(via.ok).toBe(direct.success);
    if (via.ok && direct.success) expect(via.data).toEqual(direct.data);
  });
});

describe("ValidationService (injectable class) delegates to validateMidiEvent", () => {
  it("validate() returns the same result as the pure function (valid + invalid)", () => {
    const svc = new ValidationService();
    const valid = base();
    expect(svc.validate(valid)).toEqual(validateMidiEvent(valid));
    const invalid = base({ performerId: "X" });
    expect(svc.validate(invalid)).toEqual(validateMidiEvent(invalid));
  });
});