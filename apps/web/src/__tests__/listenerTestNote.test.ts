// Story 4.4 — `test-note.ts` unit tests (FR-14, UX-DR9, Q-UX6). Node env, fake
// timers (the 300 ms noteOff gap must be deterministic).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  playTestNote,
  TEST_NOTE,
  TEST_VELOCITY,
  TEST_NOTE_DURATION_MS,
} from "../features/listener/lib/test-note";

// Minimal fake `MIDIOutput`: record every `send(data, ts?)` call.
function makeOutput() {
  const calls: Array<{ data: Uint8Array; ts: number | undefined }> = [];
  const output = {
    send: (data: Uint8Array, ts?: number) => {
      calls.push({ data, ts });
    },
  } as unknown as MIDIOutput;
  return { output, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("playTestNote — constants (Q-UX6)", () => {
  it("uses note 60, velocity 100, duration 300 ms", () => {
    expect(TEST_NOTE).toBe(60);
    expect(TEST_VELOCITY).toBe(100);
    expect(TEST_NOTE_DURATION_MS).toBe(300);
  });
});

describe("playTestNote — noteOn then noteOff after 300 ms", () => {
  it("sends noteOn [0x90|ch, 60, 100] immediately", () => {
    const { output, calls } = makeOutput();
    playTestNote(output, 0);
    expect(calls).toHaveLength(1);
    expect(Array.from(calls[0].data)).toEqual([0x90, 60, 100]);
    // Immediate send: no scheduled timestamp.
    expect(calls[0].ts).toBeUndefined();
  });

  it("sends noteOff [0x80|ch, 60, 0] after exactly 300 ms", () => {
    const { output, calls } = makeOutput();
    playTestNote(output, 0);
    // Before the 300 ms gap: only the noteOn.
    vi.advanceTimersByTime(299);
    expect(calls).toHaveLength(1);
    // At 300 ms: the noteOff fires.
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(2);
    expect(Array.from(calls[1].data)).toEqual([0x80, 60, 0]);
    expect(calls[1].ts).toBeUndefined();
  });

  it("canal 0 → status bytes 0x90 (noteOn) / 0x80 (noteOff)", () => {
    const { output, calls } = makeOutput();
    playTestNote(output, 0);
    vi.advanceTimersByTime(TEST_NOTE_DURATION_MS);
    expect(calls[0].data[0]).toBe(0x90);
    expect(calls[1].data[0]).toBe(0x80);
  });

  it("canal 15 → status bytes 0x9f (noteOn) / 0x8f (noteOff)", () => {
    const { output, calls } = makeOutput();
    playTestNote(output, 15);
    vi.advanceTimersByTime(TEST_NOTE_DURATION_MS);
    expect(Array.from(calls[0].data)).toEqual([0x9f, 60, 100]);
    expect(Array.from(calls[1].data)).toEqual([0x8f, 60, 0]);
  });

  it("does not send the noteOff before 300 ms elapse", () => {
    const { output, calls } = makeOutput();
    playTestNote(output, 5);
    vi.advanceTimersByTime(150);
    expect(calls).toHaveLength(1); // only noteOn
  });

  it("never sends SysEx (status bytes are channel-voice only)", () => {
    const { output, calls } = makeOutput();
    playTestNote(output, 7);
    vi.advanceTimersByTime(TEST_NOTE_DURATION_MS);
    for (const { data } of calls) {
      const status = data[0] & 0xf0;
      // 0x90 = noteOn, 0x80 = noteOff — never 0xf0 (SysEx) or any system byte.
      expect(status === 0x90 || status === 0x80).toBe(true);
    }
  });
});