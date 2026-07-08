// CC rate-limiter / coalescer unit tests (pure node, no DOM, no fake timers).
//
// Drives the coalescer synchronously via `submit` + `__tick` (the injected
// `setTimeout` is a no-op so no real timer ever fires). Verifies the 10 cases
// from the plan + the no-double-counting semantics (correction 2):
//   - notes pass through unchanged, never counted;
//   - CC74 burst is coalesced to ≤ 60 Hz (Smooth) / ≤ 30 Hz (Safe);
//   - the LAST CC value is preserved (pending flushes on `__tick`);
//   - identical-value duplicates are dropped;
//   - bypass CC (64/120/121/123) forward immediately even under Safe throttle;
//   - `reset()` empties pending + clears the timer;
//   - `raw` mode forwards every CC (ccCoalesced stays 0);
//   - `flush()` (mode change) preserves the last value;
//   - no stuck note (noteOn + noteOff both pass in Smooth).
import { describe, it, expect } from "vitest";
import { createCcCoalescer, isBypassCc, BYPASS_CONTROLLERS, type CcMode } from "../features/listener/lib/cc-coalescer";
import type { MidiSendable } from "../features/listener/lib/sendable";

// --- harness ---------------------------------------------------------------

interface Harness {
  readonly c: ReturnType<typeof createCcCoalescer>;
  readonly inner: MidiSendable;
  readonly sends: { data: Uint8Array; ts: number }[];
  setMode(m: CcMode): void;
  setMinInterval(ms: number): void;
  advance(ms: number): void;
  setNow(v: number): void;
  sent(): number;
  coalesced(): number;
  cc74(value: number, channel?: number, ts?: number): void;
  cc(controller: number, value: number, channel?: number, ts?: number): void;
  bypassCc(controller: number, value?: number, channel?: number, ts?: number): void;
  noteOn(note: number, channel?: number, ts?: number): void;
  noteOff(note: number, channel?: number, ts?: number): void;
  pitchBend(value: number, channel?: number, ts?: number): void;
}

function makeHarness(initial: { mode?: CcMode; minInterval?: number } = {}): Harness {
  let mode: CcMode = initial.mode ?? "smooth";
  let minInterval = initial.minInterval ?? 17;
  let nowVal = 0;
  let sent = 0;
  let coalesced = 0;
  const sends: { data: Uint8Array; ts: number }[] = [];
  const inner: MidiSendable = {
    send: (d, ts) => sends.push({ data: new Uint8Array(d), ts: ts as number }),
  };
  const c = createCcCoalescer({
    getMode: () => mode,
    getMinIntervalMs: () => minInterval,
    onSent: () => { sent += 1; },
    onCoalesced: () => { coalesced += 1; },
    now: () => nowVal,
    // No-op timer: tests drive flushes via `__tick` deterministically.
    setTimeout: (_cb, _ms) => 0,
    clearTimeout: (_h) => {},
  });
  return {
    c, inner, sends,
    setMode: (m) => { mode = m; },
    setMinInterval: (m) => { minInterval = m; },
    advance: (ms) => { nowVal += ms; },
    setNow: (v) => { nowVal = v; },
    sent: () => sent,
    coalesced: () => coalesced,
    cc74: (value, channel = 0, ts = 2500) => c.submit(inner, new Uint8Array([0xb0 | channel, 74, value]), ts),
    cc: (controller, value, channel = 0, ts = 2500) => c.submit(inner, new Uint8Array([0xb0 | channel, controller, value]), ts),
    bypassCc: (controller, value = 0, channel = 0, ts = 2500) => c.submit(inner, new Uint8Array([0xb0 | channel, controller, value]), ts),
    noteOn: (note, channel = 0, ts = 2500) => c.submit(inner, new Uint8Array([0x90 | channel, note, 100]), ts),
    noteOff: (note, channel = 0, ts = 2500) => c.submit(inner, new Uint8Array([0x80 | channel, note, 0]), ts),
    pitchBend: (value, channel = 0, ts = 2500) => c.submit(inner, new Uint8Array([0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f]), ts),
  };
}

// --- 1. notes pass without delay or deletion --------------------------------

