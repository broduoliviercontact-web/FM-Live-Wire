import { useListenerStore } from "../store/listenerStore";

// CC rate-limiter / coalescer debug counters — DEBUG-ONLY.
//
// Rendered ONLY under `?debugTiming=1` (the parent `listener/index.tsx` gates
// it with `isTimingDebugEnabled()`, mirroring the timing-CSV export button).
// Surfaces the three CC counters so an operator can verify the throttle is
// actually coalescing a CC deluge (e.g. CC74 ~194 CC/s):
//   - `ccReceived`  : CC received from the performer (every `controlChange`,
//                     including bypass 64/120/121/123 — incremented in
//                     `handleMidiEvent`);
//   - `ccSent`      : CC actually forwarded to the raw MIDIOutput (coalescer
//                     `onSent` — immediate eligible / raw / bypass / flushed);
//   - `ccCoalesced` : CC dropped / replaced (coalescer `onCoalesced`).
// At steady state (no held pending, no bypass, no reset) `ccReceived ≈ ccSent +
// ccCoalesced`. Mirrors `LatencyStat` (font-mono muted stat line). LOCAL: store
// only — no network event.

export function CcDebugStats() {
  const ccReceived = useListenerStore((s) => s.ccReceived);
  const ccSent = useListenerStore((s) => s.ccSent);
  const ccCoalesced = useListenerStore((s) => s.ccCoalesced);
  return (
    <div
      data-testid="listener-cc-debug-stats"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground"
    >
      <span data-testid="listener-cc-stat-received">CC reçus : {ccReceived}</span>
      <span data-testid="listener-cc-stat-sent">CC envoyés : {ccSent}</span>
      <span data-testid="listener-cc-stat-coalesced">CC coalescés : {ccCoalesced}</span>
    </div>
  );
}