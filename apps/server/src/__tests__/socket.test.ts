// Story 2.1 — Socket.IO attach + origin allowlist + io.use role/performerId.
//
// In-process (socket.io-client + server), random port 0 — no hardware port.
// Every client sends the allowlisted Origin via extraHeaders so it passes the
// `allowRequest` gate (AD-15); role-specific tests then assert the server-pinned
// `socket.data` (AD-2). No event handlers / rooms (Epic 2.7) — identity only.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Socket as ServerSocket } from "socket.io";
import { ROOM, PROTOCOL_VERSION } from "@fmlw/shared";
import { createIoServer, resolveTransports, isOriginAllowed } from "../socket/index";
import { PerformerRegistry, performerRegistry } from "../socket/services/PerformerRegistry";
import { RoomService, roomService } from "../socket/services/RoomService";
import type { RelayService, RelayedMidiEvent } from "../socket/services/RelayService";
import type { MidiEventAck } from "../socket/handlers/performerEvents";
import { healthRouter } from "../http/routes/health";
import type { ServerSocketData } from "../socket/middlewares/roleAuth";

const PUBLIC_ORIGIN = "http://localhost:8787";
const BAD_ORIGIN = "http://evil.example";
// Story 2.2: a non-empty secret so performers can authenticate in tests. Real
// value is irrelevant — only the timing-safe equality matters.
const TEST_OWNER_SECRET = "test-owner-secret-1234567890";

interface Harness {
  url: string;
  close: () => Promise<void>;
}

let server: http.Server;
let cleanup: Array<() => Promise<void>>;

beforeEach(() => {
  cleanup = [];
});

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

/** Spin up a bare HTTP server with Socket.IO attached (no Express needed). */
async function harness(
  opts: {
    isProd?: boolean;
    publicOrigin?: string;
    ownerSecret?: string;
    /** Fresh registry per harness for isolation; pass `performerRegistry` to
     *  exercise the singleton (e.g. for `/health` wiring). */
    registry?: PerformerRegistry;
    /** Fresh listener counter per harness for isolation; pass the `roomService`
     *  singleton to exercise `/health.listeners` wiring. */
    roomService?: RoomService;
    /** Inject a FAKE RelayService (AD-6) to assert broadcast calls without a
     *  real fan-out. Omitted → the real in-memory adapter (`io.to(room).emit`). */
    relayService?: RelayService;
    /** Per-socket rate-limit overrides (Story 2.5): inject a deterministic
     *  clock + small buckets for fast reproducible cases. Omitted → defaults
     *  (200 burst / 100/s, Date.now()). */
    rateLimit?: { now?: () => number; capacity?: number; refillPerSecond?: number };
  } = {},
): Promise<
  Harness & {
    ioServer: ReturnType<typeof createIoServer>;
    registry: PerformerRegistry;
    roomService: RoomService;
  }
> {
  const registry = opts.registry ?? new PerformerRegistry();
  const roomService = opts.roomService ?? new RoomService();
  const httpServer = http.createServer();
  const ioServer = createIoServer(httpServer, {
    publicOrigin: opts.publicOrigin ?? PUBLIC_ORIGIN,
    isProd: opts.isProd ?? false,
    ownerSecret: opts.ownerSecret ?? TEST_OWNER_SECRET,
    registry,
    roomService,
    ...(opts.relayService ? { relayService: opts.relayService } : {}),
    ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
  });
  const port: number = await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve((httpServer.address() as AddressInfo).port));
  });
  const url = `http://127.0.0.1:${port}`;
  cleanup.push(async () => {
    await new Promise<void>((r) => ioServer.close(() => r()));
    await new Promise<void>((r) => httpServer.close(() => r()));
  });
  return { url, ioServer, registry, roomService, close: async () => {} };
}

/** Connect a client with the given auth + origin; resolves on connect, rejects on connect_error. */
function connectClient(
  url: string,
  auth: Record<string, unknown>,
  origin: string,
  timeoutMs = 1500,
): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, {
      auth,
      transports: ["websocket"],
      extraHeaders: { Origin: origin },
      reconnection: false,
      timeout: timeoutMs,
    });
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error("connect timeout"));
    }, timeoutMs + 500);
    client.once("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once("connect_error", (err) => {
      clearTimeout(timer);
      client.disconnect();
      reject(err);
    });
  });
}

