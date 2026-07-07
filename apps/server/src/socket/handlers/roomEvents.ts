// roomEvents handler — public listener room subscription (FR-18, AD-4). Story 2.7.
//
// `room:join` / `room:leave` are the ONLY listener→server subscription events
// (the event gate allow-lists them for listeners, Story 2.4). The handler joins
// the listener to the single broadcast `ROOM` and updates the `RoomService`
// listener counter. The client's requested room is IGNORED — the server always
// joins to `ROOM` (no public multi-room). Performers reaching this handler (the
// gate does not restrict a performer's non-`midi:event` events) are NOT joined
// or counted: they are the broadcast source, and joining them would echo their
// own `midi:event` back to them.
//
// Idempotency (RoomService uses a `Set`): a duplicate `room:join` does not
// double-count; `room:leave` then a later `disconnect` does not double-decrement.
//
// handlers element (`handlers -> [services, srv-shared]`): imports the
// `RoomService` service + `ROOM` from @fmlw/shared (external). Does NOT import
// `middlewares/roleAuth` (different element): the role is read via a LOCAL
// structural type so this module respects the directional boundaries.

import type { Socket } from "socket.io";
import { ROOM } from "@fmlw/shared";
import type { RoomService } from "../services/RoomService.js";

/**
 * Local structural view of `socket.data` — only `role` is needed. The concrete
 * `ServerSocketData` lives in `middlewares/roleAuth` (a different element);
 * structural typing keeps this handler decoupled from the middlewares layer.
 */
type SocketData = { role?: "listener" | "performer" };

/** Stable ack for the room handlers (AD-19). */
type RoomAck = { ok: true };

/**
 * Register `room:join` + `room:leave` on `socket`. The ack is optional: the
 * client MAY emit without an ack, so the callback is guarded (`next(err)` is not
 * used here — these events always succeed for a listener).
 */
export function registerRoomHandlers(socket: Socket, roomService: RoomService): void {
  socket.on("room:join", (_payload: unknown, ack: ((res: RoomAck) => void) | undefined) => {
    const data = socket.data as SocketData;
    if (data.role === "listener") {
      void socket.join(ROOM);
      roomService.onJoin(socket.id);
    }
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("room:leave", (_payload: unknown, ack: ((res: RoomAck) => void) | undefined) => {
    const data = socket.data as SocketData;
    if (data.role === "listener") {
      void socket.leave(ROOM);
      roomService.onLeave(socket.id);
    }
    if (typeof ack === "function") ack({ ok: true });
  });
}