// Story 2.4 — event gate unit tests (pure, AD-2 / AD-16 / FR-18 / FR-19).
//
// The gate is exercised directly with a fake socket + fake registry so every
// branch is reached deterministically (including the performer non-owner case
// that cannot occur through the real handshake, since Story 2.3 refuses a 2nd
// performer — the gate re-checks `performerId === owner` for defense-in-depth).
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, vi } from "vitest";
import {
  createEventGateMiddleware,
  isEventAllowed,
  type OwnerStatusPort,
} from "../socket/middlewares/eventGate";
import type { ServerSocketData } from "../socket/middlewares/roleAuth";

/** Build a fake socket with the minimum the gate touches: `data` + `disconnect`. */
function fakeSocket(data: Partial<ServerSocketData>): {
  data: ServerSocketData;
  disconnect: ReturnType<typeof vi.fn>;
} {
  return {
    data: { role: data.role, performerId: data.performerId } as ServerSocketData,
    disconnect: vi.fn(),
  };
}

function registryWith(ownerId: string | null): OwnerStatusPort {
  return { getOwnerPerformerId: () => ownerId };
}

/** Run the gate on an event array; returns spies for assertion. */
function runGate(
  socket: ReturnType<typeof fakeSocket>,
  registry: OwnerStatusPort,
  event: unknown[],
): { next: ReturnType<typeof vi.fn>; ack: ReturnType<typeof vi.fn> } {
  const ack = vi.fn();
  const fullEvent = [...event, ack]; // ack is the LAST element
  const next = vi.fn();
  const gate = createEventGateMiddleware({
    // The gate only uses `socket.data` + `socket.disconnect` — cast is safe.
    socket: socket as unknown as Parameters<typeof createEventGateMiddleware>[0]["socket"],
    registry,
  });
  gate(fullEvent as unknown as Parameters<typeof gate>[0], next);
  return { next, ack };
}

describe("isEventAllowed (pure, AD-2 / FR-18 / FR-19)", () => {
  it("midi:event allowed only for the current owner performer", () => {
    const reg = registryWith("OWNER");
    expect(isEventAllowed("midi:event", { role: "performer", performerId: "OWNER" }, reg)).toBe(true);
    expect(isEventAllowed("midi:event", { role: "performer", performerId: "OTHER" }, reg)).toBe(false);
    expect(isEventAllowed("midi:event", { role: "listener" }, reg)).toBe(false);
    expect(isEventAllowed("midi:event", {}, reg)).toBe(false);
  });

  it("midi:event is forbidden when there is no owner", () => {
    const reg = registryWith(null);
    expect(isEventAllowed("midi:event", { role: "performer", performerId: "P1" }, reg)).toBe(false);
  });

  it("listener may emit only room:join / room:leave / midi:test", () => {
    const reg = registryWith(null);
    for (const ok of ["room:join", "room:leave", "midi:test"]) {
      expect(isEventAllowed(ok, { role: "listener" }, reg)).toBe(true);
    }
    expect(isEventAllowed("midi:event", { role: "listener" }, reg)).toBe(false);
    expect(isEventAllowed("bogus", { role: "listener" }, reg)).toBe(false);
    expect(isEventAllowed("room:join", { role: "listener" }, reg)).toBe(true);
  });

  it("performer non-midi:event events are not restricted by the gate", () => {
    const reg = registryWith("OWNER");
    expect(isEventAllowed("room:join", { role: "performer", performerId: "OWNER" }, reg)).toBe(true);
    expect(isEventAllowed("anything", { role: "performer", performerId: "OTHER" }, reg)).toBe(true);
  });
});

