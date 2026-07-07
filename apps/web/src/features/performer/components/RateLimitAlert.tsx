import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { WarnIcon } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/button";
import { usePerformerStore } from "../store/performerStore";

// Story 3.4 — E12 rate-limit alert (UX-DR14). Non-blocking, dismissible, no
// auto-retry. Shown by the MonitoringPanel when the server acks `rate:limited`
// (Story 2.5 middleware). The exact message is fixed by the story. Story 6.2 —
// rendered as a `late` (amber) warning alert with a warning icon.

export function RateLimitAlert() {
  const dismiss = usePerformerStore((s) => s.dismissRateLimit);
  return (
    <Alert variant="late" data-testid="rate-limit-alert">
      <WarnIcon />
      <AlertTitle>
        Limite de débit atteinte — certains events ont été ignorés par le serveur.
      </AlertTitle>
      <AlertDescription>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={dismiss}
          data-testid="rate-limit-dismiss"
        >
          Masquer
        </Button>
      </AlertDescription>
    </Alert>
  );
}