describe("notes — pass through unchanged, never counted", () => {
  it("noteOn + noteOff in Smooth forward same bytes/ts, 0 sent / 0 coalesced", () => {
    const h = makeHarness();
    h.noteOn(60, 0, 2500);
    h.noteOff(60, 0, 2900);
    expect(h.sends).toHaveLength(2);
    expect(Array.from(h.sends[0]!.data)).toEqual([0x90, 60, 100]);
    expect(h.sends[0]!.ts).toBe(2500);
    expect(Array.from(h.sends[1]!.data)).toEqual([0x80, 60, 0]);
    expect(h.sends[1]!.ts).toBe(2900);
    expect(h.sent()).toBe(0); // notes are NOT CC → not counted
    expect(h.coalesced()).toBe(0);
  });

  it("pitchBend passes through (never coalesced)", () => {
    const h = makeHarness();
    h.pitchBend(2000, 0, 2500);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]!.data[0]! & 0xf0).toBe(0xe0);
    expect(h.sent()).toBe(0);
    expect(h.coalesced()).toBe(0);
  });
});

// --- 2. CC74 burst coalesced to <= 60 Hz (Smooth) --------------------------

describe("CC74 burst — coalesced to <= 60 Hz in Smooth (17 ms window)", () => {
  it("50 CC74 over 100 ms → sends <= ceil(100/17)+1 = 7; coalesced > 0", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    for (let i = 0; i < 50; i += 1) {
      h.advance(2); // 2 ms between events → ~500 CC/s, well above 60 Hz
      h.cc74(i, 0, 2500 + i); // distinct value i, deferred ts preserved
      h.c.__tick(); // flush eligible pending
    }
    // ≤ 7 forwards in a 100 ms window (60 Hz cap).
    expect(h.sends.length).toBeLessThanOrEqual(7);
    expect(h.sends.length).toBeGreaterThanOrEqual(1);
    expect(h.coalesced()).toBeGreaterThan(0);
    // Drain the final held pending (it is not yet eligible immediately after
    // its submit, so the in-loop `__tick` left it pending).
    h.advance(20);
    h.c.__tick();
    // Accounting: received = sent + coalesced (no bypass, no reset, no held
    // pending after the drain — the last value flushed).
    expect(h.sent() + h.coalesced()).toBe(50);
  });
});

// --- 3. last CC value preserved (pending flushes on __tick) -----------------

describe("last value — held pending flushes the FINAL value on __tick", () => {
  it("burst stops → __tick forwards the latest value, not an earlier one", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.cc74(10, 0, 2500); // now=0 → eligible → send 10
    h.advance(2); h.cc74(20, 0, 2501); // throttled → pending 20
    h.advance(2); h.cc74(30, 0, 2502); // throttled → 20 replaced → pending 30
    h.advance(2); h.cc74(40, 0, 2503); // throttled → 30 replaced → pending 40
    expect(h.sends).toHaveLength(1); // only 10 sent so far
    expect(Array.from(h.sends[0]!.data)).toEqual([0xb0, 74, 10]);
    // Time passes; the held final value (40) flushes.
    h.advance(20);
    h.c.__tick();
    expect(h.sends).toHaveLength(2);
    expect(Array.from(h.sends[1]!.data)).toEqual([0xb0, 74, 40]); // LAST value
    expect(h.sends[1]!.ts).toBe(2503); // ts of the latest submit preserved
  });
});

// --- 4. identical-value duplicates dropped ---------------------------------

describe("duplicates — identical value of the last forwarded CC is dropped", () => {
  it("same value repeated → first forwarded, rest coalesced", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.cc74(50); // eligible → send
    h.cc74(50); // duplicate of last forwarded → drop
    h.cc74(50); // duplicate → drop
    h.cc74(50); // duplicate → drop
    expect(h.sends).toHaveLength(1);
    expect(Array.from(h.sends[0]!.data)).toEqual([0xb0, 74, 50]);
    expect(h.sent()).toBe(1);
    expect(h.coalesced()).toBe(3);
  });

  it("a value equal to last forwarded arriving after the throttle window is STILL a duplicate (dropped)", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.cc74(50); // send
    h.advance(50); h.cc74(50); // same value → duplicate, not re-sent
    expect(h.sends).toHaveLength(1);
    expect(h.coalesced()).toBe(1);
  });
});

// --- 5. bypass CC forward immediately under Safe 30 Hz burst ----------------

