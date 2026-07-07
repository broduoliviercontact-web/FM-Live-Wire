import { useNavigate } from "react-router-dom";
import { Button } from "../../../shared/ui/button";

// Story 6.1 — listener `BackToHome` (UX-DR1, Q-UX10).
//
// « ← Retour » triggers a CLEAN leave/disconnect of the listener BEFORE
// navigating to `/`. Order matters: `onDisconnect` (which emits a best-effort
// `room:leave`, marks the disconnect intentional, disconnects the socket, and
// resets the flux to idle — see `leaveListenerForNavigation` in `connection.ts`)
// runs FIRST, then `navigate("/")`. This guarantees:
//   - no ghost room membership (the server drops the socket from `ROOM` on
//     disconnect);
//   - no `server-down` pill (the leave is voluntary → `intentionalClose`);
//   - no in-flight MIDI bytes (the scheduler is stopped).
//
// DUPLICATED from `features/performer/components/BackToHome.tsx` for AD-2
// isolation (the listener feature must NOT import the performer feature); the
// disconnect SEMANTICS differ (listener = `room:leave` + intentional
// disconnect; performer = owner-slot release), so each feature owns its own
// `BackToHome` + its own disconnect callback. No confirmation dialog: leaving
// is a natural end of the session.

export interface BackToHomeProps {
  /**
   * Clean-leave callback provided by `ListenerPanel` — emits `room:leave`
   * (best-effort), stops the scheduler, marks the disconnect intentional,
   * disconnects the socket, and resets the flux to idle. Called BEFORE
   * navigation (Q-UX10).
   */
  readonly onDisconnect: () => void;
}

export function BackToHome({ onDisconnect }: BackToHomeProps) {
  const navigate = useNavigate();

  function handleClick() {
    // 1) clean leave/disconnect (room:leave + intentional disconnect) — BEFORE
    //    navigation (no ghost membership, no server-down pill).
    onDisconnect();
    // 2) navigate home — strictly after the disconnect.
    navigate("/");
  }

  return (
    <Button
      type="button"
      variant="link"
      className="h-auto p-0"
      onClick={handleClick}
      data-testid="listener-back-to-home"
    >
      ← Retour
    </Button>
  );
}