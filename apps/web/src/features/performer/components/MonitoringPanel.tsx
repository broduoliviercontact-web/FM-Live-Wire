import { Badge } from "../../../shared/ui/badge";
import { usePerformerStore } from "../store/performerStore";
import { formatMidiEvent, pluralize } from "../lib/format";
import { RateLimitAlert } from "./RateLimitAlert";

// Story 3.4 — minimal performer MonitoringPanel (FR-9, UX-DR19, UX-DR22).
//
// Shows: a "Diffusion active" status pill, the E12 rate-limit alert when active,
// the last successfully-acked event as a mono `TYPE · CH · VAL` line, the three
// pluralised foot counters (events envoyés / listeners / erreurs récentes), the
// permanent "MIDI pas audio" reminder, and the SysEx-filtered note.
//
// No SysEx is ever displayed or relayed: SysEx is filtered upstream in Story 3.3
// (decode → null → no emit), so it can never reach this panel.

export function MonitoringPanel() {
  const eventsSent = usePerformerStore((s) => s.eventsSent);
  const recentErrors = usePerformerStore((s) => s.recentErrors);
  const listeners = usePerformerStore((s) => s.listeners);
  const lastEvent = usePerformerStore((s) => s.lastEvent);
  const rateLimited = usePerformerStore((s) => s.rateLimited);

  return (
    <div
      data-testid="monitoring-panel"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex items-center gap-2">
        <Badge data-testid="monitoring-status-pill" variant="connected">
          Diffusion active
        </Badge>
      </div>

      {rateLimited ? <RateLimitAlert /> : null}

      <div
        className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground"
        data-testid="monitoring-last-event"
        // Story 6.3 — the last-event line changes on every acked event; it must
        // NOT be a permanent aria-live region (UX-DR28, AC-U20 — too verbose).
        // `aria-live="off"` makes the exclusion explicit + testable; the line is
        // still keyboard-readable on demand, just not announced.
        aria-live="off"
        aria-label="Dernier événement MIDI envoyé"
      >
        {lastEvent !== null ? formatMidiEvent(lastEvent) : "—"}
      </div>

      <div
        className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground"
        data-testid="monitoring-counters"
        // Story 6.3 — counters are high-churn technical telemetry; excluded
        // from aria-live (UX-DR28) — readable on focus, never announced.
        aria-live="off"
        aria-label="Compteurs de télémétrie"
      >
        <span data-testid="counter-events-sent">
          {pluralize(eventsSent, "event envoyé", "events envoyés")}
        </span>
        <span data-testid="counter-listeners">
          {pluralize(listeners, "listener", "listeners")}
        </span>
        <span data-testid="counter-recent-errors">
          {pluralize(recentErrors, "erreur récente", "erreurs récentes")}
        </span>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="monitoring-midi-note">
        Seul le MIDI est diffusé, jamais l'audio.
      </p>
      <p className="text-xs text-muted-foreground" data-testid="monitoring-sysex-note">
        SysEx silencieusement filtré, jamais affiché ni relayé
      </p>
    </div>
  );
}