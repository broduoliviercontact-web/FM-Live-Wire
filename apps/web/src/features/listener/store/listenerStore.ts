import { create } from "zustand";
import type { CcMode } from "../lib/cc-coalescer";

// Story 4.2 — listener UI store (AD-6: Zustand, no TanStack Query).
//
// Owns the listener-specific UI state introduced in 4.2 / 4.3 / 4.4:
//   - `selectedOutputId` : the chosen MIDI output port id (null = none). With
//                          Story 5.1 this is EITHER a real port id OR the
//                          `MOCK_OUTPUT_ID` sentinel (`"mock"`) for the Mock /
//                          Debug output. No separate field: the sentinel keeps
//                          the state simple and preserves the existing
//                          `selectedOutputId !== null` gating used by the
//                          `JoinButton` / `TestNoteButton` for both Mock and
//                          real. `useMidiOutputs().getOutput(id)` resolves the
//                          sentinel to the shared `MockMidiOutput`.
//   - `channel`          : the forced output channel as a WIRE/DATA value 0–15
//                          (UI shows 1–16; the `ChannelSelector` converts at the
//                          edge via `uiChannelToData` / `dataChannelToUi`).
//                          Default `0` = UI channel 1 (Q-UX7).
//   - `joined` / `joining` : whether the listener has joined `ROOM` (4.3).
//
// Story 4.4 — flux reception state (UX-DR11 StatusPill, UX-DR12 activity):
//   - `fluxStatus`    : "idle" | "waiting" | "active". `idle` = not joined;
//                       `waiting` = joined, no event yet (AC-U18);
//                       `active`  = at least one `midi:event` received.
//   - `eventsReceived`: count of `midi:event` received this session (the
//                       StatusPill shows it). Reset to 0 on leave.
//   - `noteOnPulse`   : a counter incremented on each incoming `noteOn` so the
//                       `MidiActivityIndicator` can react per-noteOn (UX-DR12).
//                       Reset to 0 on leave.
//
// Story 4.5 — extended flux states (UX-DR13 empty states, UX-DR14 E7/E13,
// AC-U10 server-down pill):
//   - `server-down`            : the socket was lost / cannot reach the server
//                                AFTER a listener socket is active. The pill
//                                shows « Serveur déconnecté. Reconnexion
//                                automatique en cours… » and Socket.IO backoff
//                                runs (visible indicator, no blocking dialog).
//   - `performer-disconnected` : the server reported `performer:disconnected`
//                                (E7). The pill shows « Performer déconnecté »
//                                (not an app crash — the listener stays joined).
//   - `protocolError`          : a received `midi:event` had a `v` incompatible
//                                with `PROTOCOL_VERSION` (E13). Drives a separate
//                                Alert « Version de protocole incompatible… »;
//                                the incompatible event is NOT scheduled.
// No `protocol-error` flux state is needed — the Alert is driven by the
// `protocolError` flag, and the pill keeps its current reception state.
//
// This store does NOT own the MIDI port list (the shared `MidiAccessProvider`
// owns that) — only the listener's CHOICE of output + channel + flux state.
// The socket lifecycle is owned by the shared `useListenerConnection` hook
// (`api/connection.ts`), which drives `joined` / `fluxStatus` from join/leave
// and `eventsReceived` / `noteOnPulse` from incoming events.
//
// Story 5.4 — backpressure telemetry (AD-11, FR-25/26/27, UX-DR12/14):
//   - `lastLatencyMs` : Hotfix fidélité musicale — now the last restitution
//                      RETARD `max(0, now - targetLocalMs)` (ms past the musical
//                      slot; 0 when on time), set from `ScheduleResult.scheduleLateMs`.
//                      Coherent with the schedule-late trigger (the deferred
//                      buffer could not absorb the jitter). The FIELD NAME + UI
//                      label are unchanged so direct-setter unit tests stay green;
//                      only the semantics shift from epoch latency to retard.
//                      The epoch `receivedAtMs - srvTs` latency is still computed
//                      inside the scheduler as internal telemetry (AD-11) but no
//                      longer drives the UI/alert. Telemetry only — never re-loged.
//   - `lateWarning`  : a LOCAL late / overload warning is active (latency >
//                      `MAX_LATE_MS` OR buffer overflow → drop oldest). Drives
//                      `LateAlert` + `LatencyStat` (alerte-only, hidden by
//                      default, UX-DR12/14). LOCAL PUR (FR-27): no network event
//                      is ever emitted — the warning is raised in the store only.
//   - `fallbackCount`: how many late noteOn/noteOff/programChange were sent via
//                      the immediate fallback path (FR-26). Local telemetry.
//   - `droppedCount` : how many events were dropped (late controlChange /
//                      pitchBend, OR oldest evicted on buffer overflow, FR-25/26).
//
// Story 5.5 — musical fail-safe (AD-17, FR-24, UX-DR14 E5, AC-U9):
//   - `outputLost` : the selected MIDI output was lost in session (port
//                    `state:"disconnected"` / unplugged / `send()` threw
//                    `InvalidStateError`). Drives the E5 `OutputLostAlert`
//                    « Sortie MIDI déconnectée. Rebranchez le périphérique ou
//                    choisissez une autre sortie. » + the fail-safe (scheduler
//                    stopped). LOCAL: raised by the reception wiring / output
//                    watcher, no network event. Cleared TWO ways: (1) the
//                    listener picks a new output (`setSelectedOutput` with a
//                    non-null id — choosing another sortie dismisses E5 and
//                    reopens the picker; clearing to null does NOT clear it, so
//                    the alert survives a loss-driven clear until a real new
//                    choice); (2) `resetFlux()` on leave / navigation.
//
// Scope: output selection + channel + join state + flux reception state +
// backpressure telemetry + output-lost fail-safe. No emergency all-notes-off
// (Story 5.2/5.3 own that).

