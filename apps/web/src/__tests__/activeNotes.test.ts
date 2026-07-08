// Anti-stuck-notes safety — pure unit tests for `lib/active-notes.ts`.
//
// The tracker records notes ACTUALLY sent to a listener output (AFTER channel
// remap, keyed by `outputId + channel + note`) so the safety paths can send
// EXPLICIT noteOffs for the still-sounding ones. These tests cover the tracker
// state machine + the best-effort send helpers in isolation (node env, no DOM,
// no socket, no store). The end-to-end orchestration (port change / channel
// change / Panic / output-lost / leave) is covered in `listenerNoteSafety.test.tsx`.
//
// Coverage gate: this module is one of the CI-gated critical modules, so every
// branch (noteOn vel>0 / vel0 / short, noteOff / short, other status, empty
// data, add new vs existing, remove present vs absent, clear present vs absent,
// the best-effort catch on a throwing output) is exercised below.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createActiveNoteTracker,
  sendTrackedNoteOffs,
  sendChannelAllNotesOff,
  sendOutputTrackedNoteOffs,
} from "../features/listener/lib/active-notes";
import type { MidiSendable } from "../features/listener/lib/sendable";

/** A recording `MidiSendable`: captures every `send(data, ts)` for assertions. */
interface CapturedSend {
  data: Uint8Array;
  ts: number | undefined;
}
function recordingOutput(): MidiSendable & { sends: CapturedSend[] } {
  const sends: CapturedSend[] = [];
  return {
    sends,
    send(data: Uint8Array, ts?: number) {
      sends.push({ data: new Uint8Array(data), ts });
    },
  };
}

/**
 * A `MidiSendable` that throws on `send` for the notes in `throwOn` (by note
 * number) and records the rest — proves the best-effort catch does not abort the
 * sweep and never propagates the throw.
 */
function partialThrowingOutput(throwOn: Set<number>): MidiSendable & {
  sends: CapturedSend[];
} {
  const sends: CapturedSend[] = [];
  return {
    sends,
    send(data: Uint8Array, ts?: number) {
      const note = data[1];
      if (note !== undefined && throwOn.has(note)) {
        throw new Error("port died mid-sweep");
      }
      sends.push({ data: new Uint8Array(data), ts });
    },
  };
}

/** A `MidiSendable` whose `send` always throws — proves the catch is hit. */
function alwaysThrowingOutput(): MidiSendable {
  return {
    send() {
      throw new Error("port gone");
    },
  };
}

// --- tracker state machine --------------------------------------------------

describe("active-note tracker — add / remove / clear", () => {
  it("noteOn velocity > 0 adds (channel, note); noteOff removes it", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1"); // noteOn ch0 note60
    t.trackMidiBytes(new Uint8Array([0x91, 62, 80]), "o1"); // noteOn ch1 note62
    expect(t.size).toBe(2);
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([60]);
    expect(Array.from(t.getNotesForChannel("o1", 1))).toEqual([62]);
    // noteOff ch0 note60 → removed.
    t.trackMidiBytes(new Uint8Array([0x80, 60, 0]), "o1");
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([]);
    expect(t.size).toBe(1);
  });

  it("noteOn velocity 0 is a release (removes the note, not adds)", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 64, 100]), "o1");
    expect(t.size).toBe(1);
    t.trackMidiBytes(new Uint8Array([0x90, 64, 0]), "o1"); // vel 0 = noteOff
    expect(t.size).toBe(0);
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([]);
  });

  it("re-adding an already-sounding note is idempotent (no duplicate)", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1");
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1"); // same note again
    expect(t.size).toBe(1); // Set dedupes
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([60]);
  });

  it("removing a note that is NOT sounding is a no-op (no throw)", () => {
    const t = createActiveNoteTracker();
    // remove on an output/channel/note that was never added
    t.trackMidiBytes(new Uint8Array([0x80, 60, 0]), "o1");
    t.trackMidiBytes(new Uint8Array([0x90, 72, 100]), "o1"); // add a different one
    t.trackMidiBytes(new Uint8Array([0x85, 72, 0]), "o1"); // noteOff on ch5 (never added there)
    expect(t.size).toBe(1);
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([72]);
  });

  it("notes are tracked PER output (the key that lets a port change target the OLD output)", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1");
    t.trackMidiBytes(new Uint8Array([0x90, 64, 100]), "o2");
    expect(t.size).toBe(2);
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([60]);
    expect(Array.from(t.getNotesForChannel("o2", 0))).toEqual([64]);
  });

  it("CC / program / pitchBend / SysEx are NOT note-tracked (ignored)", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0xb0, 7, 90]), "o1"); // CC
    t.trackMidiBytes(new Uint8Array([0xc0, 42]), "o1"); // program
    t.trackMidiBytes(new Uint8Array([0xe0, 0x00, 0x40]), "o1"); // pitchBend
    t.trackMidiBytes(new Uint8Array([0xf0]), "o1"); // SysEx / system
    t.trackMidiBytes(new Uint8Array([0xd0, 64]), "o1"); // channel-pressure
    expect(t.size).toBe(0);
  });

  it("too-short messages are ignored (no crash, no tracking)", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([]), "o1"); // empty
    t.trackMidiBytes(new Uint8Array([0x90]), "o1"); // noteOn, no note+vel
    t.trackMidiBytes(new Uint8Array([0x90, 60]), "o1"); // noteOn, no vel
    t.trackMidiBytes(new Uint8Array([0x80]), "o1"); // noteOff, no note
    expect(t.size).toBe(0);
  });

  it("getNotesForOutput / getNotesForChannel return empty for an unknown output", () => {
    const t = createActiveNoteTracker();
    expect(t.getNotesForOutput("nope").size).toBe(0);
    expect(t.getNotesForChannel("nope", 0).size).toBe(0);
  });

  it("getAllNotes returns a read-only snapshot of the whole tracker", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1");
    t.trackMidiBytes(new Uint8Array([0x91, 62, 80]), "o1");
    const all = t.getAllNotes();
    expect(all.size).toBe(1);
    const o1 = all.get("o1")!;
    expect(o1.size).toBe(2); // two channels
    expect(Array.from(o1.get(0)!)).toEqual([60]);
    expect(Array.from(o1.get(1)!)).toEqual([62]);
  });
});

