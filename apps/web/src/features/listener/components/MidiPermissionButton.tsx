import { useMidiInputs } from "../../../lib/midi-access";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { DangerIcon } from "../../../shared/ui/icons";

// Story 4.1 — MIDI permission step (listener feature). UX-DR6, UX-DR14 E3,
// AD-3, UX-DR23 (user-gesture required). Reuses the shared `MidiAccessProvider`
// (mounted globally) via the `useMidiInputs` hook from `lib/midi-access` — the
// low-level `requestMIDIAccess({ sysex:false })` call lives in the provider, so
// the sysex flag stays hard-coded in ONE place and the call is mockable.
//
// Renders the "Connecter MIDI" button (idle/loading), the E3 denial Alert with
// a "Réessayer" button (denied), or a sober generic Alert (error). On success
// (`status === "ready"`) it renders a `connected` StatusPill "MIDI autorisé".
// `requestAccess()` (→ `navigator.requestMIDIAccess({ sysex:false })`) is
// called ONLY on click, never at render.
//
// Scope of this story: permission ONLY. No output selection (4.2), no channel
// (4.2), no room join (4.3), no event reception (4.3), no output sending
// (4.3), no scheduler (4.5).

export function MidiPermissionButton() {
  const { status, requestAccess } = useMidiInputs();

  if (status === "ready") {
    // StatusPill `connected` — MIDI access granted. The next step (output
    // selection) is Story 4.2; for now the pill is the terminal state of 4.1.
    return (
      <Badge
        variant="connected"
        data-testid="listener-midi-status-pill"
        data-status="connected"
      >
        MIDI autorisé
      </Badge>
    );
  }

  if (status === "denied") {
    return (
      <Alert variant="danger" data-testid="listener-midi-denied-alert">
        <DangerIcon />
        <AlertTitle>Autorisation MIDI refusée.</AlertTitle>
        <AlertDescription>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => void requestAccess()}
            data-testid="listener-midi-retry-button"
          >
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "error") {
    return (
      <Alert variant="danger" data-testid="listener-midi-error-alert">
        <DangerIcon />
        <AlertTitle>Accès MIDI impossible.</AlertTitle>
        <AlertDescription>Réessayez dans un instant.</AlertDescription>
      </Alert>
    );
  }

  // idle | loading
  return (
    <Button
      type="button"
      onClick={() => void requestAccess()}
      disabled={status === "loading"}
      data-testid="listener-midi-permission-button"
    >
      {status === "loading" ? "Connexion…" : "Connecter MIDI"}
    </Button>
  );
}