/** Default output channel as a wire/data value: 0 = UI channel 1 (Q-UX7). */
export const DEFAULT_LISTENER_CHANNEL = 0 as const;

/** Flux reception status (UX-DR11, extended Story 4.5). */
export type FluxStatus =
  | "idle"
  | "waiting"
  | "active"
  | "server-down"
  | "performer-disconnected";

export interface ListenerState {
  readonly selectedOutputId: string | null;
  readonly channel: number;
  /**
   * Story 4.3 — whether the listener has joined the room (the socket has
   * joined `ROOM` and the button shows « Quitter le flux »). `joining` covers
   * the in-flight window between the click and the `room:join` ack.
   */
  readonly joined: boolean;
  readonly joining: boolean;
  /** Story 4.4 / 4.5 — flux reception status (UX-DR11). */
  readonly fluxStatus: FluxStatus;
  /** Story 4.4 — count of `midi:event` received this session. */
  readonly eventsReceived: number;
  /** Story 4.4 — increments on each incoming `noteOn` (activity pulse). */
  readonly noteOnPulse: number;
  /**
   * Story 4.5 — E13: a received `midi:event` had a `v` incompatible with
   * `PROTOCOL_VERSION`. Drives the « Version de protocole incompatible… » Alert.
   * Within a joined session the flag is NOT auto-cleared by a later compatible
   * event (the Alert stays visible until the listener leaves). It IS cleared by
   * `resetFlux()` (leave / navigation) and by a full `reset()` — so a leave→rejoin
   * dismisses E13 even on a stale build (pinned by the reset-contract tests).
   */
  readonly protocolError: boolean;
  /** Hotfix fidélité musicale — last restitution retard `max(0, now - targetLocalMs)` (ms; 0 on time), or `null` initially. */
  readonly lastLatencyMs: number | null;
  /** Story 5.4 — LOCAL late/overload warning active (FR-27, UX-DR14). */
  readonly lateWarning: boolean;
  /** Story 5.4 — count of late noteOn/noteOff/programChange sent via fallback. */
  readonly fallbackCount: number;
  /** Story 5.4 — count of dropped events (late CC/pitchBend + buffer overflow). */
  readonly droppedCount: number;
  /**
   * Story 5.5 — E5: the selected MIDI output was lost in session (port
   * unplugged / closed / `send()` threw). Drives `OutputLostAlert` + the
   * fail-safe (scheduler stopped). Cleared by a new non-null output selection
   * (`setSelectedOutput(id)`; null does NOT clear it) and by `resetFlux()`
   * (leave / navigation).
   */
  readonly outputLost: boolean;
  /**
   * CC rate-limiter / coalescer mode (Smooth 60 Hz default, Safe 30 Hz, Raw
   * bypass). A PREFERENCE (like `channel`) — lives in `INITIAL` only, so it
   * PERSISTS across leave/rejoin (not reset by `resetFlux`); reset only on full
   * `reset()` (test isolation / fresh mount).
   */
  readonly ccMode: CcMode;
  /** CC received from the performer this session (incremented in `handleMidiEvent` for every `controlChange`). Session telemetry (resets on leave). */
  readonly ccReceived: number;
  /** CC actually forwarded to the raw MIDIOutput (coalescer `onSent`). Session telemetry (resets on leave). */
  readonly ccSent: number;
  /** CC dropped / replaced (coalescer `onCoalesced`). Session telemetry (resets on leave). */
  readonly ccCoalesced: number;
  /** Select an output by id, or pass null to clear. Story 5.5: a non-null id
   *  also clears the `outputLost` E5 alert (the listener picked a new sortie). */
  readonly setSelectedOutput: (id: string | null) => void;
  /** Set the forced output channel as a wire/data value (0–15). */
  readonly setChannel: (channel: number) => void;
  /** Mark the listener as joined / not joined (Story 4.3). */
  readonly setJoined: (joined: boolean) => void;
  /** Mark the join as in-flight / not (Story 4.3). */
  readonly setJoining: (joining: boolean) => void;
  /** Set the flux reception status (Story 4.4 / 4.5). */
  readonly setFluxStatus: (status: FluxStatus) => void;
  /** Increment the received-events counter (Story 4.4). */
  readonly incEventsReceived: () => void;
  /** Increment the noteOn activity pulse (Story 4.4). */
  readonly pulseNoteOn: () => void;
  /** Set / clear the protocol-error flag (Story 4.5 E13). */
  readonly setProtocolError: (b: boolean) => void;
  /** Hotfix fidélité musicale — set the last restitution retard (ms, or null). Telemetry only. */
  readonly setLastLatencyMs: (ms: number | null) => void;
  /** Story 5.4 — set / clear the LOCAL late/overload warning (FR-27). */
  readonly setLateWarning: (b: boolean) => void;
  /** Story 5.4 — increment the fallback counter (late noteOn/noteOff/program). */
  readonly incFallback: () => void;
  /** Story 5.4 — increment the dropped counter (late CC/pitchBend + overflow). */
  readonly incDropped: () => void;
  /** Story 5.5 — set / clear the E5 output-lost flag (AD-17, AC-U9). */
  readonly setOutputLost: (b: boolean) => void;
  /** Set the CC coalescer mode (Raw / Smooth / Safe). Preference — persists across leave. */
  readonly setCcMode: (mode: CcMode) => void;
  /** Increment the CC-received counter (called in `handleMidiEvent` for `controlChange`). */
  readonly incCcReceived: () => void;
  /** Increment the CC-sent counter (coalescer `onSent`). */
  readonly incCcSent: () => void;
  /** Increment the CC-coalesced counter (coalescer `onCoalesced`). */
  readonly incCcCoalesced: () => void;
  /** Reset the flux to idle: status idle, counters 0 (Story 4.4 leave). */
  readonly resetFlux: () => void;
  /** Reset to defaults (test isolation + fresh mount). */
  readonly reset: () => void;
}