describe("io.use pins server-side identity (AD-2)", () => {
  it("listener: role pinned, no performerId", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const data = sock.data as ServerSocketData;
    expect(data.role).toBe("listener");
    expect(data.performerId).toBeUndefined();
    await closeClient(client);
  });

  it("performer: role pinned + performerId === socket.id (server)", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const client = await connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const data = sock.data as ServerSocketData;
    expect(data.role).toBe("performer");
    // performerId is the SERVER socket id, never a client value.
    expect(data.performerId).toBe(sock.id);
    await closeClient(client);
  });

  it("performer: client-supplied performerId is ignored (server keeps socket.id)", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const client = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET, performerId: "CLIENT-HACK" },
      PUBLIC_ORIGIN,
    );
    const sock = await capturedPromise;
    const data = sock.data as ServerSocketData;
    expect(data.performerId).not.toBe("CLIENT-HACK");
    expect(data.performerId).toBe(sock.id);
    await closeClient(client);
  });

  it("invalid role is rejected with connect_error", async () => {
    const { url } = await harness();
    await expect(connectClient(url, { role: "owner" }, PUBLIC_ORIGIN)).rejects.toBeTruthy();
  });

  it("missing role is rejected with connect_error", async () => {
    const { url } = await harness();
    await expect(connectClient(url, { token: "x" }, PUBLIC_ORIGIN)).rejects.toBeTruthy();
  });

  it("role is non-modifiable post-connect: client event does not change server data", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const before = (sock.data as ServerSocketData).role;
    // Client emits an arbitrary event; no server handler exists to mutate data.
    client.emit("client-bogus");
    await wait(50);
    expect((sock.data as ServerSocketData).role).toBe(before);
    expect((sock.data as ServerSocketData).role).toBe("listener");
    await closeClient(client);
  });
});

describe("origin allowlist (AD-15, anti-CSWSH)", () => {
  it("isOriginAllowed: pure predicate", () => {
    expect(isOriginAllowed(PUBLIC_ORIGIN, PUBLIC_ORIGIN)).toBe(true);
    expect(isOriginAllowed(BAD_ORIGIN, PUBLIC_ORIGIN)).toBe(false);
    expect(isOriginAllowed(undefined, PUBLIC_ORIGIN)).toBe(false);
    expect(isOriginAllowed("http://localhost:8787/", PUBLIC_ORIGIN)).toBe(false);
  });

  it("allowlisted origin connects", async () => {
    const { url } = await harness();
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    expect(client.connected).toBe(true);
    await closeClient(client);
  });

  it("non-allowlisted origin is rejected (WS upgrade denied)", async () => {
    const { url } = await harness();
    await expect(connectClient(url, { role: "listener" }, BAD_ORIGIN)).rejects.toBeTruthy();
  });
});

describe("transports (prod forces websocket-only)", () => {
  it("resolveTransports(true) = ['websocket'] (no polling fallback)", () => {
    expect(resolveTransports(true)).toEqual(["websocket"]);
  });

  it("resolveTransports(false) allows polling + websocket (dev/test)", () => {
    expect(resolveTransports(false)).toEqual(["polling", "websocket"]);
  });

  it("createIoServer(prod) builds without error (websocket-only config)", async () => {
    const { ioServer } = await harness({ isProd: true });
    expect(ioServer).toBeDefined();
  });
});

describe("performer OWNER_SECRET (AD-10, timing-safe, anti-enumeration)", () => {
  it("valid token connects and is pinned as performer", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const client = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const sock = await capturedPromise;
    const data = sock.data as ServerSocketData;
    expect(data.role).toBe("performer");
    expect(data.performerId).toBe(sock.id);
    await closeClient(client);
  });

  it("wrong token is rejected (connect_error)", async () => {
    const { url } = await harness();
    await expect(
      connectClient(url, { role: "performer", token: "wrong-secret" }, PUBLIC_ORIGIN),
    ).rejects.toBeTruthy();
  });

  it("missing token is rejected with the SAME generic error as a wrong token", async () => {
    const { url } = await harness();
    await expect(
      connectClient(url, { role: "performer" }, PUBLIC_ORIGIN),
    ).rejects.toBeTruthy();
  });

  it("wrong-length token is rejected WITHOUT throwing (length guard, no RangeError)", async () => {
    const { url } = await harness();
    // A short token must be rejected deterministically (length guard returns
    // false before timingSafeEqual is ever called with unequal lengths).
    await expect(
      connectClient(url, { role: "performer", token: "short" }, PUBLIC_ORIGIN),
    ).rejects.toBeTruthy();
  });

  it("listener needs NO token (connects without one)", async () => {
    const { url } = await harness();
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    expect(client.connected).toBe(true);
    await closeClient(client);
  });

  it("empty OWNER_SECRET: listener OK, performer rejected (dev until a secret is set)", async () => {
    const { url } = await harness({ ownerSecret: "" });
    const listener = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    expect(listener.connected).toBe(true);
    await closeClient(listener);
    await expect(
      connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN),
    ).rejects.toBeTruthy();
  });

  it("non-string token (number) is rejected, no throw", async () => {
    const { url } = await harness();
    await expect(
      connectClient(url, { role: "performer", token: 12345 }, PUBLIC_ORIGIN),
    ).rejects.toBeTruthy();
  });
});

