import { Badge } from "../../../shared/ui/badge";
import { usePerformerStore } from "../store/performerStore";

// Story 3.5 — non-blocking connection lifecycle indicator (UX-DR23).
//
// Shown only in the connected branch of PerformerPanel. Reflects the live
// socket state from the store: connecté / déconnecté / reconnexion en cours.
// It is NEVER a modal/dialog — just a small visible pill + optional attempt
// count + sober reconnect-error text. The clean-disconnect end message
// (`PERFORMER_END_MESSAGE`) is rendered here when set (e.g. by `BackToHome`
// before it navigates away).
//
// This component does NOT replay or buffer anything: reconnection only resumes
// the live stream with newly captured events (AD-17 — no replay of the past).

const LABEL: Record<string, string> = {
  connecting: "Connexion…",
  connected: "Connecté",
  disconnected: "Déconnecté",
  reconnecting: "Reconnexion en cours",
};

export function ConnectionStatus() {
  const connectionStatus = usePerformerStore((s) => s.connectionStatus);
  const reconnectAttempt = usePerformerStore((s) => s.reconnectAttempt);
  const reconnectError = usePerformerStore((s) => s.reconnectError);
  const endMessage = usePerformerStore((s) => s.endMessage);

  // Story 6.2 — DESIGN.md semantic badges: connected = green, disconnected =
  // error (red), reconnecting/connecting = outline.
  const variant =
    connectionStatus === "connected"
      ? "connected"
      : connectionStatus === "reconnecting" || connectionStatus === "connecting"
        ? "outline"
        : "error";

  return (
    <div
      data-testid="connection-status"
      className="space-y-1 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge data-testid="connection-pill" variant={variant}>
          {LABEL[connectionStatus] ?? connectionStatus}
        </Badge>
        {connectionStatus === "reconnecting" ? (
          <span
            data-testid="connection-reconnect-attempt"
            className="text-xs text-muted-foreground"
          >
            Reconnexion… (tentative {reconnectAttempt})
          </span>
        ) : null}
        {connectionStatus === "reconnecting" && reconnectError !== null ? (
          <span
            data-testid="connection-reconnect-error"
            className="text-xs text-muted-foreground"
          >
            {reconnectError}
          </span>
        ) : null}
      </div>
      {endMessage !== null ? (
        <p
          data-testid="connection-end-message"
          className="text-sm text-foreground"
        >
          {endMessage}
        </p>
      ) : null}
    </div>
  );
}