// Story 6.8 — graceful shutdown integration tests (NFR-19).
//
// Spins up a REAL `createIoServer` on an ephemeral port (`listen(0)`) inside the
// Vitest process with a REAL `socket.io-client` listener connected, then calls
// `gracefulShutdown` directly with `exit: false` and asserts:
//   - the connected client receives `disconnect` (the existing Story 5.5
//     server-down path — no new client event is introduced),
//   - the HTTP server is closed (new connections refused),
//   - the result is `{ closed: true, timedOut: false }`.
// A timeout-path test holds a raw TCP socket open + a never-resolving fake io
// to assert the hard timeout resolves `{ closed: false, timedOut: true }`.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { createIoServer } from "../socket/index";
import { PerformerRegistry } from "../socket/services/PerformerRegistry";
import { RoomService } from "../socket/services/RoomService";
import { gracefulShutdown, installShutdownHandlers, type GracefulIo } from "../app/shutdown";
import { createLogger } from "../shared/logger";

const ORIGIN = "http://localhost:8787";
const SECRET = "test-owner-secret-1234567890";
const logger = createLogger("shutdown-test");

interface Built {
  server: http.Server;
  io: ReturnType<typeof createIoServer>;
  url: string;
}

async function buildServer(): Promise<Built> {
  const registry = new PerformerRegistry();
  const roomService = new RoomService();
  const server = http.createServer();
  const io = createIoServer(server, {
    publicOrigin: ORIGIN,
    isProd: false,
    ownerSecret: SECRET,
    registry,
    roomService,
  });
  const port: number = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
  return { server, io, url: `http://127.0.0.1:${port}` };
}

function connectListener(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, {
      auth: { role: "listener" },
      transports: ["websocket"],
      extraHeaders: { Origin: ORIGIN },
      reconnection: false,
      timeout: 2000,
    });
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error("connect timeout"));
    }, 2500);
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

/** Open a raw TCP socket to the listening port and keep it open (holds the
 *  HTTP server's `close` callback so the timeout branch can be exercised). */
function holdRawSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
}

const built: Built[] = [];

async function newServer(): Promise<Built> {
  const b = await buildServer();
  built.push(b);
  return b;
}

afterEach(async () => {
  for (const b of built.splice(0)) {
    try {
      b.io.close();
    } catch {
      /* already closed */
    }
    await new Promise<void>((r) => b.server.close(() => r()));
  }
});

describe("gracefulShutdown (Story 6.8, NFR-19)", () => {
  it("disconnects a connected client (existing Story 5.5 path) + closes the HTTP server", async () => {
    const { server, io, url } = await newServer();
    const port = (server.address() as AddressInfo).port;
    const listener = await connectListener(url);

    const disconnected: Promise<boolean> = new Promise((resolve) => {
      listener.once("disconnect", () => resolve(true));
    });

    const result = await gracefulShutdown(server, io, logger, { timeoutMs: 2000 });

    // The client receives `disconnect` — the existing server-down UI path.
    await expect(disconnected).resolves.toBe(true);
    expect(result.closed).toBe(true);
    expect(result.timedOut).toBe(false);

    // New HTTP connections are now refused (server closed).
    await expect(
      new Promise<void>((resolve, reject) => {
        const probe = net.connect({ host: "127.0.0.1", port });
        probe.once("error", () => resolve());
        probe.once("connect", () => {
          probe.destroy();
          reject(new Error("server should be closed"));
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("closes immediately when no client is connected", async () => {
    const { server, io } = await newServer();
    const result = await gracefulShutdown(server, io, logger, { timeoutMs: 2000 });
    expect(result.closed).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("resolves { closed: false, timedOut: true } when the drain hits the hard timeout", async () => {
    const { server } = await newServer();
    const port = (server.address() as AddressInfo).port;
    // Hold a raw TCP socket so `server.close()` does NOT complete, and a fake
    // io whose `close()` never resolves — the only way out is the timeout.
    const held = await holdRawSocket(port);
    const stuckIo: GracefulIo = {
      disconnectSockets: () => {},
      close: () => new Promise<void>(() => {}),
    };

    const result = await gracefulShutdown(server, stuckIo, logger, { timeoutMs: 60 });

    expect(result.timedOut).toBe(true);
    expect(result.closed).toBe(false);
    held.destroy();
  });

  it("invokes onClosed with the result before resolving", async () => {
    const { server, io } = await newServer();
    let captured: { closed: boolean; timedOut: boolean } | null = null;
    const result = await gracefulShutdown(server, io, logger, {
      timeoutMs: 2000,
      onClosed: (r) => {
        captured = r;
      },
    });
    expect(captured).not.toBeNull();
    expect(captured).toEqual(result);
  });
});

describe("installShutdownHandlers (Story 6.8)", () => {
  it("installs SIGTERM + SIGINT by default and returns the list", async () => {
    const { server, io } = await newServer();
    const signals = installShutdownHandlers(server, io, logger);
    expect(signals).toEqual(["SIGTERM", "SIGINT"]);
    // The handlers are registered on process; remove them so they do not leak
    // into other tests (a real signal is never sent here).
    for (const sig of signals) {
      process.removeAllListeners(sig);
    }
  });
});