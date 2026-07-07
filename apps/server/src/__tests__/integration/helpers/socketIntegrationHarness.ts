// Story 6.5 — in-process Socket.IO integration harness (NFR-17, AD-19).
//
// Spins up the REAL server wiring (`createIoServer`) on an ephemeral port
// (`listen(0)`) inside the Vitest process, with a REAL Socket.IO client
// (`socket.io-client`) on the other side — no external server, no browser, no
// real MIDI port. The real `InMemoryRelayService` fan-out is used (NOT a spy),
// so a broadcast reaching (or NOT reaching) a joined listener is a genuine
// end-to-end integration signal, not a mocked call.
//
// Isolation: a FRESH `PerformerRegistry` + `RoomService` are constructed per
// harness (the only two module singletons) and injected, so tests never leak
// owner-slot or listener-counter state into each other. Every other service
// (ValidationService / EventGate / RateLimit / roleAuth) is per-`createIoServer`
// by construction.
//
// Cleanup is auto: `h.performer()` / `h.listener()` track the clients they
// create, and `h.close()` disconnects every tracked client, then closes the
// Socket.IO server, then closes the HTTP server — in that order. Callers just
// keep a reference to `h` and close it in `afterEach` (or rely on the test
// assigning to a module-level `h` drained in `afterEach`).
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).

import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server } from "socket.io";
import { ROOM, PROTOCOL_VERSION } from "@fmlw/shared";
import { createIoServer } from "../../../socket/index";
import { PerformerRegistry } from "../../../socket/services/PerformerRegistry";
import { RoomService } from "../../../socket/services/RoomService";

/** Allowlisted origin for the in-process server (AD-15). */
export const INTEGRATION_PUBLIC_ORIGIN = "http://localhost:8787";
/** A non-allowlisted origin used to prove the WS-upgrade gate rejects it. */
export const INTEGRATION_BAD_ORIGIN = "http://evil.example";
/** Test-only owner secret (AD-10). Server-side only — NEVER exposed to web. */
export const INTEGRATION_OWNER_SECRET = "test-owner-secret-1234567890";

export interface IntegrationHarnessOptions {
  /** Override the single allowed origin (AD-15). Defaults to the public origin. */
  publicOrigin?: string;
  /** Override the server-side owner secret. Defaults to the test secret. */
  ownerSecret?: string;
  /** Prod forces websocket-only; dev/test (default) allows polling + websocket. */
  isProd?: boolean;
  /** Per-socket rate-limit overrides (AD-13): inject a deterministic clock + a
   *  small bucket for fast, reproducible rate-limit cases. Omitted → defaults
   *  (200 burst / 100/s, `Date.now()`). */
  rateLimit?: { now?: () => number; capacity?: number; refillPerSecond?: number };
}

export interface IntegrationHarness {
  /** `http://127.0.0.1:<ephemeral-port>` clients connect to. */
  url: string;
  /** The live Socket.IO server (for server-side assertions if ever needed). */
  ioServer: Server;
  /** Fresh per-harness owner registry (slot state assertions). */
  registry: PerformerRegistry;
  /** Fresh per-harness listener counter. */
  roomService: RoomService;
  /** Connect a performer (role+token) against the allowlisted origin. Tracked
   *  for auto-cleanup. Override the secret/origin for the rejection cases. */
  performer(secret?: string, origin?: string): Promise<ClientSocket>;
  /** Connect a listener (no token) against the allowlisted origin. Tracked. */
  listener(origin?: string): Promise<ClientSocket>;
  /** Disconnect every tracked client, then close the Socket.IO + HTTP servers. */
  close(): Promise<void>;
}

/**
 * Create an in-process Socket.IO integration server on an ephemeral port. Uses
 * the REAL `createIoServer` wiring (roleAuth → eventGate → rateLimit → handlers)
 * and the REAL `InMemoryRelayService` (genuine `io.to(ROOM).emit` fan-out). No
 * core service is mocked — this is integration, not unit.
 */
export async function createIntegrationHarness(
  opts: IntegrationHarnessOptions = {},
): Promise<IntegrationHarness> {
  const registry = new PerformerRegistry();
  const roomService = new RoomService();
  const httpServer = http.createServer();
  const ioServer = createIoServer(httpServer, {
    publicOrigin: opts.publicOrigin ?? INTEGRATION_PUBLIC_ORIGIN,
    isProd: opts.isProd ?? false,
    ownerSecret: opts.ownerSecret ?? INTEGRATION_OWNER_SECRET,
    registry,
    roomService,
    ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
  });
  const port: number = await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve((httpServer.address() as AddressInfo).port));
  });
  const url = `http://127.0.0.1:${port}`;
  const clients: ClientSocket[] = [];

  function connect(auth: Record<string, unknown>, origin: string, timeoutMs = 2000): Promise<ClientSocket> {
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
        clients.push(client);
        resolve(client);
      });
      client.once("connect_error", (err) => {
        clearTimeout(timer);
        client.disconnect();
        reject(err);
      });
    });
  }

  return {
    url,
    ioServer,
    registry,
    roomService,
    performer: (secret, origin) =>
      connect({ role: "performer", token: secret ?? INTEGRATION_OWNER_SECRET }, origin ?? INTEGRATION_PUBLIC_ORIGIN),
    listener: (origin) => connect({ role: "listener" }, origin ?? INTEGRATION_PUBLIC_ORIGIN),
    async close() {
      // Disconnect clients first so the server's disconnect handlers fire
      // against a still-live io, then tear the servers down.
      for (const client of clients) {
        await closeClient(client);
      }
      clients.length = 0;
      await new Promise<void>((r) => ioServer.close(() => r()));
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

// ---- client-side helpers (pure, not bound to a harness) -------------------

/** Disconnect a client and resolve once its `disconnect` event fires. */
export function closeClient(client: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    client.once("disconnect", finish);
    client.disconnect();
    // Fallback in case disconnect fires before the listener attaches.
    setTimeout(finish, 200);
  });
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve with the first payload of `event` from `client`, or reject on timeout. */
export function onceEvent<T>(client: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Emit `event` with an ack callback; resolves to the ack response. */
export function emitWithAck<T>(client: ClientSocket, event: string, payload: unknown, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ack: ${event}`)), timeoutMs);
    client.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

/**
 * Assert `client` does NOT receive `event` within `ms`. Resolves if the quiet
 * window elapses with no event; rejects if one arrives (proving an unwanted
 * broadcast leaked through). This is the real-fan-out "no broadcast" signal:
 * instead of mocking the relay, a joined listener simply observes silence.
 */
export function expectNoEvent(client: ClientSocket, event: string, ms = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      clearTimeout(timer);
      client.off(event, onEvent);
      reject(new Error(`unexpected ${event} received within ${ms}ms`));
    };
    const timer = setTimeout(() => {
      client.off(event, onEvent);
      resolve();
    }, ms);
    client.on(event, onEvent);
  });
}

// ---- wire-shape helpers ----------------------------------------------------

/** A full valid noteOn wire event (the real handler validates strictly). */
export function midiEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
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