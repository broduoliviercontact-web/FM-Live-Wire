import { Button } from "../../../shared/ui/button";
import { StopIcon } from "../../../shared/ui/icons";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import { useListenerStore } from "../store/listenerStore";
import { panicListener } from "../api/connection";

// Story 5.2 — local Panic button (AD-7, FR-16, FR-18, S-2, AC-U13, UX-DR15).
//
// The listener's always-available musical escape hatch (S-2): a local
// all-notes-off sent straight to the selected output, with NO dependency on
// the live network link or the backend. It is ALWAYS visible, ALWAYS enabled
// (never disabled, in no flux state), and fixed to the bottom of the viewport
// so it is never hidden by scroll or a dialog (UX-DR15). Even with the backend
// killed, clicking it cuts stuck notes on the listener's own synth.
//
// The click resolves the local output (`useMidiOutputs().getOutput(id)` — a
// real `MIDIOutput` or the Story 5.1 `MockMidiOutput`) and runs `sendLocalPanic`
// (the AD-7 sweep: CC 64 → 120 → 121 → 123 on all 16 channels = 64 messages,
// immediate, no timing offset). If no output is selected, the click is a
// no-op (no crash, the button stays enabled, the hint stays visible). The
// chosen listener channel does NOT limit the sweep — `sendLocalPanic` covers
// all 16 channels itself.
//
// No Force Panic / confirmation dialog here (Story 5.3). No backpressure, no
// buffer bound, no message discarded, no late-event alert (later Epic 5 stories).

/** Exact persistent hint (FR, UX-DR15). */
const PANIC_HINT =
  "Coupe toutes les notes sur votre sortie locale. Fonctionne même si le serveur est injoignable.";

export function PanicButton() {
  const { getOutput } = useMidiOutputs();
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);

  const handleClick = () => {
    if (selectedOutputId === null) return; // no output → no-op, no crash
    const output = getOutput(selectedOutputId);
    if (output === null) return; // hot-unplug → no-op, no crash
    // Local sweep on the selected output (real or Mock) + explicit noteOffs for
    // the tracked active notes (anti-stuck-notes), then forget them. Immediate,
    // no timing. No Force Panic / 2048 here (Story 5.3). LOCAL: no socket event.
    panicListener(output, selectedOutputId);
  };

  // Fixed to the bottom of the viewport so it is never hidden by scroll or a
  // dialog. `z-[60]` keeps it above panel content AND above the Story 5.3
  // `ForcePanicDialog` overlay (Radix dialog overlay is `z-50`), so the escape
  // hatch stays visible + clickable while the Force Panic dialog is open. The
  // button is NEVER disabled (no `disabled` prop): even with no output or the
  // backend down, it stays enabled — the click is simply a guarded no-op.
  // `size="lg"` = `h-11` = 44px (the minimum touch target); `min-h-11` makes the
  // 44px guarantee explicit.
  return (
    <div
      data-testid="listener-panic"
      className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-1"
    >
      <Button
        variant="destructive"
        size="lg"
        onClick={handleClick}
        data-testid="listener-panic-button"
        className="min-h-11"
      >
        <StopIcon />
        Panic
      </Button>
      <p
        data-testid="listener-panic-hint"
        className="max-w-[16rem] text-right text-xs text-muted-foreground"
      >
        {PANIC_HINT}
      </p>
    </div>
  );
}