describe("bypass CC — 64/120/121/123 forward immediately even in Safe under burst", () => {
  it("CC120/121/123/64 forward immediately at the START of a Safe-throttled burst", () => {
    const h = makeHarness({ mode: "safe", minInterval: 33 });
    // Prime the key so CC74 would be throttled (lastSentAt = 0).
    h.cc74(10); // eligible (first) → send
    h.advance(2);
    h.cc74(20); // throttled → pending 20
    // Bypass CCs arrive while a CC74 is pending — they must forward NOW.
    h.bypassCc(120, 0); // all-sound-off
    h.bypassCc(121, 0); // reset-controllers
    h.bypassCc(123, 0); // all-notes-off
    h.bypassCc(64, 127); // sustain pedal down
    const bypassSends = h.sends.slice(1); // drop the primer CC74
    expect(bypassSends).toHaveLength(4);
    expect(Array.from(bypassSends[0]!.data)).toEqual([0xb0, 120, 0]);
    expect(Array.from(bypassSends[1]!.data)).toEqual([0xb0, 121, 0]);
    expect(Array.from(bypassSends[2]!.data)).toEqual([0xb0, 123, 0]);
    expect(Array.from(bypassSends[3]!.data)).toEqual([0xb0, 64, 127]);
    // Bypass CC ARE controlChange sent to the raw output → increment ccSent.
    // ccSent = primer (10) + 4 bypass; the held CC74 (20) is still pending
    // (not yet flushed) → not counted yet. Bypass NEVER touch ccCoalesced.
    expect(h.sent()).toBe(5);
    expect(h.coalesced()).toBe(0);
  });

  it("bypass CC64/120/121/123 increment onSent but NEVER onCoalesced, even as duplicates", () => {
    const h = makeHarness({ mode: "safe", minInterval: 33 });
    // Repeated identical bypass values still forward immediately + count sent,
    // never coalesced (bypass ignores the duplicate-drop path).
    h.bypassCc(123, 0);
    h.bypassCc(123, 0);
    h.bypassCc(64, 127);
    h.bypassCc(64, 127);
    expect(h.sends).toHaveLength(4);
    expect(h.sent()).toBe(4);
    expect(h.coalesced()).toBe(0);
  });

  it("isBypassCc / BYPASS_CONTROLLERS cover exactly 64/120/121/123", () => {
    expect(isBypassCc(64)).toBe(true);
    expect(isBypassCc(120)).toBe(true);
    expect(isBypassCc(121)).toBe(true);
    expect(isBypassCc(123)).toBe(true);
    expect(isBypassCc(74)).toBe(false);
    expect(isBypassCc(1)).toBe(false);
    expect([...BYPASS_CONTROLLERS].sort((a, b) => a - b)).toEqual([64, 120, 121, 123]);
  });
});

// --- 6. CC123 bypass (immediate, not throttled) ----------------------------

describe("CC123 — all-notes-off bypasses the throttle (immediate)", () => {
  it("CC123 forwards immediately even right after a CC74 forward in Safe", () => {
    const h = makeHarness({ mode: "safe", minInterval: 33 });
    h.cc74(10); // send at now=0
    h.advance(1); // 1 ms later — CC74 would be throttled, but CC123 bypasses
    h.bypassCc(123, 0);
    expect(h.sends).toHaveLength(2);
    expect(Array.from(h.sends[1]!.data)).toEqual([0xb0, 123, 0]);
    expect(h.sends[1]!.ts).toBe(2500);
    expect(h.sent()).toBe(2); // primer CC74 + CC123 bypass both count as sent
    expect(h.coalesced()).toBe(0);
  });
});

// --- 7. reset() empties pending + clears timer -----------------------------

describe("reset — drops pending + clears the timer (no flush send)", () => {
  it("hold a CC, reset, __tick → no send (pending was dropped, not flushed)", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.cc74(10); // send
    h.advance(2); h.cc74(20); // throttled → pending 20
    expect(h.sends).toHaveLength(1);
    h.c.reset(); // port/channel/output-lost/leave → drop pending + clear timer
    h.advance(20);
    h.c.__tick(); // nothing to flush
    expect(h.sends).toHaveLength(1); // no new send
    expect(h.sent()).toBe(1); // still just the primer
    // After reset, the next CC on the same key is treated as FIRST (eligible).
    h.cc74(99);
    expect(h.sends).toHaveLength(2);
    expect(Array.from(h.sends[1]!.data)).toEqual([0xb0, 74, 99]);
    expect(h.sent()).toBe(2);
  });

  it("reset on one channel does not carry another channel's pending (per-key)", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.cc74(10, 0); // ch0 send
    h.cc74(11, 1); // ch1 send
    h.advance(2); h.cc74(20, 0); // ch0 pending 20
    h.advance(2); h.cc74(21, 1); // ch1 pending 21
    h.c.reset(); // global reset → all channels dropped
    h.advance(20); h.c.__tick();
    expect(h.sends).toHaveLength(2); // nothing flushed
  });
});