describe("createEventGateMiddleware — forbidden path (AD-16, FR-19)", () => {
  it("listener midi:event → forbidden ack + next(err) + counter++", () => {
    const sock = fakeSocket({ role: "listener" });
    const { next, ack } = runGate(sock, registryWith(null), ["midi:event", { type: "noteOn" }]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe("forbidden");
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "forbidden" });
    expect(sock.data.forbiddenCount).toBe(1);
    expect(sock.disconnect).not.toHaveBeenCalled();
  });

  it("forbidden WITHOUT an ack does not throw (no ack to call)", () => {
    const sock = fakeSocket({ role: "listener" });
    const next = vi.fn();
    const gate = createEventGateMiddleware({
      socket: sock as unknown as Parameters<typeof createEventGateMiddleware>[0]["socket"],
      registry: registryWith(null),
    });
    // No ack appended — last element is a plain payload.
    expect(() => gate(["midi:event", { type: "noteOn" }] as unknown as Parameters<typeof gate>[0], next)).not.toThrow();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(sock.data.forbiddenCount).toBe(1);
  });

  it("listener bogus event → forbidden", () => {
    const sock = fakeSocket({ role: "listener" });
    const { next, ack } = runGate(sock, registryWith(null), ["bogus"]);
    expect((next.mock.calls[0][0] as Error).message).toBe("forbidden");
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "forbidden" });
    expect(sock.data.forbiddenCount).toBe(1);
  });

  it("performer non-owner midi:event → forbidden (defense-in-depth)", () => {
    const sock = fakeSocket({ role: "performer", performerId: "OTHER" });
    const { next, ack } = runGate(sock, registryWith("OWNER"), ["midi:event", { type: "noteOn" }]);
    expect((next.mock.calls[0][0] as Error).message).toBe("forbidden");
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "forbidden" });
    expect(sock.data.forbiddenCount).toBe(1);
  });

  it("1st and 2nd forbidden do NOT disconnect; 3rd DOES (socket.disconnect(true))", () => {
    const sock = fakeSocket({ role: "listener" });
    const reg = registryWith(null);
    runGate(sock, reg, ["midi:event"]);
    expect(sock.disconnect).not.toHaveBeenCalled();
    runGate(sock, reg, ["midi:event"]);
    expect(sock.disconnect).not.toHaveBeenCalled();
    expect(sock.data.forbiddenCount).toBe(2);
    runGate(sock, reg, ["midi:event"]);
    expect(sock.data.forbiddenCount).toBe(3);
    expect(sock.disconnect).toHaveBeenCalledTimes(1);
    expect(sock.disconnect).toHaveBeenCalledWith(true);
  });

  it("counter is per-socket: a fresh socket starts at zero (no persistent ban)", () => {
    const reg = registryWith(null);
    const a = fakeSocket({ role: "listener" });
    runGate(a, reg, ["midi:event"]);
    runGate(a, reg, ["midi:event"]);
    expect(a.data.forbiddenCount).toBe(2);
    // A NEW socket (reconnect) starts fresh — the old counter does not carry over.
    const b = fakeSocket({ role: "listener" });
    expect(b.data.forbiddenCount).toBeUndefined();
    runGate(b, reg, ["midi:event"]);
    expect(b.data.forbiddenCount).toBe(1);
    expect(b.disconnect).not.toHaveBeenCalled();
  });
});

describe("createEventGateMiddleware — allowed path", () => {
  it("listener room:join / room:leave / midi:test pass (next() no error, no ack, no count)", () => {
    const sock = fakeSocket({ role: "listener" });
    for (const ev of ["room:join", "room:leave", "midi:test"]) {
      const { next, ack } = runGate(sock, registryWith(null), [ev]);
      expect(next.mock.calls[0]).toEqual([]); // next() with NO args = allowed
      expect(ack).not.toHaveBeenCalled();
    }
    expect(sock.data.forbiddenCount).toBeUndefined();
    expect(sock.disconnect).not.toHaveBeenCalled();
  });

  it("owner performer midi:event passes (next() no error, ack untouched, count 0)", () => {
    const sock = fakeSocket({ role: "performer", performerId: "OWNER" });
    const { next, ack } = runGate(sock, registryWith("OWNER"), ["midi:event", { type: "noteOn" }]);
    expect(next.mock.calls[0]).toEqual([]); // allowed → next() with no args
    expect(ack).not.toHaveBeenCalled();
    expect(sock.data.forbiddenCount).toBeUndefined();
    expect(sock.disconnect).not.toHaveBeenCalled();
  });

  it("performer non-midi:event event passes", () => {
    const sock = fakeSocket({ role: "performer", performerId: "OWNER" });
    const { next } = runGate(sock, registryWith("OWNER"), ["room:join"]);
    expect(next.mock.calls[0]).toEqual([]);
    expect(sock.data.forbiddenCount).toBeUndefined();
  });
});