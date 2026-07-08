// Dexed/WAM spike — pure MIDI-note → name helper (isolated in features/dexed/).
//
// Shared by the virtual keyboard (key labels) and the MIDI monitor (event
// lines). Scientific pitch convention: MIDI 60 -> "C4", MIDI 69 -> "A4"
// (so A4 = 440 Hz matches `midiToFreq` in DexedHost).

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Scientific pitch name, e.g. MIDI 60 -> "C4", MIDI 61 -> "C#4". */
export function noteName(note: number): string {
  const name = NOTE_NAMES[note % 12] ?? "?";
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}