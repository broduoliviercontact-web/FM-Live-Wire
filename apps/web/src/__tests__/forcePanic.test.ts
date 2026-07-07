// Story 5.3 — `force-panic.ts` unit tests (AD-7, FR-17, AC-U14).
// Pure, node env (no DOM, no Web MIDI, no network, no fake timers needed).
//
// Proves:
//   - `sendForcePanic` produces EXACTLY 2048 messages (128 notes × 16 channels);
//   - channel-major order: ch0 note0..127, ch1 note0..127, … ch15 note0..127;
//   - first message `[0x80, 0, 0]`, last `[0x8F, 127, 0]`;
//   - all status bytes are noteOff `0x80 | channel` (0x80 … 0x8F);
//   - all velocities are 0;
//   - the 16 channels and 128 notes are all covered;
//   - each `send` uses the injected `now` (i.e. `performance.now()` in
//     production) — NO lookahead (timestamp is `now`, not `now+LOOKAHEAD`);
//   - `force-panic.ts` has NO Socket.IO / socket / connection / room / scheduler
//     / LOOKAHEAD / BUFFER_CAP / `.emit(` dependency (import-check on source).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  sendForcePanic,
  FORCE_PANIC_NOTE_COUNT,
  FORCE_PANIC_CHANNEL_COUNT,
  FORCE_PANIC_MESSAGE_COUNT,
} from "../features/listener/lib/force-panic";
import type { MidiSendable } from "../features/listener/lib/sendable";

function recordingOutput(): MidiSendable & {
  sends: { data: Uint8Array; ts: number }[];
} {
  const sends: { data: Uint8Array; ts: number }[] = [];
  return {
    sends,
    send(data: Uint8Array, ts?: number): void {
      sends.push({ data: new Uint8Array(data), ts: ts as number });
    },
  };
}

describe("sendForcePanic — message count + order", () => {
  it("produces EXACTLY 2048 messages (128 notes × 16 channels)", () => {
    const out = recordingOutput();
    sendForcePanic(out, 9999);
    expect(out.sends).toHaveLength(FORCE_PANIC_MESSAGE_COUNT);
    expect(FORCE_PANIC_MESSAGE_COUNT).toBe(2048);
    expect(FORCE_PANIC_NOTE_COUNT).toBe(128);
    expect(FORCE_PANIC_CHANNEL_COUNT).toBe(16);
  });

  it("orders channel-major: ch0 note0..127, ch1 note0..127, … ch15 note0..127", () => {
    const out = recordingOutput();
    sendForcePanic(out, 0);
    for (let ch = 0; ch < FORCE_PANIC_CHANNEL_COUNT; ch += 1) {
      for (let note = 0; note < FORCE_PANIC_NOTE_COUNT; note += 1) {
        const idx = ch * FORCE_PANIC_NOTE_COUNT + note;
        const msg = out.sends[idx]!;
        expect(msg.data[0]).toBe(0x80 | ch); // noteOff on this channel
        expect(msg.data[1]).toBe(note); // note 0..127 in order
        expect(msg.data[2]).toBe(0); // velocity 0
      }
    }
  });

  it("first message is [0x80, 0, 0] and last is [0x8F, 127, 0]", () => {
    const out = recordingOutput();
    sendForcePanic(out, 0);
    expect(Array.from(out.sends[0]!.data)).toEqual([0x80, 0, 0]);
    expect(Array.from(out.sends[2047]!.data)).toEqual([0x8f, 127, 0]);
  });
});

describe("sendForcePanic — channel + note coverage + status bytes", () => {
  it("covers all 16 channels (status bytes 0x80 … 0x8F)", () => {
    const out = recordingOutput();
    sendForcePanic(out, 0);
    const statuses = out.sends.map((s) => s.data[0]);
    for (let ch = 0; ch < 16; ch += 1) {
      const count = statuses.filter((b) => b === (0x80 | ch)).length;
      expect(count).toBe(128); // 128 notes per channel
    }
  });

  it("covers all 128 notes on every channel", () => {
    const out = recordingOutput();
    sendForcePanic(out, 0);
    for (let ch = 0; ch < 16; ch += 1) {
      const notes = out.sends
        .slice(ch * 128, ch * 128 + 128)
        .map((s) => s.data[1]);
      expect(notes).toEqual(Array.from({ length: 128 }, (_, i) => i));
    }
  });

  it("every status byte is a noteOff (0x80 | channel)", () => {
    const out = recordingOutput();
    sendForcePanic(out, 0);
    for (const msg of out.sends) {
      const high = msg.data[0]! & 0xf0;
      expect(high).toBe(0x80); // noteOff high nibble
    }
  });

  it("every velocity is 0", () => {
    const out = recordingOutput();
    sendForcePanic(out, 1234);
    for (const msg of out.sends) expect(msg.data[2]).toBe(0);
  });
});

describe("sendForcePanic — timestamp (no lookahead)", () => {
  it("each `send` uses the injected `now` — NO lookahead", () => {
    const out = recordingOutput();
    const now = 77777;
    sendForcePanic(out, now);
    expect(out.sends.every((s) => s.ts === now)).toBe(true);
  });

  it("defaults `now` to `performance.now()` when omitted (production path)", () => {
    const out = recordingOutput();
    sendForcePanic(out);
    const first = out.sends[0]!.ts;
    expect(typeof first).toBe("number");
    expect(out.sends.every((s) => s.ts === first)).toBe(true);
  });

  it("calls `output.send` exactly 2048 times (one per message)", () => {
    let calls = 0;
    const out: MidiSendable = {
      send() {
        calls += 1;
      },
    };
    sendForcePanic(out, 0);
    expect(calls).toBe(2048);
  });
});

describe("force-panic.ts — Socket.IO independence (import-check on source)", () => {
  const sourcePath = fileURLToPath(
    new URL("../features/listener/lib/force-panic.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  it("does not import `socket.io-client`", () => {
    expect(source).not.toContain("socket.io-client");
  });
  it("does not reference `socket`", () => {
    expect(source).not.toMatch(/\bsocket\b/i);
  });
  it("does not import the `connection` module", () => {
    expect(source).not.toContain("connection");
  });
  it("does not reference `room:join` / `room:leave` / `room`", () => {
    expect(source).not.toContain("room");
  });
  it("does not reference the timing layer / LOOKAHEAD / BUFFER_CAP", () => {
    expect(source).not.toContain("scheduler");
    expect(source).not.toContain("LOOKAHEAD");
    expect(source).not.toContain("BUFFER_CAP");
  });
  it("does not emit anything (`socket.emit` / `.emit(`)", () => {
    expect(source).not.toContain(".emit(");
  });
});