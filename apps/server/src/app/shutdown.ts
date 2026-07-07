// Graceful shutdown (Story 6.8, NFR-19). Drain the HTTP + Socket.IO servers on
// SIGTERM/SIGINT so a deploy/restart does not yank MIDI streams mid-event.
//
// Notify strategy: `io.disconnectSockets(true)` makes every connected client
// receive its `disconnect` event — that is the EXISTING Story 5.5 server-down UI
// path (OutputLostAlert / server-down pill). No new client event is introduced
// (the listener pipeline is untouched — AD-2 scope). The drain then closes the
// Socket.IO + Engine.IO server and the HTTP server, best-effort within a hard
// timeout, and `process.exit(0)` (in the signal-handler path only).
//
// `srv-app` element: imports only `node:http` (built-in) + `srv-shared` (logger).
// The Socket.IO `Server` is typed STRUCTURALLY (`GracefulIo`) so this module
// does not pull a direct `socket.io` dependency — the real `Server` returned by
// `createIoServer` (socket-wiring) satisfies it. Pure-ish over the injected
// deps, so it is unit/integration-testable with a real ephemeral server and
// `exit: false` (no `process.exit` in tests).

import type { Server as HttpServer } from "node:http";
import type { Logger } from "../shared/logger.js";

/**
 * Structural slice of the Socket.IO `Server` that the drain needs. Defined
 * locally (not imported from `socket.io`) so `srv-app` stays free of a direct
 * `socket.io` import; the real `Server` from `createIoServer` satisfies it.
 */
export interface GracefulIo {
  /** Disconnect every connected client; `close` also tears down the connection. */
  disconnectSockets(close?: boolean): void;
  /** Close the Socket.IO server + its Engine.IO server; resolves when closed. */
  close(fn?: (err?: Error) => void): Promise<void>;
}

export interface GracefulShutdownOptions {
  /** Hard cap to avoid hanging on stuck connections (ms). Default 5000. */
  timeoutMs?: number;
  /** When true, `process.exit(exitCode)` after the drain. The signal handler
   *  sets this; tests leave it false so the test process is not killed. */
  exit?: boolean;
  /** Exit code when `exit` is true. Default 0. */
  exitCode?: number;
  /** Notified once the drain completes (before `process.exit` if `exit`). */
  onClosed?: (result: GracefulShutdownResult) => void;
}

export interface GracefulShutdownResult {
  /** True if the HTTP server + all sockets closed within `timeoutMs`. */
  readonly closed: boolean;
  /** True if the hard timeout fired (some connections may still be open). */
  readonly timedOut: boolean;
}

/**
 * Drain the server on shutdown. Sequence:
 *   1. `io.disconnectSockets(true)` — every client receives `disconnect` → the
 *      existing Story 5.5 server-down UI fires (no new client event).
 *   2. `io.close()` — close the Socket.IO + Engine.IO server.
 *   3. `server.close()` — stop accepting new HTTP connections and close once
 *      lingering connections drop.
 * Resolves when both servers close, or when the hard `timeoutMs` elapses
 * (best-effort). With `exit: true`, calls `process.exit(exitCode)` after.
 */
export function gracefulShutdown(
  server: HttpServer,
  io: GracefulIo,
  logger: Logger,
  opts: GracefulShutdownOptions = {},
): Promise<GracefulShutdownResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise<GracefulShutdownResult>((resolve) => {
    let settled = false;
    let timedOut = false;

    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result: GracefulShutdownResult = { closed, timedOut };
      opts.onClosed?.(result);
      if (opts.exit) {
        const code = opts.exitCode ?? 0;
        logger.info("shutdown complete, exiting", { closed, timedOut, exitCode: code });
        process.exit(code);
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      logger.warn("shutdown timeout, best-effort exit", { timeoutMs });
      finish(false);
    }, timeoutMs);

    logger.info("shutdown signal received, draining");
    // 1. Notify clients via the existing disconnect path (Story 5.5).
    io.disconnectSockets(true);
    // 2 + 3. Close the io + HTTP servers; resolve when both done.
    Promise.all<void>([
      io.close(),
      new Promise<void>((r) => server.close(() => r())),
    ])
      .then(() => finish(true))
      .catch(() => finish(false));
  });
}

export type ShutdownSignal = "SIGTERM" | "SIGINT";

/**
 * Install SIGTERM + SIGINT handlers that trigger `gracefulShutdown` with
 * `exit: true`. Called once from `startServer` (the production entrypoint) —
 * NOT from `createApp` (the supertest target), so tests that never call
 * `startServer` are unaffected (no leaked signal handlers in the test process).
 * Returns the installed signals for assertion.
 */
export function installShutdownHandlers(
  server: HttpServer,
  io: GracefulIo,
  logger: Logger,
  signals: ShutdownSignal[] = ["SIGTERM", "SIGINT"],
): ShutdownSignal[] {
  for (const sig of signals) {
    process.on(sig, () => {
      void gracefulShutdown(server, io, logger, { exit: true, exitCode: 0 });
    });
  }
  return signals;
}