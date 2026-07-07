// RoomService — in-memory LISTENER counter for the single broadcast room (AD-4,
// FR-28). Story 2.7.
//
// One-way model: there is exactly ONE room (`ROOM`, "fm-live-wire:main"). Public
// multi-room is explicitly out of scope (no public multi-room). This service
// counts how many listeners are CURRENTLY joined to that room, so `/health` can
// report `listeners` (FR-28, AD-20) — the count is the RoomService's, NOT a
// query against `io.sockets.adapter` (keeps it deterministic + unit-testable
// without a live Socket.IO server).
//
// Idempotency is the whole point: a listener that emits `room:join` twice must
// NOT be counted twice; `room:leave` + a later `disconnect` must NOT double-
// decrement. A `Set<socketId>` gives this for free — `add`/`delete` are
// idempotent, and the size IS the live listener count. The count can never go
// negative (a `delete` of an absent id is a no-op).
//
// State is volatile in-memory (AD-6): lost on restart. Mutated ONLY here.
//
// services element: may import srv-shared (none needed). No Socket.IO
// dependency — fully unit-testable in isolation. The concrete `RoomService` is
// injected by the socket-wiring layer (composition root); `/health` (handlers)
// imports the process-wide singleton below so both share the same counter.

/**
 * Single-room listener counter. `joined` holds the `socket.id` of every
 * listener currently counted as joined to `ROOM`.
 */
export class RoomService {
  private readonly joined: Set<string> = new Set();

  /**
   * Count a listener as joined. Idempotent: a second `onJoin` for the same
   * socket id does NOT increment the count (no double-count on a duplicate
   * `room:join`). The client's requested room is ignored by the caller — the
   * server always joins to `ROOM` (no public multi-room).
   */
  onJoin(socketId: string): void {
    this.joined.add(socketId);
  }

  /**
   * Decrement a listener that explicitly left (`room:leave`). Idempotent: a
   * `onLeave` for an id that was never counted (or already left) is a no-op —
   * the count never goes negative.
   */
  onLeave(socketId: string): void {
    this.joined.delete(socketId);
  }

  /**
   * Decrement a listener on disconnect — but ONLY if it was still counted as
   * joined. If the listener already emitted `room:leave`, `onLeave` already
   * removed it and this is a no-op (no double-decrement). If it never joined,
   * this is also a no-op.
   */
  onDisconnect(socketId: string): void {
    this.joined.delete(socketId);
  }

  /** Number of listeners currently joined to `ROOM` (feeds `/health.listeners`). */
  getListenerCount(): number {
    return this.joined.size;
  }

  /**
   * Test-only isolation hook: clears the counter. Used by the `/health` suite
   * (which exercises the process-wide singleton) so tests do not leak state
   * into each other. Not called from production code.
   */
  reset(): void {
    this.joined.clear();
  }
}

/**
 * Process-wide singleton. The Express `/health` route (handlers) and the
 * Socket.IO wiring (socket-wiring) import THIS instance so they share the same
 * listener count. Tests construct fresh `new RoomService()` for isolation (and
 * pass one into `createIoServer({ roomService })`); the `/health` suite uses
 * this singleton + `reset()` between tests.
 */
export const roomService = new RoomService();