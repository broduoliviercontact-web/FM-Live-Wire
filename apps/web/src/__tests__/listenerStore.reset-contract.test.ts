// listenerStore — INITIAL vs FLUX_IDLE reset contract (test-only audit).
//
// Pure state, node env (like listenerStore.test.ts). No jsdom, no socket, no
// Web MIDI. The goal is to PIN the current reset behaviour as an explicit
// contract so the INITIAL / FLUX_IDLE boundary cannot drift silently:
//   - `reset()`      → INITIAL  (all 17 data fields)
//   - `resetFlux()`   → FLUX_IDLE (12 fields; preserves the 3 prefs + leaves
//                    joined/joining to their own setters)
//
// These tests assert the CURRENT behaviour only. They do not change it. In
// particular `protocolError` is cleared by `resetFlux()` today even though the
// store comment claims it is sticky until a page refresh — that comment is
// known to be inaccurate but is NOT corrected here (separate change).
import { describe, it, expect, beforeEach } from "vitest";
import {
  useListenerStore,
  DEFAULT_LISTENER_CHANNEL,
} from "../features/listener/store/listenerStore";

// The 17 data fields (excludes the 19 action functions on ListenerState).
const DATA_FIELDS = [
  "selectedOutputId",
  "channel",
  "joined",
  "joining",
  "fluxStatus",
  "eventsReceived",
  "noteOnPulse",
  "protocolError",
  "lastLatencyMs",
  "lateWarning",
  "fallbackCount",
  "droppedCount",
  "outputLost",
  "ccMode",
  "ccReceived",
  "ccSent",
  "ccCoalesced",
] as const;

type DataKey = (typeof DATA_FIELDS)[number];
type DataShape = Record<DataKey, unknown>;

/** Snapshot the 17 data fields (no action functions). */
function data(): DataShape {
  const s = useListenerStore.getState() as Record<string, unknown>;
  const out = {} as DataShape;
  for (const k of DATA_FIELDS) out[k] = s[k];
  return out;
}

const EXPECTED_INITIAL: DataShape = {
  selectedOutputId: null,
  channel: DEFAULT_LISTENER_CHANNEL,
  joined: false,
  joining: false,
  fluxStatus: "idle",
  eventsReceived: 0,
  noteOnPulse: 0,
  protocolError: false,
  lastLatencyMs: null,
  lateWarning: false,
  fallbackCount: 0,
  droppedCount: 0,
  outputLost: false,
  ccMode: "smooth",
  ccReceived: 0,
  ccSent: 0,
  ccCoalesced: 0,
};

// The 12 fields resetFlux() restores to idle (mirrors FLUX_IDLE in the store).
const EXPECTED_FLUX_IDLE: Partial<DataShape> = {
  fluxStatus: "idle",
  eventsReceived: 0,
  noteOnPulse: 0,
  protocolError: false,
  lastLatencyMs: null,
  lateWarning: false,
  fallbackCount: 0,
  droppedCount: 0,
  outputLost: false,
  ccReceived: 0,
  ccSent: 0,
  ccCoalesced: 0,
};

/** Drive every data field away from its INITIAL value via the public setters. */
function dirtyAll(): void {
  const s = useListenerStore.getState();
  s.setSelectedOutput("out-1");
  s.setChannel(7);
  s.setJoined(true);
  s.setJoining(true);
  s.setFluxStatus("active");
  s.incEventsReceived();
  s.pulseNoteOn();
  s.setProtocolError(true);
  s.setLastLatencyMs(42);
  s.setLateWarning(true);
  s.incFallback();
  s.incDropped();
  s.setOutputLost(true);
  s.setCcMode("raw");
  s.incCcReceived();
  s.incCcSent();
  s.incCcCoalesced();
}

beforeEach(() => {
  useListenerStore.getState().reset();
});

