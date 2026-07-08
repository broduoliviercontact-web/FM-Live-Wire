// Story 5.4 — listener scheduler backpressure unit tests (AD-11, FR-25/26/27).
// Pure, node env (no DOM, no Web MIDI, no network, no fake timers needed).
//
// Proves:
//   - normal reception → send(data, now + LOOKAHEAD_MS) (lookahead path);
//   - late noteOn / noteOff / programChange → fallback IMMEDIATE send(data, now)
//     (the note / program is NOT lost, FR-26);
//   - late controlChange / pitchBend → DROP (no send, FR-26);
//   - fallbackCount increments for late noteOn/noteOff/programChange (via the
//     `ScheduleResult.outcome === "fallback"` flag);
//   - drop count increments for late controlChange/pitchBend (via
//     `result.outcome === "dropped"`);
//   - latency MAX_LATE_MS (200) exact → NOT late (boundary); 201 → late;
//   - buffer cap 256 (FR-25): after 256 events the buffer length is 256;
//   - the 257th event → drop oldest (bufferOverflow === true);
//   - the buffer is BOUNDED (never an infinite queue): feed 1000 events →
//     length stays at 256;
//   - the local warning is driven by `result.bufferOverflow` (FR-25/27);
//   - `scheduler.ts` has NO socket.io-client / connection / server overload
//     event / `socket.emit` / `.emit(` dependency (import-check on source).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeLatencyMs,
  effectiveLatencyMs,
  isLate,
  shouldFallbackOnLate,
  decideBackpressure,
  createMidiScheduler,
  type MidiEventType,
  type MidiScheduler,
} from "../features/listener/lib/scheduler";
import { LOOKAHEAD_MS, MAX_LATE_MS, BUFFER_CAP } from "../config/runtime";
import type { MidiSendable } from "../features/listener/lib/sendable";

// --- recording output --------------------------------------------------------

function recordingOutput(): MidiSendable & {
  sends: { data: Uint8Array; ts: number }[];
} {
  const sends: { data: Uint8Array; ts: number }[] = [];
  return {
    sends,
    send(data: Uint8Array, ts?: number): void {
      sends.push({ data: new Uint8Array(data), ts: ts as number });
    },
  };
}

/**
 * Hotfix fidélité musicale — prime a deferred-playback anchor so a subsequent
 * single `schedule` call can be SCHEDULE-late. A single event with a null
 * anchor always targets `now + PLAYBACK_DELAY_MS` (the future) → never late, so
 * to exercise the late path on ONE call we first establish an anchor on a
 * throwaway output (so the test's `out` captures only the event under test).
 * Default prime: performerTs 1000 at now 1000 → anchor { 1000, 2500 }. Then a
 * test event at now 5000 with performerTs 1120 → target 2620 < 5040 → late.
 */
function primeAnchor(sch: MidiScheduler, performerTs = 1000, now = 1000): void {
  sch.schedule(recordingOutput(), new Uint8Array([0x90, 60, 100]), {
    type: "noteOn",
    performerTs,
    receivedAtMs: now,
  }, now);
}

const N = (type: MidiEventType) => type; // alias to keep lines short

// --- pure helpers ------------------------------------------------------------

describe("computeLatencyMs — receivedAtMs - srvTs (null when srvTs absent)", () => {
  it("returns null when srvTs is undefined", () => {
    expect(computeLatencyMs(undefined, 1000)).toBeNull();
  });
  it("returns receivedAtMs - srvTs (both epoch, comparable)", () => {
    expect(computeLatencyMs(1000, 1200)).toBe(200); // received 200 ms after relay
    expect(computeLatencyMs(1000, 1000)).toBe(0);
    expect(computeLatencyMs(1100, 1000)).toBe(-100); // defensive: negative (clock skew) → not late
  });
  it("does NOT use the performer ts — only the epoch pair (Story 6.8 hotfix)", () => {
    // A wild performer performance.now() (e.g. 5 ms from the performer's page
    // load) must NOT leak into the latency: only receivedAtMs - srvTs matters.
    // Here srvTs/receivedAtMs are epoch; the performer ts is irrelevant to this
    // function (it is not even an argument).
    expect(computeLatencyMs(1_783_000_000_000, 1_783_000_000_050)).toBe(50);
  });
});

