// Story 3.3 — `createSeqCounter` unit tests (AD-5).
//
// Monotone uint32 counter: starts at 1 by default, `current()` peeks without
// advancing, `advance()` moves to the next value, and the value wraps modulo
// uint32 (after 0xFFFFFFFF the next is 0). Deterministic across instances.
import { describe, it, expect } from "vitest";
import {
  createSeqCounter,
  SEQ_START,
  SEQ_UINT32_MAX,
} from "../features/performer/lib/seq";

describe("createSeqCounter — monotone sequence", () => {
  it("starts at SEQ_START (1) by default", () => {
    const seq = createSeqCounter();
    expect(seq.current()).toBe(SEQ_START);
    expect(SEQ_START).toBe(1);
  });

  it("current() peeks WITHOUT advancing", () => {
    const seq = createSeqCounter();
    expect(seq.current()).toBe(1);
    expect(seq.current()).toBe(1);
    expect(seq.current()).toBe(1);
  });

  it("advance() moves to the next value (monotone increasing)", () => {
    const seq = createSeqCounter();
    expect(seq.current()).toBe(1);
    seq.advance();
    expect(seq.current()).toBe(2);
    seq.advance();
    expect(seq.current()).toBe(3);
    seq.advance();
    expect(seq.current()).toBe(4);
  });
});

describe("createSeqCounter — uint32 range", () => {
  it("produced values are non-negative integers within uint32 range", () => {
    const seq = createSeqCounter();
    for (let i = 0; i < 1000; i++) {
      const v = seq.current();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SEQ_UINT32_MAX);
      seq.advance();
    }
  });

  it("accepts an explicit start value", () => {
    const seq = createSeqCounter(100);
    expect(seq.current()).toBe(100);
    seq.advance();
    expect(seq.current()).toBe(101);
  });
});

describe("createSeqCounter — uint32 wrap", () => {
  it("wraps to 0 after 0xFFFFFFFF", () => {
    const seq = createSeqCounter(SEQ_UINT32_MAX);
    expect(seq.current()).toBe(0xffffffff);
    seq.advance(); // 0xFFFFFFFF + 1 → wraps to 0
    expect(seq.current()).toBe(0);
    seq.advance();
    expect(seq.current()).toBe(1);
    seq.advance();
    expect(seq.current()).toBe(2);
  });

  it("stays in uint32 range across the wrap boundary", () => {
    const seq = createSeqCounter(SEQ_UINT32_MAX - 1);
    expect(seq.current()).toBe(0xfffffffe);
    seq.advance();
    expect(seq.current()).toBe(0xffffffff);
    seq.advance();
    expect(seq.current()).toBe(0); // wrapped
    expect(seq.current()).toBeLessThanOrEqual(SEQ_UINT32_MAX);
  });
});

describe("createSeqCounter — determinism", () => {
  it("two counters with the same start produce the same sequence", () => {
    const a = createSeqCounter();
    const b = createSeqCounter();
    for (let i = 0; i < 50; i++) {
      expect(a.current()).toBe(b.current());
      a.advance();
      b.advance();
    }
  });

  it("two counters with the same explicit start produce the same sequence", () => {
    const a = createSeqCounter(0xfffffff0);
    const b = createSeqCounter(0xfffffff0);
    for (let i = 0; i < 50; i++) {
      // crosses the wrap boundary identically
      expect(a.current()).toBe(b.current());
      a.advance();
      b.advance();
    }
  });
});