describe("listenerStore reset contract — resetFlux() (FLUX_IDLE)", () => {
  it("resets the 12 flux/session fields to idle", () => {
    dirtyAll();
    useListenerStore.getState().resetFlux();
    const s = useListenerStore.getState() as Record<string, unknown>;
    for (const [k, expected] of Object.entries(EXPECTED_FLUX_IDLE)) {
      expect(s[k], `field ${k}`).toBe(expected);
    }
  });

  it("preserves selectedOutputId, channel, ccMode across resetFlux()", () => {
    dirtyAll();
    useListenerStore.getState().resetFlux();
    const s = useListenerStore.getState();
    expect(s.selectedOutputId).toBe("out-1");
    expect(s.channel).toBe(7);
    expect(s.ccMode).toBe("raw");
  });

  it("resetFlux() alone does NOT force joined=false (current behaviour)", () => {
    // resetFlux() leaves `joined` untouched — the leave flow clears it via
    // setJoined(false) explicitly. Pinning this so a future "fix" cannot
    // silently couple resetFlux to joined.
    useListenerStore.getState().setJoined(true);
    useListenerStore.getState().resetFlux();
    expect(useListenerStore.getState().joined).toBe(true);

    useListenerStore.getState().setJoined(false);
    useListenerStore.getState().resetFlux();
    expect(useListenerStore.getState().joined).toBe(false);
  });

  it("resetFlux() does NOT clear joining (current behaviour)", () => {
    // An aborted join (no ack) leaves joining=true; resetFlux() does not
    // rescue it — only a full reset() does. Pinning the current behaviour.
    useListenerStore.getState().setJoining(true);
    useListenerStore.getState().resetFlux();
    expect(useListenerStore.getState().joining).toBe(true);

    useListenerStore.getState().reset();
    expect(useListenerStore.getState().joining).toBe(false);
  });

  it("resets CC + backpressure counters/telemetry to 0/null on resetFlux()", () => {
    const s = useListenerStore.getState();
    s.incEventsReceived();
    s.pulseNoteOn();
    s.setLastLatencyMs(99);
    s.setLateWarning(true);
    s.incFallback();
    s.incDropped();
    s.incCcReceived();
    s.incCcSent();
    s.incCcCoalesced();
    useListenerStore.getState().resetFlux();
    const r = useListenerStore.getState();
    expect(r.eventsReceived).toBe(0);
    expect(r.noteOnPulse).toBe(0);
    expect(r.lastLatencyMs).toBeNull();
    expect(r.lateWarning).toBe(false);
    expect(r.fallbackCount).toBe(0);
    expect(r.droppedCount).toBe(0);
    expect(r.ccReceived).toBe(0);
    expect(r.ccSent).toBe(0);
    expect(r.ccCoalesced).toBe(0);
  });

  it("resetFlux() clears protocolError (current behaviour — Option A pin)", () => {
    // NOTE: the store comment (listenerStore.ts l.121-123) claims protocolError
    // is sticky until a page refresh. The CODE clears it via FLUX_IDLE on
    // resetFlux(). This test pins the CODE behaviour (Option A). Correcting
    // the comment is a separate, out-of-scope change.
    useListenerStore.getState().setProtocolError(true);
    useListenerStore.getState().resetFlux();
    expect(useListenerStore.getState().protocolError).toBe(false);
  });
});

describe("listenerStore reset contract — reset() (INITIAL)", () => {
  it("restores all 17 data fields to INITIAL", () => {
    dirtyAll();
    useListenerStore.getState().reset();
    expect(data()).toEqual(EXPECTED_INITIAL);
  });
});

describe("listenerStore reset contract — outputLost clearing", () => {
  it("setSelectedOutput(non-null) clears outputLost", () => {
    useListenerStore.getState().setOutputLost(true);
    useListenerStore.getState().setSelectedOutput("out-1");
    expect(useListenerStore.getState().outputLost).toBe(false);
    expect(useListenerStore.getState().selectedOutputId).toBe("out-1");
  });

  it("setSelectedOutput(null) does NOT clear outputLost", () => {
    // Clearing to null must keep the E5 alert visible (a loss-driven clear
    // must survive until the listener picks a real new sortie). Pinning the
    // conditional spread in setSelectedOutput (l.233).
    useListenerStore.getState().setSelectedOutput("out-1");
    useListenerStore.getState().setOutputLost(true);
    useListenerStore.getState().setSelectedOutput(null);
    expect(useListenerStore.getState().outputLost).toBe(true);
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
  });
});