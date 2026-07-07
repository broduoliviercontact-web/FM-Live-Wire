import { useListenerStore } from "../store/listenerStore";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { cn } from "../../../lib/utils";

// Story 4.4 / 4.5 — MIDI activity indicator (UX-DR12, AC-U19/UX-DR26).
//
// A small dot that pulses on each incoming `noteOn` while the flux is active.
//   - `idle` / `waiting` / `server-down` / `performer-disconnected` : OFF
//                       (muted, low opacity, no animation). Story 4.5 adds the
//                       `server-down` + `performer-disconnected` flux states;
//                       the dot is OFF for any state that is not `active`.
//   - `active`          : ON. Without reduced motion it uses the built-in
//                         `animate-pulse` (a visible pulse); the `noteOnPulse`
//                         counter also increments per `noteOn` so each noteOn
//                         is observable in the DOM (`data-pulse`).
//   - reduced motion    : no animation — a static opacity change only (the dot
//                         is fully opaque, no `animate-pulse` class), per AC-U19.
//
// `noteOnPulse` (from the store, incremented by the `midi:event` handler on each
// `noteOn`) is exposed as `data-pulse` so tests can assert the per-noteOn
// reaction without inspecting CSS animation state. Only `noteOn` pulses —
// `noteOff` / `controlChange` / `programChange` / `pitchBend` do not (the
// handler only calls `pulseNoteOn()` for `noteOn`).

export function MidiActivityIndicator() {
  const fluxStatus = useListenerStore((s) => s.fluxStatus);
  const noteOnPulse = useListenerStore((s) => s.noteOnPulse);
  const reduced = usePrefersReducedMotion();

  const active = fluxStatus === "active";
  const animate = active && !reduced;

  return (
    <span
      data-testid="listener-activity-indicator"
      data-state={active ? "active" : "idle"}
      data-pulse={noteOnPulse}
      data-reduced-motion={reduced ? "true" : "false"}
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        // Story 6.2 — DESIGN.md: noteOn activity = connected (green).
        active
          ? "bg-connected"
          : "bg-muted-foreground/40",
        active && !animate && "opacity-100",
        !active && "opacity-40",
        animate && "animate-pulse",
      )}
      aria-hidden="true"
    />
  );
}