import { useListenerStore } from "../store/listenerStore";
import type { FluxStatus } from "../store/listenerStore";
import { pluralize } from "../../../shared/i18n";

// Story 4.4 / 4.5 — listener flux status pill (UX-DR11, AC-U18, AC-U10).
//
// Reflects the flux reception state at a glance:
//   - `idle`                   : not joined (muted, "● Inactif").
//   - `waiting`                : joined, no event yet — exact
//                                « En attente du performer… » (non-error empty
//                                state, UX-DR13).
//   - `active`                 : at least one `midi:event` received — exact
//                                « ● Réception active — {n} events reçus »
//                                (singular « 1 event reçu » / « 0 event reçu »
//                                per French pluralization).
//   - `server-down`            : socket lost / unreachable — exact
//                                « Serveur déconnecté. Reconnexion
//                                automatique en cours… » (AC-U10; visible
//                                indicator, no blocking dialog).
//   - `performer-disconnected` : the server reported `performer:disconnected`
//                                (E7) — exact « Performer déconnecté ».
//
// The E13 « Version de protocole incompatible… » is a separate Alert driven by
// the `protocolError` flag (not a pill state). Purely presentational: reads
// `fluxStatus` + `eventsReceived` from the store. No socket, no MIDI access.
//
// Story 6.3 — `aria-live="polite"` so screen readers announce the flux status
// changes (idle → waiting → active → server-down → performer-disconnected) as
// they happen (AC-U20, UX-DR27). `aria-atomic="true"` reads the whole pill text
// on each change (so the count is heard alongside the label).

const LABELS: Record<FluxStatus, string> = {
  idle: "● Inactif",
  waiting: "En attente du performer…",
  active: "● Réception active",
  "server-down": "Serveur déconnecté. Reconnexion automatique en cours…",
  "performer-disconnected": "Performer déconnecté",
};

function eventsLabel(n: number): string {
  // Story 6.2 — fr-FR pluralization via `Intl.PluralRules` (0 and 1 are both
  // "one" → "event reçu"; ≥ 2 → "events reçus"). Replaces the naive
  // `n <= 1` check so 0 reads as "0 event reçu".
  return `${n} ${pluralize(n, "event reçu", "events reçus")}`;
}

export function StatusPill() {
  const fluxStatus = useListenerStore((s) => s.fluxStatus);
  const eventsReceived = useListenerStore((s) => s.eventsReceived);

  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium";
  // Story 6.2 — DESIGN.md semantic tokens: active = connected (green),
  // server-down = late (amber warning), other states muted.
  const tone =
    fluxStatus === "active"
      ? "border-connected bg-connected/10 text-connected"
      : fluxStatus === "server-down"
        ? "border-late bg-late/10 text-late"
        : fluxStatus === "performer-disconnected"
          ? "border-muted-foreground/40 bg-muted text-muted-foreground"
          : fluxStatus === "waiting"
            ? "border-muted-foreground/40 bg-muted text-muted-foreground"
            : "border-border bg-muted/50 text-muted-foreground/70";

  const text =
    fluxStatus === "active"
      ? `${LABELS.active} — ${eventsLabel(eventsReceived)}`
      : LABELS[fluxStatus];

  return (
    <span
      data-testid="listener-status-pill"
      data-state={fluxStatus}
      aria-live="polite"
      aria-atomic="true"
      className={`${base} ${tone}`}
    >
      {text}
    </span>
  );
}