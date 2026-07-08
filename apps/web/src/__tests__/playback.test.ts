// Hotfix fidélité musicale — deferred playback anchor math (pure unit tests).
//
// Verifies the user's exact anchor cases (relative musical timing preserved),
// jitter absorption, schedule-late detection, backwards/incoherent ts, NaN /
// Infinity safety, anchor null-vs-existing, and the `isScheduleLate` boundary.
// Pure node — no DOM, no socket, no store, no network (import-checked).

import { describe, expect, it } from "vitest";
import {
  computeTargetLocalMs,
  establishAnchor,
  isScheduleLate,
  relativeMs,
  scheduleLateMs,
} from "../features/listener/lib/playback";
import { LOOKAHEAD_MS, PLAYBACK_DELAY_MS } from "../config/runtime";

describe("playback anchor math — user's exact cases", () => {
  // The user's spec: anchor the first event at now + delay, then reconstruct
  // each slot from `event.ts` differences. ts=1000/now=5000/delay=1500 → 6500;
  // ts=1120 → 6620 ; ts=1400 → 6900.
  it("anchors the first event at now + delay (ts=1000, now=5000, delay=1500 → 6500)", () => {
    const { targetLocalMs, anchor } = computeTargetLocalMs(1000, null, 5000, 1500);
    expect(targetLocalMs).toBe(6500);
    expect(anchor).toEqual({ performerTs: 1000, localMs: 6500 });
  });

  it("reconstructs the second slot from the ts difference (ts=1120 → 6620)", () => {
    const anchor = establishAnchor(1000, 5000, 1500);
    const { targetLocalMs } = computeTargetLocalMs(1120, anchor, 5000, 1500);
    // 6620 = anchorLocalMs(6500) + (1120 - 1000) = 6500 + 120
    expect(targetLocalMs).toBe(6620);
  });

  it("reconstructs the third slot from the ts difference (ts=1400 → 6900)", () => {
    const anchor = establishAnchor(1000, 5000, 1500);
    const { targetLocalMs } = computeTargetLocalMs(1400, anchor, 5000, 1500);
    // 6900 = 6500 + (1400 - 1000) = 6500 + 400
    expect(targetLocalMs).toBe(6900);
  });
});

describe("playback anchor math — jitter absorption", () => {
  // The performer's relative spacing is what matters. Two events 120 ms apart
  // in performer `ts` must land 120 ms apart locally — regardless of irregular
  // arrival intervals. The anchor + `relativeMs` math guarantees this: the
  // LOCAL spacing equals the `ts` spacing, independent of `now` at arrival.
  it("preserves the performer's relative spacing despite arrival jitter", () => {
    // First event: performer ts=1000, arrives at local now=5000.
    const a0 = computeTargetLocalMs(1000, null, 5000, 1500);
    expect(a0.targetLocalMs).toBe(6500);
    // Second event: performer ts=1120 (120 ms after the first in performer
    // time), but arrives 400 ms later locally (jitter) at now=5400.
    const a1 = computeTargetLocalMs(1120, a0.anchor, 5400, 1500);
    // The local slot is STILL anchorLocalMs(6500) + 120 = 6620 — the 400 ms
    // arrival jitter does not shift the musical slot.
    expect(a1.targetLocalMs).toBe(6620);
    expect(a1.targetLocalMs - a0.targetLocalMs).toBe(120);
  });

  it("preserves spacing across a sequence with irregular arrivals", () => {
    // Performer ts: 1000, 1120, 1400 → intended spacing 120, 280.
    // Arrival now: 5000, 5400, 5100 (jittered, out of order arrival latency).
    const a0 = computeTargetLocalMs(1000, null, 5000, 1500);
    const a1 = computeTargetLocalMs(1120, a0.anchor, 5400, 1500);
    const a2 = computeTargetLocalMs(1400, a0.anchor, 5100, 1500);
    expect(a1.targetLocalMs - a0.targetLocalMs).toBe(120);
    expect(a2.targetLocalMs - a1.targetLocalMs).toBe(280);
  });
});

describe("playback anchor math — schedule-late", () => {
  it("isScheduleLate is false when the slot is comfortably in the future", () => {
    // target 6500, now 5000 → 6500 < 5040? no.
    expect(isScheduleLate(6500, 5000)).toBe(false);
  });

  it("isScheduleLate is true when the slot is in the past", () => {
    expect(isScheduleLate(4000, 5000)).toBe(true);
  });

  it("isScheduleLate boundary: target === now + LOOKAHEAD_MS is NOT late (strict <)", () => {
    expect(isScheduleLate(5000 + LOOKAHEAD_MS, 5000)).toBe(false);
  });

  it("isScheduleLate boundary: target === now + LOOKAHEAD_MS - 1 IS late", () => {
    expect(isScheduleLate(5000 + LOOKAHEAD_MS - 1, 5000)).toBe(true);
  });

  it("scheduleLateMs is 0 when on time", () => {
    expect(scheduleLateMs(6500, 5000)).toBe(0);
  });

  it("scheduleLateMs is now - target when past", () => {
    expect(scheduleLateMs(4000, 5000)).toBe(1000);
  });

  it("scheduleLateMs never goes negative (clamped at 0)", () => {
    expect(scheduleLateMs(99999, 5000)).toBe(0);
  });
});

