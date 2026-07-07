import type { Socket } from "socket.io-client";
import type { MidiEvent } from "../../../entities/MidiEvent";

// Story 3.4 — performer relay: emit a captured `MidiEvent` to the server with a
// typed ack callback (AD-5: `performerId`/`srvTs` are NEVER added here — the
// server attaches them; the payload is the Story 3.3 `MidiEvent` as-is).
//
// This is the ONLY place that performs `socket.emit("midi:event", …)`. No other
// network event is emitted by this story.

/**
 * Ack shape returned by the server for `midi:event` (Story 2.7 handler +
 * 2.5 rate-limit middleware). `error` is typed as a plain string so unknown
 * codes fall through to the non-blocking error path.
 */
export type MidiEventAck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly issues?: unknown[] };

/**
 * Emit one captured `MidiEvent` to the server. The payload is forwarded as-is
 * (never enriched with `performerId` or `srvTs` — AD-5: server-authoritative).
 * `onAck` is called with the server's ack.
 */
export function emitMidiEvent(
  socket: Socket,
  event: MidiEvent,
  onAck: (ack: MidiEventAck) => void,
): void {
  socket.emit("midi:event", event, onAck);
}

/**
 * Fetch the current listener count from the server's `GET /health` (same
 * origin). Returns `0` on a non-OK response or a missing/non-numeric field.
 * Used to initialise/refresh the `listeners` counter without polling
 * aggressively and without a server-side `listeners:update` event.
 */
export async function fetchListenersCount(): Promise<number> {
  const res = await fetch("/health");
  if (!res.ok) return 0;
  const data = (await res.json()) as { listeners?: unknown };
  return typeof data.listeners === "number" ? data.listeners : 0;
}