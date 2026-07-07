import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { DangerIcon } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/button";

// Story 3.1 — terminal `performer:busy` screen (E9, AD-2 single owner slot).
//
// The server refused the connection because another performer already holds the
// single owner slot. This is a TERMINAL state: there is NO retry button and NO
// automatic reconnect (`reconnection: false` on the socket). The user must wait
// for the active session to end; the only forward action is the link back to `/`.

export function PerformerBusyAlert() {
  return (
    <Alert variant="danger" data-testid="performer-busy-alert">
      <DangerIcon />
      <AlertTitle>
        Un performer est déjà connecté. Attendez la fin de sa session.
      </AlertTitle>
      <AlertDescription>
        <Button asChild variant="link" className="h-auto p-0">
          <a href="/" data-testid="performer-busy-back-link">
            Retour à l'accueil
          </a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}