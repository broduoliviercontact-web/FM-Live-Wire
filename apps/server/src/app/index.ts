import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { healthRouter } from "../http/routes/health.js";
import { staticRouter } from "../http/routes/static.js";
import { resolveEnv, requireOwnerSecretInProd, type ServerConfig } from "../config/env.js";
import { createLogger } from "../shared/logger.js";
import { createIoServer } from "../socket/index.js";
import { installShutdownHandlers } from "./shutdown.js";

// Server app wiring (AD-1: thin Express; AD-13: mono-process mono-domain).
// Exports `createApp` (supertest target) + `startServer` (runnable). The
// bootstrap `src/index.ts` calls `startServer()`.
//
// srv-app element: may import handlers + srv-shared + srv-config + socket-wiring
// (boundary allow-list). Socket.IO is attached to the SAME http.Server here
// (AD-4), on the same origin (AD-15, AD-20). No event handlers / rooms yet
// (Epic 2.7) — Story 2.1 only pins identity.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// From apps/server/[src|dist]/app -> apps/web/dist (three `..` reach `apps/`).
const DEFAULT_WEB_DIST = path.resolve(__dirname, "../../../web/dist");

/** Build the Express app. `distDir` = absolute path to the Vite build. */
export function createApp(distDir: string): express.Express {
  const app = express();
  // /health first so the SPA fallback never shadows it.
  app.use(healthRouter());
  app.use(staticRouter(distDir));
  return app;
}

/**
 * Create and start the HTTP server with Socket.IO attached on the same origin
 * (AD-4, AD-20). Returns the running http.Server. `overrides` lets tests point
 * at a temp dist dir and inject a config without touching `process.env`.
 */
export function startServer(overrides?: { distDir?: string; env?: ServerConfig }): http.Server {
  const isProd = process.env.NODE_ENV === "production";
  const config = overrides?.env ?? resolveEnv(process.env);
  // Story 6.8: OWNER_SECRET is required in production (AD-10). Fail fast before
  // binding the port so a misconfigured prod deploy crashes loudly instead of
  // running with performers rejected generically. Dev/tests pass `isProd=false`.
  requireOwnerSecretInProd(config, isProd);
  const logger = createLogger("server");
  const distDir = overrides?.distDir ?? DEFAULT_WEB_DIST;
  const app = createApp(distDir);
  const server = http.createServer(app);
  // Attach Socket.IO to the SAME server (single origin, zero CORS, AD-15).
  // OWNER_SECRET is server-only (AD-10): read from env here, injected into the
  // io.use middleware; it never crosses to the web app via a VITE_* path.
  const io = createIoServer(server, {
    publicOrigin: config.publicOrigin,
    isProd,
    ownerSecret: config.ownerSecret,
  });
  server.listen(config.port, () => {
    logger.info("listening", { port: config.port, publicOrigin: config.publicOrigin });
  });
  // Story 6.8: graceful shutdown on SIGTERM/SIGINT — drain clients (each gets
  // `disconnect` → the existing Story 5.5 server-down UI) + close the io + HTTP
  // servers, then exit 0. Installed only here (prod entrypoint); `createApp`
  // (supertest target) never installs it, so tests stay clean.
  installShutdownHandlers(server, io, logger);
  return server;
}