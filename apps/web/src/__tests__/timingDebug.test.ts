// Hotfix audit — unit tests for `lib/timing-debug.ts` (pure, node env, no DOM).
//
// Proves the opt-in timing debug instrumentation:
//   - `?debugTiming=1` flag (via `__setTimingDebugEnabledForTest`) — OFF by default;
//   - the loggers are STRICT no-ops when disabled (buffer stays empty, no throw);
//   - performer capture deltas (`performerDelta`/`nowDelta` since the previous
//     noteOn) measure `event.timeStamp` regularity;
//   - listener mirror anchor establishes on the first event, then `relativeMs`
//     and `anchorPerformerTs`/`anchorLocalMs` track the scheduler's anchor;
//   - the mirror AUTO-RESYNCS on divergence > 1 ms (scheduler re-anchor / lifecycle
//     reset), flagging `anchorReset=true` + `mirrorConsistent=false`;
//   - `sentTimestamp` = the value passed to `output.send` (sent→targetLocalMs,
//     fallback→now, dropped/stopped→null);
//   - ring buffer is BOUNDED at 4096 (FIFO);
//   - CSV export has the exact header + columns, kind `in` rows leave listener
//     columns empty (single-schema CSV aligned by `seq`);
//   - the trace contains NO secret (only seq/type/channel/note/velocity/timestamps).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isTimingDebugEnabled,
  __setTimingDebugEnabledForTest,
  logPerformerCapture,
  logListenerSchedule,
  flushTimingTrace,
  exportTimingCsv,
  resetTimingTrace,
  type TimingRow,
} from "../lib/timing-debug";

const CSV_HEADER =
  "seq,type,channel,note,velocity,performerTs,performerDelta,receivedAt,anchorPerformerTs,anchorLocalMs,relativeMs,targetLocalMs,targetDelta,sentTimestamp,outcome,scheduleLateMs,anchorReset";

function rows(): TimingRow[] {
  return flushTimingTrace();
}

beforeEach(() => {
  resetTimingTrace();
  __setTimingDebugEnabledForTest(true);
  // `flushTimingTrace` calls `console.table`; suppress in test output.
  vi.spyOn(console, "table").mockImplementation(() => undefined);
});

afterEach(() => {
  __setTimingDebugEnabledForTest(false);
  vi.restoreAllMocks();
});

describe("timing-debug — opt-in flag + no-op when disabled", () => {
  it("is disabled by default in node (no `window.location.search`)", () => {
    __setTimingDebugEnabledForTest(false);
    expect(isTimingDebugEnabled()).toBe(false);
  });

  it("the loggers are STRICT no-ops when disabled (buffer stays empty, no throw)", () => {
    __setTimingDebugEnabledForTest(false);
    expect(() =>
      logPerformerCapture({
        seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100,
        performerTs: 1000, now: 5000,
      }),
    ).not.toThrow();
    expect(() =>
      logListenerSchedule({
        seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100,
        performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000,
        outcome: "sent", scheduleLateMs: 0,
      }),
    ).not.toThrow();
    expect(rows()).toHaveLength(0);
  });
});

describe("timing-debug — performer capture deltas (event.timeStamp regularity)", () => {
  it("the first noteOn has null deltas; subsequent noteOns compute performerDelta + nowDelta", () => {
    logPerformerCapture({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, now: 5000 });
    // A controlChange between noteOns must NOT update the noteOn deltas.
    logPerformerCapture({ seq: 2, type: "controlChange", channel: 0, note: undefined, velocity: undefined, performerTs: 1010, now: 5010 });
    logPerformerCapture({ seq: 3, type: "noteOn", channel: 0, note: 62, velocity: 100, performerTs: 1250, now: 5050 });
    logPerformerCapture({ seq: 4, type: "noteOn", channel: 0, note: 64, velocity: 100, performerTs: 1500, now: 5100 });
    const r = rows();
    expect(r[0]!.performerDelta).toBeNull();
    expect(r[0]!.nowDelta).toBeNull();
    // CC row: not a noteOn → no delta.
    expect(r[1]!.performerDelta).toBeNull();
    // 2nd noteOn: Δts = 250, Δnow = 50.
    expect(r[2]!.performerDelta).toBe(250);
    expect(r[2]!.nowDelta).toBe(50);
    // 3rd noteOn: Δts = 250, Δnow = 50 (regular arpeggio → constant deltas).
    expect(r[3]!.performerDelta).toBe(250);
    expect(r[3]!.nowDelta).toBe(50);
  });

  it("clusters event.timeStamp batches as Δts ≈ 0 (the suspected failure mode)", () => {
    // 4 sixteenths received in ONE OS callback → near-identical `event.timeStamp`.
    logPerformerCapture({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, now: 5000 });
    logPerformerCapture({ seq: 2, type: "noteOn", channel: 0, note: 62, velocity: 100, performerTs: 1000, now: 5000 });
    logPerformerCapture({ seq: 3, type: "noteOn", channel: 0, note: 64, velocity: 100, performerTs: 1001, now: 5001 });
    logPerformerCapture({ seq: 4, type: "noteOn", channel: 0, note: 65, velocity: 100, performerTs: 1002, now: 5002 });
    const r = rows();
    // Δts clusters at 0/1 → if the scheduler reconstructs from these, the targets
    // collapse (proven in listenerArpeggio.test). This row documents the input.
    expect(r[1]!.performerDelta).toBe(0);
    expect(r[2]!.performerDelta).toBe(1);
    expect(r[3]!.performerDelta).toBe(1);
  });
});

