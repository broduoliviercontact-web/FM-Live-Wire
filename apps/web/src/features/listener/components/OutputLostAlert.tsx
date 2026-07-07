import { Alert, AlertDescription } from "../../../shared/ui/alert";
import { DangerIcon } from "../../../shared/ui/icons";
import { useListenerStore } from "../store/listenerStore";

// Story 5.5 — E5 output-lost alert (AD-17, FR-24, UX-DR14, AC-U9).
//
// Shown when the selected MIDI output was lost in session (the port was
// unplugged / went `state:"disconnected"`, OR `output.send` threw
// `InvalidStateError` because the port is closed). The scheduler is STOPPED
// (fail-safe — no in-flight bytes, no orphan notes), the selection is cleared so
// the `MidiPortPicker` reopens, and this Alert tells the listener what happened
// + what to do — exact text
// « Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre
//   sortie. ».
//
// Driven by the LOCAL `outputLost` flag in `listenerStore` (raised by the
// reception wiring `handleOutputLost` + the `useOutputState` watcher). LOCAL
// PUR (FR-27 / AD-17): no network event is ever emitted — the flag is set in the
// store only. The Alert is dismissed when the listener picks a new sortie
// (`setSelectedOutput` with a non-null id clears `outputLost`).
//
// Purely presentational — no `MidiSendable` dependency, no socket, no side effect.

/** Exact E5 message (UX-DR14 / AC-U9). */
export const OUTPUT_LOST_MESSAGE =
  "Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie.";

export function OutputLostAlert() {
  const outputLost = useListenerStore((s) => s.outputLost);
  if (!outputLost) return null;
  return (
    <Alert
      variant="danger"
      data-testid="listener-output-lost-alert"
      role="alert"
    >
      <DangerIcon />
      <AlertDescription>{OUTPUT_LOST_MESSAGE}</AlertDescription>
    </Alert>
  );
}