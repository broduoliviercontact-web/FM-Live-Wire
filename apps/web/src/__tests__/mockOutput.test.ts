// Story 5.1 — `MockMidiOutput` + `formatMockLine` unit tests (AD-14, NFR-19).
// Pure, node env (no DOM, no Web MIDI, no network).
//
// Proves:
//   - `MockMidiOutput.send(bytes, ts)` captures the bytes + timestamp in order;
//   - it produces NO sound (it is a plain object with no audio/device access —
//     verified by the absence of any Web MIDI / AudioContext reference);
//   - the captured messages are exposed for `MockByteStream`;
//   - subscribers are notified on each `send` (re-render trigger);
//   - `formatMockLine` decodes the 5 channel-voice types to the EXACT lines,
//     with the channel decoded from the status byte (UI 1–16);
//   - the singleton `getMockMidiOutput()` is stable; `__resetMockMidiOutput`
//     clears it between tests.
import { describe, it, expect, beforeEach } from "vitest";
import {
  MockMidiOutput,
  MOCK_OUTPUT_ID,
  getMockMidiOutput,
  __resetMockMidiOutput,
  formatMockLine,
} from "../features/listener/lib/mock-output";

beforeEach(() => {
  __resetMockMidiOutput();
});

describe("MockMidiOutput — capture", () => {
  it("captures `send(bytes, ts)` in arrival order", () => {
    const mock = new MockMidiOutput();
    mock.send(new Uint8Array([0x90, 60, 100]), 1040);
    mock.send(new Uint8Array([0x80, 60, 0]), 1340);
    expect(mock.messages).toHaveLength(2);
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x90, 60, 100]);
    expect(mock.messages[0]!.timestamp).toBe(1040);
    expect(Array.from(mock.messages[1]!.data)).toEqual([0x80, 60, 0]);
    expect(mock.messages[1]!.timestamp).toBe(1340);
  });

  it("accepts `send(bytes)` without a timestamp (immediate, like the test note)", () => {
    const mock = new MockMidiOutput();
    mock.send(new Uint8Array([0x90, 60, 100]));
    expect(mock.messages[0]!.timestamp).toBeUndefined();
  });

  it("copies the bytes so later mutation of the caller's buffer does not leak", () => {
    const mock = new MockMidiOutput();
    const buf = new Uint8Array([0x90, 60, 100]);
    mock.send(buf, 0);
    buf[1] = 0; // mutate the caller's buffer after send
    expect(mock.messages[0]!.data[1]).toBe(60); // captured copy unaffected
  });

  it("exposes messages for the MockByteStream (readable via the singleton)", () => {
    const mock = getMockMidiOutput();
    mock.send(new Uint8Array([0x90, 60, 100]), 1);
    expect(getMockMidiOutput().messages).toHaveLength(1);
  });

  it("produces NO sound — the Mock is a plain object (no Web MIDI / AudioContext)", () => {
    const mock = new MockMidiOutput();
    // The Mock only has `messages`, `subscribe`, `getVersion`, `reset`, `send`.
    // It references no `MIDIAccess`, no `AudioContext`, no `navigator` — by
    // construction it cannot produce sound. `send` returns void and stores.
    expect(mock.send(new Uint8Array([0x90, 60, 100]), 0)).toBeUndefined();
    expect(mock.messages).toHaveLength(1);
  });
});

describe("MockMidiOutput — reactivity (subscribe + version)", () => {
  it("notifies subscribers on each `send` and bumps the version", () => {
    const mock = new MockMidiOutput();
    const seen: number[] = [];
    const unsub = mock.subscribe(() => seen.push(mock.getVersion()));
    expect(mock.getVersion()).toBe(0);
    mock.send(new Uint8Array([0x90, 60, 100]), 1);
    mock.send(new Uint8Array([0x80, 60, 0]), 2);
    expect(mock.getVersion()).toBe(2);
    expect(seen).toEqual([1, 2]);
    unsub();
    mock.send(new Uint8Array([0xc0, 42]), 3);
    expect(seen).toEqual([1, 2]); // unsubscribed → not notified
    expect(mock.getVersion()).toBe(3);
  });
});