describe("timing-debug — listener mirror anchor + relativeMs", () => {
  it("establishes the mirror on the first event (no reset flag) + relativeMs=0", () => {
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    const r = rows()[0]!;
    expect(r.anchorPerformerTs).toBe(1000);
    expect(r.anchorLocalMs).toBe(2500);
    expect(r.relativeMs).toBe(0);
    expect(r.anchorReset).toBe(false);
    expect(r.mirrorConsistent).toBe(true);
    expect(r.targetDelta).toBeNull(); // first noteOn
  });

  it("tracks relativeMs + targetDelta in steady state (no reset)", () => {
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    logListenerSchedule({ seq: 2, type: "noteOn", channel: 0, note: 62, velocity: 100, performerTs: 1250, receivedAt: 2010, targetLocalMs: 2750, now: 1010, outcome: "sent", scheduleLateMs: 0 });
    const r = rows()[1]!;
    expect(r.anchorPerformerTs).toBe(1000); // unchanged
    expect(r.anchorLocalMs).toBe(2500);
    expect(r.relativeMs).toBe(250); // 2750 - 2500
    expect(r.targetDelta).toBe(250); // 2750 - 2500 (prev noteOn target)
    expect(r.anchorReset).toBe(false);
    expect(r.mirrorConsistent).toBe(true);
  });

  it("AUTO-RESYNCS on divergence > 1 ms (scheduler re-anchor) → anchorReset=true, mirrorConsistent=false", () => {
    // 1st event: anchor {1000, 2500}.
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    // 2nd event steady.
    logListenerSchedule({ seq: 2, type: "noteOn", channel: 0, note: 62, velocity: 100, performerTs: 1120, receivedAt: 2010, targetLocalMs: 2620, now: 1010, outcome: "sent", scheduleLateMs: 0 });
    // 3rd event: scheduler re-anchored (e.g. after a channel change) at now=9000.
    // Mirror projects from old anchor {1000,2500}: 2500 + max(0, 100-1000)=2500.
    // True target = 9000 + 1500 = 10500 → |10500-2500| = 8000 > 1 → diverged.
    logListenerSchedule({ seq: 3, type: "noteOn", channel: 0, note: 64, velocity: 100, performerTs: 100, receivedAt: 9500, targetLocalMs: 10500, now: 9000, outcome: "sent", scheduleLateMs: 0 });
    const r = rows()[2]!;
    expect(r.anchorReset).toBe(true);
    expect(r.mirrorConsistent).toBe(false);
    // Mirror re-established to the new anchor.
    expect(r.anchorPerformerTs).toBe(100);
    expect(r.anchorLocalMs).toBe(10500);
    expect(r.relativeMs).toBe(0);
  });

  it("a backwards performerTs stays on the anchor (clamp), no false reset", () => {
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    // performerTs goes backwards → scheduler clamps relativeMs to 0 → targetLocalMs = anchorLocalMs = 2500.
    // Mirror projects 2500 + max(0, 500-1000) = 2500 → matches → NO reset.
    logListenerSchedule({ seq: 2, type: "noteOn", channel: 0, note: 62, velocity: 100, performerTs: 500, receivedAt: 2010, targetLocalMs: 2500, now: 1010, outcome: "sent", scheduleLateMs: 0 });
    const r = rows()[1]!;
    expect(r.anchorReset).toBe(false);
    expect(r.mirrorConsistent).toBe(true);
    expect(r.relativeMs).toBe(0);
  });
});