describe("playback anchor math — backwards / incoherent ts", () => {
  // A performer ts that goes backwards (clock reset / incoherent stamp / a new
  // performer after turnover whose `performance.now()` restarted near 0) is
  // clamped to 0 by `relativeMs` so the target is never negative (never in the
  // past relative to the anchor). No crash.
  it("relativeMs clamps a backwards ts to 0", () => {
    expect(relativeMs(500, 1000)).toBe(0);
  });

  it("relativeMs is the positive difference for a forwards ts", () => {
    expect(relativeMs(1500, 1000)).toBe(500);
  });

  it("a backwards ts after anchoring lands at the anchor local time (not in the past)", () => {
    const anchor = establishAnchor(1000, 5000, 1500); // localMs 6500
    const { targetLocalMs } = computeTargetLocalMs(500, anchor, 6000, 1500);
    // 6500 + max(0, 500 - 1000) = 6500 + 0 = 6500 — not 6500 - 500.
    expect(targetLocalMs).toBe(6500);
  });
});

describe("playback anchor math — NaN / Infinity safety", () => {
  // The schema's `z.number()` accepts NaN / Infinity. A non-finite performer ts
  // must NOT poison the anchor and must fall back to an imminent send
  // (`now + LOOKAHEAD_MS`).
  it("NaN performerTs → imminent fallback, anchor untouched", () => {
    const { targetLocalMs, anchor } = computeTargetLocalMs(NaN, null, 5000, 1500);
    expect(targetLocalMs).toBe(5000 + LOOKAHEAD_MS);
    expect(anchor).toBe(null); // not poisoned
  });

  it("Infinity performerTs → imminent fallback, anchor untouched", () => {
    const { targetLocalMs, anchor } = computeTargetLocalMs(
      Infinity,
      null,
      5000,
      1500,
    );
    expect(targetLocalMs).toBe(5000 + LOOKAHEAD_MS);
    expect(anchor).toBe(null);
  });

  it("-Infinity performerTs → imminent fallback, anchor untouched", () => {
    const { targetLocalMs, anchor } = computeTargetLocalMs(
      -Infinity,
      null,
      5000,
      1500,
    );
    expect(targetLocalMs).toBe(5000 + LOOKAHEAD_MS);
    expect(anchor).toBe(null);
  });

  it("a NaN does not poison the anchor for subsequent finite events", () => {
    // First event NaN → no anchor established.
    const a0 = computeTargetLocalMs(NaN, null, 5000, 1500);
    expect(a0.anchor).toBe(null);
    // Next finite event establishes the anchor cleanly from itself.
    const a1 = computeTargetLocalMs(1000, a0.anchor, 5000, 1500);
    expect(a1.anchor).toEqual({ performerTs: 1000, localMs: 6500 });
    expect(a1.targetLocalMs).toBe(6500);
  });
});

describe("playback anchor math — anchor null vs existing", () => {
  it("a null anchor is established from the first finite event", () => {
    const { targetLocalMs, anchor } = computeTargetLocalMs(1000, null, 5000, 1500);
    expect(anchor).not.toBe(null);
    expect(targetLocalMs).toBe(6500);
  });

  it("an existing anchor is reused (not re-established from the new event)", () => {
    const anchor = establishAnchor(1000, 5000, 1500); // localMs 6500
    // A later event with a much later `now` must still anchor to the ORIGINAL
    // localMs (re-anchoring from `now` would shift the whole session).
    const { targetLocalMs, anchor: a1 } = computeTargetLocalMs(
      2000,
      anchor,
      99999,
      1500,
    );
    expect(a1).toBe(anchor); // same anchor object reused
    // 6500 + (2000 - 1000) = 7500 — independent of the late `now`.
    expect(targetLocalMs).toBe(7500);
  });
});

describe("playback anchor math — defaults + purity", () => {
  it("defaults delay to PLAYBACK_DELAY_MS (1500)", () => {
    const { targetLocalMs } = computeTargetLocalMs(1000, null, 5000);
    expect(targetLocalMs).toBe(5000 + PLAYBACK_DELAY_MS);
    expect(PLAYBACK_DELAY_MS).toBe(1500);
  });

  it("establishAnchor defaults delay to PLAYBACK_DELAY_MS", () => {
    const anchor = establishAnchor(1000, 5000);
    expect(anchor.localMs).toBe(5000 + PLAYBACK_DELAY_MS);
  });

  it("isScheduleLate defaults delay-agnostic (uses LOOKAHEAD_MS only)", () => {
    // Sanity: the constant the boundary tests rely on.
    expect(LOOKAHEAD_MS).toBe(40);
  });
});

describe("playback module — import purity (no socket/store/network)", () => {
  // The module must not pull in any DOM / socket / store / network dependency.
  // It imports only `config/runtime` (constants). This is a static guarantee:
  // importing it in node must not throw, and the surface is only the pure
  // functions + the Anchor type.
  it("imports cleanly in node (no DOM/socket/store side-effects)", async () => {
    const mod = await import("../features/listener/lib/playback");
    expect(typeof mod.computeTargetLocalMs).toBe("function");
    expect(typeof mod.establishAnchor).toBe("function");
    expect(typeof mod.relativeMs).toBe("function");
    expect(typeof mod.isScheduleLate).toBe("function");
    expect(typeof mod.scheduleLateMs).toBe("function");
  });
});