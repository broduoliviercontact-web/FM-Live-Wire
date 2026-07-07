import { toast } from "sonner";
import { Button } from "../../../shared/ui/button";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import { useListenerStore } from "../store/listenerStore";
import { useListenerConnection } from "../api/connection";
import { playTestNote } from "../lib/test-note";

// Story 4.4 — local test note button (FR-14, UX-DR9, Q-UX6, AC-U4).
//
// Plays the standard local test note (note 60, velocity 100, 300 ms) on the
// listener's chosen output + channel, emits `midi:test` to the server
// (listener→server, FR-18/2.7; the server acks but plays NO sound — the note
// is local), and shows a transient toast « Note de test envoyée. ».
//
// The note can be played BEFORE joining the flux: it only needs an output +
// channel. `useListenerConnection().emitMidiTest()` opens a listener socket
// WITHOUT joining (no implicit `room:join`) when none is open yet, and reuses
// the shared socket otherwise (no two concurrent listener sockets).
//
// Disabled until an output is selected (channel always defaults to a valid
// 0–15), with the exact hint « Choisissez une sortie et un canal pour tester. ».
// No SysEx. The raw bytes are not shown in this story (a byte visualizer is a
// later story).

/** Exact AC hint shown when the test note cannot be played (no output). */
const NO_OUTPUT_CHANNEL_HINT = "Choisissez une sortie et un canal pour tester.";

export function TestNoteButton() {
  const { getOutput } = useMidiOutputs();
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);
  const channel = useListenerStore((s) => s.channel);
  const { emitMidiTest } = useListenerConnection();

  // Channel always has a valid 0–15 default, so the only blocker is no output.
  const disabled = selectedOutputId === null;

  const handleClick = () => {
    if (selectedOutputId === null) return;
    const output = getOutput(selectedOutputId);
    if (output === null) return; // hot-unplug → no play, no crash
    // Local test tone (immediate noteOn + noteOff after 300 ms).
    playTestNote(output, channel);
    // Listener→server ping (no server sound, no broadcast).
    emitMidiTest();
    // Transient confirmation (UX-DR23).
    toast.success("Note de test envoyée.");
  };

  return (
    <div className="space-y-1">
      <Button
        onClick={handleClick}
        disabled={disabled}
        data-testid="listener-test-note-button"
      >
        Note de test
      </Button>
      {disabled && (
        <p
          data-testid="listener-test-note-hint"
          className="text-xs text-muted-foreground"
        >
          {NO_OUTPUT_CHANNEL_HINT}
        </p>
      )}
    </div>
  );
}