describe("timing-debug — sentTimestamp (the value passed to output.send)", () => {
  it("sent → targetLocalMs, fallback → now, dropped → null, stopped → null", () => {
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    logListenerSchedule({ seq: 2, type: "noteOn", channel: 0, note: 62, velocity: 100, performerTs: 1120, receivedAt: 7000, targetLocalMs: 6620, now: 7000, outcome: "fallback", scheduleLateMs: 380 });
    logListenerSchedule({ seq: 3, type: "controlChange", channel: 0, note: undefined, velocity: undefined, performerTs: 1120, receivedAt: 7000, targetLocalMs: 6620, now: 7000, outcome: "dropped", scheduleLateMs: 380 });
    logListenerSchedule({ seq: 4, type: "noteOn", channel: 0, note: 64, velocity: 100, performerTs: 1200, receivedAt: 9500, targetLocalMs: 9000, now: 9000, outcome: "stopped", scheduleLateMs: 0 });
    const r = rows();
    expect(r[0]!.sentTimestamp).toBe(2500); // sent → targetLocalMs
    expect(r[1]!.sentTimestamp).toBe(7000); // fallback → now
    expect(r[2]!.sentTimestamp).toBeNull(); // dropped → no send
    expect(r[3]!.sentTimestamp).toBeNull(); // stopped → no send
  });
});

describe("timing-debug — ring buffer is bounded at 4096 (FIFO)", () => {
  it("pushing beyond the cap evicts the oldest (length stays at 4096)", () => {
    for (let i = 0; i < 4100; i += 1) {
      logListenerSchedule({
        seq: i, type: "noteOn", channel: 0, note: 60, velocity: 100,
        performerTs: 1000 + i, receivedAt: 2000, targetLocalMs: 2500 + i, now: 1000,
        outcome: "sent", scheduleLateMs: 0,
      });
    }
    const r = rows();
    expect(r).toHaveLength(4096);
    // First 4 evicted (FIFO); oldest surviving is seq 4.
    expect(r[0]!.seq).toBe(4);
    expect(r[r.length - 1]!.seq).toBe(4099);
  });
});

describe("timing-debug — CSV export (single schema, in rows leave listener cols empty)", () => {
  it("exports the exact header + rows; kind `in` rows have empty listener columns", () => {
    logPerformerCapture({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, now: 5000 });
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    const csv = exportTimingCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toBe(CSV_HEADER);
    // IN row: 17 columns, listener columns (8..16) empty.
    const inCols = lines[1]!.split(",");
    expect(inCols).toHaveLength(17);
    expect(inCols[0]).toBe("1"); // seq
    expect(inCols[5]).toBe("1000"); // performerTs
    expect(inCols[7]).toBe(""); // receivedAt empty (in row)
    expect(inCols[11]).toBe(""); // targetLocalMs empty (in row)
    expect(inCols[14]).toBe(""); // outcome empty (in row)
    // OUT row: targetLocalMs + outcome filled.
    const outCols = lines[2]!.split(",");
    expect(outCols[11]).toBe("2500"); // targetLocalMs
    expect(outCols[14]).toBe("sent"); // outcome
    expect(outCols[13]).toBe("2500"); // sentTimestamp (sent → targetLocalMs)
  });
});

describe("timing-debug — NO secret in the trace", () => {
  it("the CSV never contains OWNER_SECRET / token / performerId beyond the wire seq", () => {
    logPerformerCapture({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, now: 5000 });
    logListenerSchedule({ seq: 1, type: "noteOn", channel: 0, note: 60, velocity: 100, performerTs: 1000, receivedAt: 2000, targetLocalMs: 2500, now: 1000, outcome: "sent", scheduleLateMs: 0 });
    const csv = exportTimingCsv();
    expect(csv).not.toMatch(/OWNER_SECRET|secret|token|password|apiKey|performerId/i);
    // Only MIDI + timing fields appear.
    expect(csv).toMatch(/^seq,type,channel,note,velocity,performerTs,/);
  });
});