describe("getMockMidiOutput — singleton + reset", () => {
  it("returns the SAME instance across calls", () => {
    expect(getMockMidiOutput()).toBe(getMockMidiOutput());
  });
  it("MOCK_OUTPUT_ID is the sentinel string 'mock'", () => {
    expect(MOCK_OUTPUT_ID).toBe("mock");
  });
  it("__resetMockMidiOutput clears captured messages", () => {
    const mock = getMockMidiOutput();
    mock.send(new Uint8Array([0x90, 60, 100]), 1);
    expect(mock.messages).toHaveLength(1);
    __resetMockMidiOutput();
    expect(getMockMidiOutput().messages).toHaveLength(0);
    expect(getMockMidiOutput().getVersion()).toBe(0);
  });
});

describe("formatMockLine — 5 channel-voice types (exact lines, channel from status byte)", () => {
  it("noteOn ch1 60 100 → 'noteOn · ch1 · 60 · 100'", () => {
    expect(formatMockLine(new Uint8Array([0x90, 60, 100]))).toEqual({
      type: "noteOn",
      text: "noteOn · ch1 · 60 · 100",
    });
  });
  it("noteOff ch1 60 0 → 'noteOff · ch1 · 60 · 0'", () => {
    expect(formatMockLine(new Uint8Array([0x80, 60, 0]))).toEqual({
      type: "noteOff",
      text: "noteOff · ch1 · 60 · 0",
    });
  });
  it("cc ch1 7 100 → 'cc · ch1 · 7 · 100'", () => {
    expect(formatMockLine(new Uint8Array([0xb0, 7, 100]))).toEqual({
      type: "cc",
      text: "cc · ch1 · 7 · 100",
    });
  });
  it("program ch1 42 → 'program · ch1 · 42'", () => {
    expect(formatMockLine(new Uint8Array([0xc0, 42]))).toEqual({
      type: "program",
      text: "program · ch1 · 42",
    });
  });
  it("pitchBend ch1 8192 → 'pitchBend · ch1 · 8192' (14-bit (msb<<7)|lsb)", () => {
    // 8192 = 0x40 << 7 | 0x00 → lsb=0x00, msb=0x40
    expect(formatMockLine(new Uint8Array([0xe0, 0x00, 0x40]))).toEqual({
      type: "pitchBend",
      text: "pitchBend · ch1 · 8192",
    });
  });

  it("decodes the channel from the status byte as UI 1–16 (ch16 = status & 0x0f = 15 + 1)", () => {
    expect(formatMockLine(new Uint8Array([0x9f, 60, 100]))?.text).toBe(
      "noteOn · ch16 · 60 · 100",
    );
    expect(formatMockLine(new Uint8Array([0xbf, 7, 90]))?.text).toBe(
      "cc · ch16 · 7 · 90",
    );
  });

  it("returns null for unknown / system / too-short messages (no SysEx capture)", () => {
    expect(formatMockLine(new Uint8Array([0xf0, 0x7f]))).toBeNull(); // SysEx
    expect(formatMockLine(new Uint8Array([0xd0, 10]))).toBeNull(); // channel-pressure
    expect(formatMockLine(new Uint8Array([0xf8]))).toBeNull(); // system-realtime
    expect(formatMockLine(new Uint8Array([]))).toBeNull(); // empty
    expect(formatMockLine(new Uint8Array([0x90, 60]))).toBeNull(); // noteOn short
  });

  it("returns null for every too-short channel-voice variant (defensive guards)", () => {
    // noteOn: missing note, or missing velocity.
    expect(formatMockLine(new Uint8Array([0x90]))).toBeNull();
    expect(formatMockLine(new Uint8Array([0x90, 60]))).toBeNull();
    // noteOff: missing note, or missing velocity.
    expect(formatMockLine(new Uint8Array([0x80]))).toBeNull();
    expect(formatMockLine(new Uint8Array([0x80, 60]))).toBeNull();
    // cc: missing controller, or missing value.
    expect(formatMockLine(new Uint8Array([0xb0]))).toBeNull();
    expect(formatMockLine(new Uint8Array([0xb0, 7]))).toBeNull();
    // program: missing program.
    expect(formatMockLine(new Uint8Array([0xc0]))).toBeNull();
    // pitchBend: missing lsb, or missing msb.
    expect(formatMockLine(new Uint8Array([0xe0]))).toBeNull();
    expect(formatMockLine(new Uint8Array([0xe0, 0x00]))).toBeNull();
  });
});