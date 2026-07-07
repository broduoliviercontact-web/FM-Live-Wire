// Story 2.3 — PerformerRegistry unit tests (pure logic, AD-2 / AD-6 / FR-4 / FR-5).
//
// Fresh `new PerformerRegistry()` per test — no Socket.IO, no singleton state.
// The singleton (`performerRegistry`) is exercised by the socket integration
// tests; here we prove the registry's own contract in isolation.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect } from "vitest";
import { PerformerRegistry, performerRegistry } from "../socket/services/PerformerRegistry";

describe("PerformerRegistry — single-slot owner (AD-2, FR-4, FR-5)", () => {
  it("starts free: not active, no owner id", () => {
    const r = new PerformerRegistry();
    expect(r.isOwnerActive()).toBe(false);
    expect(r.getOwnerPerformerId()).toBeNull();
  });

  it("first performer takes the slot", () => {
    const r = new PerformerRegistry();
    expect(r.tryTakeOwner("p1")).toBe(true);
    expect(r.isOwnerActive()).toBe(true);
    expect(r.getOwnerPerformerId()).toBe("p1");
  });

  it("second performer is refused and the first remains owner", () => {
    const r = new PerformerRegistry();
    expect(r.tryTakeOwner("p1")).toBe(true);
    expect(r.tryTakeOwner("p2")).toBe(false); // refused, no replacement
    expect(r.getOwnerPerformerId()).toBe("p1"); // first still owner
    expect(r.isOwnerActive()).toBe(true);
  });

  it("release with a WRONG id does not free the slot", () => {
    const r = new PerformerRegistry();
    r.tryTakeOwner("p1");
    r.releaseOwner("someone-else");
    expect(r.isOwnerActive()).toBe(true);
    expect(r.getOwnerPerformerId()).toBe("p1");
  });

  it("release with the matching id frees the slot", () => {
    const r = new PerformerRegistry();
    r.tryTakeOwner("p1");
    r.releaseOwner("p1");
    expect(r.isOwnerActive()).toBe(false);
    expect(r.getOwnerPerformerId()).toBeNull();
  });

  it("a new performer can take the slot after release (reuse)", () => {
    const r = new PerformerRegistry();
    r.tryTakeOwner("p1");
    r.releaseOwner("p1");
    expect(r.tryTakeOwner("p2")).toBe(true);
    expect(r.getOwnerPerformerId()).toBe("p2");
    expect(r.isOwnerActive()).toBe(true);
  });

  it("release on an already-free slot is a no-op (no throw)", () => {
    const r = new PerformerRegistry();
    expect(() => r.releaseOwner("p1")).not.toThrow();
    expect(r.isOwnerActive()).toBe(false);
  });

  it("a stale release from a PREVIOUS owner does not free a newer owner's slot", () => {
    // p1 takes, releases; p2 takes; a late p1 disconnect must NOT free p2.
    const r = new PerformerRegistry();
    r.tryTakeOwner("p1");
    r.releaseOwner("p1");
    r.tryTakeOwner("p2");
    r.releaseOwner("p1"); // stale
    expect(r.getOwnerPerformerId()).toBe("p2");
    expect(r.isOwnerActive()).toBe(true);
  });

  it("exports a process-wide singleton instance", () => {
    expect(performerRegistry).toBeInstanceOf(PerformerRegistry);
  });
});

// Story 6.4 — consolidation: the "même owner / performerId si comportement prévu"
// conditional scenario. The slot is single-occupancy: a re-take attempt by the
// CURRENT owner is refused (the slot is not free), so the owner is unchanged.
describe("PerformerRegistry — same-owner re-take is idempotent (Story 6.4)", () => {
  it("tryTakeOwner with the SAME id while already owner returns false", () => {
    const r = new PerformerRegistry();
    expect(r.tryTakeOwner("p1")).toBe(true);
    // The slot is occupied (by p1 itself) → a second take attempt is refused,
    // even from the same performer. No double-take, no state change.
    expect(r.tryTakeOwner("p1")).toBe(false);
    expect(r.getOwnerPerformerId()).toBe("p1");
    expect(r.isOwnerActive()).toBe(true);
  });

  it("after release, the same owner can re-take the slot", () => {
    const r = new PerformerRegistry();
    r.tryTakeOwner("p1");
    r.releaseOwner("p1");
    expect(r.tryTakeOwner("p1")).toBe(true); // free again → same id re-acquires
    expect(r.getOwnerPerformerId()).toBe("p1");
  });
});