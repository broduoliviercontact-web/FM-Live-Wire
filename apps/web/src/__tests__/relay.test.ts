// Story 3.4 — relay unit tests (AD-5: payload never enriched client-side).
//
// Proves `emitMidiEvent` calls `socket.emit("midi:event", payload, onAck)` with
// the MidiEvent passed by reference (no `performerId`, no `srvTs` added), and
// forwards the server ack to `onAck`. Also covers `fetchListenersCount`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitMidiEvent, fetchListenersCount } from "../features/performer/api/relay";
import type { MidiEvent } from "../entities/MidiEvent";

function noteOn(seq: number): MidiEvent {
  return {
    v: 1,
    roomId: "fm-live-wire:main",
    type: "noteOn",
    channel: 0,
    seq,
    ts: 1000 + seq,
    note: 60,
    velocity: 100,
  };
}

interface FakeSocket {
  emit: ReturnType<typeof vi.fn>;
}

function makeSocket(): FakeSocket {
  return { emit: vi.fn() };
}

describe("emitMidiEvent", () => {
  it("calls socket.emit('midi:event', payload, onAck)", () => {
    const socket = makeSocket();
    const onAck = vi.fn();
    const event = noteOn(1);
    emitMidiEvent(socket as unknown as never, event, onAck);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith("midi:event", event, onAck);
  });

  it("passes the payload BY REFERENCE (never cloned/enriched)", () => {
    const socket = makeSocket();
    const onAck = vi.fn();
    const event = noteOn(1);
    emitMidiEvent(socket as unknown as never, event, onAck);
    expect(socket.emit.mock.calls[0][1]).toBe(event); // same object reference
  });

  it("does NOT add performerId to the payload", () => {
    const socket = makeSocket();
    emitMidiEvent(socket as unknown as never, noteOn(1), vi.fn());
    const payload = socket.emit.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("performerId");
  });

  it("does NOT add srvTs to the payload", () => {
    const socket = makeSocket();
    emitMidiEvent(socket as unknown as never, noteOn(1), vi.fn());
    const payload = socket.emit.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("srvTs");
  });

  it("the payload keys are exactly the MidiEvent contract (no extras)", () => {
    const socket = makeSocket();
    emitMidiEvent(socket as unknown as never, noteOn(1), vi.fn());
    const payload = socket.emit.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["channel", "note", "roomId", "seq", "ts", "type", "v", "velocity"].sort(),
    );
  });

  it("forwards the server ack {ok:true} to onAck", () => {
    const socket = makeSocket();
    const onAck = vi.fn();
    emitMidiEvent(socket as unknown as never, noteOn(1), onAck);
    const ackArg = socket.emit.mock.calls[0][2] as (a: unknown) => void;
    ackArg({ ok: true });
    expect(onAck).toHaveBeenCalledWith({ ok: true });
  });

  it("forwards a non-ok ack to onAck (interpretation is the caller's job)", () => {
    const socket = makeSocket();
    const onAck = vi.fn();
    emitMidiEvent(socket as unknown as never, noteOn(1), onAck);
    const ackArg = socket.emit.mock.calls[0][2] as (a: unknown) => void;
    const ack = { ok: false, error: "rate:limited" };
    ackArg(ack);
    expect(onAck).toHaveBeenCalledWith(ack);
  });
});

describe("fetchListenersCount", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns the listeners count from /health", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, listeners: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    expect(await fetchListenersCount()).toBe(7);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/health",
    );
  });

  it("returns 0 when listeners is missing / non-numeric", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    expect(await fetchListenersCount()).toBe(0);
  });

  it("returns 0 on a non-OK HTTP response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("", { status: 500 }),
    ) as unknown as typeof fetch;
    expect(await fetchListenersCount()).toBe(0);
  });
});