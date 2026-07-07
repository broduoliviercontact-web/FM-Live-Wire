// Story 2.5 — rate-limit middleware unit tests (AD-13, FR-22, NFR-3, E12).
//
// The middleware is exercised directly with a fake socket + fake logger + an
// injected deterministic clock (the pure bucket never reads a clock). This
// covers: allow-while-tokens, deny-on-exhaustion, explicit ack, sampled log
// (NOT one per rejection), and non-`midi:event` pass-through.
//
// A SINGLE middleware instance is built per test and reused across emits — the
// bucket lives in its closure, so successive emits share state (a fresh
// middleware would reset the bucket and hide exhaustion).
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, vi } from "vitest";
import { createRateLimitMiddleware, type RateLimitLoggerPort } from "../socket/middlewares/rateLimit";
import type { ServerSocketData } from "../socket/middlewares/roleAuth";

/** Fake socket: only `id` + `data` are touched by the limiter (no disconnect). */
function fakeSocket(data: Partial<ServerSocketData>): { id: string; data: ServerSocketData } {
  return {
    id: "S1",
    data: { role: data.role, performerId: data.performerId } as ServerSocketData,
  };
}

/** A controllable clock — returns steps[i] then sticks on the last value. */
function clock(steps: number[]): () => number {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)];
}

interface EmitResult {
  next: ReturnType<typeof vi.fn>;
  ack: ReturnType<typeof vi.fn>;
}

/**
 * Build a SINGLE middleware + an `emit` helper that appends a fresh ack as the
 * last event element. Reusing the middleware preserves the in-closure bucket.
 */
function buildLimiter(opts: {
  socket: ReturnType<typeof fakeSocket>;
  now?: () => number;
  logger?: RateLimitLoggerPort;
  capacity?: number;
  refillPerSecond?: number;
}) {
  const mw = createRateLimitMiddleware({
    socket: opts.socket as unknown as Parameters<typeof createRateLimitMiddleware>[0]["socket"],
    now: opts.now,
    logger: opts.logger,
    capacity: opts.capacity,
    refillPerSecond: opts.refillPerSecond,
  });
  function emit(event: unknown[]): EmitResult {
    const ack = vi.fn();
    const next = vi.fn();
    mw([...event, ack] as unknown as Parameters<typeof mw>[0], next);
    return { next, ack };
  }
  return { emit, mw };
}

describe("createRateLimitMiddleware — non-midi:event passes through", () => {
  it("room:join / room:leave / midi:test are NOT policed → next() no error", () => {
    const { emit } = buildLimiter({ socket: fakeSocket({ role: "listener" }), now: clock([0]) });
    for (const ev of ["room:join", "room:leave", "midi:test"]) {
      const { next, ack } = emit([ev, { x: 1 }]);
      expect(next.mock.calls[0]).toEqual([]); // allowed, no args
      expect(ack).not.toHaveBeenCalled();
    }
  });

  it("omitting `now` falls back to Date.now() (a fresh bucket is full regardless)", () => {
    // No injected clock → the `?? (() => Date.now())` fallback runs. A fresh
    // bucket is always full, so the first emit passes irrespective of the real
    // wall-clock value (deterministic in OUTCOME, not in timestamp).
    const { emit } = buildLimiter({
      socket: fakeSocket({ role: "performer", performerId: "S1" }),
      capacity: 1,
      refillPerSecond: 0,
    });
    const { next, ack } = emit(["midi:event", { type: "noteOn" }]);
    expect(next.mock.calls[0]).toEqual([]); // allowed
    expect(ack).not.toHaveBeenCalled();
  });
});

describe("createRateLimitMiddleware — midi:event allow while bucket has tokens", () => {
  it("owner midi:event passes while tokens remain (next() no error, ack untouched)", () => {
    const { emit } = buildLimiter({
      socket: fakeSocket({ role: "performer", performerId: "S1" }),
      now: clock([0]), // constant → no refill; capacity 3 → 3 pass
      capacity: 3,
      refillPerSecond: 100,
    });
    for (let i = 0; i < 3; i++) {
      const { next, ack } = emit(["midi:event", { type: "noteOn" }]);
      expect(next.mock.calls[0]).toEqual([]); // allowed
      expect(ack).not.toHaveBeenCalled();
    }
  });
});

describe("createRateLimitMiddleware — exhaustion → rate:limited", () => {
  it("midi:event denied once the bucket is empty: next(err) + explicit ack", () => {
    const { emit } = buildLimiter({
      socket: fakeSocket({ role: "performer", performerId: "S1" }),
      now: clock([0]), // constant → no refill
      capacity: 2,
      refillPerSecond: 100,
    });
    // Drain 2.
    emit(["midi:event"]);
    emit(["midi:event"]);
    // 3rd → denied.
    const { next, ack } = emit(["midi:event", { type: "noteOn" }]);
    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as Error).message).toBe("rate:limited");
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "rate:limited" });
  });

  it("denied WITHOUT an ack does not throw (no ack to call)", () => {
    const { mw } = buildLimiter({
      socket: fakeSocket({ role: "performer", performerId: "S1" }),
      now: clock([0]),
      capacity: 1,
      refillPerSecond: 100,
    });
    mw(["midi:event", { type: "noteOn" }] as unknown as Parameters<typeof mw>[0], vi.fn()); // drain
    expect(() =>
      mw(["midi:event", { type: "noteOn" }] as unknown as Parameters<typeof mw>[0], vi.fn()),
    ).not.toThrow(); // 2nd denied, no ack appended
  });
});

describe("createRateLimitMiddleware — sampled log (NOT one per rejection)", () => {
  it("logs the 1st rejection then every 50th — not every rejection", () => {
    const warn = vi.fn();
    const { emit } = buildLimiter({
      socket: fakeSocket({ role: "performer", performerId: "S1" }),
      now: clock([0]), // constant, refill 0 → bucket never recovers
      logger: { warn } satisfies RateLimitLoggerPort,
      capacity: 1,
      refillPerSecond: 0,
    });
    emit(["midi:event"]); // #1 allowed (drain)
    // 100 denied events.
    for (let i = 0; i < 100; i++) emit(["midi:event"]);
    // Sampled: limitedCount 1 (first rejection), 50, 100 → exactly 3 warn calls.
    expect(warn).toHaveBeenCalledTimes(3);
    const metas = warn.mock.calls.map(
      (c) => c[1] as { socketId: string; role: string; limitedCount: number },
    );
    expect(metas.map((m) => m.limitedCount)).toEqual([1, 50, 100]);
    for (const m of metas) {
      expect(m.socketId).toBe("S1");
      expect(m.role).toBe("performer");
    }
  });

  it("does NOT log when the logger is omitted (no throw)", () => {
    const { emit } = buildLimiter({
      socket: fakeSocket({ role: "performer", performerId: "S1" }),
      now: clock([0]),
      capacity: 1,
      refillPerSecond: 0,
    });
    emit(["midi:event"]); // drain
    expect(() => emit(["midi:event"])).not.toThrow(); // denied, no logger
  });
});