import { useMidiInputs, type MidiInputInfo } from "../../../lib/midi-access";
import { Alert, AlertDescription, AlertTitle } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";

// Story 3.2 — MIDI input port picker (UX-DR18, UX-DR13 E4, AD-3).
//
// Lists the available MIDI INPUT ports (not outputs), lets the performer select
// one, and re-renders live on hot-plug (the provider re-snapshots on
// `onstatechange`). Empty state (E4) is an info Alert + a refresh button, not an
// error. No MIDI message handler is installed and no port is opened here — MIDI
// capture is Story 3.3.
//
// A native `<select>` is used (rather than the radix-based shadcn Select) for
// accessibility + deterministic jsdom testing; it is styled to match the input
// primitives.

function formatLabel(input: MidiInputInfo): string {
  return input.name.length > 0 ? input.name : input.id;
}

export function MidiPortPicker() {
  const { status, inputs, selectedInputId, selectInput, refreshInputs } =
    useMidiInputs();

  if (status !== "ready") {
    return null; // only shown once access is granted.
  }

  if (inputs.length === 0) {
    return (
      <Alert data-testid="midi-empty-alert">
        <AlertTitle>
          Aucune entrée MIDI détectée. Branchez un clavier ou un bus IAC.
        </AlertTitle>
        <AlertDescription>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={refreshInputs}
            data-testid="midi-refresh-button"
          >
            Rafraîchir
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const selected =
    selectedInputId === null
      ? null
      : inputs.find((i) => i.id === selectedInputId) ?? null;

  return (
    <div className="space-y-2">
      <label
        htmlFor="midi-input-select"
        className="text-sm font-medium leading-none"
      >
        Entrée MIDI
      </label>
      <select
        id="midi-input-select"
        data-testid="midi-input-select"
        value={selectedInputId ?? ""}
        onChange={(e) =>
          selectInput(e.target.value === "" ? null : e.target.value)
        }
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <option value="">— Sélectionner —</option>
        {inputs.map((input) => (
          <option key={input.id} value={input.id}>
            {formatLabel(input)}
          </option>
        ))}
      </select>

      {selected !== null ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="midi-selected-detail"
        >
          {selected.manufacturer.length > 0 ? selected.manufacturer : "—"} ·{" "}
          {selected.state} · {selected.connection}
        </p>
      ) : null}
    </div>
  );
}