describe("active-note tracker — clear paths", () => {
  it("clearOutput forgets all notes for one output only", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1");
    t.trackMidiBytes(new Uint8Array([0x90, 64, 100]), "o2");
    t.clearOutput("o1");
    expect(t.getNotesForOutput("o1").size).toBe(0);
    expect(Array.from(t.getNotesForChannel("o2", 0))).toEqual([64]); // o2 intact
    expect(t.size).toBe(1);
  });

  it("clearOutput on an unknown output is a no-op", () => {
    const t = createActiveNoteTracker();
    t.clearOutput("never");
    expect(t.size).toBe(0);
  });

  it("clearChannel forgets one channel's notes and prunes the empty channel", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1"); // ch0
    t.trackMidiBytes(new Uint8Array([0x91, 62, 80]), "o1"); // ch1
    t.clearChannel("o1", 0);
    expect(Array.from(t.getNotesForChannel("o1", 0))).toEqual([]);
    expect(Array.from(t.getNotesForChannel("o1", 1))).toEqual([62]); // ch1 intact
    expect(t.size).toBe(1);
  });

  it("clearChannel that empties the LAST channel prunes the output entry too", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1");
    t.clearChannel("o1", 0);
    expect(t.getNotesForOutput("o1").size).toBe(0); // output pruned
    expect(t.size).toBe(0);
  });

  it("clearChannel on an unknown output/channel is a no-op", () => {
    const t = createActiveNoteTracker();
    t.clearChannel("never", 0);
    expect(t.size).toBe(0);
  });

  it("clearAll forgets everything", () => {
    const t = createActiveNoteTracker();
    t.trackMidiBytes(new Uint8Array([0x90, 60, 100]), "o1");
    t.trackMidiBytes(new Uint8Array([0x90, 64, 100]), "o2");
    t.clearAll();
    expect(t.size).toBe(0);
    expect(t.getNotesForOutput("o1").size).toBe(0);
    expect(t.getNotesForOutput("o2").size).toBe(0);
  });
});

// --- best-effort send helpers -----------------------------------------------