describe("isLate — strictly greater than MAX_LATE_MS", () => {
  it("MAX_LATE_MS is 200 (AD-11 confirmed default)", () => {
    expect(MAX_LATE_MS).toBe(200);
  });
  it("null latency is NOT late", () => {
    expect(isLate(null)).toBe(false);
  });
  it("200 ms exact is NOT late (boundary, strict >)", () => {
    expect(isLate(200)).toBe(false);
  });
  it("201 ms IS late", () => {
    expect(isLate(201)).toBe(true);
  });
  it("0 / negative latency is NOT late", () => {
    expect(isLate(0)).toBe(false);
    expect(isLate(-5)).toBe(false);
  });
});

describe("effectiveLatencyMs — clamp raw latency to 0 (clock-skew guard)", () => {
  it("returns null when srvTs is undefined (no latency info)", () => {
    expect(effectiveLatencyMs(undefined, 1000)).toBeNull();
  });
  it("passes through a positive raw delta unchanged", () => {
    expect(effectiveLatencyMs(1000, 1250)).toBe(250);
  });
  it("returns 0 for a zero raw delta", () => {
    expect(effectiveLatencyMs(1000, 1000)).toBe(0);
  });
  it("clamps a NEGATIVE raw delta (server clock ahead of client) to 0", () => {
    // receivedAtMs - srvTs = -162 (the prod clock-skew symptom) → 0, NOT -162.
    expect(effectiveLatencyMs(1162, 1000)).toBe(0);
    expect(effectiveLatencyMs(1100, 1000)).toBe(0);
  });
  it("isLate(effectiveLatencyMs(...)) is false for clock skew (never late on skew)", () => {
    expect(isLate(effectiveLatencyMs(1162, 1000))).toBe(false); // raw -162 → 0
  });
  it("isLate(effectiveLatencyMs(...)) is true only past MAX_LATE_MS", () => {
    expect(isLate(effectiveLatencyMs(1000, 1250))).toBe(true); // 250 > 200
  });
});

