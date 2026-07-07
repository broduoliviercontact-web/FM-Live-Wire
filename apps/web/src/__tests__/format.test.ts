// Story 3.4 — pure formatting unit tests (UX-DR21, UX-DR22).
//
// `formatMidiEvent` covers the 5 types as `TYPE · CH · VAL` with CH 1–16; the
// payload channel stays 0–15 (the formatter adds 1 for display). `pluralize`
// uses `Intl.PluralRules('fr-FR')` — proven by the 0 → singular case (a naive
// `count === 1` check would render "0 events envoyés", which is wrong in FR).
import { describe, it, expect } from "vitest";
import { formatMidiEvent, pluralize } from "../features/performer/lib/format";
import type { MidiEvent } from "../entities/MidiEvent";

const base = { v: 1, roomId: "fm-live-wire:main", seq: 1, ts: 1 } as const;

function ev(over: Partial<MidiEvent>): MidiEvent {
  return { ...base, ...over } as MidiEvent;
}

describe("formatMidiEvent — 5 types as `TYPE · CH · VAL` (CH 1–16)", () => {
  it("noteOn", () => {
    const s = formatMidiEvent(ev({ type: "noteOn", channel: 0, note: 60, velocity: 100 }));
    expect(s).toBe("noteOn · CH 1 · note=60 vel=100");
  });

  it("noteOff", () => {
    const s = formatMidiEvent(ev({ type: "noteOff", channel: 2, note: 72, velocity: 0 }));
    expect(s).toBe("noteOff · CH 3 · note=72 vel=0");
  });

  it("controlChange", () => {
    const s = formatMidiEvent(
      ev({ type: "controlChange", channel: 4, controller: 7, value: 99 }),
    );
    expect(s).toBe("controlChange · CH 5 · cc=7 val=99");
  });

  it("programChange", () => {
    const s = formatMidiEvent(ev({ type: "programChange", channel: 0, program: 42 }));
    expect(s).toBe("programChange · CH 1 · prog=42");
  });

  it("pitchBend", () => {
    const s = formatMidiEvent(ev({ type: "pitchBend", channel: 15, pitchBend: 8192 }));
    expect(s).toBe("pitchBend · CH 16 · bend=8192");
  });

  it("channel wire 15 → display CH 16 (edge conversion only at the edge)", () => {
    const s = formatMidiEvent(ev({ type: "programChange", channel: 15, program: 0 }));
    expect(s).toContain("CH 16");
  });
});

describe("pluralize — Intl.PluralRules('fr-FR')", () => {
  it("0 → singular (French treats 0 as singular)", () => {
    expect(pluralize(0, "event envoyé", "events envoyés")).toBe("0 event envoyé");
  });

  it("1 → singular", () => {
    expect(pluralize(1, "event envoyé", "events envoyés")).toBe("1 event envoyé");
  });

  it("2 → plural", () => {
    expect(pluralize(2, "event envoyé", "events envoyés")).toBe("2 events envoyés");
  });

  it("large numbers → plural", () => {
    expect(pluralize(42, "event envoyé", "events envoyés")).toBe("42 events envoyés");
  });

  it("listeners pluralisation", () => {
    expect(pluralize(1, "listener", "listeners")).toBe("1 listener");
    expect(pluralize(3, "listener", "listeners")).toBe("3 listeners");
  });

  it("erreurs récentes pluralisation", () => {
    expect(pluralize(0, "erreur récente", "erreurs récentes")).toBe("0 erreur récente");
    expect(pluralize(5, "erreur récente", "erreurs récentes")).toBe("5 erreurs récentes");
  });

  it("proves Intl.PluralRules is used (FR 0 is singular — a naive ===1 check fails here)", () => {
    // A naive `count === 1 ? singular : plural` would render "0 events envoyés".
    // The FR plural rule selects "one" for 0 → singular. This asserts that path.
    expect(new Intl.PluralRules("fr-FR").select(0)).toBe("one");
    expect(pluralize(0, "event envoyé", "events envoyés")).toBe("0 event envoyé");
  });
});