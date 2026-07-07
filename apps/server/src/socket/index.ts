import { Server } from "socket.io";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { ROOM } from "@fmlw/shared";
import { createRoleAuthMiddleware, type ServerSocketData } from "./middlewares/roleAuth.js";
import { createEventGateMiddleware } from "./middlewares/eventGate.js";
import { createRateLimitMiddleware } from "./middlewares/rateLimit.js";
import { performerRegistry, type PerformerRegistry } from "./services/PerformerRegistry.js";
import { RoomService, roomService } from "./services/RoomService.js";
import { InMemoryRelayService, type RelayService } from "./services/RelayService.js";
import { ValidationService } from "./services/ValidationService.js";
import { registerRoomHandlers } from "./handlers/roomEvents.js";
import { registerControlHandlers } from "./handlers/controlEvents.js";
import { registerPerformerHandlers } from "./handlers/performerEvents.js";
import { createLogger } from "../shared/logger.js";

// Socket.IO v4 wiring (AD-4) attached to the existing HTTP server, on the SAME
// origin (AD-15, AD-20). Origin is gated at the Engine.IO upgrade via
// `allowRequest` — NOT only via the `cors` option, so the WebSocket upgrade is
// genuinely rejected when the `Origin` header differs from `PUBLIC_ORIGIN`
// (anti-CSWSH). App-side Express keeps zero CORS. Role/performerId are pinned
// by `io.use` (createRoleAuthMiddleware, AD-2); performer `OWNER_SECRET` is
// validated timing-safe there (AD-10); the single owner slot is claimed there
// too (AD-2, FR-4). The secret is injected from server-only env so it never
// reaches this module via a `VITE_*` path.
//
// socket-wiring element: composition root for middlewares + services + the
// Story 2.7 handlers. May import middlewares + services + srv-config +
// srv-shared + handlers (it wires handler registration onto each socket AFTER
// the middlewares).

export type Transport = "polling" | "websocket";

/**
 * Resolve enabled low-level transports. Prod forces WebSocket-only (no
 * long-polling fallback); dev/test allows polling + websocket so the in-process
 * test client is not constrained. Pure + unit-tested.
 */
export function resolveTransports(isProd: boolean): Transport[] {
  return isProd ? ["websocket"] : ["polling", "websocket"];
}

/** Pure origin check — unit-tested, then wired into `allowRequest`. */
export function isOriginAllowed(origin: string | undefined, publicOrigin: string): boolean {
  return typeof origin === "string" && origin === publicOrigin;
}

export interface CreateIoOptions {
  /** The single allowed origin (AD-15). Compared against the `Origin` header. */
  publicOrigin: string;
  /** When true, forces WebSocket-only transport (prod). */
  isProd: boolean;
  /** Server-only owner secret (AD-10). Empty = performers rejected generically. */
  ownerSecret: string;
  /**
   * Owner registry. Defaults to the process-wide `performerRegistry` singleton
   * (shared with `/health`). Tests pass a fresh `new PerformerRegistry()` for
   * isolation.
   */
  registry?: PerformerRegistry;
  /**
   * Listener counter (Story 2.7). Defaults to the process-wide `roomService`
   * singleton (shared with `/health.listeners`). Tests pass a fresh
   * `new RoomService()` for isolation; the `/health` suite passes the singleton.
   */
  roomService?: RoomService;
  /**
   * Relay adapter (AD-6, Story 2.7). Defaults to `new InMemoryRelayService(io)`
   * (single-process `io.to(room).emit`). Tests inject a FAKE `RelayService` to
   * assert broadcast calls deterministically (and to prove the adapter is
   * swappable without a handler rewrite).
   */
  relayService?: RelayService;
  /**
   * Validation service (Story 2.6/2.7). Defaults to `new ValidationService()`.
   * Tests may inject a fake; production uses the real shared-schema validator.
   */
  validationService?: ValidationService;
  /**
   * Per-socket rate-limit overrides (AD-13, Story 2.5). Omitted in prod →
   * defaults (burst 200, refill 100/s, `Date.now()` clock). Tests inject a
   * deterministic clock + small buckets for fast, reproducible cases.
   */
  rateLimit?: {
    now?: () => number;
    capacity?: number;
    refillPerSecond?: number;
  };
}