describe("schedule — negative latency (clock skew) never triggers late / LateAlert", () => {
  // Reproduces the post-Render-retest symptom: the listener clock runs behind
  // the server so receivedAtMs - srvTs is negative. A negative one-way estimate
  // is meaningless and must NOT read as a delay (no late, no fallback/drop tied
  // to latency, no alert). The scheduler clamps via effectiveLatencyMs.
  const mkInfo = (srvTs: number, receivedAtMs: number) => ({
    type: "noteOn" as const,
    srvTs,
    receivedAtMs,
  });

  it("receivedAtMs - srvTs = -162 → NOT late, sent on lookahead, latencyMs 0, no overflow", () => {
    const out = recordingOutput();
    const sched = createMidiScheduler();
    const r = sched.schedule(
      out,
      new Uint8Array([0x90, 60, 100]),
      mkInfo(1162, 1000), // raw -162 → effective 0
      5000,
    );
    expect(r.late).toBe(false);
    expect(r.outcome).toBe("sent"); // lookahead, NOT fallback
    expect(r.bufferOverflow).toBe(false);
    expect(r.latencyMs).toBe(0); // clamped, NOT -162
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(5000 + LOOKAHEAD_MS); // 5040
  });

  it("receivedAtMs - srvTs = 50 → NOT late, sent on lookahead, latencyMs 50", () => {
    const out = recordingOutput();
    const sched = createMidiScheduler();
    const r = sched.schedule(
      out,
      new Uint8Array([0x90, 60, 100]),
      mkInfo(1000, 1050), // 50 ms
      5000,
    );
    expect(r.late).toBe(false);
    expect(r.outcome).toBe("sent");
    expect(r.latencyMs).toBe(50);
    expect(out.sends[0]!.ts).toBe(5040);
  });

  it("receivedAtMs - srvTs = 250 → epoch latency 250 (telemetry); schedule-late → fallback immediate", () => {
    // Hotfix fidélité musicale — late is now SCHEDULE-late (the deferred buffer
    // could not absorb the jitter), no longer the epoch latency. Prime an anchor
    // so the single test event lands past its slot. The epoch latency (250) is
    // still reported as `latencyMs` (telemetry).
    const out = recordingOutput();
    const sched = createMidiScheduler();
    primeAnchor(sched);
    const r = sched.schedule(
      out,
      new Uint8Array([0x90, 60, 100]),
      { type: "noteOn", performerTs: 1120, srvTs: 1000, receivedAtMs: 1250 },
      5000,
    );
    expect(r.late).toBe(true);
    expect(r.outcome).toBe("fallback"); // noteOn → kept via immediate send
    expect(r.latencyMs).toBe(250); // epoch telemetry preserved
    expect(out.sends[0]!.ts).toBe(5000); // immediate, NOT deferred
  });

  it("a schedule-late controlChange IS dropped (droppable type), confirming late still fires", () => {
    const out = recordingOutput();
    const sched = createMidiScheduler();
    primeAnchor(sched);
    const r = sched.schedule(
      out,
      new Uint8Array([0xb0, 74, 91]),
      { type: "controlChange", performerTs: 1120, srvTs: 1000, receivedAtMs: 1250 },
      5000,
    );
    expect(r.late).toBe(true);
    expect(r.outcome).toBe("dropped"); // CC → drop
    expect(out.sends).toHaveLength(0);
  });
});

describe("shouldFallbackOnLate — per-type policy figée (FR-26)", () => {
  it("noteOn / noteOff / programChange → fallback (keep)", () => {
    expect(shouldFallbackOnLate("noteOn")).toBe(true);
    expect(shouldFallbackOnLate("noteOff")).toBe(true);
    expect(shouldFallbackOnLate("programChange")).toBe(true);
  });
  it("controlChange / pitchBend → drop", () => {
    expect(shouldFallbackOnLate("controlChange")).toBe(false);
    expect(shouldFallbackOnLate("pitchBend")).toBe(false);
  });
});

// --- pure decision -----------------------------------------------------------

