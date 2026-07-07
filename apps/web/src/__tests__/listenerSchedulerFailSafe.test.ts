// Story 5.5 — scheduler fail-safe unit tests (AD-17, FR-24, AC-U9/U10).
//
// Pure (node env): no DOM, no clock, no React. Exercises `createMidiScheduler`
// stop/start/isStopped gate + the `InvalidStateError` → fail-safe path. A fake
// `MidiSendable` records sends and can be made to throw on `.send` to simulate a
// closed / gone port.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMidiScheduler,
  type MidiSendable,
} from "../features/listener/lib/scheduler";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

/** A minimal recording `MidiSendable` (the scheduler depends only on `.send`). */
interface FakeSend {
  calls: Array<{ data: Uint8Array; ts: number }>;
  send: MidiSendable["send"];
}
function makeOutput(throws = false): FakeSend {
  const calls: FakeSend["calls"] = [];
  const send: MidiSendable["send"] = (data, ts) => {
    if (throws) {
      // Simulate a closed / gone port (DOMException InvalidStateError).
      const err = new DOMException("port closed", "InvalidStateError");
      throw err;
    }
    calls.push({ data, ts });
  };
  return { calls, send };
}

const NOTE_ON: [number, number, number] = [0x90, 60, 100];
const bytes = (arr: number[]): Uint8Array => Uint8Array.of(...arr);

const info = {
  type: "noteOn" as const,
  receivedAtMs: 1000,
  // no srvTs → calm → lookahead path (receivedAtMs unused when srvTs absent)
};

describe("createMidiScheduler — fail-safe gate (stop / start / isStopped)", () => {
  it("schedule BEFORE stop sends the bytes (lookahead) and isStopped is false", () => {
    const sched = createMidiScheduler();
    const out = makeOutput();
    expect(sched.isStopped()).toBe(false);
    const res = sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5000);
    expect(res.stopped).toBeFalsy();
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0]!.ts).toBe(5040); // 5000 + LOOKAHEAD_MS(40)
  });

  it("stop() then schedule → NO send, result.stopped === true, isStopped true", () => {
    const sched = createMidiScheduler();
    const out = makeOutput();
    sched.stop();
    expect(sched.isStopped()).toBe(true);
    const res = sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5000);
    expect(res.stopped).toBe(true);
    expect(out.calls).toHaveLength(0); // NO in-flight bytes
  });

  it("after stop, EVERY future schedule is a no-op (no send ever)", () => {
    const sched = createMidiScheduler();
    const out = makeOutput();
    sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5000); // 1 sent
    sched.stop();
    sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5001);
    sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5002);
    sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5003);
    expect(out.calls).toHaveLength(1); // only the pre-stop event
  });

  it("start() after stop resumes ONLY future events (no old event replayed)", () => {
    const sched = createMidiScheduler();
    const out = makeOutput();
    sched.stop();
    // While stopped → nothing sent, nothing queued.
    sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5000);
    expect(out.calls).toHaveLength(0);
    // Resume — only future events can be sent.
    sched.start();
    expect(sched.isStopped()).toBe(false);
    sched.schedule({ send: out.send }, bytes([0x90, 61, 100]), info, 6000);
    expect(out.calls).toHaveLength(1);
    expect(Array.from(out.calls[0]!.data)).toEqual([0x90, 61, 100]);
    expect(out.calls[0]!.ts).toBe(6040); // lookahead
  });

  it("start() resets the pending count (no stale backlog flushed)", () => {
    const sched = createMidiScheduler();
    // Fill the buffer a bit, stop, then start — the count must be 0 after start.
    const out = makeOutput();
    for (let i = 0; i < 10; i += 1) {
      sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5000 + i);
    }
    expect(sched.getBufferLength()).toBe(10);
    sched.stop();
    sched.start();
    expect(sched.getBufferLength()).toBe(0);
  });

  it("isStopped() reflects the gate state across stop / start / reset", () => {
    const sched = createMidiScheduler();
    expect(sched.isStopped()).toBe(false);
    sched.stop();
    expect(sched.isStopped()).toBe(true);
    sched.start();
    expect(sched.isStopped()).toBe(false);
    sched.stop();
    expect(sched.isStopped()).toBe(true);
    sched.reset();
    expect(sched.isStopped()).toBe(false);
  });

  it("reset() restores factory state (buffer 0 + gate open)", () => {
    const sched = createMidiScheduler();
    const out = makeOutput();
    for (let i = 0; i < 5; i += 1) {
      sched.schedule({ send: out.send }, bytes(NOTE_ON), info, 5000 + i);
    }
    sched.stop();
    expect(sched.isStopped()).toBe(true);
    expect(sched.getBufferLength()).toBe(5);
    sched.reset();
    expect(sched.isStopped()).toBe(false);
    expect(sched.getBufferLength()).toBe(0);
  });
});

