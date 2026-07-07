import { useEffect, useState } from "react";
import { fetchHealth, HEALTH_POLL_INTERVAL_MS } from "../api/health";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { cn } from "../../../lib/utils";

// Story 6.1 — OnAirIndicator (UX-DR3, AC-U2, AD-20, FR-28).
//
// A light polling of `GET /health` (`ownerActive`) drives the on-air pill on
// the landing. There is NO Socket.IO on the landing (Q-UX5): this is plain
// `fetch` on an interval.
//   - ownerActive true  → « ● On air »     (amber dot, pulsing).
//   - ownerActive false → « ○ Hors antenne » (muted dot, no pulse).
//   - fetch failure      → ownerActive false → « ○ Hors antenne » (sober, never
//                          crashes, never blocks the role buttons).
//
// The pulse respects `prefers-reduced-motion`: when reduced, the
// `animate-pulse-on-air` class is NOT applied (static amber dot) and
// `data-reduced-motion="true"` is exposed for tests (AC-U2). The interval is
// cleaned up on unmount (no leak). Story 6.2 — the amber `on_air` token is now
// applied via the `bg-on-air` utility (from `tokens.css`), replacing the
// inline `#F2A93B` so the canonical DESIGN.md token is used everywhere.

export function OnAirIndicator() {
  const [onAir, setOnAir] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      const active = await fetchHealth();
      if (!cancelled) setOnAir(active);
    };
    void poll(); // immediate first poll (no flash of stale state)
    const id = window.setInterval(poll, HEALTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const pulse = onAir && !reduced;

  return (
    <span
      data-testid="landing-on-air-indicator"
      data-on-air={onAir ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
        onAir
          ? "border-on-air/40 text-foreground"
          : "border-border text-muted-foreground",
      )}
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-2.5 w-2.5 rounded-full",
          onAir ? "bg-on-air" : "bg-muted-foreground/40",
          pulse && "animate-pulse-on-air",
        )}
      />
      {onAir ? "● On air" : "○ Hors antenne"}
    </span>
  );
}