describe("decideBackpressure — pure decision (no clock / no output)", () => {
  it("calm event, empty buffer → sent, no overflow", () => {
    const r = decideBackpressure({
      type: N("noteOn"),
      latencyMs: 50,
      late: false,
      bufferLength: 0,
    });
    expect(r.outcome).toBe("sent");
    expect(r.late).toBe(false);
    expect(r.bufferOverflow).toBe(false);
    expect(r.latencyMs).toBe(50);
  });

  it("late noteOn → fallback", () => {
    const r = decideBackpressure({
      type: N("noteOn"),
      latencyMs: 300,
      late: true,
      bufferLength: 0,
    });
    expect(r.outcome).toBe("fallback");
    expect(r.late).toBe(true);
    expect(r.bufferOverflow).toBe(false);
  });

  it("late noteOff → fallback", () => {
    expect(
      decideBackpressure({ type: N("noteOff"), latencyMs: 300, late: true, bufferLength: 0 }).outcome,
    ).toBe("fallback");
  });

  it("late programChange → fallback", () => {
    expect(
      decideBackpressure({ type: N("programChange"), latencyMs: 300, late: true, bufferLength: 0 }).outcome,
    ).toBe("fallback");
  });

  it("late controlChange → dropped", () => {
    const r = decideBackpressure({
      type: N("controlChange"),
      latencyMs: 300,
      late: true,
      bufferLength: 0,
    });
    expect(r.outcome).toBe("dropped");
    expect(r.late).toBe(true);
  });

  it("late pitchBend → dropped", () => {
    expect(
      decideBackpressure({ type: N("pitchBend"), latencyMs: 300, late: true, bufferLength: 0 }).outcome,
    ).toBe("dropped");
  });

  it("calm event at a FULL buffer (256) → sent + bufferOverflow (oldest dropped)", () => {
    const r = decideBackpressure({
      type: N("noteOn"),
      latencyMs: 50,
      late: false,
      bufferLength: BUFFER_CAP,
    });
    expect(r.outcome).toBe("sent");
    expect(r.bufferOverflow).toBe(true);
  });

  it("late noteOn at a FULL buffer → fallback + bufferOverflow (both)", () => {
    const r = decideBackpressure({
      type: N("noteOn"),
      latencyMs: 300,
      late: true,
      bufferLength: BUFFER_CAP,
    });
    expect(r.outcome).toBe("fallback");
    expect(r.bufferOverflow).toBe(true);
  });

  it("buffer overflow only triggers at >= BUFFER_CAP (255 is fine, 256 overflows)", () => {
    expect(
      decideBackpressure({ type: N("noteOn"), latencyMs: 0, late: false, bufferLength: 255 }).bufferOverflow,
    ).toBe(false);
    expect(
      decideBackpressure({ type: N("noteOn"), latencyMs: 0, late: false, bufferLength: 256 }).bufferOverflow,
    ).toBe(true);
  });
});

// --- stateful factory --------------------------------------------------------

describe("createMidiScheduler — normal reception (lookahead path)", () => {
  it("LOOKAHEAD_MS is 40 ms (AD-11)", () => {
    expect(LOOKAHEAD_MS).toBe(40);
  });

  it("calm noteOn (srvTs absent) → deferred send at anchorLocalMs (now + PLAYBACK_DELAY_MS = 6500)", () => {
    // Hotfix fidélité musicale — a calm event anchors to now + 1500 and is sent
    // at that deferred target (NOT now + 40). The first event establishes the
    // anchor; `latencyMs` is null (no srvTs).
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const data = new Uint8Array([0x90, 60, 100]);
    const r = sch.schedule(out, data, { type: "noteOn", performerTs: 1000, receivedAtMs: 1000 }, 5000);
    expect(r.outcome).toBe("sent");
    expect(r.late).toBe(false);
    expect(r.latencyMs).toBeNull();
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(6500); // 5000 + PLAYBACK_DELAY_MS (1500)
    expect(Array.from(out.sends[0]!.data)).toEqual([0x90, 60, 100]);
  });

  it("a second calm event reconstructs its slot from the ts difference (relative timing)", () => {
    // First event ts=1000 → 6500 ; second event ts=1120 → 6500 + 120 = 6620.
    const out = recordingOutput();
    const sch = createMidiScheduler();
    sch.schedule(out, new Uint8Array([0x90, 60, 100]), { type: "noteOn", performerTs: 1000, receivedAtMs: 1000 }, 5000);
    const r = sch.schedule(out, new Uint8Array([0x90, 62, 100]), { type: "noteOn", performerTs: 1120, receivedAtMs: 1050 }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends[1]!.ts).toBe(6620); // anchorLocalMs(6500) + (1120 - 1000)
  });

  it("calm noteOn with a calm srvTs (latency 50 ≤ 200) → deferred sent (NOT fallback)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 1000,
      srvTs: 1000,
      receivedAtMs: 1050,
    }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(6500); // deferred, not immediate
  });

  it("a non-finite performerTs (undefined / NaN) → imminent fallback send at now + LOOKAHEAD_MS", () => {
    // The schema's z.number() accepts NaN; an undefined/NaN performerTs must NOT
    // poison the anchor → safe imminent send at now + 40 (the fallback target).
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), { type: "noteOn", performerTs: NaN, receivedAtMs: 1000 }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(5040); // imminent fallback (now + LOOKAHEAD)
  });
});

