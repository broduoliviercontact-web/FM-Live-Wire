// Story 5.2 — `panic.ts` unit tests (AD-7, FR-16, FR-18, S-2, AC-U13).
// Pure, node env (no DOM, no Web MIDI, no network, no fake timers needed).
//
// Proves:
//   - `sendLocalPanic` produces EXACTLY 64 messages (4 controllers × 16 channels);
//   - the order is CC 64 → 120 → 121 → 123 for EACH channel, channels 0..15 in
//     order (so the global order is ch0:64,120,121,123 ; ch1:64,120,121,123 ;
//     … ; ch15:64,120,121,123);
//   - channels 0 to 15 are all covered (status bytes 0xB0 … 0xBF);
//   - the value byte is ALWAYS 0;
//   - each `send` is called with the injected `now` (i.e. `performance.now()`
//     in production) — NO lookahead (the timestamp is `now`, not `now+LOOKAHEAD`);
//   - `panic.ts` has NO Socket.IO / socket / connection / room dependency
//     (import-check on the source file itself).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  sendLocalPanic,
  PANIC_CONTROLLERS,
  PANIC_CHANNEL_COUNT,
  PANIC_MESSAGE_COUNT,
} from "../features/listener/lib/panic";
import type { MidiSendable } from "../features/listener/lib/sendable";

// A recording `MidiSendable`: captures every `send(bytes, ts)` with the bytes
// copied so later mutation cannot leak, plus the timestamp used for each.
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

describe("sendLocalPanic — message count + order", () => {
  it("produces EXACTLY 64 messages (4 controllers × 16 channels)", () => {
    const out = recordingOutput();
    sendLocalPanic(out, 9999);
    expect(out.sends).toHaveLength(PANIC_MESSAGE_COUNT);
    expect(PANIC_MESSAGE_COUNT).toBe(64);
  });

  it("orders the sweep as CC 64 → 120 → 121 → 123 for EACH channel, channels 0..15", () => {
    const out = recordingOutput();
    sendLocalPanic(out, 0);
    for (let ch = 0; ch < PANIC_CHANNEL_COUNT; ch += 1) {
      for (let i = 0; i < PANIC_CONTROLLERS.length; i += 1) {
        const idx = ch * PANIC_CONTROLLERS.length + i;
        const msg = out.sends[idx]!;
        expect(msg.data[0]).toBe(0xb0 | ch); // status = CC on this channel
        expect(msg.data[1]).toBe(PANIC_CONTROLLERS[i]); // controller order
        expect(msg.data[2]).toBe(0); // value always 0
      }
    }
  });

  it("the global first 8 messages are ch0 64,120,121,123 then ch1 64,120,121,123", () => {
    const out = recordingOutput();
    sendLocalPanic(out, 0);
    const controllers = out.sends.map((s) => s.data[1]);
    expect(controllers.slice(0, 8)).toEqual([64, 120, 121, 123, 64, 120, 121, 123]);
    const statuses = out.sends.map((s) => s.data[0]);
    expect(statuses.slice(0, 8)).toEqual([0xb0, 0xb0, 0xb0, 0xb0, 0xb1, 0xb1, 0xb1, 0xb1]);
  });
});

describe("sendLocalPanic — channel coverage + status bytes", () => {
  it("covers channels 0 to 15 (status bytes 0xB0 … 0xBF)", () => {
    const out = recordingOutput();
    sendLocalPanic(out, 0);
    const statuses = out.sends.map((s) => s.data[0]);
    // Each channel appears exactly 4 times (once per controller).
    for (let ch = 0; ch < 16; ch += 1) {
      const count = statuses.filter((b) => b === (0xb0 | ch)).length;
      expect(count).toBe(4);
    }
    // Boundary channels.
    expect(out.sends[0]!.data[0]).toBe(0xb0); // channel 0
    expect(out.sends[63]!.data[0]).toBe(0xbf); // channel 15
  });
});

describe("sendLocalPanic — value byte + timestamp (no lookahead)", () => {
  it("the value byte is ALWAYS 0", () => {
    const out = recordingOutput();
    sendLocalPanic(out, 1234);
    for (const msg of out.sends) expect(msg.data[2]).toBe(0);
  });

  it("each `send` uses the injected `now` as the timestamp — NO lookahead", () => {
    const out = recordingOutput();
    const now = 55555;
    sendLocalPanic(out, now);
    // Every send is scheduled at exactly `now` — not `now + LOOKAHEAD_MS`.
    expect(out.sends.every((s) => s.ts === now)).toBe(true);
  });

  it("defaults `now` to `performance.now()` when omitted (production path)", () => {
    const out = recordingOutput();
    sendLocalPanic(out);
    // The default branch: every send uses the same `performance.now()` value.
    const first = out.sends[0]!.ts;
    expect(typeof first).toBe("number");
    expect(out.sends.every((s) => s.ts === first)).toBe(true);
  });
});

describe("sendLocalPanic — works for any MidiSendable (real or Mock)", () => {
  it("calls `output.send` exactly 64 times (one per message)", () => {
    let calls = 0;
    const out: MidiSendable = {
      send() {
        calls += 1;
      },
    };
    sendLocalPanic(out, 0);
    expect(calls).toBe(64);
  });
});

describe("panic.ts — Socket.IO independence (import-check on the source)", () => {
  // Read the panic.ts source itself and assert it has NO dependency on the
  // socket, the connection module, the room, or the lookahead scheduler. This
  // is the S-2 / AC-U13 guarantee: Panic works with the backend killed.
  const sourcePath = fileURLToPath(
    new URL("../features/listener/lib/panic.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  it("does not import `socket.io-client`", () => {
    expect(source).not.toContain("socket.io-client");
  });
  it("does not import `socket`", () => {
    expect(source).not.toMatch(/\bsocket\b/i);
  });
  it("does not import the `connection` module", () => {
    expect(source).not.toContain("connection");
  });
  it("does not reference `room:join` / `room:leave` / `room`", () => {
    expect(source).not.toContain("room");
  });
  it("does not reference the lookahead scheduler / LOOKAHEAD_MS / BUFFER_CAP", () => {
    expect(source).not.toContain("LOOKAHEAD");
    expect(source).not.toContain("BUFFER_CAP");
    expect(source).not.toContain("scheduler");
  });
  it("does not emit anything (`socket.emit` / `emit`)", () => {
    expect(source).not.toContain(".emit(");
  });
});