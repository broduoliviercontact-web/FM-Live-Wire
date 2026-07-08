// Hotfix audit — synthetic arpeggiator tests for the deferred scheduler.
//
// Pure, node env (no DOM, no Web MIDI, no network). Uses the `recordingOutput()`
// + `primeAnchor()` pattern from `listenerSchedulerBackpressure.test.ts`.
//
// Reproduces the post-hotfix symptom (arpège régulier à la double-croche pas
// sync côté listener) at the MIDI layer — never audio:
//
//   - `arpeggiator-regular` : 8 sixteenths at a constant interval, real-time
//     `now` advance (≤ 1500 ms → never late). Asserts the reconstruction is
//     FAITHFUL: `targetLocalMs` gaps == ΔperformerTs exactly, outcome `sent`
//     everywhere, 0 fallback / 0 drop / scheduleLateMs 0, and the Mock (call
//     order) preserves noteOff before the next noteOn for a repeated note.
//
//   - `arpeggiator-batched-performer-ts` (SMOKING GUN) : 4 messages in one OS
//     callback with near-identical `performerTs` (1000,1000,1001,1002) — the
//     suspected IAC/Ableton driver-batch symptom. Asserts the CURRENT behavior:
//     `targetLocalMs` CLUSTERS (Δ ≈ 0–2 ms), documenting that IF `event.timeStamp`
//     is batched, the anchor-relative reconstruction collapses (notes fire
//     together → off the grid). This is the reproducible diagnostic artefact.
//
//   - `arpeggiator-same-ts-noteoff-before-noteon` : noteOff(60) + the next
//     noteOn(60) at the SAME `performerTs` → same `targetLocalMs`. Asserts the
//     Mock preserves the call order (noteOff before noteOn by index). Documents
//     that the scheduler has NO tie-break by `seq` — a real CoreMIDI/IAC port
//     could reorder identical-timestamp sends (audit point, NOT a fix here).
import { describe, it, expect } from "vitest";
import { createMidiScheduler } from "../features/listener/lib/scheduler";
import { LOOKAHEAD_MS } from "../config/runtime";
import type { MidiSendable } from "../features/listener/lib/sendable";

// --- recording output (mirrors listenerSchedulerBackpressure.test) -----------

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
 * Prime a deferred-playback anchor on a throwaway output so the test's `out`
 * captures only the events under test. Default: performerTs 1000 at now 1000
 * → anchor { 1000, 2500 }.
 */
function primeAnchor(sch: ReturnType<typeof createMidiScheduler>, performerTs = 1000, now = 1000): void {
  sch.schedule(recordingOutput(), new Uint8Array([0x90, 60, 100]), {
    type: "noteOn",
    performerTs,
    receivedAtMs: now,
  }, now);
}

const NOTE_ON = (note: number) => new Uint8Array([0x90, note, 100]);
const NOTE_OFF = (note: number) => new Uint8Array([0x80, note, 0]);

// --- regular arpeggiator (faithful reconstruction) ---------------------------

