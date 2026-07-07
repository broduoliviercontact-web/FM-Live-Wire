// Story 2.7 — RoomService unit tests (AD-4, FR-28, listener counter).
//
// Pure unit tests: a fresh `RoomService` per case (no Socket.IO). Covers the
// idempotency contract that the integration tests rely on: a duplicate
// `room:join` does not double-count; `room:leave` + disconnect does not
// double-decrement; the count never goes negative.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect } from "vitest";
import { RoomService, roomService } from "../socket/services/RoomService";

describe("RoomService — listener counter", () => {
  it("starts at 0", () => {
    expect(new RoomService().getListenerCount()).toBe(0);
  });

  it("onJoin increments the count", () => {
    const rs = new RoomService();
    rs.onJoin("a");
    expect(rs.getListenerCount()).toBe(1);
    rs.onJoin("b");
    expect(rs.getListenerCount()).toBe(2);
  });

  it("duplicate onJoin for the SAME socket does NOT double-count", () => {
    const rs = new RoomService();
    rs.onJoin("a");
    rs.onJoin("a"); // listener emitted room:join twice
    expect(rs.getListenerCount()).toBe(1);
  });

  it("onLeave decrements", () => {
    const rs = new RoomService();
    rs.onJoin("a");
    rs.onLeave("a");
    expect(rs.getListenerCount()).toBe(0);
  });

  it("onLeave for an id that was never joined is a no-op (no negative)", () => {
    const rs = new RoomService();
    rs.onLeave("ghost");
    expect(rs.getListenerCount()).toBe(0);
  });

  it("onDisconnect decrements only if still joined", () => {
    const rs = new RoomService();
    rs.onJoin("a");
    rs.onDisconnect("a");
    expect(rs.getListenerCount()).toBe(0);
  });

  it("onDisconnect for an id that never joined is a no-op (no negative)", () => {
    const rs = new RoomService();
    rs.onDisconnect("ghost");
    expect(rs.getListenerCount()).toBe(0);
  });

  it("room:leave then disconnect does NOT double-decrement", () => {
    // The listener explicitly left, then the socket disconnected: only one
    // decrement must happen (onLeave already removed it; onDisconnect is a no-op).
    const rs = new RoomService();
    rs.onJoin("a");
    rs.onLeave("a");
    rs.onDisconnect("a");
    expect(rs.getListenerCount()).toBe(0);
  });

  it("disconnect WITHOUT a prior room:leave still decrements", () => {
    // The listener joined but never explicitly left: disconnect must clean up.
    const rs = new RoomService();
    rs.onJoin("a");
    rs.onJoin("b");
    rs.onDisconnect("a");
    expect(rs.getListenerCount()).toBe(1);
  });

  it("reset clears the counter (test-isolation hook)", () => {
    const rs = new RoomService();
    rs.onJoin("a");
    rs.onJoin("b");
    rs.reset();
    expect(rs.getListenerCount()).toBe(0);
  });

  it("process-wide singleton is a RoomService instance", () => {
    // Sanity: /health imports this singleton; it shares state with the wiring.
    expect(roomService).toBeInstanceOf(RoomService);
  });
});