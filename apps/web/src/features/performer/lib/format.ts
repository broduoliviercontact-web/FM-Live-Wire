import type { MidiEvent } from "../../../entities/MidiEvent";

// Story 3.4 — pure UI formatting for the MonitoringPanel (UX-DR22: mono data
// line `TYPE · CH · VAL`). No React, no I/O — unit-testable in node.
//
// `channel` is shown 1–16 (UX); the wire payload keeps 0–15 (AD-12).

/**
 * Format a `MidiEvent` as a single mono line `TYPE · CH · VAL` covering the 5
 * allowed types. `CH` is 1-based for display.
 */
export function formatMidiEvent(event: MidiEvent): string {
  const ch = event.channel + 1; // UI 1–16 (wire is 0–15)
  switch (event.type) {
    case "noteOn":
      return `noteOn · CH ${ch} · note=${event.note} vel=${event.velocity}`;
    case "noteOff":
      return `noteOff · CH ${ch} · note=${event.note} vel=${event.velocity}`;
    case "controlChange":
      return `controlChange · CH ${ch} · cc=${event.controller} val=${event.value}`;
    case "programChange":
      return `programChange · CH ${ch} · prog=${event.program}`;
    case "pitchBend":
      return `pitchBend · CH ${ch} · bend=${event.pitchBend}`;
  }
}

// --- French pluralisation (UX-DR21, `Intl.PluralRules('fr-FR')`) ------------

const frPlural = new Intl.PluralRules("fr-FR");

/**
 * Render `count` + a French pluralised noun. French treats 0 and 1 as singular
 * ("0 event envoyé", "1 event envoyé"), ≥2 as plural — so this must use
 * `Intl.PluralRules` and not a naive `count === 1` check.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${frPlural.select(count) === "one" ? singular : plural}`;
}