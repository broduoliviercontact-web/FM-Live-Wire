import { useListenerStore } from "../store/listenerStore";

// Story 4.5 — listener empty state (UX-DR13, AC-U18).
//
// A non-error empty state shown when the listener has joined but no performer
// is streaming yet (flux `waiting`). The exact hint
// « Dès que le performer démarre, le flux arrive. » reassures the user this is
// expected, not a broken app (AC-U18). The `MidiActivityIndicator` is OFF in
// `waiting` (handled by its own component); this component only owns the hint.
//
// Returns null for any other flux state — the hint is shown ONLY while waiting
// for the performer (idle has nothing to explain; active/server-down/
// performer-disconnected have their own pill text). Purely presentational.

/** Exact AC-U18 hint shown while the listener waits for the performer. */
const WAITING_HINT = "Dès que le performer démarre, le flux arrive.";

export function EmptyState() {
  const fluxStatus = useListenerStore((s) => s.fluxStatus);
  if (fluxStatus !== "waiting") return null;
  return (
    <p
      data-testid="listener-empty-state"
      className="text-sm text-muted-foreground"
    >
      {WAITING_HINT}
    </p>
  );
}