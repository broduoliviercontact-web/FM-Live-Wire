import { useNavigate } from "react-router-dom";
import { Button } from "../../../shared/ui/button";

// Story 6.1 — RolePicker (UX-DR1, UX-DR3).
//
// The landing role-picker: two buttons that route the visitor to the right
// surface. There is NO auth and NO transverse nav (UX-DR1): the landing IS the
// hub, and each surface returns via its own `BackToHome`.
//   - « Je diffuse (performer) » → `/performer`.
//   - « J'écoute (listener) »    → `/listener`.
//
// The buttons are ALWAYS active — even when nobody is on air, a listener can go
// to `/listener` and wait for the performer (AC: "les boutons restent actifs
// même hors antenne"). `control_height_lg` 44px (DESIGN.md) is approximated with
// the `h-11` Tailwind class (44px) so the hit target matches the design without
// importing the token system (Epic 6.2).

export function RolePicker() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button
        type="button"
        className="h-11"
        onClick={() => navigate("/performer")}
        data-testid="landing-role-performer"
      >
        Je diffuse (performer)
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-11"
        onClick={() => navigate("/listener")}
        data-testid="landing-role-listener"
      >
        J'écoute (listener)
      </Button>
    </div>
  );
}