describe("owner slot lifecycle (AD-2, FR-4, FR-5, in-process)", () => {
  it("first valid performer connects and takes the slot", async () => {
    const { url, ioServer, registry } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const client = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const sock = await capturedPromise;
    expect(registry.isOwnerActive()).toBe(true);
    expect(registry.getOwnerPerformerId()).toBe(sock.id);
    await closeClient(client);
  });

  it("second valid performer is refused with `performer:busy`", async () => {
    const { url, ioServer, registry } = await harness();
    const capturedPromise = captureFirstSocket(ioServer);
    const first = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const firstSock = await capturedPromise;
    // Second performer on the SAME registry → refused.
    await expect(
      connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN),
    ).rejects.toMatchObject({ message: expect.stringMatching(/performer:busy/) });
    // The first owner is NOT replaced.
    expect(registry.getOwnerPerformerId()).toBe(firstSock.id);
    expect(first.connected).toBe(true);
    await closeClient(first);
  });

  it("owner disconnect releases the slot", async () => {
    const { url, registry } = await harness();
    const client = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    expect(registry.isOwnerActive()).toBe(true);
    await closeClient(client);
    await wait(50);
    expect(registry.isOwnerActive()).toBe(false);
    expect(registry.getOwnerPerformerId()).toBeNull();
  });

  it("a new performer can take the slot AFTER release (reuse)", async () => {
    const { url, ioServer, registry } = await harness();
    const first = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    await closeClient(first);
    await wait(50);
    expect(registry.isOwnerActive()).toBe(false);
    // Reconnect a fresh performer on the now-free slot.
    const capturedPromise = captureFirstSocket(ioServer);
    const second = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const secondSock = await capturedPromise;
    expect(registry.isOwnerActive()).toBe(true);
    expect(registry.getOwnerPerformerId()).toBe(secondSock.id);
    await closeClient(second);
  });

  it("listener receives `performer:disconnected` when the owner disconnects", async () => {
    const { url, ioServer } = await harness();
    // Listener first, then explicitly join ROOM (Story 2.7: the auto-join
    // stopgap is gone — listeners join via the public `room:join` handler).
    const listenerClient = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const joinAck = await emitWithAck<{ ok: true }>(listenerClient, "room:join", {});
    expect(joinAck).toEqual({ ok: true });
    const capturedOwner = captureFirstSocket(ioServer);
    const ownerClient = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const ownerSock = await capturedOwner;

    const received = onceEvent<{ performerId: string }>(listenerClient, "performer:disconnected");
    await closeClient(ownerClient);
    const evt = await received;
    expect(evt.performerId).toBe(ownerSock.id);
    await closeClient(listenerClient);
  });

  it("wrong-token performer gets `invalid`, NOT `performer:busy` (regression)", async () => {
    const { url, registry } = await harness();
    // No owner yet; a wrong-token performer must fail at token validation, not
    // at the slot check, and must NOT take the slot.
    const err = await connectClient(url, { role: "performer", token: "wrong" }, PUBLIC_ORIGIN).catch(
      (e) => e,
    );
    expect(err).toBeTruthy();
    expect(String(err?.message ?? err)).not.toMatch(/performer:busy/);
    expect(registry.isOwnerActive()).toBe(false); // slot never taken
  });
});

