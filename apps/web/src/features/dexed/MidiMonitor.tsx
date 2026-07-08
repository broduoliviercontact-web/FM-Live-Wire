// Dexed/WAM spike — MIDI monitor (isolated in features/dexed/).
//
// Shows the last 10 note on/off messages received from the Web MIDI input,
// with note name + MIDI number, velocity (note on), channel and source (the
// input name/id). Newest first. "Clear monitor" empties the list.
//
// Pure presentational: the capped buffer lives in `DexedHost` (the single note
// handler already drives the synth), so this component just renders props.

import { Button } from "../../shared/ui/button";
import { noteName } from "./notes";

export interface MonitorEntry {
  readonly id: number;
  readonly kind: "noteOn" | "noteOff";
  readonly note: number;
  readonly velocity: number;
  readonly channel: number;
  readonly source: string;
}

interface MidiMonitorProps {
  messages: MonitorEntry[];
  onClear: () => void;
}

export function MidiMonitor({ messages, onClear }: MidiMonitorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">MIDI monitor</span>
        <Button type="button" variant="outline" onClick={onClear}>
          Clear monitor
        </Button>
      </div>
      <div className="flex flex-col gap-1 rounded-md border border-input bg-background p-2 font-mono text-xs">
        {messages.length === 0 ? (
          <span className="text-muted-foreground">Aucun message.</span>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-2">
              <span
                className={
                  m.kind === "noteOn"
                    ? "text-connected"
                    : "text-muted-foreground"
                }
              >
                {m.kind === "noteOn" ? "Note On " : "Note Off"}
              </span>
              <span className="text-foreground">
                {noteName(m.note)} (MIDI {m.note})
              </span>
              {m.kind === "noteOn" ? (
                <span className="text-muted-foreground">vel {m.velocity}</span>
              ) : null}
              <span className="text-muted-foreground">ch {m.channel}</span>
              <span className="ml-auto truncate text-muted-foreground">
                {m.source}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}