const INITIAL = {
  selectedOutputId: null as string | null,
  channel: DEFAULT_LISTENER_CHANNEL,
  joined: false,
  joining: false,
  fluxStatus: "idle" as FluxStatus,
  eventsReceived: 0,
  noteOnPulse: 0,
  protocolError: false,
  lastLatencyMs: null as number | null,
  lateWarning: false,
  fallbackCount: 0,
  droppedCount: 0,
  outputLost: false,
  ccMode: "smooth" as CcMode,
  ccReceived: 0,
  ccSent: 0,
  ccCoalesced: 0,
} as const;

const FLUX_IDLE = {
  fluxStatus: "idle" as FluxStatus,
  eventsReceived: 0,
  noteOnPulse: 0,
  protocolError: false,
  lastLatencyMs: null as number | null,
  lateWarning: false,
  fallbackCount: 0,
  droppedCount: 0,
  outputLost: false,
  ccReceived: 0,
  ccSent: 0,
  ccCoalesced: 0,
} as const;

export const useListenerStore = create<ListenerState>((set) => ({
  ...INITIAL,
  // Story 5.5 — picking a new (non-null) sortie clears the E5 output-lost alert
  // (conditional spread keeps `outputLost` untouched when clearing to null, so
  // the alert survives the loss-driven clear until a real new choice is made).
  setSelectedOutput: (id) =>
    set({ selectedOutputId: id, ...(id !== null ? { outputLost: false } : {}) }),
  setChannel: (channel) => set({ channel }),
  setJoined: (joined) => set({ joined }),
  setJoining: (joining) => set({ joining }),
  setFluxStatus: (status) => set({ fluxStatus: status }),
  incEventsReceived: () => set((s) => ({ eventsReceived: s.eventsReceived + 1 })),
  pulseNoteOn: () => set((s) => ({ noteOnPulse: s.noteOnPulse + 1 })),
  setProtocolError: (b) => set({ protocolError: b }),
  setLastLatencyMs: (ms) => set({ lastLatencyMs: ms }),
  setLateWarning: (b) => set({ lateWarning: b }),
  incFallback: () => set((s) => ({ fallbackCount: s.fallbackCount + 1 })),
  incDropped: () => set((s) => ({ droppedCount: s.droppedCount + 1 })),
  setOutputLost: (b) => set({ outputLost: b }),
  setCcMode: (mode) => set({ ccMode: mode }),
  incCcReceived: () => set((s) => ({ ccReceived: s.ccReceived + 1 })),
  incCcSent: () => set((s) => ({ ccSent: s.ccSent + 1 })),
  incCcCoalesced: () => set((s) => ({ ccCoalesced: s.ccCoalesced + 1 })),
  resetFlux: () => set(FLUX_IDLE),
  reset: () => set(INITIAL),
}));