describe("createMidiScheduler — late fallback (noteOn / noteOff / programChange)", () => {
  it("schedule-late noteOn → fallback IMMEDIATE send(data, now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch);
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 1120,
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("fallback");
    expect(r.late).toBe(true);
    expect(r.latencyMs).toBe(300); // epoch telemetry preserved
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(5000); // immediate (now), NOT deferred
  });

  it("schedule-late noteOff → fallback IMMEDIATE send(data, now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch);
    const r = sch.schedule(out, new Uint8Array([0x80, 60, 0]), {
      type: "noteOff",
      performerTs: 1120,
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("fallback");
    expect(out.sends[0]!.ts).toBe(5000);
  });

  it("schedule-late programChange → fallback IMMEDIATE send(data, now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch);
    const r = sch.schedule(out, new Uint8Array([0xc0, 42]), {
      type: "programChange",
      performerTs: 1120,
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("fallback");
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(5000);
  });

  it("fallbackCount flag: schedule-late noteOn/noteOff/programChange → outcome === 'fallback'", () => {
    const sch = createMidiScheduler();
    const out = recordingOutput();
    for (const type of ["noteOn", "noteOff", "programChange"] as const) {
      primeAnchor(sch);
      const r = sch.schedule(out, new Uint8Array([0x00]), { type, performerTs: 1120, srvTs: 1000, receivedAtMs: 1300 }, 5000);
      expect(r.outcome).toBe("fallback");
    }
  });
});

describe("createMidiScheduler — late drop (controlChange / pitchBend)", () => {
  it("schedule-late controlChange → DROP (no send)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch);
    const r = sch.schedule(out, new Uint8Array([0xb0, 74, 91]), {
      type: "controlChange",
      performerTs: 1120,
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("dropped");
    expect(r.late).toBe(true);
    expect(out.sends).toHaveLength(0); // dropped → no send
  });

  it("schedule-late pitchBend → DROP (no send)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch);
    const r = sch.schedule(out, new Uint8Array([0xe0, 0, 64]), {
      type: "pitchBend",
      performerTs: 1120,
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("dropped");
    expect(out.sends).toHaveLength(0);
  });

  it("drop flag: schedule-late controlChange/pitchBend → outcome === 'dropped'", () => {
    const sch = createMidiScheduler();
    const out = recordingOutput();
    for (const type of ["controlChange", "pitchBend"] as const) {
      primeAnchor(sch);
      const r = sch.schedule(out, new Uint8Array([0x00]), { type, performerTs: 1120, srvTs: 1000, receivedAtMs: 1300 }, 5000);
      expect(r.outcome).toBe("dropped");
    }
  });

  it("calm controlChange (deferred, on slot) → sent (only SCHEDULE-LATE CC is dropped)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0xb0, 74, 91]), {
      type: "controlChange",
      performerTs: 1000,
      srvTs: 1000,
      receivedAtMs: 1050,
    }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends).toHaveLength(1);
  });
});

// --- boundaries --------------------------------------------------------------