describe("sendTrackedNoteOffs — explicit noteOff, best-effort", () => {
  it("sends one noteOff `[0x80|ch, note, 0]` per note, with the given timestamp", () => {
    const out = recordingOutput();
    const notes = new Set([60, 62, 64]);
    sendTrackedNoteOffs(out, notes, 5, 1234);
    expect(out.sends).toHaveLength(3);
    for (const s of out.sends) {
      expect(s.ts).toBe(1234);
      expect(s.data[0]).toBe(0x85); // 0x80 | 5
      expect(s.data[2]).toBe(0); // velocity 0
    }
    expect(out.sends.map((s) => s.data[1]).sort((a, b) => a - b)).toEqual([
      60, 62, 64,
    ]);
  });

  it("a throw on ONE note does not abort the rest and never propagates", () => {
    const out = partialThrowingOutput(new Set([62])); // throws on note 62
    const notes = new Set([60, 62, 64]);
    expect(() => sendTrackedNoteOffs(out, notes, 0, 9)).not.toThrow();
    // note 62 threw → only 60 and 64 were recorded.
    expect(out.sends.map((s) => s.data[1]).sort((a, b) => a - b)).toEqual([
      60, 64,
    ]);
  });

  it("an output that always throws is fully swallowed (no propagation, 0 sends)", () => {
    const out = alwaysThrowingOutput();
    expect(() =>
      sendTrackedNoteOffs(out, new Set([60, 62]), 0, 1),
    ).not.toThrow();
  });

  it("an empty note set sends nothing", () => {
    const out = recordingOutput();
    sendTrackedNoteOffs(out, new Set(), 0, 1);
    expect(out.sends).toHaveLength(0);
  });
});

describe("sendChannelAllNotesOff — CC 120 + CC 123 on one channel, best-effort", () => {
  it("sends CC 120 then CC 123 on the given channel (2 messages)", () => {
    const out = recordingOutput();
    sendChannelAllNotesOff(out, 3, 200);
    expect(out.sends).toHaveLength(2);
    expect(out.sends[0]!.data).toEqual(new Uint8Array([0xb3, 120, 0]));
    expect(out.sends[0]!.ts).toBe(200);
    expect(out.sends[1]!.data).toEqual(new Uint8Array([0xb3, 123, 0]));
  });

  it("a throw on CC 120 does not abort CC 123 and never propagates", () => {
    const out: MidiSendable & { sends: CapturedSend[] } = {
      sends: [] as CapturedSend[],
      send(data: Uint8Array, ts?: number) {
        if (data[1] === 120) throw new Error("died on 120");
        (this as unknown as { sends: CapturedSend[] }).sends.push({
          data: new Uint8Array(data),
          ts,
        });
      },
    };
    expect(() => sendChannelAllNotesOff(out, 0, 1)).not.toThrow();
    expect(out.sends).toHaveLength(1);
    expect(out.sends[0]!.data).toEqual(new Uint8Array([0xb0, 123, 0]));
  });
});

describe("sendOutputTrackedNoteOffs — per-channel sweep over an output", () => {
  it("sends noteOffs for every active (channel, note) of the output", () => {
    const out = recordingOutput();
    const perChannel = new Map([
      [0, new Set([60, 62])],
      [3, new Set([72])],
    ]);
    sendOutputTrackedNoteOffs(out, perChannel, 555);
    expect(out.sends).toHaveLength(3);
    // ch0 → 0x80, ch3 → 0x83
    const statuses = out.sends.map((s) => s.data[0]).sort();
    expect(statuses).toEqual([0x80, 0x80, 0x83]);
    expect(out.sends.every((s) => s.ts === 555 && s.data[2] === 0)).toBe(true);
  });

  it("an empty per-channel map sends nothing", () => {
    const out = recordingOutput();
    sendOutputTrackedNoteOffs(out, new Map(), 1);
    expect(out.sends).toHaveLength(0);
  });
});

// --- pure-module import check (no socket / no store / no network) -----------

describe("active-notes.ts — pure module (no socket / no store / no network)", () => {
  const source = readFileSync(
    join(import.meta.dirname!, "../features/listener/lib/active-notes.ts"),
    "utf8",
  );
  it("imports ONLY the local MidiSendable type (no socket, no store, no network)", () => {
    expect(source).not.toContain("socket.io-client");
    expect(source).not.toContain("/api/socket");
    expect(source).not.toContain("listenerStore");
    expect(source).not.toContain("io(");
  });
  it("never emits a network event / never constructs a SysEx message", () => {
    expect(source).not.toContain("socket.emit");
    // The only bytes this module constructs are noteOff `[0x80|ch, note, 0]` and
    // CC `[0xb0|ch, controller, 0]` — never a SysEx status byte (0xF0). (The
    // `& 0xf0` mask in the tracker is a read mask, not a sent byte.)
    expect(source).not.toMatch(/new Uint8Array\(\[0x[fF]0/);
  });
});