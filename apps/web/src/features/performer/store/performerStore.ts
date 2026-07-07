import { create } from "zustand";
import type { MidiEvent } from "../../../entities/MidiEvent";
import type { MidiEventAck } from "../api/relay";

// Story 3.4 + 3.5 — performer monitoring + connection store (AD-6: Zustand, no
// TanStack Query).
//
// Monitoring counters (Story 3.4) driven by `midi:event` acks from the server
// (Story 2.7 handler + 2.5 rate-limit middleware):
//   - `eventsSent`   : incremented on each `{ ok:true }` ack.
//   - `recentErrors` : incremented on any non-ok ack (invalid /
//     unsupported-version / rate:limited / unknown) — non-blocking feedback.
//   - `listeners`    : counter received from the server (initialised via
//     `GET /health`, updated if a `listeners:update` event ever arrives).
//   - `lastEvent`    : the most recent successfully-acked `MidiEvent`.
//   - `rateLimited`  : sticky flag shown by `RateLimitAlert` (E12), cleared by
//     `dismissRateLimit`.
//
// Connection lifecycle (Story 3.5):
//   - `connectionStatus`: live indicator shown by `ConnectionStatus` (non
//     blocking). `connecting` → `connected` → `disconnected` / `reconnecting`.
//   - `reconnectAttempt` : current backoff attempt number (1-based) while
//     reconnecting.
//   - `reconnectError`   : last reconnection-attempt error message (sober,
//     non-blocking), cleared on a successful `reconnect`.
//   - `endMessage`       : the performer's own clean-disconnect message, set by
//     `BackToHome` before navigating to `/`. Null otherwise.
//
// `performerId` / `srvTs` are NEVER stored here — they are server-only and never
// reach the client payload (AD-5). The store keeps the client's own `MidiEvent`
// (already without `performerId`).

/** Final message shown after the performer's own clean disconnect (Story 3.5). */
export const PERFORMER_END_MESSAGE =
  "Déconnexion : slot owner libéré. Les listeners voient « Performer déconnecté ».";

/** Live connection indicator shown by `ConnectionStatus` (Story 3.5). */
export type ConnectionStatusValue =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface PerformerState {
  // --- monitoring (Story 3.4) ---
  readonly eventsSent: number;
  readonly recentErrors: number;
  readonly listeners: number;
  readonly lastEvent: MidiEvent | null;
  readonly rateLimited: boolean;
  // --- connection lifecycle (Story 3.5) ---
  readonly connectionStatus: ConnectionStatusValue;
  readonly reconnectAttempt: number;
  readonly reconnectError: string | null;
  readonly endMessage: string | null;
  // --- actions ---
  /** Apply a `midi:event` ack for the given emitted event. */
  readonly handleAck: (event: MidiEvent, ack: MidiEventAck) => void;
  /** Set the listener count from the server (`/health` or `listeners:update`). */
  readonly setListeners: (n: number) => void;
  /** Dismiss the rate-limit alert (E12). */
  readonly dismissRateLimit: () => void;
  /** Set the live connection indicator. */
  readonly setConnectionStatus: (status: ConnectionStatusValue) => void;
  /** Mark a reconnection attempt (updates status + attempt number). */
  readonly setReconnecting: (attempt: number) => void;
  /** Set only the reconnection attempt counter (does NOT change the status). */
  readonly setReconnectAttempt: (attempt: number) => void;
  /** Record / clear the last reconnection-attempt error. */
  readonly setReconnectError: (err: string | null) => void;
  /** Set the clean-disconnect end message (or null to clear). */
  readonly setEndMessage: (msg: string | null) => void;
  /** Reset all state (test/isolation + before each fresh connect attempt). */
  readonly reset: () => void;
}

const INITIAL = {
  eventsSent: 0,
  recentErrors: 0,
  listeners: 0,
  lastEvent: null as MidiEvent | null,
  rateLimited: false,
  connectionStatus: "connecting" as ConnectionStatusValue,
  reconnectAttempt: 0,
  reconnectError: null as string | null,
  endMessage: null as string | null,
} as const;

export const usePerformerStore = create<PerformerState>((set) => ({
  ...INITIAL,
  handleAck: (event, ack) =>
    set((s) => {
      if (ack.ok === true) {
        return { eventsSent: s.eventsSent + 1, lastEvent: event };
      }
      // ack.ok === false: invalid / unsupported-version / rate:limited / unknown.
      // All are non-blocking; rate:limited additionally raises the E12 alert.
      return {
        recentErrors: s.recentErrors + 1,
        rateLimited: ack.error === "rate:limited" ? true : s.rateLimited,
      };
    }),
  setListeners: (n) => set({ listeners: n }),
  dismissRateLimit: () => set({ rateLimited: false }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setReconnecting: (attempt) =>
    set({ connectionStatus: "reconnecting", reconnectAttempt: attempt }),
  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  setReconnectError: (err) => set({ reconnectError: err }),
  setEndMessage: (msg) => set({ endMessage: msg }),
  reset: () => set(INITIAL),
}));