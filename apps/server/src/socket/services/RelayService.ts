// RelayService — stable broadcast adapter for the one-way MIDI relay (AD-4,
// AD-6, FR-19, FR-20). Story 2.7.
//
// The `midi:event` handler does NOT call `io.to(room).emit(...)` directly. It
// depends on the `RelayService` INTERFACE below, with a tiny in-memory adapter
// (`InMemoryRelayService`) as the MVP implementation. This is the AD-6 seam: a
// future Redis-backed fan-out (real pub/sub across processes) can be dropped in
// by implementing the same interface — NO handler rewrite, NO test rewrite (the
// handler + its tests depend on the interface, not the concrete class). The
// swap is proven by a unit test that injects a fake `RelayService`.
//
// `RelayedMidiEvent` is the SERVER-LOCAL shape that goes on the wire to
// listeners: the validated `MidiEvent` (from @fmlw/shared, untouched — the
// payload is never transformed) PLUS two fields the server attaches AFTER
// validation and that the client is FORBIDDEN to supply:
//   - `performerId`: always `socket.id` (server-authoritative, AD-2). Never read
//     from the payload (ValidationService's strict schema rejects a client
//     `performerId`).
//   - `srvTs`: `Date.now()` at relay time — server telemetry timestamp for the
//     broadcast (NOT the client `ts`, which is a performance timestamp). No
//     replay/backpressure logic is built on it in this story.
//
// This type is intentionally NOT in `@fmlw/shared`: it is a server-only
// envelope, not part of the client→server wire contract (AD-5 stays untouched).
//
// services element: imports `@fmlw/shared` (the `MidiEvent` type, single source)
// and the `socket.io` `Server` type (the adapter target). Both are external
// workspace/3rd-party deps, not internal elements, so this stays within
// `services -> [srv-shared]` (no internal imports).

import type { Server } from "socket.io";
import type { MidiEvent } from "@fmlw/shared";

/**
 * The validated MIDI event + the two server-attached fields. This is what
 * listeners receive on `"midi:event"`. The MIDI payload itself is passed through
 * unchanged — the server only ENRICHES, never transforms.
 */
export type RelayedMidiEvent = MidiEvent & {
  /** Server-authoritative owner id (AD-2): always `socket.id`. */
  performerId: string;
  /** Server relay timestamp (`Date.now()`) — telemetry, not the client `ts`. */
  srvTs: number;
};

/**
 * Stable broadcast seam (AD-6). The handler depends on THIS interface, so the
 * relay transport is swappable (in-memory now, Redis pub/sub later) without
 * touching the handler. `void | Promise<void>` lets a future async adapter
 * (Redis round-trip) satisfy the same signature.
 */
export interface RelayService {
  broadcast(room: string, event: RelayedMidiEvent): void | Promise<void>;
}

/**
 * MVP in-memory adapter: broadcasts via the live Socket.IO server's
 * `io.to(room).emit("midi:event", event)`. Single-process fan-out only (AD-6:
 * state is volatile; a real Redis adapter is a future swap, NOT this story).
 */
export class InMemoryRelayService implements RelayService {
  constructor(private readonly io: Server) {}

  broadcast(room: string, event: RelayedMidiEvent): void {
    this.io.to(room).emit("midi:event", event);
  }
}