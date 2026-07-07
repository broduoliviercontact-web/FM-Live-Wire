// PerformerRegistry — in-memory SINGLE-SLOT owner registry (AD-2, AD-6).
//
// The unique-owner invariant: at most ONE performer may hold the "owner" slot at
// any time. A second valid performer is REFUSED (performer:busy) — the existing
// owner is NEVER silently replaced. The slot is released when the owner
// disconnects (socket "disconnect"), and a fresh performer may then take it.
//
// State is volatile in-memory (AD-6): lost on restart. It is mutated ONLY by
// this service (tryTakeOwner / releaseOwner). The handoff of `performerId` is
// always the server-side `socket.id`, never a client value (AD-2).
//
// services element: may import srv-shared (none needed here). Pure logic, no
// Socket.IO / Express dependency — fully unit-testable in isolation.

/** Read-only view of the owner slot, for consumers like `/health`. */
export interface OwnerStatus {
  isOwnerActive(): boolean;
  getOwnerPerformerId(): string | null;
}

/** Write + read view used by the socket wiring (take/release on connect/disconnect). */
export interface OwnerRegistry extends OwnerStatus {
  tryTakeOwner(performerId: string): boolean;
  releaseOwner(performerId: string): void;
}

/**
 * Single-slot owner registry. `ownerPerformerId` is `null` when the slot is
 * free, or the owning performer's `socket.id` when occupied.
 */
export class PerformerRegistry implements OwnerRegistry {
  private ownerPerformerId: string | null = null;

  /**
   * Claim the owner slot for `performerId`. Returns `true` if the slot was free
   * (and is now held by `performerId`); returns `false` if already occupied —
   * the existing owner is NEVER replaced (AD-2, FR-4).
   */
  tryTakeOwner(performerId: string): boolean {
    if (this.ownerPerformerId !== null) return false;
    this.ownerPerformerId = performerId;
    return true;
  }

  /**
   * Release the slot, but ONLY if `performerId` is the current owner. A stale or
   * mismatched id (e.g. a late disconnect from a previous owner) must NOT free a
   * slot held by a newer owner.
   */
  releaseOwner(performerId: string): void {
    if (this.ownerPerformerId === performerId) {
      this.ownerPerformerId = null;
    }
  }

  /** `true` while an owner is connected (FR-28, feeds `/health.ownerActive`). */
  isOwnerActive(): boolean {
    return this.ownerPerformerId !== null;
  }

  /** The current owner's `socket.id`, or `null` when the slot is free. */
  getOwnerPerformerId(): string | null {
    return this.ownerPerformerId;
  }
}

/**
 * Process-wide singleton. The Express `/health` route (handlers) and the
 * Socket.IO wiring (socket-wiring) import THIS instance so they share the same
 * owner state. Tests construct fresh `new PerformerRegistry()` for isolation
 * (and may pass one into `createIoServer({ registry })`).
 */
export const performerRegistry = new PerformerRegistry();