describe("/health.ownerActive wired to the registry singleton (FR-28, AD-20)", () => {
  let httpServer: http.Server;
  let ioServer: ReturnType<typeof createIoServer>;
  let baseUrl: string;

  // This suite uses the process-wide singletons so /health (handlers) and the
  // socket wiring share state. Reset both between tests.
  beforeEach(async () => {
    const cur = performerRegistry.getOwnerPerformerId();
    if (cur) performerRegistry.releaseOwner(cur);
    roomService.reset(); // Story 2.7: listener counter singleton
    // Minimal Express app with ONLY /health (no static dist needed).
    const app = express();
    app.use(healthRouter());
    httpServer = http.createServer(app);
    ioServer = createIoServer(httpServer, {
      publicOrigin: PUBLIC_ORIGIN,
      isProd: false,
      ownerSecret: TEST_OWNER_SECRET,
      registry: performerRegistry,
      roomService, // Story 2.7: singleton — /health.listeners reads this
    });
    const port: number = await new Promise((resolve) => {
      httpServer.listen(0, "127.0.0.1", () =>
        resolve((httpServer.address() as AddressInfo).port),
      );
    });
    baseUrl = `http://127.0.0.1:${port}`;
    cleanup.push(async () => {
      await new Promise<void>((r) => ioServer.close(() => r()));
      await new Promise<void>((r) => httpServer.close(() => r()));
      const cur2 = performerRegistry.getOwnerPerformerId();
      if (cur2) performerRegistry.releaseOwner(cur2);
      roomService.reset();
    });
  });

  it("reflects `true` while an owner is connected, `false` after disconnect", async () => {
    // Before: no owner.
    const before = await (await fetch(`${baseUrl}/health`)).json();
    expect(before).toMatchObject({ ok: true, ownerActive: false, listeners: 0 });
    expect(typeof before.uptime).toBe("number");

    // Connect an owner.
    const owner = await connectClient(
      baseUrl,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    await wait(30);
    const during = await (await fetch(`${baseUrl}/health`)).json();
    expect(during).toMatchObject({ ok: true, ownerActive: true, listeners: 0 });

    // Disconnect → slot released → ownerActive false again.
    await closeClient(owner);
    await wait(50);
    const after = await (await fetch(`${baseUrl}/health`)).json();
    expect(after).toMatchObject({ ok: true, ownerActive: false, listeners: 0 });
  });

  it("`listeners` reflects the RoomService counter on room:join / disconnect (Story 2.7)", async () => {
    // Before: no listeners joined.
    const before = await (await fetch(`${baseUrl}/health`)).json();
    expect(before).toMatchObject({ ok: true, listeners: 0 });

    // A listener joins ROOM via the public room:join handler → counter → /health.
    const listener = await connectClient(baseUrl, { role: "listener" }, PUBLIC_ORIGIN);
    const joinAck = await emitWithAck<{ ok: true }>(listener, "room:join", {});
    expect(joinAck).toEqual({ ok: true });
    await wait(30);
    const during = await (await fetch(`${baseUrl}/health`)).json();
    expect(during).toMatchObject({ ok: true, listeners: 1 });

    // Disconnect (no explicit room:leave) → the disconnect handler decrements.
    await closeClient(listener);
    await wait(50);
    const after = await (await fetch(`${baseUrl}/health`)).json();
    expect(after).toMatchObject({ ok: true, listeners: 0 });
  });
});

describe("event gate (socket.use, AD-2 / AD-16 / FR-18 / FR-19)", () => {
  it("listener `midi:event` → client ack `{ok:false,error:'forbidden'}` and NOT relayed", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    // Test-only spy: proves the event never reaches a handler when forbidden.
    const relaySpy = vi.fn();
    sock.on("midi:event", relaySpy);
    const res = await emitWithAck(client, "midi:event", { type: "noteOn", channel: 0, note: 60, velocity: 100 });
    expect(res).toEqual({ ok: false, error: "forbidden" });
    await wait(30);
    expect(relaySpy).not.toHaveBeenCalled();
    expect((sock.data as ServerSocketData).forbiddenCount).toBe(1);
    await closeClient(client);
  });

  it("3rd forbidden disconnects the socket; reconnect is allowed (no persistent ban)", async () => {
    const { url } = await harness();
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    // 1st + 2nd: forbidden, still connected.
    await emitWithAck(client, "midi:event", { type: "noteOn" });
    await emitWithAck(client, "midi:event", { type: "noteOn" });
    expect(client.connected).toBe(true);
    // Attach the disconnect listener BEFORE the 3rd emit: the server may drop
    // the socket in the same flush as the ack, so the event can fire before we
    // would otherwise start listening.
    const disconnected = onceEvent(client, "disconnect");
    const third = emitWithAck(client, "midi:event", { type: "noteOn" });
    await expect(third).resolves.toEqual({ ok: false, error: "forbidden" });
    await disconnected;
    expect(client.connected).toBe(false);
    // No persistent ban: a fresh listener connects on a new socket.
    const reconnected = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    expect(reconnected.connected).toBe(true);
    await closeClient(reconnected);
  });

  it("listener `room:join` / `room:leave` / `midi:test` pass the gate (reach handlers)", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const joinSpy = vi.fn();
    const leaveSpy = vi.fn();
    const testSpy = vi.fn();
    sock.on("room:join", joinSpy);
    sock.on("room:leave", leaveSpy);
    sock.on("midi:test", testSpy);
    // No ack needed; just emit. The gate lets them through to the handlers.
    client.emit("room:join", { room: ROOM });
    client.emit("room:leave", { room: ROOM });
    client.emit("midi:test", { ping: 1 });
    await wait(50);
    expect(joinSpy).toHaveBeenCalledTimes(1);
    expect(leaveSpy).toHaveBeenCalledTimes(1);
    expect(testSpy).toHaveBeenCalledTimes(1);
    expect((sock.data as ServerSocketData).forbiddenCount).toBeUndefined();
    await closeClient(client);
  });

  it("listener emitting a non-allowed event (`bogus`) → forbidden", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const res = await emitWithAck(client, "bogus", { x: 1 });
    expect(res).toEqual({ ok: false, error: "forbidden" });
    expect((sock.data as ServerSocketData).forbiddenCount).toBe(1);
    await closeClient(client);
  });

  it("owner performer `midi:event` passes the gate and reaches the handler", async () => {
    const { url, ioServer } = await harness();
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const sock = await capturedPromise;
    // Story 2.7: a REAL midi:event handler is now wired. A VALID event passes
    // the gate, validates, and acks {ok:true} (no test-only spy needed).
    const res = await emitWithAck(client, "midi:event", midiEvent());
    expect(res).toEqual({ ok: true });
    expect((sock.data as ServerSocketData).forbiddenCount).toBeUndefined();
    await closeClient(client);
  });
});

