// Story 2.5 — pure token bucket unit tests (AD-13, FR-22, NFR-3).
//
// The bucket is pure + deterministic: time is INJECTED, `Date.now()` is never
// called inside `tokenBucket.ts`, and `consumeToken` returns a NEW state (the
// input is never mutated). These tests pin every branch so coverage is 100%.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect } from "vitest";
import {
  createTokenBucketState,
  consumeToken,
  DEFAULT_CAPACITY,
  DEFAULT_REFILL_PER_SECOND,
} from "../utils/tokenBucket";

describe("createTokenBucketState (defaults AD-13)", () => {
  it("defaults to capacity 200 / refill 100/s, full to capacity", () => {
    const s = createTokenBucketState();
    expect(s.capacity).toBe(DEFAULT_CAPACITY);
    expect(s.refillPerSecond).toBe(DEFAULT_REFILL_PER_SECOND);
    expect(s.tokens).toBe(200);
    expect(s.lastRefillMs).toBe(0); // no clock read — caller passes nowMs
  });

  it("honours explicit params + initial nowMs", () => {
    const s = createTokenBucketState({ capacity: 5, refillPerSecond: 2, nowMs: 1000 });
    expect(s.capacity).toBe(5);
    expect(s.refillPerSecond).toBe(2);
    expect(s.tokens).toBe(5);
    expect(s.lastRefillMs).toBe(1000);
  });
});

describe("consumeToken — burst capacity (200 pass, 201st denied)", () => {
  it("200 consecutive consumes at the same instant all pass; 201st is denied", () => {
    let s = createTokenBucketState({ nowMs: 0 }); // 200 tokens
    for (let i = 0; i < 200; i++) {
      const r = consumeToken(s, 0);
      expect(r.allowed).toBe(true);
      s = r.state;
    }
    expect(s.tokens).toBe(0);
    const denied = consumeToken(s, 0);
    expect(denied.allowed).toBe(false);
    // No refill elapsed (same instant) → tokens stays 0.
    expect(denied.state.tokens).toBe(0);
  });

  it("denial still advances the clock (no double-counted refill next call)", () => {
    let s = createTokenBucketState({ capacity: 1, refillPerSecond: 1000, nowMs: 0 });
    s = consumeToken(s, 0).state; // tokens 1 -> 0, lastRefillMs 0
    const denied = consumeToken(s, 0); // denied at t=0, banks 0 refill
    expect(denied.allowed).toBe(false);
    expect(denied.state.lastRefillMs).toBe(0);
    // If the clock had NOT advanced on denial, this 1ms call would recompute
    // elapsed from the OLD lastRefillMs and double-count. Instead elapsed is
    // exactly 1ms → refill = 1 token → allowed.
    const after = consumeToken(denied.state, 1);
    expect(after.allowed).toBe(true);
    expect(after.state.tokens).toBe(0);
  });
});

describe("consumeToken — refill 100/s + cap at capacity", () => {
  it("refills 100 tokens per second (10ms → 1 token)", () => {
    // Small bucket: drain it fully, then prove 10ms refills exactly 1 token.
    let s = createTokenBucketState({ capacity: 5, refillPerSecond: 100, nowMs: 0 }); // 5
    for (let i = 0; i < 5; i++) s = consumeToken(s, 0).state; // 0, lastRefillMs 0
    expect(consumeToken(s, 0).allowed).toBe(false); // empty
    // 10ms → +1 token → allowed (1 >= 1), and the token is consumed → 0 again.
    const r = consumeToken(s, 10);
    expect(r.allowed).toBe(true);
    expect(r.state.tokens).toBe(0); // refilled to 1, then consumed
    // 20ms from the checkpoint → +2 tokens → 2 available after consume.
    const r2 = consumeToken(r.state, 30); // 20ms elapsed → +2 → 2, consume 1 → 1
    expect(r2.allowed).toBe(true);
    expect(r2.state.tokens).toBeCloseTo(1, 5);
  });

  it("never refills ABOVE capacity (cap bound)", () => {
    // Drain, then wait a huge time with an unreachable cost so the denial path
    // banks the refill WITHOUT consuming — tokens must cap at `capacity`.
    let s = createTokenBucketState({ capacity: 5, refillPerSecond: 1000, nowMs: 0 }); // 5
    for (let i = 0; i < 5; i++) s = consumeToken(s, 0).state; // 0
    const r = consumeToken(s, 999_999, 100); // huge refill, cost 100 → denied
    expect(r.allowed).toBe(false);
    expect(r.state.tokens).toBe(5); // capped at capacity, NOT 999*1000
    expect(r.state.tokens).toBeLessThanOrEqual(s.capacity);
  });

  it("recovers after injected time: exhausted bucket refills enough to pass", () => {
    // Small bucket for a sharp recovery proof.
    let s = createTokenBucketState({ capacity: 3, refillPerSecond: 1, nowMs: 0 });
    // Drain it.
    for (let i = 0; i < 3; i++) s = consumeToken(s, 0).state;
    expect(consumeToken(s, 0).allowed).toBe(false); // empty
    // 500ms → +0.5 token → still denied (cost 1 > 0.5).
    const half = consumeToken(s, 500);
    expect(half.allowed).toBe(false);
    expect(half.state.tokens).toBeCloseTo(0.5, 5);
    // Another 500ms (total 1000ms from the 500ms checkpoint) → +0.5 → 1.0 → allowed.
    const recovered = consumeToken(half.state, 1000);
    expect(recovered.allowed).toBe(true);
    expect(recovered.state.tokens).toBeCloseTo(0, 5);
  });

  it("clock moving backwards yields ZERO refill (never negative)", () => {
    let s = createTokenBucketState({ capacity: 5, refillPerSecond: 100, nowMs: 100 }); // 5
    s = consumeToken(s, 100).state; // 5 -> consume 1 -> 4, lastRefillMs 100
    // nowMs < lastRefillMs → elapsed clamped to 0 → no refill (no negative).
    const r = consumeToken(s, 50); // refilled min(5, 4+0)=4, consume 1 -> 3
    expect(r.state.tokens).toBe(3); // exactly 4-1, no negative refill
    expect(r.allowed).toBe(true);
  });
});