describe("createMidiScheduler — schedule-late boundary (target vs now + LOOKAHEAD_MS)", () => {
  // Hotfix fidélité musicale — the late boundary is now SCHEDULE-late:
  // `targetLocalMs < now + LOOKAHEAD_MS` (strict). target === now + LOOKAHEAD_MS
  // is NOT late (deferred sent); target === now + LOOKAHEAD_MS - 1 IS late.
  // Prime an anchor { 1000, 2500 }; at now 5000 the boundary is 5040.
  it("target === now + LOOKAHEAD_MS → NOT late → deferred sent (5040)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch); // anchor { 1000, 2500 }
    // target = 2500 + (3540 - 1000) = 2500 + 2540 = 5040 === now(5000) + 40.
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 3540,
      srvTs: 1000,
      receivedAtMs: 1200,
    }, 5000);
    expect(r.late).toBe(false);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(5040); // deferred at the boundary
  });

  it("target === now + LOOKAHEAD_MS - 1 → late → fallback send (now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch);
    // target = 2500 + (3539 - 1000) = 5039 < 5040 → late.
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 3539,
      srvTs: 1000,
      receivedAtMs: 1201,
    }, 5000);
    expect(r.late).toBe(true);
    expect(r.outcome).toBe("fallback");
    expect(out.sends[0]!.ts).toBe(5000); // immediate
  });

  it("schedule-late CC → dropped; on-slot CC → sent", () => {
    const sch = createMidiScheduler();
    primeAnchor(sch);
    const out1 = recordingOutput();
    const r1 = sch.schedule(out1, new Uint8Array([0xb0, 1, 2]), {
      type: "controlChange",
      performerTs: 3539, // target 5039 < 5040 → late
      srvTs: 1000,
      receivedAtMs: 1201,
    }, 5000);
    expect(r1.outcome).toBe("dropped");
    // A fresh scheduler: a single CC with null anchor → target now + 1500 → sent.
    const sch2 = createMidiScheduler();
    const out2 = recordingOutput();
    const r2 = sch2.schedule(out2, new Uint8Array([0xb0, 1, 2]), {
      type: "controlChange",
      performerTs: 1000,
      srvTs: 1000,
      receivedAtMs: 1200,
    }, 5000);
    expect(r2.outcome).toBe("sent");
  });
});

// --- buffer cap (FR-25) -----------------------------------------------------

describe("createMidiScheduler — bounded buffer 256 + drop oldest (FR-25)", () => {
  it("BUFFER_CAP is 256 (AD-11)", () => {
    expect(BUFFER_CAP).toBe(256);
  });

  it("after 256 calm events the buffer length is 256 (cap reached)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    for (let i = 0; i < 256; i += 1) {
      sch.schedule(out, new Uint8Array([0x90, 60, 100]), { type: "noteOn", receivedAtMs: 0 }, 0);
    }
    expect(sch.getBufferLength()).toBe(256);
    expect(out.sends).toHaveLength(256); // all sent (calm)
  });

  it("the 257th event → drop oldest (bufferOverflow === true) + still sent", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    for (let i = 0; i < 256; i += 1) {
      sch.schedule(out, new Uint8Array([0x90, 60, 100]), { type: "noteOn", receivedAtMs: 0 }, 0);
    }
    const r257 = sch.schedule(out, new Uint8Array([0x90, 61, 100]), { type: "noteOn", receivedAtMs: 0 }, 0);
    expect(r257.bufferOverflow).toBe(true);
    expect(r257.outcome).toBe("sent"); // the new event is still sent (room made)
    expect(sch.getBufferLength()).toBe(256); // bounded — did NOT grow to 257
    expect(out.sends).toHaveLength(257); // 256 + the 257th
  });

  it("the buffer is BOUNDED — feeding 1000 events never exceeds 256 (no infinite queue)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    let overflowCount = 0;
    for (let i = 0; i < 1000; i += 1) {
      const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), { type: "noteOn", receivedAtMs: 0 }, 0);
      if (r.bufferOverflow) overflowCount += 1;
      expect(sch.getBufferLength()).toBeLessThanOrEqual(BUFFER_CAP);
    }
    expect(sch.getBufferLength()).toBe(256); // capped
    // 1000 events → 256 fit, 744 overflow (drop oldest).
    expect(overflowCount).toBe(1000 - 256);
    expect(out.sends).toHaveLength(1000); // all calm → all sent
  });

  it("dropped events do NOT enter the buffer (schedule-late CC keeps the buffer free)", () => {
    // Hotfix fidélité musicale — 300 schedule-late CC are all dropped. A primed
    // anchor occupies 1 buffer slot; the 300 dropped CC must NOT grow it. The
    // test output captures 0 sends (all dropped).
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch); // 1 buffer slot, anchor { 1000, 2500 }
    expect(sch.getBufferLength()).toBe(1);
    for (let i = 0; i < 300; i += 1) {
      sch.schedule(out, new Uint8Array([0xb0, 1, 2]), {
        type: "controlChange",
        performerTs: 1120, // target 2620 < now(5000)+40 → schedule-late → dropped
        srvTs: 1000,
        receivedAtMs: 1300,
      }, 5000);
    }
    expect(sch.getBufferLength()).toBe(1); // dropped events never enter the buffer
    expect(out.sends).toHaveLength(0); // all dropped
  });

  it("reset() clears the buffer (leave / test isolation)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    for (let i = 0; i < 100; i += 1) {
      sch.schedule(out, new Uint8Array([0x90, 60, 100]), { type: "noteOn", receivedAtMs: 0 }, 0);
    }
    expect(sch.getBufferLength()).toBe(100);
    sch.reset();
    expect(sch.getBufferLength()).toBe(0);
  });
});