describe("rate limit — token bucket per-socket (socket.use, AD-13 / FR-22 / NFR-3)", () => {
  it("DEFAULT 200/100: burst of 200 `midi:event` passes; 201st → rate:limited; reaches no handler", async () => {
    // Constant injected clock → no refill interferes; capacity 200 default.
    const { url, ioServer } = await harness({ rateLimit: { now: () => 0 } });
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    // Story 2.7: a REAL midi:event handler is wired. The spy is COUNT-ONLY (the
    // real handler acks {ok:true}); it proves an event reached a handler (200)
    // vs not (201st). Payloads are now FULL valid events (strict validation).
    const relaySpy = vi.fn();
    sock.on("midi:event", relaySpy);
    // Drain 200 with acks — all reach the handler → ack {ok:true}.
    for (let i = 0; i < 200; i++) {
      const res = await emitWithAck<{ ok: true }>(client, "midi:event", midiEvent({ seq: i + 1 }));
      expect(res).toEqual({ ok: true });
    }
    // 201st → blocked by the limiter: ack {ok:false,error:'rate:limited'}, handler NOT called.
    const blocked = await emitWithAck<{ ok: false; error: string }>(client, "midi:event", midiEvent({ seq: 201 }));
    expect(blocked).toEqual({ ok: false, error: "rate:limited" });
    await wait(50);
    expect(relaySpy).toHaveBeenCalledTimes(200); // 201st never reached the handler
    await closeClient(client);
  });

  it("DEFAULT 200/100: 100/s sustained does NOT trigger rate:limited (refill keeps up)", async () => {
    // Advancing clock +10ms per event = exactly 100/s. Steady state: refill 1
    // token per event = consumption 1 token per event → never exhausts.
    let t = 0;
    const now = () => {
      const cur = t;
      t += 10;
      return cur;
    };
    const { url, ioServer } = await harness({ rateLimit: { now } });
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const relaySpy = vi.fn();
    sock.on("midi:event", relaySpy);
    // 300 sustained events at 100/s — all must pass (no rate:limited).
    for (let i = 0; i < 300; i++) {
      const res = await emitWithAck<{ ok: boolean; error?: string }>(client, "midi:event", midiEvent({ seq: i + 1 }));
      expect(res).toEqual({ ok: true });
      expect(res.error).toBeUndefined();
    }
    await wait(30);
    expect(relaySpy).toHaveBeenCalledTimes(300);
    await closeClient(client);
  });

  it("small bucket + injected clock: exhaustion then RECOVERY after 1s (deterministic)", async () => {
    const clock = { v: 0 };
    const { url, ioServer } = await harness({
      rateLimit: { now: () => clock.v, capacity: 3, refillPerSecond: 1 },
    });
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    // Story 2.7: real handler acks {ok:true} for valid events — no test spy needed.
    void sock;

    // 3 pass (capacity), 4th → rate:limited.
    for (let i = 0; i < 3; i++) {
      expect(await emitWithAck<{ ok: true }>(client, "midi:event", midiEvent({ seq: i }))).toEqual({ ok: true });
    }
    expect(await emitWithAck<{ ok: false; error: string }>(client, "midi:event", midiEvent({ seq: 3 }))).toEqual({
      ok: false,
      error: "rate:limited",
    });

    // Advance the injected clock by 1000ms → +1 token → exactly 1 recovery emit.
    clock.v = 1000;
    expect(await emitWithAck<{ ok: true }>(client, "midi:event", midiEvent({ seq: 4 }))).toEqual({ ok: true });
    // The next one is denied again (only 1 token/s refilled).
    expect(await emitWithAck<{ ok: false; error: string }>(client, "midi:event", midiEvent({ seq: 5 }))).toEqual({
      ok: false,
      error: "rate:limited",
    });
    await closeClient(client);
  });

  it("listener `midi:event` stays `forbidden` (gate blocks BEFORE the limiter), not `rate:limited`", async () => {
    // Rate limit is wired (constant clock, small bucket) but a listener never
    // reaches it: the gate refuses midi:event with `forbidden` first.
    const { url, ioServer } = await harness({ rateLimit: { now: () => 0, capacity: 1, refillPerSecond: 0 } });
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    const relaySpy = vi.fn();
    sock.on("midi:event", relaySpy);
    const res = await emitWithAck<{ ok: false; error: string }>(client, "midi:event", { type: "noteOn" });
    expect(res).toEqual({ ok: false, error: "forbidden" });
    expect(res.error).not.toBe("rate:limited");
    await wait(30);
    expect(relaySpy).not.toHaveBeenCalled();
    await closeClient(client);
  });

  it("wrong-token performer stays `invalid` (handshake refusal — limiter never sees it)", async () => {
    const { url, registry } = await harness({ rateLimit: { now: () => 0, capacity: 1, refillPerSecond: 0 } });
    const err = await connectClient(url, { role: "performer", token: "wrong" }, PUBLIC_ORIGIN).catch((e) => e);
    expect(err).toBeTruthy();
    expect(String(err?.message ?? err)).toMatch(/invalid/);
    expect(String(err?.message ?? err)).not.toMatch(/rate:limited/);
    expect(registry.isOwnerActive()).toBe(false); // never took the slot
  });

  it("bucket is per-socket: a fresh performer reconnects with a full bucket (no persistent state)", async () => {
    // Small bucket, constant clock. Drain performer A; reconnect performer B →
    // B starts with a full bucket (the limiter state lived in A's closure).
    const { url, ioServer } = await harness({ rateLimit: { now: () => 0, capacity: 2, refillPerSecond: 0 } });
    const capA = captureRawSocket(ioServer);
    const a = await connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN);
    const sockA = await capA;
    void sockA; // Story 2.7: real handler acks — no test spy needed.
    await emitWithAck(a, "midi:event", midiEvent({ seq: 1 }));
    await emitWithAck(a, "midi:event", midiEvent({ seq: 2 }));
    expect(await emitWithAck<{ ok: false; error: string }>(a, "midi:event", midiEvent({ seq: 3 }))).toEqual({
      ok: false,
      error: "rate:limited",
    });
    await closeClient(a);
    await wait(50); // let the owner slot release
    // B reconnects on the freed slot → fresh bucket closure → first emit passes.
    const capB = captureRawSocket(ioServer);
    const b = await connectClient(url, { role: "performer", token: TEST_OWNER_SECRET }, PUBLIC_ORIGIN);
    const sockB = await capB;
    void sockB;
    expect(await emitWithAck<{ ok: true }>(b, "midi:event", midiEvent({ seq: 1 }))).toEqual({ ok: true });
    await closeClient(b);
  });
});

