import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../shared/ui/button";
import { WarnIcon } from "../../../shared/ui/icons";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import { useListenerStore } from "../store/listenerStore";
import { sendForcePanic } from "../lib/force-panic";
import { ForcePanicDialog, FORCE_PANIC_TOAST } from "./ForcePanicDialog";

// Story 5.3 — Force Panic opt-in button (FR-17, AC-U14, UX-DR16, UX-DR23).
//
// Secondary, opt-in: it opens a confirmation dialog (`ForcePanicDialog`) and
// sends NOTHING on click — only after the user confirms does the 2048-message
// noteOff sweep run on the local selected output. Unlike the Story 5.2
// `PanicButton` (always enabled, the escape hatch), this button is DISABLED
// until a local output is selected: a 2048-message sweep with no output would
// be a wasteful no-op, and Force Panic is opt-in anyway. The normal Panic
// stays untouched and remains the always-available escape hatch.
//
// Like Panic, Force Panic is fully local: it resolves the output via
// `useMidiOutputs().getOutput(id)` (real `MIDIOutput` or `MockMidiOutput`) and
// calls `sendForcePanic(output)` — no dependency on the live network link, so
// it works with the backend down. No network emit, no server handler, no
// join/leave handshake.

export function ForcePanicButton() {
  const { getOutput } = useMidiOutputs();
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);
  const [open, setOpen] = useState(false);

  // Disabled until a local output is selected (opt-in + avoids a wasteful
  // 2048-message no-op in the void). The normal Panic stays always enabled.
  const disabled = selectedOutputId === null;

  const handleConfirm = () => {
    if (selectedOutputId === null) return; // no output → no send (guarded)
    const output = getOutput(selectedOutputId);
    if (output === null) return; // hot-unplug → no send, no crash
    // Local noteOff sweep (immediate, no timing offset). Real or Mock output.
    sendForcePanic(output);
    toast.success(FORCE_PANIC_TOAST);
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid="listener-force-panic-button"
      >
        <WarnIcon />
        Force Panic
      </Button>
      {disabled && (
        <p
          data-testid="listener-force-panic-hint"
          className="text-xs text-muted-foreground"
        >
          Choisissez une sortie pour activer le Panic étendu.
        </p>
      )}
      <ForcePanicDialog open={open} onOpenChange={setOpen} onConfirm={handleConfirm} />
    </div>
  );
}