/**
 * Create a Socket.IO server bound to `httpServer`. Returns the `Server`.
 *
 * Owner lifecycle (AD-2, FR-4, FR-5): the slot is claimed in the `io.use`
 * middleware (roleAuth); on the owner's `disconnect` the slot is released and
 * `performer:disconnected` is emitted to `ROOM` so listeners learn the stream
 * ended.
 *
 * Listener lifecycle (Story 2.7): listeners join `ROOM` via the public
 * `room:join` handler (registered below) — NOT via an auto-join here. The
 * `RoomService` counter is updated on join/leave/disconnect; on disconnect the
 * decrement is idempotent (a listener that already left is not double-counted).
 *
 * Handler wiring: the three handler groups (room / control / performer) are
 * registered on EACH socket AFTER the per-event middlewares (gate → rate limit
 * → handler). The gate's `next(err)` short-circuits the chain, so a forbidden
 * event never reaches a handler; the rate limit likewise blocks before the
 * `midi:event` handler. Handlers depend on the injected services (RoomService,
 * RelayService, ValidationService), never the reverse.
 */
export function createIoServer(httpServer: HttpServer, opts: CreateIoOptions): Server {
  const logger = createLogger("socket");
  const registry = opts.registry ?? performerRegistry;
  const roomSvc = opts.roomService ?? roomService;
  const validation = opts.validationService ?? new ValidationService();
  const io = new Server(httpServer, {
    // Handshake CORS (HTTP). The real WS gate is `allowRequest` below.
    cors: { origin: opts.publicOrigin },
    // AD-15: reject the upgrade when the Origin header is not allowlisted.
    allowRequest: (req: IncomingMessage, fn) => {
      const allowed = isOriginAllowed(req.headers.origin, opts.publicOrigin);
      if (!allowed) {
        logger.warn("origin rejected", { origin: req.headers.origin ?? null });
      }
      fn(allowed ? null : "forbidden", allowed);
    },
    transports: resolveTransports(opts.isProd),
  });
  // The in-memory relay adapter wraps the live server (AD-6). A test may inject
  // a fake `RelayService` to assert broadcast calls without a real fan-out.
  const relay = opts.relayService ?? new InMemoryRelayService(io);
  io.use(createRoleAuthMiddleware({ ownerSecret: opts.ownerSecret, registry }));
  io.on("connection", (socket) => {
    const data = socket.data as ServerSocketData;
    logger.info("connected", { id: socket.id, role: data.role });
    // Per-event gate (AD-2, AD-16, FR-18, FR-19): blocks non-owner `midi:event`
    // and any listener event outside the allow-list; 3 forbiddens → disconnect.
    socket.use(createEventGateMiddleware({ socket, registry }));
    // Per-socket token-bucket rate limit (AD-13, FR-22, NFR-3, Story 2.5) on
    // `midi:event` ONLY, AFTER the gate. The gate's `next(err)` short-circuits
    // the chain, so a `forbidden` event never reaches this limiter — `forbidden`
    // stays prioritized over `rate:limited`. Default 200 burst / 100/s refill.
    socket.use(
      createRateLimitMiddleware({
        socket,
        logger,
        ...(opts.rateLimit ?? {}),
      }),
    );
    // Handlers (Story 2.7) — registered AFTER the middlewares so the gate +
    // rate limit run first. Listeners get room + control handlers; performers
    // get the `midi:event` handler (the gate ensures only the owner's
    // `midi:event` reaches it, and listeners' `midi:event` is forbidden). All
    // three groups are harmless to register on every socket: a listener's
    // `midi:event` is blocked by the gate before `performerEvents` runs, and a
    // performer's `room:join` is a no-op ack (room:join is listener-scoped).
    registerRoomHandlers(socket, roomSvc);
    registerControlHandlers(socket);
    registerPerformerHandlers(socket, { validation, relay });
    // Disconnect (FR-5 + Story 2.7): owner releases the slot + notifies the
    // room; a listener is decremented in the counter (idempotent — no
    // double-decrement if it already emitted `room:leave`). A 2nd performer that
    // was refused at handshake never reaches here.
    socket.on("disconnect", (reason) => {
      if (data.role === "performer") {
        registry.releaseOwner(socket.id);
        io.to(ROOM).emit("performer:disconnected", { performerId: socket.id, reason });
        logger.info("owner disconnected", { performerId: socket.id });
      } else if (data.role === "listener") {
        roomSvc.onDisconnect(socket.id);
      }
    });
  });
  return io;
}