// --- MockOutput agnosticism --------------------------------------------------

describe("createMidiScheduler — Mock vs real output agnostic (MidiSendable)", () => {
  it("works with a minimal MidiSendable object (no DOM MIDIOutput needed)", () => {
    const sends: Uint8Array[] = [];
    const minimal: MidiSendable = {
      send: (data: Uint8Array) => sends.push(new Uint8Array(data)),
    };
    const sch: MidiScheduler = createMidiScheduler();
    sch.schedule(minimal, new Uint8Array([0x90, 60, 100]), { type: "noteOn", receivedAtMs: 0 }, 0);
    expect(sends).toHaveLength(1);
  });
});

// --- Story 6.8 hotfix — cross-client clock domains (NFR-2 / NFR-19) ------------
//
// Hotfix fidélité musicale — the performer `event.ts` (a `performance.now()`
// from the PERFORMER's time origin) is now used, but ONLY as RELATIVE musical
// time: the scheduler anchors the first event locally and reconstructs each
// slot from `event.ts` DIFFERENCES. It is NEVER compared ABSOLUTELY to the
// listener's `now` / the epoch `srvTs` / `receivedAtMs` (cross-client
// `performance.now()` origins are not comparable — the Story 6.8 principle).
// The epoch pair (`receivedAtMs` - `srvTs`) stays a SANE telemetry latency
// (never ~1.78e12 garbage); the local `now` drives the deferred send target.

