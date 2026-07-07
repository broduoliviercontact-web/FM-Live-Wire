import { useMidiInputs } from "../../../lib/midi-access";
import { Button } from "../../../shared/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { DangerIcon } from "../../../shared/ui/icons";

// Story 3.2 — MIDI permission step (UX-DR6, UX-DR14 E3, AD-3).
//
// Renders the "Connecter MIDI Input" button (idle/loading), the E3 denial Alert
// with a "Réessayer" button (denied), or a sober generic Alert (error). Returns
// null once access is granted (status === "ready") — the `MidiPortPicker` takes
// over. `requestAccess()` (→ `navigator.requestMIDIAccess({ sysex:false })`) is
// called ONLY on click, never at render. No MIDI message capture.

export function MidiPermissionButton() {
  const { status, requestAccess } = useMidiInputs();

  if (status === "ready") {
    return null; // MidiPortPicker takes over.
  }

  if (status === "denied") {
    return (
      <Alert variant="danger" data-testid="midi-denied-alert">
        <DangerIcon />
        <AlertTitle>Autorisation MIDI refusée.</AlertTitle>
        <AlertDescription>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => void requestAccess()}
            data-testid="midi-retry-button"
          >
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "error") {
    return (
      <Alert variant="danger" data-testid="midi-error-alert">
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
      data-testid="midi-permission-button"
    >
      {status === "loading" ? "Connexion…" : "Connecter MIDI Input"}
    </Button>
  );
}