describe("createMidiScheduler — InvalidStateError fail-safe (AD-17, AC-U9)", () => {
  it("an InvalidStateError from output.send stops the scheduler + calls onOutputLost, no throw up", () => {
    const onOutputLost = vi.fn();
    const sched = createMidiScheduler({ onOutputLost });
    const throwing = makeOutput(true); // send throws InvalidStateError
    // The schedule call itself MUST NOT throw (the UI never sees the error).
    expect(() =>
      sched.schedule({ send: throwing.send }, bytes(NOTE_ON), info, 5000),
    ).not.toThrow();
    // Fail-safe triggered: scheduler stopped, output lost signalled locally.
    expect(sched.isStopped()).toBe(true);
    expect(onOutputLost).toHaveBeenCalledTimes(1);
  });

  it("after InvalidStateError, a subsequent schedule is a no-op (no send)", () => {
    const onOutputLost = vi.fn();
    const sched = createMidiScheduler({ onOutputLost });
    const throwing = makeOutput(true);
    sched.schedule({ send: throwing.send }, bytes(NOTE_ON), info, 5000);
    // A second output (non-throwing) — but the scheduler is stopped now, so
    // even a healthy output receives NOTHING until an explicit start().
    const healthy = makeOutput();
    const res = sched.schedule({ send: healthy.send }, bytes(NOTE_ON), info, 6000);
    expect(res.stopped).toBe(true);
    expect(healthy.calls).toHaveLength(0);
  });

  it("start() recovers from an InvalidStateError stop (future events send again)", () => {
    const sched = createMidiScheduler({ onOutputLost: vi.fn() });
    const throwing = makeOutput(true);
    sched.schedule({ send: throwing.send }, bytes(NOTE_ON), info, 5000);
    expect(sched.isStopped()).toBe(true);
    sched.start();
    const healthy = makeOutput();
    sched.schedule({ send: healthy.send }, bytes(NOTE_ON), info, 6000);
    expect(healthy.calls).toHaveLength(1); // resumed — live future event sent
  });

  it("onOutputLost is optional (no crash when omitted on a throw)", () => {
    const sched = createMidiScheduler(); // no onOutputLost
    const throwing = makeOutput(true);
    expect(() =>
      sched.schedule({ send: throwing.send }, bytes(NOTE_ON), info, 5000),
    ).not.toThrow();
    expect(sched.isStopped()).toBe(true);
  });
});

// Import-guard: scheduler.ts stays LOCAL (no network link / event / replay
// helper imports) — the fail-safe is purely local (FR-27 / AD-17).
describe("scheduler.ts — LOCAL + no replay (import-guard)", () => {
  it("imports no live network link / no overload event name", async () => {
    const mod = await import("../features/listener/lib/scheduler");
    expect(typeof mod.createMidiScheduler).toBe("function");
    // Source must not reach the live network link or raise a server overload.
    const src = readFileSync(
      join(import.meta.dirname!, "../features/listener/lib/scheduler.ts"),
      "utf8",
    );
    const OVERLOAD = ["listener", "overload"].join(":");
    expect(src).not.toContain("socket.io-client");
    expect(src).not.toContain(OVERLOAD);
    // No replay / resend helper imported (AD-17 — nothing is queued or resent).
    expect(src).not.toContain(".emit(");
  });

  it("the shared protocol constants are untouched (sanity)", () => {
    expect(ROOM).toBeDefined();
    expect(PROTOCOL_VERSION).toBeDefined();
  });
});