describe("createMidiScheduler — cross-client clocks are NEVER compared ABSOLUTELY (Story 6.8 hotfix)", () => {
  it("epoch latency is the sane pair receivedAtMs - srvTs (ms), NOT ~1.78e12 garbage", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    // Realistic epoch ms (2026 ≈ 1.78e12). Server relayed 50 ms ago. The
    // performer ts is a tiny relative value; it does NOT inflate latency.
    const srvTs = 1_783_000_000_000;
    const receivedAtMs = 1_783_000_000_050;
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 1000,
      srvTs,
      receivedAtMs,
    }, 5000);
    expect(r.latencyMs).toBe(50); // sane — NOT 1.78e12
    expect(r.late).toBe(false); // on slot → calm → deferred sent
    expect(r.outcome).toBe("sent");
  });

  it("schedule-late drives fallback at the LOCAL `now`; epoch latency stays sane telemetry", () => {
    // The local `now` (5000) is tiny while the epoch latency is 300 (telemetry).
    // Late is SCHEDULE-late (primed anchor → target 2620 < 5040), NOT derived
    // from the epoch pair. The fallback fires at the LOCAL `now` (5000).
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch); // anchor { 1000, 2500 }
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 1120, // target 2620 < now(5000)+40 → schedule-late
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_300, // epoch latency 300 (telemetry)
    }, 5000);
    expect(r.latencyMs).toBe(300); // epoch telemetry preserved, NOT 1.78e12
    expect(r.late).toBe(true); // schedule-late, not epoch-late
    expect(r.outcome).toBe("fallback");
    expect(out.sends[0]!.ts).toBe(5000); // immediate fallback at the LOCAL `now`
  });

  it("the deferred send target uses the LOCAL `now` + PLAYBACK_DELAY_MS — epoch clocks do NOT leak into sendAt", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    // Epoch pair is ~1.78e12 (calm 50); local `now` is 5000. The send target
    // MUST be 5000 + 1500 = 6500 (local clock + delay), NOT 1.78e12 + 1500.
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 1000,
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_050,
    }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(6500); // local now + PLAYBACK_DELAY_MS
  });

  it("a wild performer ts is used ONLY relatively — it cannot inflate the epoch latency", () => {
    // A performer `event.ts` near 0 (page just loaded) anchors locally; the
    // epoch latency is still the sane 50 ms pair. The ts does NOT leak into
    // `latencyMs` (it would have produced ~1.78e12 garbage pre-hotfix).
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      performerTs: 5, // wild performer performance.now() (page just loaded)
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_050,
    }, 5000);
    expect(r.latencyMs).toBe(50); // the wild ts did NOT inflate latency
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(6500); // anchored locally: now + delay
  });

  it("ScheduleInfo has NO `ts` field — `performerTs` is the relative field; a stray `ts` is rejected", () => {
    // Compile-time + runtime guarantee: the relative field is `performerTs`
    // (NOT `ts`). Passing a performer `ts` is a type error — `ts` is not a
    // ScheduleInfo field, so it cannot be mis-compared to anything.
    const info = {
      type: "noteOn" as const,
      performerTs: 1000,
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_300,
    };
    // @ts-expect-error — `ts` is NOT a ScheduleInfo field (use `performerTs`).
    info.ts = 42;
    const out = recordingOutput();
    const r = createMidiScheduler().schedule(out, new Uint8Array([0x90, 60, 100]), info, 5000);
    expect(r.latencyMs).toBe(300); // the stray `ts` had no effect on latency
  });
});

// --- import-check on the source (FR-27 / LOCAL PUR) -------------------------

describe("scheduler.ts — LOCAL PUR import-check (no socket / no emit / no overload event)", () => {
  const source = readFileSync(
    join(import.meta.dirname!, "../features/listener/lib/scheduler.ts"),
    "utf8",
  );
  // Forbidden server-overload event name, built from parts (repo-wide grep → 0).
  const OVERLOAD_EVENT = ["listener", "overload"].join(":");
  it("does NOT import socket.io-client", () => {
    expect(source).not.toContain("socket.io-client");
  });
  it("does NOT import the connection layer", () => {
    expect(source).not.toContain("/api/connection");
    expect(source).not.toContain('from "./connection');
  });
  it("does NOT emit a server overload event (FR-27 / AC-U11)", () => {
    expect(source).not.toContain(OVERLOAD_EVENT);
  });
  it("does NOT call socket.emit / .emit(", () => {
    expect(source).not.toContain(".emit(");
    expect(source).not.toContain("socket.emit");
  });
  it("imports the tunable constants from config/runtime (consumed here, not recreated)", () => {
    expect(source).toContain('from "../../../config/runtime"');
    expect(source).toContain("LOOKAHEAD_MS");
    expect(source).toContain("MAX_LATE_MS");
    expect(source).toContain("BUFFER_CAP");
    // Does NOT redeclare the constants (consumes the scaffolding).
    expect(source).not.toMatch(/export const LOOKAHEAD_MS\s*=/);
    expect(source).not.toMatch(/export const MAX_LATE_MS\s*=/);
    expect(source).not.toMatch(/export const BUFFER_CAP\s*=/);
  });
});