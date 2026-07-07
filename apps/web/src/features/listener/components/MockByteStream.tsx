import { useCallback, useSyncExternalStore } from "react";
import { useListenerStore } from "../store/listenerStore";
import {
  MOCK_OUTPUT_ID,
  getMockMidiOutput,
  formatMockLine,
} from "../lib/mock-output";

// Story 5.1 — Mock byte stream (UX-DR12, UX-DR22 monospace, AD-14).
//
// A monospace, scrollable list of the bytes captured by the shared
// `MockMidiOutput`. Rendered only when the Mock output is selected. Each
// `send(bytes, ts)` from the scheduler (the unchanged 4.3 pipeline) is decoded
// back to a displayable line via `formatMockLine` (channel decoded from the
// status byte, shown as UI 1–16). One line per message, colored by type via a
// `data-type` attribute (no over-polish).
//
// Re-rendering: `useSyncExternalStore` subscribes to the Mock singleton's
// version counter; each `send` increments it and notifies, so the stream
// re-renders with the latest captured messages. Empty state (Mock active, no
// event yet) shows the exact placeholder « — en attente d'événements — ».

/** Exact empty-state placeholder (FR). */
const MOCK_EMPTY_PLACEHOLDER = "— en attente d'événements —";

/** Tailwind text-color class per type (testable via `data-type`).
 * Story 6.2 — DESIGN.md MIDI tones: note_on = connected, note_off = muted,
 * cc = info, program = on_air, pitch_bend = purple. */
const TYPE_TONE: Record<string, string> = {
  noteOn: "text-connected",
  noteOff: "text-muted-foreground",
  cc: "text-info",
  program: "text-on-air",
  pitchBend: "text-pitch-bend",
};

export function MockByteStream() {
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);

  // Bind the Mock singleton's subscribe/getVersion via stable arrow wrappers
  // (the class methods lose `this` if passed unbound). The singleton is stable
  // across renders, so the callbacks are stable too.
  const subscribe = useCallback(
    (onStoreChange: () => void) => getMockMidiOutput().subscribe(onStoreChange),
    [],
  );
  const getVersion = useCallback(() => getMockMidiOutput().getVersion(), []);
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);

  if (selectedOutputId !== MOCK_OUTPUT_ID) return null;

  const mock = getMockMidiOutput();
  // Decode each captured message; skip unknown (SysEx / system) bytes.
  const lines = mock.messages
    .map((m) => formatMockLine(m.data))
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return (
    <div
      data-testid="listener-mock-byte-stream"
      data-version={version}
      // Story 6.3 — the raw byte stream is intentionally NOT an aria-live
      // region (UX-DR28, AC-U20): it is far too verbose to be announced per
      // MIDI message. `aria-live="off"` makes the exclusion explicit + testable
      // (the default is also off, but the attribute documents the intent). A
      // sober `aria-label` names the region for screen-reader users who
      // navigate to it on demand — it is still readable when focused, just not
      // announced on every change.
      aria-live="off"
      aria-label="Flux MIDI brut Mock — non annoncé en direct"
      className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-2"
    >
      {lines.length === 0 ? (
        <p
          data-testid="listener-mock-byte-stream-empty"
          className="font-mono text-xs text-muted-foreground"
        >
          {MOCK_EMPTY_PLACEHOLDER}
        </p>
      ) : (
        <ul
          data-testid="listener-mock-byte-stream-list"
          className="space-y-0.5 font-mono text-xs"
        >
          {lines.map((line, i) => (
            <li
              key={i}
              data-type={line.type}
              data-testid="listener-mock-byte-stream-line"
              className={TYPE_TONE[line.type] ?? "text-foreground"}
            >
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}