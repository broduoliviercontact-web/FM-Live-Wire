import { useNavigate } from "react-router-dom";
import { Button } from "../../../shared/ui/button";

// Story 3.5 — `BackToHome` (UX-DR1, Q-UX10).
//
// "← Retour" triggers a CLEAN disconnect of the performer socket BEFORE
// navigating to `/`. Order matters: `onDisconnect` (which calls
// `socket.disconnect()` → the server releases the owner slot via Story 2.3)
// runs first, then `navigate("/")`. This guarantees no ghost owner slot
// survives the navigation (a new performer can immediately take the slot).
//
// No confirmation dialog: leaving is a natural end of the session.

export interface BackToHomeProps {
  /**
   * Clean-disconnect callback provided by PerformerPanel — disconnects the
   * socket (→ server releases the owner slot, Story 2.3) and sets the store's
   * end message. Called BEFORE navigation.
   */
  readonly onDisconnect: () => void;
}

export function BackToHome({ onDisconnect }: BackToHomeProps) {
  const navigate = useNavigate();

  function handleClick() {
    // 1) clean disconnect (server releases the owner slot) — BEFORE navigation
    onDisconnect();
    // 2) navigate home — strictly after the disconnect
    navigate("/");
  }

  return (
    <Button
      type="button"
      variant="link"
      className="h-auto p-0"
      onClick={handleClick}
      data-testid="performer-back-to-home"
    >
      ← Retour
    </Button>
  );
}