describe("consumeToken — determinism + purity", () => {
  it("same state + same now + same cost → same result (deterministic)", () => {
    const base = createTokenBucketState({ capacity: 10, refillPerSecond: 5, nowMs: 0 });
    const a = consumeToken(base, 1234, 2);
    const b = consumeToken(base, 1234, 2);
    expect(a).toEqual(b);
  });

  it("does NOT mutate the input state (no hidden side effect)", () => {
    const original = createTokenBucketState({ capacity: 4, refillPerSecond: 1, nowMs: 0 });
    const snapshot = { ...original };
    consumeToken(original, 100); // result discarded
    expect(original).toEqual(snapshot); // input untouched
  });

  it("cost > capacity is never allowed (tokens capped below cost)", () => {
    let s = createTokenBucketState({ capacity: 3, refillPerSecond: 0, nowMs: 0 });
    const r = consumeToken(s, 0, 5);
    expect(r.allowed).toBe(false);
    expect(r.state.tokens).toBe(3); // full, but cost 5 unreachable
    s = r.state;
    // Even after waiting, refill 0 → never enough.
    expect(consumeToken(s, 9999, 5).allowed).toBe(false);
  });
});

// Story 6.4 — consolidation: the "plusieurs clés indépendantes si applicable"
// conditional scenario. The bucket is a PURE stateless function over an
// immutable `TokenBucketState`: per-socket isolation comes from each socket
// owning its own state object. Two separate states never interfere (no shared
// mutable state, no hidden global).
describe("consumeToken — independent buckets do not interfere (Story 6.4)", () => {
  it("two separate states evolve independently (per-socket isolation, AD-13)", () => {
    let a = createTokenBucketState({ capacity: 5, refillPerSecond: 100, nowMs: 0 });
    const b = createTokenBucketState({ capacity: 5, refillPerSecond: 100, nowMs: 0 });
    // Drain A by 3, leave B untouched.
    for (let i = 0; i < 3; i += 1) a = consumeToken(a, 0).state;
    expect(a.tokens).toBe(2);
    expect(b.tokens).toBe(5); // B still full — A's consumes did not leak into B
    // B consumes independently.
    const rb = consumeToken(b, 0);
    expect(rb.state.tokens).toBe(4);
    expect(a.tokens).toBe(2); // A unaffected by B's consume
  });

  it("two buckets refilled at different clocks stay independent", () => {
    let a = createTokenBucketState({ capacity: 2, refillPerSecond: 1000, nowMs: 0 });
    const b = createTokenBucketState({ capacity: 2, refillPerSecond: 1000, nowMs: 0 });
    // Drain a completely; b stays full.
    a = consumeToken(a, 0).state; // a: 1
    a = consumeToken(a, 0).state; // a: 0
    expect(a.tokens).toBe(0);
    expect(a.lastRefillMs).toBe(0);
    expect(b.tokens).toBe(2); // b untouched by a's consumes
    // Consume b at t=100: b refills (capped at 2, already 2) then -1 → 1, and
    // b.lastRefillMs advances to 100. a is NOT refilled by b's clock advance.
    const rb = consumeToken(b, 100);
    expect(rb.state.tokens).toBe(1);
    expect(rb.state.lastRefillMs).toBe(100);
    expect(a.tokens).toBe(0); // a still empty
    expect(a.lastRefillMs).toBe(0); // a's clock did not move with b
  });
});