// --- 8. raw mode (no coalescing) + safe cap 30 Hz --------------------------

describe("modes — raw forwards all (ccCoalesced 0); safe caps at 30 Hz", () => {
  it("raw mode forwards every CC immediately (ccCoalesced stays 0)", () => {
    const h = makeHarness({ mode: "raw", minInterval: 17 });
    for (let i = 0; i < 20; i += 1) {
      h.cc74(i);
    }
    expect(h.sends).toHaveLength(20);
    expect(h.sent()).toBe(20);
    expect(h.coalesced()).toBe(0); // raw → no coalescing
  });

  it("raw mode forwards duplicates too (no duplicate-drop in raw)", () => {
    const h = makeHarness({ mode: "raw", minInterval: 17 });
    h.cc74(50); h.cc74(50); h.cc74(50);
    expect(h.sends).toHaveLength(3);
    expect(h.sent()).toBe(3);
    expect(h.coalesced()).toBe(0);
  });

  it("safe mode caps at 30 Hz (33 ms window) — fewer forwards than Smooth over the same window", () => {
    const safe = makeHarness({ mode: "safe", minInterval: 33 });
    const smooth = makeHarness({ mode: "smooth", minInterval: 17 });
    for (let i = 0; i < 60; i += 1) {
      safe.advance(2); safe.cc74(i); safe.c.__tick();
      smooth.advance(2); smooth.cc74(i); smooth.c.__tick();
    }
    // Both coalesce; safe (33 ms) forwards <= ceil(120/33)+1 = 5.
    expect(safe.sends.length).toBeLessThanOrEqual(5);
    expect(safe.sends.length).toBeGreaterThanOrEqual(1);
    // Smooth (17 ms) forwards more than safe over the same 120 ms window.
    expect(smooth.sends.length).toBeGreaterThan(safe.sends.length);
    expect(safe.coalesced()).toBeGreaterThan(0);
    // Drain the final held pending on each, then accounting closes.
    safe.advance(40); safe.c.__tick();
    smooth.advance(40); smooth.c.__tick();
    expect(safe.sent() + safe.coalesced()).toBe(60);
    expect(smooth.sent() + smooth.coalesced()).toBe(60);
  });
});

// --- 9. mode change → flush() preserves the last value ----------------------

describe("mode change — flush() forwards held pending (preserves last value)", () => {
  it("switching smooth → raw flushes the held value, then raw forwards", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.cc74(10); // send
    h.advance(2); h.cc74(20); // pending 20
    h.advance(2); h.cc74(30); // pending 30 (20 replaced)
    expect(h.sends).toHaveLength(1);
    // Orchestrator flushes BEFORE applying the new mode (preserve last value).
    h.c.flush();
    expect(h.sends).toHaveLength(2);
    expect(Array.from(h.sends[1]!.data)).toEqual([0xb0, 74, 30]); // last value
    h.setMode("raw");
    h.cc74(40); // raw → immediate
    expect(h.sends).toHaveLength(3);
    expect(Array.from(h.sends[2]!.data)).toEqual([0xb0, 74, 40]);
    expect(h.coalesced()).toBe(1); // value 20 was replaced by 30 (pre-flush)
  });
});

// --- 10. no stuck note (noteOn + noteOff both pass in Smooth) --------------

describe("no stuck note — noteOn then noteOff both pass in Smooth", () => {
  it("a noteOff following a noteOn is forwarded, not held or dropped", () => {
    const h = makeHarness({ mode: "smooth", minInterval: 17 });
    h.noteOn(60, 0, 2500);
    h.cc74(10); // interleaved CC (eligible → send)
    h.advance(2);
    h.cc74(20); // throttled (pending) — must NOT delay the noteOff
    h.noteOff(60, 0, 2600); // arrives while a CC is pending
    // noteOn + noteOff both forwarded immediately; CC74(20) still pending.
    const noteSends = h.sends.filter((s) => (s.data[0]! & 0xf0) !== 0xb0);
    expect(noteSends).toHaveLength(2);
    expect(Array.from(noteSends[0]!.data)).toEqual([0x90, 60, 100]);
    expect(Array.from(noteSends[1]!.data)).toEqual([0x80, 60, 0]);
    expect(noteSends[1]!.ts).toBe(2600); // noteOff NOT delayed by the pending CC
  });
});