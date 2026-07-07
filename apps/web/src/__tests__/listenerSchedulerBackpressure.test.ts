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

  it("calm noteOn (srvTs absent) → send(data, now + LOOKAHEAD_MS)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const data = new Uint8Array([0x90, 60, 100]);
    const r = sch.schedule(out, data, { type: "noteOn", receivedAtMs: 1000 }, 5000);
    expect(r.outcome).toBe("sent");
    expect(r.late).toBe(false);
    expect(r.latencyMs).toBeNull();
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(5040); // 5000 + 40
    expect(Array.from(out.sends[0]!.data)).toEqual([0x90, 60, 100]);
  });

  it("calm noteOn with a calm srvTs (latency 50 ≤ 200) → lookahead (NOT fallback)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs: 1000,
      receivedAtMs: 1050,
    }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(5040); // lookahead, not immediate
  });
});

describe("createMidiScheduler — late fallback (noteOn / noteOff / programChange)", () => {
  it("late noteOn (receivedAtMs - srvTs = 300 > 200) → fallback IMMEDIATE send(data, now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("fallback");
    expect(r.late).toBe(true);
    expect(r.latencyMs).toBe(300);
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(5000); // immediate (now), NOT now + 40
  });

  it("late noteOff → fallback IMMEDIATE send(data, now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x80, 60, 0]), {
      type: "noteOff",
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("fallback");
    expect(out.sends[0]!.ts).toBe(5000);
  });

  it("late programChange → fallback IMMEDIATE send(data, now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0xc0, 42]), {
      type: "programChange",
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("fallback");
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.ts).toBe(5000);
  });

  it("fallbackCount flag: late noteOn/noteOff/programChange → outcome === 'fallback'", () => {
    const sch = createMidiScheduler();
    const out = recordingOutput();
    for (const type of ["noteOn", "noteOff", "programChange"] as const) {
      const r = sch.schedule(out, new Uint8Array([0x00]), { type, srvTs: 1000, receivedAtMs: 1300 }, 0);
      expect(r.outcome).toBe("fallback");
    }
  });
});

describe("createMidiScheduler — late drop (controlChange / pitchBend)", () => {
  it("late controlChange → DROP (no send)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0xb0, 74, 91]), {
      type: "controlChange",
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("dropped");
    expect(r.late).toBe(true);
    expect(out.sends).toHaveLength(0); // dropped → no send
  });

  it("late pitchBend → DROP (no send)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0xe0, 0, 64]), {
      type: "pitchBend",
      srvTs: 1000,
      receivedAtMs: 1300,
    }, 5000);
    expect(r.outcome).toBe("dropped");
    expect(out.sends).toHaveLength(0);
  });

  it("drop flag: late controlChange/pitchBend → outcome === 'dropped'", () => {
    const sch = createMidiScheduler();
    const out = recordingOutput();
    for (const type of ["controlChange", "pitchBend"] as const) {
      const r = sch.schedule(out, new Uint8Array([0x00]), { type, srvTs: 1000, receivedAtMs: 1300 }, 0);
      expect(r.outcome).toBe("dropped");
    }
  });

  it("calm controlChange (latency 50) → sent (only LATE CC is dropped)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0xb0, 74, 91]), {
      type: "controlChange",
      srvTs: 1000,
      receivedAtMs: 1050,
    }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends).toHaveLength(1);
  });
});

// --- boundaries --------------------------------------------------------------

