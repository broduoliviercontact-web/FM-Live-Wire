import { Button } from "../../../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../../shared/ui/dialog";

// Story 5.3 — Force Panic confirmation dialog (FR-17, AC-U14, UX-DR16,
// UX-DR23). The confirmation is MANDATORY before the 2048-message noteOff
// sweep is sent (AC-U14): opening the dialog sends NOTHING; only « Confirmer »
// triggers the sweep. « Annuler » closes with no send.
//
// Presentational + controlled: the owning `ForcePanicButton` holds the
// `open` state and the send logic (resolve the local output, call
// `sendForcePanic`, toast). This dialog only reports confirm / cancel back.
// This keeps the network-free guarantee with the test suite: the dialog has
// no `MidiSendable` dependency, only callbacks.
//
// Exact copy (FR, verbatim UX-DR20):
//   title      « Panic étendu : ~1–2 s. Confirmer ? »
//   intro copy « Force Panic envoie un noteOff sur les 128 notes × 16 canaux
//               (2048 messages). Utile si une note reste coincée après un
//               Panic normal. »

/** Exact confirmation title (FR, UX-DR20 verbatim). */
const FORCE_PANIC_TITLE = "Panic étendu : ~1–2 s. Confirmer ?";
/** Exact intro copy (FR). */
const FORCE_PANIC_INTRO =
  "Force Panic envoie un noteOff sur les 128 notes × 16 canaux (2048 messages). Utile si une note reste coincée après un Panic normal.";
/** Exact toast text (FR). */
export const FORCE_PANIC_TOAST = "Force Panic envoyé.";

export interface ForcePanicDialogProps {
  /** Controlled open state. */
  readonly open: boolean;
  /** Called by Radix on open/close (overlay click, escape, our buttons). */
  readonly onOpenChange: (open: boolean) => void;
  /** Called ONLY when the user clicks « Confirmer » (the sweep + toast run
   *  in the owning button). Must send nothing before this is called. */
  readonly onConfirm: () => void;
}

export function ForcePanicDialog({ open, onOpenChange, onConfirm }: ForcePanicDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false); // close after the sweep + toast
  };
  const handleCancel = () => {
    onOpenChange(false); // close, no send
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="listener-force-panic-dialog">
        <DialogTitle data-testid="listener-force-panic-dialog-title">
          {FORCE_PANIC_TITLE}
        </DialogTitle>
        <DialogDescription data-testid="listener-force-panic-dialog-intro">
          {FORCE_PANIC_INTRO}
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            data-testid="listener-force-panic-cancel"
          >
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            data-testid="listener-force-panic-confirm"
          >
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}