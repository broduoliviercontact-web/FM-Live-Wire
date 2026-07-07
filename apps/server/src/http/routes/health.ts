import express from "express";
import { performerRegistry } from "../../socket/services/PerformerRegistry.js";
import { roomService } from "../../socket/services/RoomService.js";

// GET /health — FR-28, AD-20. The SHAPE is final. `ownerActive` is wired to the
// PerformerRegistry singleton (Story 2.3); `listeners` is wired to the
// RoomService singleton (Story 2.7) — the live listener count for the single
// broadcast room, maintained by the `room:join`/`room:leave`/disconnect handlers.
// Field name `ownerActive` is validated by AD-20 (feeds the landing polling).
//
// handlers element: may import services + srv-shared. Both singletons are shared
// with the socket wiring (same module instances) so `/health` reflects the live
// owner + listener state.

export interface HealthResponse {
  readonly ok: true;
  readonly uptime: number;
  readonly ownerActive: boolean;
  readonly listeners: number;
}

export function healthRouter(): express.Router {
  return express
    .Router()
    .get("/health", (_req, res) => {
      const body: HealthResponse = {
        ok: true,
        uptime: process.uptime(),
        ownerActive: performerRegistry.isOwnerActive(),
        listeners: roomService.getListenerCount(),
      };
      res.json(body);
    });
}