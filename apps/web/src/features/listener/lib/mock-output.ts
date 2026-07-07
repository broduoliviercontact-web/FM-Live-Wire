// Story 5.1 — Mock / Debug output (AD-14, FR-12, NFR-19, UX-DR7/12/13).
//
// `MockMidiOutput` is an output interchangeable with a real Web MIDI `MIDIOutput`:
// it implements `MidiSendable` (`{ send(bytes, ts) }`) so the Story 4.3 scheduler
// forwards events to it exactly as to a hardware port — the pipeline
// `socket → remap → encode → schedule → output.send` is unchanged. The Mock
// produces NO sound and opens NO hardware port: it only captures the bytes for
// on-screen visualization (`MockByteStream`), which makes the whole chain
// testable in CI without a MIDI device (NFR-19).
//
// A single shared instance (`getMockMidiOutput()`) is used by the listener
// connection (via `useMidiOutputs().getOutput(MOCK_OUTPUT_ID)`) AND observed by
// `MockByteStream`, so a `send` from the scheduler re-renders the stream. The
// instance is a module singleton (like the shared listener socket): one Mock
// output per listener, no per-event allocation.
//
// Selection: the listener store holds the chosen output id; `MOCK_OUTPUT_ID`
// is the sentinel id for the Mock. `useMidiOutputs().getOutput(id)` returns this
// singleton when `id === MOCK_OUTPUT_ID`, and the real `MIDIOutput` otherwise —
// so `JoinButton` / `TestNoteButton` (which gate on `selectedOutputId !== null`
// and call `getOutput`) work unchanged for both Mock and real.
//
// No SysEx is ever produced or captured here; the Mock only records what the
// pipeline already sends (channel-voice bytes from `encodeForOutput` /
// `playTestNote`). No buffer bound, no fallback, no late-event handling
// (those are Epic 5).

import type { MidiSendable } from "./sendable";

/** Sentinel output id meaning "the Mock / Debug output is selected". */
export const MOCK_OUTPUT_ID = "mock";

/** A captured Mock message: the raw bytes + the optional scheduling timestamp. */
export interface MockMidiMessage {
  readonly data: Uint8Array;
  readonly timestamp: number | undefined;
}

/** A decoded, displayable line for `MockByteStream` (one per captured message). */
export interface MockMidiLine {
  /** Short type label, also used as the `data-type` attribute (color hook). */
  readonly type: "noteOn" | "noteOff" | "cc" | "program" | "pitchBend";
  /** The exact monospace line, e.g. `noteOn · ch1 · 60 · 100`. */
  readonly text: string;
}

type Listener = () => void;

/**
 * A Mock MIDI output: captures `send(bytes, ts)` calls for on-screen display.
 * Implements `MidiSendable` so the scheduler treats it like a real `MIDIOutput`.
 * Produces no sound and opens no port. Notifies subscribers on each `send` so a
 * React component (`MockByteStream`) can re-render via `useSyncExternalStore`.
 */
export class MockMidiOutput implements MidiSendable {
  /** Captured messages in arrival order (newest at the end). */
  readonly messages: MockMidiMessage[] = [];
  private version = 0;
  private readonly listeners = new Set<Listener>();

  send(data: Uint8Array, timestamp?: number): void {
    // Copy so later mutation of the caller's buffer does not affect the capture.
    this.messages.push({ data: new Uint8Array(data), timestamp });
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  /** Subscribe to `send` events; returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** A monotonically increasing counter — the `useSyncExternalStore` snapshot. */
  getVersion(): number {
    return this.version;
  }

  /** Test-only: clear captured messages + reset the version (no notify). */
  reset(): void {
    this.messages.length = 0;
    this.version = 0;
  }
}

// --- module singleton --------------------------------------------------------

let singleton: MockMidiOutput | null = null;

/**
 * The shared Mock output for the listener. The connection's `getOutput` returns
 * this for `MOCK_OUTPUT_ID`, and `MockByteStream` subscribes to the same
 * instance — so a `send` from the scheduler reaches the stream.
 */
export function getMockMidiOutput(): MockMidiOutput {
  if (singleton === null) singleton = new MockMidiOutput();
  return singleton;
}

/** Test-only: clear the shared Mock singleton between tests (no message leak). */
export function __resetMockMidiOutput(): void {
  if (singleton !== null) singleton.reset();
}

// --- pure byte → display line decoder ----------------------------------------

/**
 * Decode raw MIDI channel-voice bytes into a displayable `MockMidiLine`, or
 * `null` for unknown / system / too-short messages. The channel is decoded from
 * the status byte (`status & 0x0f`), then shown as UI 1–16 (`+ 1`).
 *
 * Exact formats (UX-DR22 monospace):
 *   - noteOn     `noteOn · ch{n} · {note} · {velocity}`
 *   - noteOff    `noteOff · ch{n} · {note} · {velocity}`
 *   - cc         `cc · ch{n} · {controller} · {value}`
 *   - program    `program · ch{n} · {program}`
 *   - pitchBend  `pitchBend · ch{n} · {14-bit value}`
 */
export function formatMockLine(data: Uint8Array): MockMidiLine | null {
  if (data.length < 1) return null;
  // `data[0]` is guaranteed defined by the length check above; the non-null
  // assertion is the idiomatic post-guard narrowing (no unreachable branch).
  const status = data[0]!;
  const high = status & 0xf0;
  const ch = (status & 0x0f) + 1;

  switch (high) {
    case 0x90: {
      // noteOn
      const note = data[1];
      const vel = data[2];
      if (note === undefined || vel === undefined) return null;
      return { type: "noteOn", text: `noteOn · ch${ch} · ${note} · ${vel}` };
    }
    case 0x80: {
      // noteOff
      const note = data[1];
      const vel = data[2];
      if (note === undefined || vel === undefined) return null;
      return { type: "noteOff", text: `noteOff · ch${ch} · ${note} · ${vel}` };
    }
    case 0xb0: {
      // controlChange → `cc`
      const controller = data[1];
      const value = data[2];
      if (controller === undefined || value === undefined) return null;
      return { type: "cc", text: `cc · ch${ch} · ${controller} · ${value}` };
    }
    case 0xc0: {
      // programChange → `program`
      const program = data[1];
      if (program === undefined) return null;
      return { type: "program", text: `program · ch${ch} · ${program}` };
    }
    case 0xe0: {
      // pitchBend: 14-bit (msb<<7)|lsb
      const lsb = data[1];
      const msb = data[2];
      if (lsb === undefined || msb === undefined) return null;
      const value = (msb << 7) | lsb;
      return { type: "pitchBend", text: `pitchBend · ch${ch} · ${value}` };
    }
    default:
      // SysEx (0xF0), system-realtime, channel-pressure (0xD0), etc. → unknown.
      return null;
  }
}