describe("arpeggiator-regular — 8 sixteenths reconstruct faithfully (no late, ordered)", () => {
  // A regular sixteenth-note arpeggio at 120 BPM = 125 ms per sixteenth. We use
  // 250 ms steps (eighth notes) for readability. The first event primes the
  // anchor; events 2..8 reconstruct from the ts difference. Real-time `now`
  // advances ≤ 1500 ms so every slot is in the future → never schedule-late.
  it("targetLocalMs gaps == ΔperformerTs (musical gaps preserved), outcome sent, 0 late", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    // Prime at now 1000 → anchor { performerTs 1000, localMs 2500 }.
    primeAnchor(sch, 1000, 1000);

    const notes = [60, 62, 64, 65, 67, 69, 71, 72];
    const step = 250; // eighth notes
    let now = 1100; // advance real time gradually (≤ 1500 ms past anchor)
    const startTs = 1000;
    const targets: number[] = [];
    for (let i = 0; i < notes.length; i += 1) {
      const performerTs = startTs + (i + 1) * step; // 1250, 1500, …
      const r = sch.schedule(out, NOTE_ON(notes[i]!), {
        type: "noteOn",
        performerTs,
        receivedAtMs: now,
      }, now);
      expect(r.outcome).toBe("sent");
      expect(r.late).toBe(false);
      expect(r.scheduleLateMs).toBe(0);
      expect(r.bufferOverflow).toBe(false);
      // target = anchor.localMs + max(0, performerTs - anchor.performerTs)
      //        = 2500 + (performerTs - 1000).
      const expectedTarget = 2500 + (performerTs - 1000);
      expect(r.targetLocalMs).toBe(expectedTarget);
      targets.push(r.targetLocalMs);
      now += 50; // gentle real-time advance (well within the 1500 ms buffer)
    }

    // Gaps between consecutive targets equal the performer ts gap (250 ms).
    for (let i = 1; i < targets.length; i += 1) {
      expect(targets[i]! - targets[i - 1]!).toBe(step);
    }
    // All sends captured, all deferred at their reconstructed slot.
    expect(out.sends).toHaveLength(notes.length);
    for (let i = 0; i < out.sends.length; i += 1) {
      expect(out.sends[i]!.ts).toBe(targets[i]);
    }
  });

  it("a repeated note keeps noteOff BEFORE the next noteOn (Mock call order)", () => {
    // Same note 60 twice; noteOff of the first arrives just before the next
    // noteOn. Distinct ts → distinct targets → distinct send timestamps; the
    // Mock records in call order, so noteOff precedes the next noteOn by index.
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch, 1000, 1000);

    const r1 = sch.schedule(out, NOTE_ON(60), { type: "noteOn", performerTs: 1250, receivedAtMs: 1100 }, 1100);
    const r2 = sch.schedule(out, NOTE_OFF(60), { type: "noteOff", performerTs: 1400, receivedAtMs: 1150 }, 1150);
    const r3 = sch.schedule(out, NOTE_ON(60), { type: "noteOn", performerTs: 1500, receivedAtMs: 1200 }, 1200);

    expect(r1.outcome).toBe("sent");
    expect(r2.outcome).toBe("sent");
    expect(r3.outcome).toBe("sent");
    expect(out.sends).toHaveLength(3);
    // Distinct ascending targets → distinct send timestamps.
    expect(out.sends[0]!.ts).toBe(2750); // 2500 + 250
    expect(out.sends[1]!.ts).toBe(2900); // 2500 + 400
    expect(out.sends[2]!.ts).toBe(3000); // 2500 + 500
    // Call order preserved: noteOn(1), noteOff(1), noteOn(2) by data.
    expect(Array.from(out.sends[0]!.data)).toEqual([0x90, 60, 100]);
    expect(Array.from(out.sends[1]!.data)).toEqual([0x80, 60, 0]);
    expect(Array.from(out.sends[2]!.data)).toEqual([0x90, 60, 100]);
  });
});

// --- batched performer ts (the smoking gun) ---------------------------------

describe("arpeggiator-batched-performer-ts — clustered event.timeStamp collapses the reconstruction", () => {
  // Simulates the suspected IAC/Ableton driver batch: 4 sixteenths arrive in
  // ONE OS callback → near-identical `event.timeStamp` (1000,1000,1001,1002).
  // The anchor-relative reconstruction maps each to ~anchor.localMs → all four
  // notes target within 0–2 ms → they fire together → off the grid. This is the
  // CURRENT behavior; the test documents the artefact the Render trace must
  // confirm (or refute) before any musical fix.
  it("four near-identical performerTs → targetLocalMs clustered within 2 ms (reproducible artefact)", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch, 1000, 1000); // anchor { 1000, 2500 }

    const tsBatch = [1000, 1000, 1001, 1002];
    const notes = [60, 62, 64, 65];
    let now = 1100;
    const targets: number[] = [];
    for (let i = 0; i < tsBatch.length; i += 1) {
      const r = sch.schedule(out, NOTE_ON(notes[i]!), {
        type: "noteOn",
        performerTs: tsBatch[i]!,
        receivedAtMs: now,
      }, now);
      expect(r.outcome).toBe("sent");
      targets.push(r.targetLocalMs);
      now += 1;
    }

    // All four targets collapse onto the anchor localMs (2500) ± 2 ms.
    expect(targets[0]).toBe(2500); // 2500 + max(0, 1000-1000)
    expect(targets[1]).toBe(2500); // identical ts → identical target
    expect(targets[2]).toBe(2501); // +1 ms
    expect(targets[3]).toBe(2502); // +2 ms
    // The whole arpeggio fires within 2 ms — NOT on the grid.
    const span = targets[targets.length - 1]! - targets[0]!;
    expect(span).toBeLessThanOrEqual(2);
    expect(out.sends).toHaveLength(4);
    // All four sends happen at the same deferred slot (clustering).
    expect(out.sends[0]!.ts).toBe(2500);
    expect(out.sends[1]!.ts).toBe(2500);
  });

  it("a regular ts batch (125, 250, 375 ms apart) does NOT cluster — controls the artefact", () => {
    // Control: the same 4 notes with regular ts gaps reconstruct with regular
    // target gaps → proves the clustering above is caused by the BATCHED ts,
    // not by the scheduler or the test harness.
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch, 1000, 1000);

    const tsRegular = [1125, 1250, 1375, 1500];
    const notes = [60, 62, 64, 65];
    const targets: number[] = [];
    for (let i = 0; i < tsRegular.length; i += 1) {
      const r = sch.schedule(out, NOTE_ON(notes[i]!), {
        type: "noteOn",
        performerTs: tsRegular[i]!,
        receivedAtMs: 1100,
      }, 1100);
      targets.push(r.targetLocalMs);
    }
    // Regular 125 ms gaps → regular 125 ms target gaps (on the grid).
    for (let i = 1; i < targets.length; i += 1) {
      expect(targets[i]! - targets[i - 1]!).toBe(125);
    }
    const span = targets[targets.length - 1]! - targets[0]!;
    expect(span).toBe(375); // NOT clustered
  });
});

