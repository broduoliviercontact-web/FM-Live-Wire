import { Alert, AlertDescription } from "../../../shared/ui/alert";
import { DangerIcon } from "../../../shared/ui/icons";
import { useListenerStore } from "../store/listenerStore";

// Story 4.5 — protocol-version error alert (E13, UX-DR14, AC-U13).
//
// Shown when a received `midi:event` had a `v` incompatible with
// `PROTOCOL_VERSION`. A stale client build cannot recover on its own (the
// server now speaks a newer protocol), so the Alert is terminal and asks the
// user to refresh — exact text
// « Version de protocole incompatible. Rafraîchissez la page. ».
//
// Driven by the `protocolError` flag in `listenerStore` (set by the
// `midi:event` handler in `connection.ts` BEFORE the 4.3 schedule chain — an
// incompatible event is NOT scheduled). The incompatible event is not counted
// (it was not processed). Purely presentational.
//
// Does NOT mention any emergency all-notes-off state — that is a later story.

/** Exact E13 message (terminal — a refresh is required). */
const PROTOCOL_ERROR_MESSAGE =
  "Version de protocole incompatible. Rafraîchissez la page.";

export function ProtocolVersionAlert() {
  const protocolError = useListenerStore((s) => s.protocolError);
  if (!protocolError) return null;
  return (
    <Alert
      variant="danger"
      data-testid="listener-protocol-alert"
      role="alert"
    >
      <DangerIcon />
      <AlertDescription>{PROTOCOL_ERROR_MESSAGE}</AlertDescription>
    </Alert>
  );
}