import { useListenerStore } from "../store/listenerStore";

// Story 5.4 — LOCAL late / overload warning (FR-27, UX-DR14, E10, AC-U11).
//
// A purely local alert shown when the listener's backpressure layer detects a
// late flux OR a bounded-buffer overflow (drop oldest, FR-25). It is the
// user-facing surface of the `lateWarning` flag in the listener store.
//
// LOCAL PUR (FR-27 / AC-U11): this component imports ONLY the listener store.
// It never imports the live network link, the join/leave handshake, or any
// live network link driver — it does NOT raise any server overload event (or
// any network event) when the warning raises. The warning is raised in the
// store by the scheduler / reception wiring; this component just renders it.
// No replay, no retry, no re-loging (AD-17 / AD-11).
//
// Alerte-only (UX-DR12/14): `lateWarning` is `false` on calm reception, so this
// returns `null` and nothing is shown by default. The `LatencyStat` companion
// is shown only alongside this alert.
//
// Story 6.8 (negative-latency hotfix): the shown `ms` is the EFFECTIVE latency
// `max(0, receivedAtMs - srvTs)` from the scheduler — never negative. A negative
// raw delta (server/client clock skew) is clamped to 0 upstream, so this alert
// can never read "−N ms". The alert still only shows when `lateWarning` is true:
// `effectiveLatencyMs > MAX_LATE_MS` OR a real buffer-overflow drop (FR-25).

/** Exact alert text prefix (E10). The `{ms}` value follows, then ` ms`. */
export const LATE_ALERT_PREFIX =
  "⚠ Flux en retard / connexion instable — latence estimée";

export function LateAlert() {
  const lateWarning = useListenerStore((s) => s.lateWarning);
  const lastLatencyMs = useListenerStore((s) => s.lastLatencyMs);
  if (!lateWarning) return null;
  // No `srvTs` on the triggering event → show 0 (the buffer-overflow case).
  // `lastLatencyMs` is already clamped ≥ 0 (effectiveLatencyMs) — never negative.
  const ms = lastLatencyMs ?? 0;
  return (
    <div
      data-testid="listener-late-alert"
      role="alert"
      className="rounded-md border border-late/30 border-l-[3px] border-l-late bg-late/10 px-3 py-2 text-sm text-late"
    >
      {LATE_ALERT_PREFIX} {ms} ms
    </div>
  );
}