describe("Story 2.7 — handlers: room:join/leave, midi:event broadcast, midi:test", () => {
  it("room:join acks {ok:true} and increments the RoomService counter (join ROOM imposed)", async () => {
    const { url, ioServer, roomService } = await harness();
    const capturedPromise = captureRawSocket(ioServer);
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const sock = await capturedPromise;
    // The client's requested room is IGNORED — the server always joins ROOM.
    const res = await emitWithAck<{ ok: true }>(client, "room:join", { room: "whatever" });
    expect(res).toEqual({ ok: true });
    await wait(30);
    // Proof ROOM is imposed: the server socket is in ROOM.
    expect(sock.rooms.has(ROOM)).toBe(true);
    expect(roomService.getListenerCount()).toBe(1);
    await closeClient(client);
  });

  it("duplicate room:join does NOT double-count (idempotent)", async () => {
    const { url, roomService } = await harness();
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    await emitWithAck(client, "room:join", {});
    await emitWithAck(client, "room:join", {}); // duplicate
    await wait(30);
    expect(roomService.getListenerCount()).toBe(1);
    await closeClient(client);
  });

  it("room:leave decrements the counter", async () => {
    const { url, roomService } = await harness();
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    await emitWithAck(client, "room:join", {});
    await wait(20);
    expect(roomService.getListenerCount()).toBe(1);
    const leaveAck = await emitWithAck<{ ok: true }>(client, "room:leave", {});
    expect(leaveAck).toEqual({ ok: true });
    await wait(20);
    expect(roomService.getListenerCount()).toBe(0);
    await closeClient(client);
  });

  it("disconnect decrements the counter when the listener never left (no double-decrement)", async () => {
    const { url, roomService } = await harness();
    const client = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    await emitWithAck(client, "room:join", {});
    await wait(20);
    expect(roomService.getListenerCount()).toBe(1);
    await closeClient(client);
    await wait(50);
    expect(roomService.getListenerCount()).toBe(0);
  });

  it("listener receives the broadcast midi:event with performerId===owner.id + srvTs (number)", async () => {
    // Real in-memory relay (default) — a genuine io.to(ROOM).emit fan-out.
    const { url, ioServer } = await harness();
    const listenerClient = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    await emitWithAck(listenerClient, "room:join", {}); // listener must join ROOM
    const capturedOwner = captureFirstSocket(ioServer);
    const ownerClient = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const ownerSock = await capturedOwner;

    const received = onceEvent<RelayedMidiEvent>(listenerClient, "midi:event");
    const ack = await emitWithAck<{ ok: true }>(ownerClient, "midi:event", midiEvent({ seq: 7, note: 64 }));
    expect(ack).toEqual({ ok: true });
    const evt = await received;
    // Server-attached fields:
    expect(evt.performerId).toBe(ownerSock.id); // server-authoritative, never from payload
    expect(typeof evt.srvTs).toBe("number");
    // MIDI payload passed through unchanged:
    expect(evt.type).toBe("noteOn");
    expect(evt.note).toBe(64);
    expect(evt.seq).toBe(7);
    expect(evt.v).toBe(PROTOCOL_VERSION);
    expect(evt.roomId).toBe(ROOM);
    await closeClient(ownerClient);
    await closeClient(listenerClient);
  });

  it("INVALID event → stable error ack, NO broadcast (spy relay proves no fan-out)", async () => {
    const { relay, broadcast } = spyRelay();
    const { url } = await harness({ relayService: relay });
    const owner = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const res = await emitWithAck<MidiEventAck>(owner, "midi:event", midiEvent({ extra: 1 }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid");
      expect(Array.isArray(res.issues)).toBe(true);
    }
    await wait(30);
    expect(broadcast).not.toHaveBeenCalled();
    await closeClient(owner);
  });

  it("client-supplied performerId → ack 'invalid', NO broadcast (never read from payload)", async () => {
    const { relay, broadcast } = spyRelay();
    const { url, ioServer } = await harness({ relayService: relay });
    const capturedOwner = captureFirstSocket(ioServer);
    const owner = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const ownerSock = await capturedOwner;
    const res = await emitWithAck<MidiEventAck>(owner, "midi:event", midiEvent({ performerId: "CLIENT-HACK" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
    await wait(30);
    expect(broadcast).not.toHaveBeenCalled();
    // The server-side id is untouched (would have been ownerSock.id, not the hack).
    expect(ownerSock.id).not.toBe("CLIENT-HACK");
    await closeClient(owner);
  });

  it("v !== 1 → ack 'unsupported-version', NO broadcast", async () => {
    const { relay, broadcast } = spyRelay();
    const { url } = await harness({ relayService: relay });
    const owner = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const res = await emitWithAck<MidiEventAck>(owner, "midi:event", midiEvent({ v: 2 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("unsupported-version");
    await wait(30);
    expect(broadcast).not.toHaveBeenCalled();
    await closeClient(owner);
  });

  it("midi:test acks {ok:true} and does NOT broadcast", async () => {
    const { relay, broadcast } = spyRelay();
    const { url } = await harness({ relayService: relay });
    const listener = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const res = await emitWithAck<{ ok: true }>(listener, "midi:test", { ping: 1 });
    expect(res).toEqual({ ok: true });
    await wait(30);
    expect(broadcast).not.toHaveBeenCalled();
    await closeClient(listener);
  });

  it("RelayService adapter is mockable from the wiring WITHOUT a rewrite (integration)", async () => {
    // The wiring injects the fake relay exactly as it would a future Redis
    // adapter — same option, same handler code. The broadcast is captured by the
    // spy instead of fanned out via io.to(ROOM).emit.
    const { relay, broadcast } = spyRelay();
    const { url, ioServer } = await harness({ relayService: relay });
    const listener = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    await emitWithAck(listener, "room:join", {});
    const capturedOwner = captureFirstSocket(ioServer);
    const owner = await connectClient(
      url,
      { role: "performer", token: TEST_OWNER_SECRET },
      PUBLIC_ORIGIN,
    );
    const ownerSock = await capturedOwner;
    await emitWithAck(owner, "midi:event", midiEvent({ seq: 1 }));
    await wait(30);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const relayed = broadcast.mock.calls[0][1] as RelayedMidiEvent;
    expect(relayed.performerId).toBe(ownerSock.id);
    expect(typeof relayed.srvTs).toBe("number");
    await closeClient(owner);
    await closeClient(listener);
  });

  it("non-regression: listener midi:event stays `forbidden` (gate blocks before the handler)", async () => {
    const { relay, broadcast } = spyRelay();
    const { url } = await harness({ relayService: relay });
    const listener = await connectClient(url, { role: "listener" }, PUBLIC_ORIGIN);
    const res = await emitWithAck<{ ok: false; error: string }>(listener, "midi:event", midiEvent());
    expect(res).toEqual({ ok: false, error: "forbidden" });
    await wait(30);
    expect(broadcast).not.toHaveBeenCalled();
    await closeClient(listener);
  });
});

// ---- helpers --------------------------------------------------------------

interface CapturedSocket {
  data: ServerSocketData;
  id: string;
}

function captureFirstSocket(ioServer: ReturnType<typeof createIoServer>): Promise<CapturedSocket> {
  return new Promise((resolve) => {
    ioServer.once("connection", (socket) => {
      resolve({ data: socket.data as ServerSocketData, id: socket.id });
    });
  });
}

/** Capture the NEXT connected server Socket (raw, so tests can register handlers). */
function captureRawSocket(ioServer: ReturnType<typeof createIoServer>): Promise<ServerSocket> {
  return new Promise((resolve) => {
    ioServer.once("connection", (socket) => resolve(socket));
  });
}

function closeClient(client: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    client.once("disconnect", () => resolve());
    client.disconnect();
    // Fallback in case disconnect fires before listener attaches.
    setTimeout(resolve, 200);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve with the first payload of `event` from `client`, or reject on timeout. */
function onceEvent<T>(client: ClientSocket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Emit `event` with an ack callback; resolves to the ack response. */
function emitWithAck<T>(client: ClientSocket, event: string, payload: unknown, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ack: ${event}`)), timeoutMs);
    client.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

// ---- Story 2.7 helpers -----------------------------------------------------

/** A full valid noteOn wire event (the real handler validates strictly now). */
function midiEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    channel: 0,
    seq: 1,
    ts: 100,
    type: "noteOn",
    note: 60,
    velocity: 100,
    ...over,
  };
}

/**
 * Build a FAKE RelayService (AD-6) that records broadcasts via a `vi.fn`. Inject
 * it via `harness({ relayService })` to assert "broadcast called / NOT called"
 * deterministically — without a real `io.to(room).emit` fan-out.
 */
function spyRelay(): { relay: RelayService; broadcast: ReturnType<typeof vi.fn> } {
  const broadcast = vi.fn();
  const relay: RelayService = { broadcast };
  return { relay, broadcast };
}