// performerEvents handler — `midi:event` validation + one-way broadcast
// (AD-2, AD-4, AD-5, AD-9, FR-19, FR-20, FR-21). Story 2.7.
//
// This is the 3rd validation layer's consumer (ValidationService, Story 2.6):
//   1. handshake (io.use, 2.1/2.2): role + OWNER_SECRET
//   2. per-event gate + rate limit (socket.use, 2.4/2.5): ownership + throttle
//   3. HERE: strict `MidiEventSchema.safeParse` on the payload, then relay.
//
// Flow:
//   - validate(payload) → on failure: ack the STABLE error shape
//     `{ ok:false, error, issues }` (`invalid` or `unsupported-version`) and
//     DO NOT broadcast. The raw Zod `issues` are forwarded (actionable UI).
//   - on success: attach the two SERVER-ONLY fields (the client is forbidden to
//     supply them — the strict schema rejects a client `performerId`):
//       * `performerId = socket.id`  (server-authoritative, AD-2 — NEVER read
//         from the payload)
//       * `srvTs = Date.now()`       (server relay telemetry timestamp; not the
//         client `ts`, which is a performance timestamp)
//     then `relay.broadcast(ROOM, relayed)` and ack `{ ok:true }`.
//
// The MIDI payload is passed through UNCHANGED — the server only ENRICHES,
// never transforms (no re-logging, no replay, no backpressure listener).
//
// AD-6 seam: the handler depends on the `RelayService` INTERFACE (injected),
// not the concrete `InMemoryRelayService`. A future Redis adapter implements the
// same interface → no handler rewrite, no test rewrite (proven by a unit test
// that injects a fake relay).
//
// handlers element (`handlers -> [services, srv-shared]`): imports the
// `ValidationService` + `RelayService`/`RelayedMidiEvent` services + `ROOM` from
// @fmlw/shared (external). Does NOT import middlewares.

import type { Socket } from "socket.io";
import { ROOM } from "@fmlw/shared";
import type { RelayService, RelayedMidiEvent } from "../services/RelayService.js";
import type { ValidationService, ValidationResult } from "../services/ValidationService.js";

/**
 * Stable ack shape for `midi:event` (AD-19). Success → `{ ok:true }` (the
 * validated `data` is NOT echoed back — the client already has it). Failure →
 * the failure branch of `ValidationResult` verbatim (`error` + `issues`).
 */
export type MidiEventAck = { ok: true } | Extract<ValidationResult, { ok: false }>;

/**
 * Register `midi:event` on `socket` with the injected validation + relay deps.
 * The ack is optional (guarded), matching the gate/rate-limit pattern.
 */
export function registerPerformerHandlers(
  socket: Socket,
  deps: { validation: ValidationService; relay: RelayService },
): void {
  socket.on(
    "midi:event",
    (payload: unknown, ack: ((res: MidiEventAck) => void) | undefined) => {
      const result = deps.validation.validate(payload);
      if (!result.ok) {
        if (typeof ack === "function") {
          ack({ ok: false, error: result.error, issues: result.issues });
        }
        return;
      }
      const relayed: RelayedMidiEvent = {
        ...result.data,
        performerId: socket.id, // server-authoritative; never read from payload
        srvTs: Date.now(),
      };
      deps.relay.broadcast(ROOM, relayed);
      if (typeof ack === "function") ack({ ok: true });
    },
  );
}