// --- same-timestamp noteOff / noteOn (no seq tie-break) ----------------------

describe("arpeggiator-same-ts-noteoff-before-noteon — same targetLocalMs, Mock preserves call order", () => {
  // noteOff(60) + the next noteOn(60) at the SAME `performerTs` → same
  // `targetLocalMs`. The scheduler has NO tie-break by `seq`; order relies on
  // the call order (WebSocket ordered + synchronous `schedule()`). The Mock
  // records by call order → noteOff before noteOn. A real CoreMIDI/IAC port
  // receiving `send(data, sameTimestamp)` is NOT guaranteed to preserve order
  // — this test documents the audit point (NOT a fix in this batch).
  it("noteOff then noteOn at the same ts → same targetLocalMs; Mock keeps noteOff first by index", () => {
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch, 1000, 1000);

    const sameTs = 1250;
    const rOff = sch.schedule(out, NOTE_OFF(60), { type: "noteOff", performerTs: sameTs, receivedAtMs: 1100 }, 1100);
    const rOn = sch.schedule(out, NOTE_ON(60), { type: "noteOn", performerTs: sameTs, receivedAtMs: 1100 }, 1100);

    // Both reconstruct to the same target (2500 + 250).
    expect(rOff.targetLocalMs).toBe(2750);
    expect(rOn.targetLocalMs).toBe(2750);
    expect(rOff.outcome).toBe("sent");
    expect(rOn.outcome).toBe("sent");

    expect(out.sends).toHaveLength(2);
    // Same send timestamp (no tie-break).
    expect(out.sends[0]!.ts).toBe(2750);
    expect(out.sends[1]!.ts).toBe(2750);
    // Call order preserved by index: noteOff BEFORE noteOn.
    expect(Array.from(out.sends[0]!.data)).toEqual([0x80, 60, 0]); // noteOff first
    expect(Array.from(out.sends[1]!.data)).toEqual([0x90, 60, 100]); // noteOn second
  });

  it("two noteOns at the same ts → same targetLocalMs; order is the call order (no seq tie-break)", () => {
    // Documents that the scheduler does not use `seq` for ordering: two noteOns
    // of different notes at the same ts share a target; the Mock preserves the
    // call order. The wiring passes events in WebSocket order (which is seq
    // order from the server), so in practice the call order == seq order.
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch, 1000, 1000);

    const sameTs = 1500;
    sch.schedule(out, NOTE_ON(60), { type: "noteOn", performerTs: sameTs, receivedAtMs: 1200 }, 1200);
    sch.schedule(out, NOTE_ON(62), { type: "noteOn", performerTs: sameTs, receivedAtMs: 1200 }, 1200);

    expect(out.sends).toHaveLength(2);
    expect(out.sends[0]!.ts).toBe(3000);
    expect(out.sends[1]!.ts).toBe(3000);
    // Call order == WebSocket order == seq order (no seq-based tie-break in the scheduler).
    expect(Array.from(out.sends[0]!.data)).toEqual([0x90, 60, 100]);
    expect(Array.from(out.sends[1]!.data)).toEqual([0x90, 62, 100]);
  });
});

// --- panic / test note stay immediate (deferred playback does not delay them) -

describe("arpeggiator — deferred playback does NOT delay panic/test (immediate sends)", () => {
  it("a stopped scheduler (panic/leave) sends nothing and reports targetLocalMs == now", () => {
    // `panic()` / `stop()` short-circuit before reconstruction. The audit
    // requires panic/test to stay IMMEDIATE even with deferred playback on.
    const out = recordingOutput();
    const sch = createMidiScheduler();
    primeAnchor(sch, 1000, 1000);
    sch.stop();
    const r = sch.schedule(out, NOTE_ON(60), { type: "noteOn", performerTs: 1250, receivedAtMs: 1100 }, 1100);
    expect(r.stopped).toBe(true);
    expect(r.outcome).toBe("dropped"); // stopped path reports dropped (no send)
    expect(r.scheduleLateMs).toBe(0);
    expect(r.targetLocalMs).toBe(1100); // reflects now, not a deferred slot
    expect(out.sends).toHaveLength(0); // nothing sent when stopped
  });

  it("LOOKAHEAD_MS is still 40 (deferred playback does not change the panic target)", () => {
    expect(LOOKAHEAD_MS).toBe(40);
  });
});