// Story 2.7 — RelayService unit tests (AD-6, FR-19, FR-20, broadcast adapter).
//
// The in-memory adapter is exercised with a FAKE `io` (only `to().emit` is
// touched): asserts `broadcast(room, event)` calls `io.to(room).emit("midi:event",
// event)` exactly. Also proves the `RelayService` INTERFACE is stable + mockable:
// a hand-written fake satisfies it (the handler + its tests depend on the
// interface, not the concrete class — the swap is exercised in
// performerEvents.test.ts).
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, vi } from "vitest";
import type { Server } from "socket.io";
import { ROOM, PROTOCOL_VERSION } from "@fmlw/shared";
import {
  InMemoryRelayService,
  type RelayService,
  type RelayedMidiEvent,
} from "../socket/services/RelayService";

/** A full valid noteOn + the two server-attached fields → a RelayedMidiEvent. */
function relaidEvent(over: Partial<RelayedMidiEvent> = {}): RelayedMidiEvent {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    channel: 0,
    seq: 1,
    ts: 100,
    type: "noteOn",
    note: 60,
    velocity: 100,
    performerId: "S1",
    srvTs: 123456,
    ...over,
  } as RelayedMidiEvent;
}

describe("InMemoryRelayService — MVP adapter delegates to io.to(room).emit", () => {
  it("broadcast(room, event) calls io.to(room).emit('midi:event', event)", () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to } as unknown as Server;
    const relay = new InMemoryRelayService(io);

    const event = relaidEvent();
    relay.broadcast(ROOM, event);

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith(ROOM);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("midi:event", event);
  });

  it("broadcast forwards the event object unchanged (no transformation)", () => {
    const emit = vi.fn();
    const io = { to: () => ({ emit }) } as unknown as Server;
    const relay = new InMemoryRelayService(io);
    const event = relaidEvent({ note: 72, srvTs: 999 });
    relay.broadcast(ROOM, event);
    expect(emit.mock.calls[0][1]).toBe(event); // same reference, no clone/transform
  });

  it("broadcast targets the room passed in (not a hardcoded one)", () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to } as unknown as Server;
    const relay = new InMemoryRelayService(io);
    relay.broadcast("some-other-room", relaidEvent());
    expect(to).toHaveBeenCalledWith("some-other-room");
  });
});

describe("RelayService interface — stable + mockable (AD-6 seam)", () => {
  it("a hand-written fake satisfies the RelayService interface", () => {
    // A fake that records broadcasts — the kind a test or a future Redis adapter
    // would provide. It is assignable to `RelayService` (structural typing).
    class RecordingRelay implements RelayService {
      calls: Array<{ room: string; event: RelayedMidiEvent }> = [];
      broadcast(room: string, event: RelayedMidiEvent): void {
        this.calls.push({ room, event });
      }
    }
    const relay: RelayService = new RecordingRelay();
    const event = relaidEvent();
    relay.broadcast(ROOM, event);
    expect((relay as RecordingRelay).calls).toEqual([{ room: ROOM, event }]);
  });

  it("an async fake (Promise<void>) also satisfies the interface", () => {
    // The interface return is `void | Promise<void>` so a future async Redis
    // adapter fits the same seam.
    class AsyncRelay implements RelayService {
      async broadcast(_room: string, _event: RelayedMidiEvent): Promise<void> {
        // pretend a Redis round-trip
      }
    }
    const relay: RelayService = new AsyncRelay();
    expect(relay.broadcast(ROOM, relaidEvent())).toBeInstanceOf(Promise);
  });
});