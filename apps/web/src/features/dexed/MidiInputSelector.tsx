// Dexed/WAM spike — MIDI input selector (isolated in features/dexed/).
//
// Presentational `<select>` bound to the Web MIDI input list exposed by
// `useWebMidiInput`. `selectedInputId === null` maps to the "Tous les inputs"
// option (every detected input fires). Pure props — no hook usage, so it
// stays easy to test and stays out of the audio path.

import { useId } from "react";
import type { MidiInputInfo } from "./useWebMidiInput";

interface MidiInputSelectorProps {
  inputs: MidiInputInfo[];
  /** `null` = "Tous les inputs". */
  selectedInputId: string | null;
  onSelect: (id: string | null) => void;
  disabled: boolean;
}

export function MidiInputSelector({
  inputs,
  selectedInputId,
  onSelect,
  disabled,
}: MidiInputSelectorProps) {
  const reactId = useId();
  return (
    <label
      htmlFor={reactId}
      className="flex items-center gap-2 text-sm"
    >
      <span className="text-muted-foreground">Entrée MIDI</span>
      <select
        id={reactId}
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
        value={selectedInputId ?? ""}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">Tous les inputs</option>
        {inputs.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name.length > 0 ? i.name : i.id}
            {i.manufacturer.length > 0 ? ` — ${i.manufacturer}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}