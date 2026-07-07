// TS fixture: real TypeScript syntax (interface + typed const). Leaf target.
export interface MidiNote {
  pitch: number;
  velocity: number;
  channel: number;
}

export const ent: MidiNote = { pitch: 60, velocity: 100, channel: 0 };