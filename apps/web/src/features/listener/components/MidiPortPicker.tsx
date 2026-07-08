import { useEffect } from "react";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import { selectListenerOutput } from "../api/connection";
import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { InfoIcon } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/button";
import type { MidiOutputInfo } from "../../../lib/midi-access";
import { MOCK_OUTPUT_ID } from "../lib/mock-output";

// Story 4.2 / 5.1 — MIDI output port picker (listener feature). UX-DR7,
// UX-DR13 E4, UX-DR23 (hot-plug `onstatechange`), AD-3, AD-14 (Mock hot switch).
//
// Lists the available MIDI OUTPUT ports (real ports) PLUS a selectable
// « Mock / Debug » option (Story 5.1, AD-14). The Mock is always available —
// even with no real port — so the listener can test the socket → scheduler →
// encode chain without a device (NFR-19). Switching Mock ↔ real is hot: a
// simple store update, no reload (Q-UX9).
//
// The output LIST comes from the shared `MidiAccessProvider` (via
// `useMidiOutputs`); the listener's CHOICE lives in `listenerStore` (the Mock
// is the `MOCK_OUTPUT_ID` sentinel). If the selected REAL output disappears
// (hot-unplug), the selection is cleared (no dangling id). The Mock never
// disappears on hot-plug (it is not a hardware port), so its selection is
// preserved across hot-plug events.
//
// Empty state (E4): when there are no real ports AND the Mock is not selected,
// an info Alert (not a blocking error) reminds the listener to use Mock / Debug
// — and the Mock is now selectable right there. Once Mock is selected, the
// Alert is hidden (no blocking "no device" message while Mock is active).

function formatLabel(output: MidiOutputInfo): string {
  return output.name.length > 0 ? output.name : output.id;
}

export function MidiPortPicker() {
  const { status, outputs, selectedOutputId, selectOutput, getOutput, refreshOutputs } =
    useMidiOutputs();

  // Hot-plug reconciliation: if the selected REAL output is no longer present in
  // the live list, clear the selection (no dangling id, no crash). The Mock is
  // NOT a hardware port — it never appears in `outputs` — so it is excluded
  // from this check (its selection survives hot-plug). The provider already
  // re-snapshots on `onstatechange` (no polling); this effect only reconciles
  // the store's choice against that list.
  useEffect(() => {
    if (
      selectedOutputId !== null &&
      selectedOutputId !== MOCK_OUTPUT_ID &&
      !outputs.some((o) => o.id === selectedOutputId)
    ) {
      selectOutput(null);
    }
  }, [outputs, selectedOutputId, selectOutput]);

  if (status !== "ready") {
    return null; // only shown once MIDI access is granted.
  }

  // E4 info Alert: no real ports AND the listener has not picked the Mock yet.
  // Once Mock is selected the Alert is hidden (non-blocking while Mock active).
  const showEmptyAlert =
    outputs.length === 0 && selectedOutputId !== MOCK_OUTPUT_ID;

  const selected =
    selectedOutputId === null || selectedOutputId === MOCK_OUTPUT_ID
      ? null
      : outputs.find((o) => o.id === selectedOutputId) ?? null;

  return (
    <div className="space-y-2">
      {showEmptyAlert ? (
        <Alert variant="info" data-testid="listener-output-empty-alert">
          <InfoIcon />
          <AlertTitle>
            Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester.
          </AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={refreshOutputs}
              data-testid="listener-output-refresh-button"
            >
              Rafraîchir
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <label
        htmlFor="listener-output-select"
        className="text-sm font-medium leading-none"
      >
        Sortie MIDI
      </label>
      <select
        id="listener-output-select"
        data-testid="listener-output-select"
        value={selectedOutputId ?? ""}
        onChange={(e) =>
          selectListenerOutput(
            e.target.value === "" ? null : e.target.value,
            getOutput,
          )
        }
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <option value="">— Sélectionner —</option>
        <option value={MOCK_OUTPUT_ID} data-testid="listener-output-mock-option">
          Mock / Debug
        </option>
        {outputs.map((output) => (
          <option key={output.id} value={output.id}>
            {formatLabel(output)}
          </option>
        ))}
      </select>

      {selected !== null ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="listener-output-detail"
        >
          {selected.manufacturer.length > 0 ? selected.manufacturer : "—"} ·{" "}
          {selected.state} · {selected.connection}
        </p>
      ) : null}
    </div>
  );
}