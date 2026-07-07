import { useListenerStore } from "../store/listenerStore";
import { useListenerConnection } from "../api/connection";
import { Button } from "../../../shared/ui/button";

// Story 4.3 / 4.4 — listener join / leave button (UX-DR10, AC-U3).
//
// The socket lifecycle + the live `midi:event` → output pipeline now live in
// the shared `useListenerConnection` hook (`api/connection.ts`), so this button
// is a thin control:
//   - « Rejoindre le flux » → `joinFlux()` (ensure socket + emit `room:join`;
//     on `{ok:true}` flip `joined` + set flux `waiting`).
//   - « Quitter le flux »  → `leaveFlux()` (emit `room:leave`, flip `joined`
//     false, reset flux to idle, disconnect the socket).
//
// DISABLED while no output is selected, with the exact hint
// « Choisissez une sortie MIDI pour rejoindre. » (AC-U3). No `room:join` is
// emitted in that state (`joinFlux` self-gates on the selection).
//
// The `midi:event` reception pipeline (remap → encode → schedule on the raw
// `MIDIOutput`) is UNCHANGED from 4.3 — it now runs from the shared
// `handleMidiEvent` in `connection.ts`, which also drives the Story 4.4
// counters / activity / status. No replay, no queue, no retry of old events
// (AD-17). The minimal scheduler is unchanged (no buffer / fallback /
// backpressure — Epic 5).
//
// Does NOT import the performer feature (AD-2 isolation).

/** Exact AC-U3 hint shown when no output is selected. */
const NO_OUTPUT_HINT = "Choisissez une sortie MIDI pour rejoindre.";

export function JoinButton() {
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);
  const joined = useListenerStore((s) => s.joined);
  const { joinFlux, leaveFlux } = useListenerConnection();

  if (joined) {
    return (
      <Button
        size="lg"
        onClick={leaveFlux}
        data-testid="listener-join-button"
      >
        Quitter le flux
      </Button>
    );
  }

  const disabled = selectedOutputId === null;
  return (
    <div className="space-y-1">
      <Button
        size="lg"
        onClick={joinFlux}
        disabled={disabled}
        data-testid="listener-join-button"
      >
        Rejoindre le flux
      </Button>
      {disabled && (
        <p
          data-testid="listener-join-hint"
          className="text-xs text-muted-foreground"
        >
          {NO_OUTPUT_HINT}
        </p>
      )}
    </div>
  );
}