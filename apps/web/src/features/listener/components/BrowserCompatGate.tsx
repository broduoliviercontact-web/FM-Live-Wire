import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { DangerIcon } from "../../../shared/ui/icons";

// Story 4.1 — BrowserCompatGate (listener feature). AD-3: Web MIDI feature
// detection ONLY, duplicated per-feature for AD-2 isolation (the listener
// feature must NOT import the performer feature; the gate logic is small enough
// that a local copy is preferable to a cross-feature import).
//
// The gate does FEATURE DETECTION ONLY. It checks that the Web MIDI API exists
// (`typeof navigator.requestMIDIAccess === "function"`) and that the document
// is in a secure context (`window.isSecureContext`). It NEVER calls
// `navigator.requestMIDIAccess()` — calling it would prompt for device access,
// and the gate must block BEFORE any such call. The MIDI permission prompt is
// triggered later, by `MidiPermissionButton`, on a user click.
//
// `detectBrowserCompat` is exported pure so it can be unit-tested without
// rendering, and so the "never calls requestMIDIAccess" guarantee is obvious.

export interface BrowserCompatInfo {
  /** `window.isSecureContext` — Web MIDI requires HTTPS (or a secure context). */
  readonly secureContext: boolean;
  /** The Web MIDI API is present on `navigator`. Presence only — never invoked. */
  readonly hasWebMidi: boolean;
}

/**
 * Pure feature detection (no side effects, no `requestMIDIAccess()` call).
 * Safe in non-DOM environments: returns `{ false, false }` when
 * `window`/`navigator` are absent.
 */
export function detectBrowserCompat(): BrowserCompatInfo {
  const secureContext =
    typeof window !== "undefined" && window.isSecureContext === true;
  const hasWebMidi =
    typeof navigator !== "undefined" &&
    typeof navigator.requestMIDIAccess === "function";
  return { secureContext, hasWebMidi };
}

/**
 * Blocks the listener flow on an incompatible browser.
 *
 * - Insecure context → terminal "Web MIDI nécessite HTTPS" (E2).
 * - Missing Web MIDI API → terminal "Chrome/Edge requis" (E1).
 * - Otherwise → renders `children` (the real listener flow).
 *
 * The two terminal states are end-of-the-road: there is no "retry" — the user
 * must switch browser / use HTTPS. The check order is intentional: a non-secure
 * context would block Web MIDI even if the API exists, so HTTPS is reported
 * first.
 */
export function BrowserCompatGate({ children }: { children: ReactNode }) {
  const compat = detectBrowserCompat();

  if (!compat.secureContext) {
    return (
      <Alert variant="danger" data-testid="listener-compat-insecure">
        <DangerIcon />
        <AlertTitle>Web MIDI nécessite HTTPS</AlertTitle>
        <AlertDescription>
          La réception MIDI n'est disponible qu'en contexte sécurisé. Ouvrez ce
          site en HTTPS (ou en localhost en développement local).
        </AlertDescription>
      </Alert>
    );
  }

  if (!compat.hasWebMidi) {
    return (
      <Alert variant="danger" data-testid="listener-compat-no-webmidi">
        <DangerIcon />
        <AlertTitle>Chrome/Edge requis</AlertTitle>
        <AlertDescription>
          Web MIDI n'est pas disponible dans ce navigateur. Utilisez Chrome ou
          Edge sur ordinateur pour recevoir du MIDI.
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
}