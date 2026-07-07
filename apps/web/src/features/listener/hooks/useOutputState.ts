import { useEffect, useRef } from "react";
import { useMidiOutputs } from "./useMidiOutputs";
import { handleOutputLost, resumeListenerScheduler } from "../api/connection";
import { MOCK_OUTPUT_ID } from "../lib/mock-output";

// Story 5.5 — LOCAL output-state watcher (AD-17, FR-24, UX-DR14 E5, AC-U9).
//
// Watches the selected REAL MIDI output for in-session loss and triggers the
// fail-safe (scheduler stop + clear selection + raise E5) via the LOCAL
// `handleOutputLost` from `connection.ts`. A port is "lost" when it disappears
// from the live list (hot-unplug, `onstatechange` removes it) OR its `state`
// becomes `"disconnected"` (the port stays in the map but is gone). The Mock
// output never disconnects (it is not a hardware port), so it is excluded.
//
// Detection is LOCAL: it reads the output list re-snapshotted by the shared
// `MidiAccessProvider` on `onstatechange` (no polling, no server). The fail-safe
// itself is LOCAL too (FR-27): `handleOutputLost` stops the scheduler and raises
// the `outputLost` flag in the store — no network event is ever emitted.
//
// Why a ref on the previously-selected id? The `MidiPortPicker` ALSO reconciles
// the selection (it clears `selectedOutputId` when a real port disappears). Both
// effects run on the same `outputs` change, so by the time this effect runs the
// store may already have cleared `selectedOutputId`. Tracking the PREVIOUS
// selected id lets this watcher detect the loss of THAT port regardless of the
// order, and — crucially — distinguish a loss (fail-safe) from a voluntary
// selection change (no fail-safe): a voluntary change leaves the previous port
// present + connected, so no alert is raised.
//
// This hook has NO return value; mount it once (it only sets up an effect).

export function useOutputState(): void {
  const { outputs, selectedOutputId } = useMidiOutputs();
  const prevSelectedRef = useRef<string | null>(selectedOutputId);

  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedOutputId;
    // Loss detection: a REAL previously-selected port is gone / disconnected.
    // The Mock never disconnects (it is not a hardware port); a null prev means
    // no real port was chosen yet.
    if (prev !== null && prev !== MOCK_OUTPUT_ID) {
      const port = outputs.find((o) => o.id === prev);
      if (port === undefined || port.state === "disconnected") {
        // Output gone / disconnected → fail-safe (stop scheduler + clear + E5).
        handleOutputLost();
        return;
      }
    }
    // Resume: a NEW non-null sortie was chosen while the scheduler was STOPPED
    // (e.g. after an output loss). `resumeListenerScheduler` is guarded by
    // `isStopped()`, so a normal hot-switch (scheduler running) does NOT reset
    // the pending count. This does NOT fire on server-down (the selection is
    // unchanged → this effect does not run), so events arriving while the link
    // is down still produce no send. No replay: nothing is queued (AD-17).
    if (selectedOutputId !== null) {
      resumeListenerScheduler();
    }
  }, [outputs, selectedOutputId]);
}