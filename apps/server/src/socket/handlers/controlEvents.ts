// controlEvents handler — `midi:test` listener ping (FR-18). Story 2.7.
//
// `midi:test` is a listener→server round-trip ping used for a LOCAL test tone.
// The server does NOT render sound and does NOT broadcast anything: the listener
// plays its own local test tone (Web MIDI on the client, Epic 4 — out of scope
// here). The handler only acks `{ ok:true }` so the client can confirm the
// socket + gate path is live. No `RelayService`, no `RoomService` interaction.
//
// handlers element (`handlers -> [services, srv-shared]`): no internal imports
// needed (the handler is a pure ack). Stays within the boundaries trivially.

import type { Socket } from "socket.io";

/** Stable ack for the control handler (AD-19). */
type ControlAck = { ok: true };

/**
 * Register `midi:test` on `socket`. The ack is optional (the client may emit
 * without one), so the callback is guarded.
 */
export function registerControlHandlers(socket: Socket): void {
  socket.on("midi:test", (_payload: unknown, ack: ((res: ControlAck) => void) | undefined) => {
    if (typeof ack === "function") ack({ ok: true });
  });
}