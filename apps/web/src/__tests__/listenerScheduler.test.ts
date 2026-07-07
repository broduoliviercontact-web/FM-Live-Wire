// Story 4.3 — listener scheduler unit tests (AD-11, minimal version).
//
// Pure: `scheduleMidiBytes(output, data, now?)` computes
// `target = now + LOOKAHEAD_MS` (40 ms) and calls `output.send(data, target)`.
// No buffer, no drop, no fallback — this is the minimal lookahead-only
// scheduler (backpressure lands in Epic 5).
//
// `now` is injectable so the clock is deterministic; the default
// (`performance.now()`) is covered by spying on the global.
import { describe, it, expect, vi, afterEach } from "vitest";
import { LOOKAHEAD_MS } from "../config/runtime";
import { scheduleMidiBytes } from "../features/listener/lib/scheduler";

function makeOutput() {
  const send = vi.fn((data: Uint8Array, ts: number) => undefined);
  return { send, output: { send } as unknown as MIDIOutput };
}

describe("scheduleMidiBytes — minimal lookahead scheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("LOOKAHEAD_MS is 40 ms (AD-11 confirmed default)", () => {
    expect(LOOKAHEAD_MS).toBe(40);
  });

  it("target = now + 40 ; calls output.send(data, target) with injected now=1000", () => {
    const { send, output } = makeOutput();
    const data = new Uint8Array([0x90, 60, 100]);
    scheduleMidiBytes(output, data, 1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(data, 1040);
  });

  it("uses performance.now() by default (clock injected via spy) → target = now+40", () => {
    const spy = vi.spyOn(performance, "now").mockReturnValue(2000);
    const { send, output } = makeOutput();
    const data = new Uint8Array([0x80, 60, 0]);
    scheduleMidiBytes(output, data); // no `now` → default performance.now()
    expect(spy).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(data, 2040);
  });

  it("passes `data` by reference (no copy / no mutation)", () => {
    const { send, output } = makeOutput();
    const data = new Uint8Array([0xb0, 7, 90]);
    scheduleMidiBytes(output, data, 0);
    const received = send.mock.calls[0][0] as Uint8Array;
    expect(received).toBe(data); // same reference
  });

  it("creates NO buffer / drop / fallback — single send, returns void, no state", () => {
    const { send, output } = makeOutput();
    const data = new Uint8Array([0xc0, 42]);
    const result = scheduleMidiBytes(output, data, 500);
    expect(result).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    // A second independent call sends exactly once more (no accumulation).
    scheduleMidiBytes(output, data, 510);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toBe(550);
  });
});