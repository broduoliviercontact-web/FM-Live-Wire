import { useListenerStore } from "../store/listenerStore";

// Story 5.4 — alerte-only latency / fallback stat (UX-DR12, FR-26, NFR-2).
//
// A small stat line shown ONLY when the LOCAL late/overload warning is active
// (`lateWarning === true`), i.e. alongside `LateAlert`. It surfaces the last
// relay latency (`srvTs - ts`, telemetry only — AD-11) and the fallback counter
// (how many late noteOn/noteOff/programChange were sent via the immediate
// fallback path, FR-26). NOT a permanent monitoring dashboard (UX-DR12): on
// calm reception `lateWarning` is `false` → this returns `null`.
//
// LOCAL PUR (FR-27): imports only the listener store — no live network link,
// no raise, no network event.

export function LatencyStat() {
  const lateWarning = useListenerStore((s) => s.lateWarning);
  const lastLatencyMs = useListenerStore((s) => s.lastLatencyMs);
  const fallbackCount = useListenerStore((s) => s.fallbackCount);
  const droppedCount = useListenerStore((s) => s.droppedCount);
  if (!lateWarning) return null;
  const ms = lastLatencyMs ?? 0;
  return (
    <div
      data-testid="listener-latency-stat"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground"
    >
      <span data-testid="listener-latency-stat-ms">Latence : {ms} ms</span>
      <span data-testid="listener-latency-stat-fallbacks">
        Fallbacks : {fallbackCount}
      </span>
      <span data-testid="listener-latency-stat-dropped">
        Drops : {droppedCount}
      </span>
    </div>
  );
}