describe("createMidiScheduler — MAX_LATE_MS boundary (200 exact vs 201)", () => {
  it("latency 200 ms exact → NOT late → lookahead send (now + 40)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs: 1000,
      receivedAtMs: 1200, // latency 200 (=== MAX_LATE_MS) → not late
    }, 5000);
    expect(r.late).toBe(false);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(5040); // lookahead
  });

  it("latency 201 ms → late → fallback send (now)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs: 1000,
      receivedAtMs: 1201, // latency 201 (> MAX_LATE_MS) → late
    }, 5000);
    expect(r.late).toBe(true);
    expect(r.outcome).toBe("fallback");
    expect(out.sends[0]!.ts).toBe(5000); // immediate
  });

  it("late CC at 201 ms → dropped; calm CC at 200 ms → sent", () => {
    const sch = createMidiScheduler();
    const out1 = recordingOutput();
    const r1 = sch.schedule(out1, new Uint8Array([0xb0, 1, 2]), {
      type: "controlChange",
      srvTs: 1000,
      receivedAtMs: 1201,
    }, 0);
    expect(r1.outcome).toBe("dropped");
    const out2 = recordingOutput();
    const r2 = sch.schedule(out2, new Uint8Array([0xb0, 1, 2]), {
      type: "controlChange",
      srvTs: 1000,
      receivedAtMs: 1200,
    }, 0);
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

  it("dropped events do NOT enter the buffer (late CC keeps the buffer free)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    for (let i = 0; i < 300; i += 1) {
      sch.schedule(out, new Uint8Array([0xb0, 1, 2]), {
        type: "controlChange",
        srvTs: 1000,
        receivedAtMs: 1300, // late → dropped
      }, 0);
    }
    expect(sch.getBufferLength()).toBe(0); // dropped events never enter
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
// Proves the prod bug is fixed: the listener NEVER compares a performer
// `performance.now()` with the listener/server clocks. Latency uses ONLY the
// comparable epoch pair (`receivedAtMs` - `srvTs`, both `Date.now()`); scheduling
// uses ONLY the local `performance.now()`. A wild performer `event.ts` is not
// even an argument to the scheduler, so it cannot inflate latency.

describe("createMidiScheduler — cross-client clocks are NEVER compared (Story 6.8 hotfix)", () => {
  it("latency is the epoch pair receivedAtMs - srvTs (sane ms), NOT ~1.78e12 garbage", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    // Realistic epoch ms (2026 ≈ 1.78e12). Server relayed 50 ms ago.
    const srvTs = 1_783_000_000_000;
    const receivedAtMs = 1_783_000_000_050;
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs,
      receivedAtMs,
    }, 5000);
    expect(r.latencyMs).toBe(50); // sane — NOT 1.78e12
    expect(r.late).toBe(false); // 50 ≤ 200 → calm → lookahead
    expect(r.outcome).toBe("sent");
  });

  it("a huge epoch latency (> 200) is late via the EPOCH pair, regardless of the local performance.now() `now`", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    // The local scheduling clock `now` (performance.now.) is tiny (5000) while
    // the epoch latency is 300 (late). Proves latency is NOT derived from `now`.
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_300, // epoch latency 300 > 200 → late
    }, 5000);
    expect(r.latencyMs).toBe(300);
    expect(r.late).toBe(true);
    expect(r.outcome).toBe("fallback");
    expect(out.sends[0]!.ts).toBe(5000); // immediate fallback at the LOCAL `now`
  });

  it("the scheduling target uses ONLY local performance.now() — epoch clocks do NOT leak into sendAt", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    // Epoch pair is ~1.78e12 (calm 50); local `now` is 5000. The send target
    // MUST be 5000 + 40 = 5040 (local clock), NOT 1.78e12 + 40.
    const r = sch.schedule(out, new Uint8Array([0x90, 60, 100]), {
      type: "noteOn",
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_050,
    }, 5000);
    expect(r.outcome).toBe("sent");
    expect(out.sends[0]!.ts).toBe(5040); // local performance.now() + LOOKAHEAD
  });

  it("ScheduleInfo has NO `ts` field — the performer performance.now() cannot drive late/fallback", () => {
    // Compile-time + runtime guarantee: the only clocks the scheduler sees are
    // `srvTs` (epoch) + `receivedAtMs` (epoch) + the local `now`. There is no
    // `ts` parameter to mis-compare. Passing a performer `ts` is a type error.
    const info = {
      type: "noteOn" as const,
      srvTs: 1_783_000_000_000,
      receivedAtMs: 1_783_000_000_300,
    };
    // @ts-expect-error — `ts` is NOT a ScheduleInfo field (cross-client ts is rejected)
    info.ts = 42;
    const out = recordingOutput();
    const r = createMidiScheduler().schedule(out, new Uint8Array([0x90, 60, 100]), info, 0);
    expect(r.latencyMs).toBe(300); // the stray `ts` had no effect
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