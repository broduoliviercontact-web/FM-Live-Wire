// Story 3.4 — performer monitoring store unit tests (AD-6).
//
// Pure store tests: ack interpretation (ok / invalid / rate:limited /
// unsupported-version / unknown), listener count, dismiss, reset. No React.
import { describe, it, expect, beforeEach } from "vitest";
import { usePerformerStore } from "../features/performer/store/performerStore";
import type { MidiEvent } from "../entities/MidiEvent";

function noteOn(seq: number, channel = 0, note = 60, velocity = 100): MidiEvent {
  return {
    v: 1,
    roomId: "fm-live-wire:main",
    type: "noteOn",
    channel,
    seq,
    ts: 1000 + seq,
    note,
    velocity,
  };
}

beforeEach(() => {
  usePerformerStore.getState().reset();
});

describe("performerStore — ack {ok:true}", () => {
  it("increments eventsSent and sets lastEvent", () => {
    const ev = noteOn(1);
    usePerformerStore.getState().handleAck(ev, { ok: true });
    const s = usePerformerStore.getState();
    expect(s.eventsSent).toBe(1);
    expect(s.lastEvent).toEqual(ev);
    expect(s.recentErrors).toBe(0);
    expect(s.rateLimited).toBe(false);
  });

  it("increments eventsSent across multiple ok acks", () => {
    usePerformerStore.getState().handleAck(noteOn(1), { ok: true });
    usePerformerStore.getState().handleAck(noteOn(2), { ok: true });
    usePerformerStore.getState().handleAck(noteOn(3), { ok: true });
    expect(usePerformerStore.getState().eventsSent).toBe(3);
    expect(usePerformerStore.getState().lastEvent).toEqual(noteOn(3));
  });
});

describe("performerStore — ack {ok:false, error:'invalid'}", () => {
  it("increments recentErrors, does NOT set lastEvent, no rate-limit", () => {
    const ev = noteOn(1);
    usePerformerStore.getState().handleAck(ev, {
      ok: false,
      error: "invalid",
      issues: [],
    });
    const s = usePerformerStore.getState();
    expect(s.recentErrors).toBe(1);
    expect(s.eventsSent).toBe(0);
    expect(s.lastEvent).toBeNull();
    expect(s.rateLimited).toBe(false);
  });
});

describe("performerStore — ack {ok:false, error:'rate:limited'}", () => {
  it("increments recentErrors AND raises the rate-limit flag (E12)", () => {
    usePerformerStore.getState().handleAck(noteOn(1), { ok: false, error: "rate:limited" });
    const s = usePerformerStore.getState();
    expect(s.recentErrors).toBe(1);
    expect(s.rateLimited).toBe(true);
  });

  it("rate-limit flag is sticky until dismissed (not auto-cleared by a later ok)", () => {
    usePerformerStore.getState().handleAck(noteOn(1), { ok: false, error: "rate:limited" });
    expect(usePerformerStore.getState().rateLimited).toBe(true);
    // A later successful event does not auto-dismiss the alert.
    usePerformerStore.getState().handleAck(noteOn(2), { ok: true });
    expect(usePerformerStore.getState().rateLimited).toBe(true);
    expect(usePerformerStore.getState().eventsSent).toBe(1);
  });
});

describe("performerStore — ack {ok:false, error:'unsupported-version'}", () => {
  it("increments recentErrors (non-blocking), no rate-limit", () => {
    usePerformerStore.getState().handleAck(noteOn(1), {
      ok: false,
      error: "unsupported-version",
      issues: [],
    });
    const s = usePerformerStore.getState();
    expect(s.recentErrors).toBe(1);
    expect(s.rateLimited).toBe(false);
    expect(s.lastEvent).toBeNull();
  });
});

describe("performerStore — unknown error (fallback)", () => {
  it("an unknown error code still increments recentErrors (sober fallback)", () => {
    usePerformerStore.getState().handleAck(noteOn(1), { ok: false, error: "something-else" });
    expect(usePerformerStore.getState().recentErrors).toBe(1);
    expect(usePerformerStore.getState().rateLimited).toBe(false);
  });
});

describe("performerStore — listeners", () => {
  it("setListeners updates the counter from a server value", () => {
    usePerformerStore.getState().setListeners(5);
    expect(usePerformerStore.getState().listeners).toBe(5);
    usePerformerStore.getState().setListeners(12);
    expect(usePerformerStore.getState().listeners).toBe(12);
  });
});

describe("performerStore — dismiss + reset", () => {
  it("dismissRateLimit clears the rate-limit flag", () => {
    usePerformerStore.getState().handleAck(noteOn(1), { ok: false, error: "rate:limited" });
    expect(usePerformerStore.getState().rateLimited).toBe(true);
    usePerformerStore.getState().dismissRateLimit();
    expect(usePerformerStore.getState().rateLimited).toBe(false);
  });

  it("reset zeroes every counter", () => {
    usePerformerStore.getState().handleAck(noteOn(1), { ok: true });
    usePerformerStore.getState().handleAck(noteOn(2), { ok: false, error: "invalid" });
    usePerformerStore.getState().setListeners(7);
    usePerformerStore.getState().reset();
    const s = usePerformerStore.getState();
    expect(s.eventsSent).toBe(0);
    expect(s.recentErrors).toBe(0);
    expect(s.listeners).toBe(0);
    expect(s.lastEvent).toBeNull();
    expect(s.rateLimited).toBe(false);
  });
});