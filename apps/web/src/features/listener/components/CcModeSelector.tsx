import { useRef } from "react";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import { useListenerStore } from "../store/listenerStore";
import { setListenerCcMode } from "../api/connection";
import type { CcMode } from "../lib/cc-coalescer";
import { cn } from "../../../lib/utils";
import { CheckIcon } from "../../../shared/ui/icons";

// CC rate-limiter / coalescer mode selector (Raw / Smooth / Safe).
//
// A 3-button accessible `radiogroup` (mirrors `ChannelSelector` — UX-DR25):
//   - `role="radiogroup"` on the row, labelled by the visible label;
//   - each button is `role="radio"` with `aria-checked`;
//   - roving tabindex: the active radio is `tabindex=0`, others `tabindex=-1`;
//   - arrow (↑↓←→) + Home/End move the selection and move focus along;
//   - a visible check icon marks the active radio (not color-only).
//
// Smooth (60 Hz) is the DEFAULT — the safe synth-friendly ceiling that tames a
// CC74 deluge (~194 CC/s, peaks 416) without starving the synth. Safe (30 Hz) is
// for unstable links / slow synths; Raw bypasses the coalescer entirely (every
// CC forwards). The preference lives in `listenerStore.ccMode` and persists
// across leave/rejoin (like `channel`); the orchestrator `setListenerCcMode`
// flushes held CC pending BEFORE applying the new mode (preserves the last
// value). NOTES are never affected by this setting — they always pass through.
//
// The tooltip is an always-present, accessible help paragraph (testable in
// jsdom) + a native `title` on the label for hover affordance.
//
// Only shown once MIDI access is granted (status === "ready"). No join, no
// reception, no scheduler here — pure preference.

const TOOLTIP_TEXT =
  "Limite le débit CC (filter cutoff, modwheel…) pour ne pas saturer le synthé. Smooth 60 Hz, Safe 30 Hz, Raw aucun lissage.";

const MODES: ReadonlyArray<{ readonly mode: CcMode; readonly label: string }> = [
  { mode: "raw", label: "Raw" },
  { mode: "smooth", label: "Smooth" },
  { mode: "safe", label: "Safe" },
];

const RADIO_BASE =
  "relative inline-flex h-9 items-center justify-center gap-1 rounded-md border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CcModeSelector() {
  const { status } = useMidiOutputs();
  const ccMode = useListenerStore((s) => s.ccMode);
  const groupRef = useRef<HTMLDivElement>(null);

  if (status !== "ready") return null;

  // Move selection to `mode` and focus the target radio (roving tabindex: the
  // newly-active radio becomes the tab stop and receives focus).
  const moveFocusTo = (mode: CcMode) => {
    setListenerCcMode(mode);
    const btn = groupRef.current?.querySelector<HTMLButtonElement>(
      `[data-cc-mode="${mode}"]`,
    );
    btn?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, mode: CcMode) => {
    const idx = MODES.findIndex((m) => m.mode === mode);
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveFocusTo(MODES[Math.min(MODES.length - 1, idx + 1)]!.mode);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveFocusTo(MODES[Math.max(0, idx - 1)]!.mode);
        break;
      case "Home":
        e.preventDefault();
        moveFocusTo(MODES[0]!.mode);
        break;
      case "End":
        e.preventDefault();
        moveFocusTo(MODES[MODES.length - 1]!.mode);
        break;
      default:
        break;
    }
  };

  const selectedLabel = MODES.find((m) => m.mode === ccMode)?.label ?? ccMode;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span
          id="listener-cc-mode-label"
          className="text-sm font-medium leading-none"
          title={TOOLTIP_TEXT}
          data-testid="listener-cc-mode-label"
        >
          Mode CC
        </span>
        <span
          data-testid="listener-cc-mode-selected"
          className="text-xs text-muted-foreground"
        >
          {selectedLabel}
        </span>
      </div>

      <p
        data-testid="listener-cc-mode-tooltip"
        className="text-xs text-muted-foreground"
      >
        {TOOLTIP_TEXT}
      </p>

      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby="listener-cc-mode-label"
        data-testid="listener-cc-mode-selector"
        className="grid grid-cols-3 gap-2"
      >
        {MODES.map(({ mode, label }) => {
          const isSelected = mode === ccMode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              aria-label={`Mode CC ${label}`}
              data-cc-mode={mode}
              data-testid={`listener-cc-mode-button-${mode}`}
              onClick={() => setListenerCcMode(mode)}
              onKeyDown={(e) => handleKeyDown(e, mode)}
              className={cn(
                RADIO_BASE,
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent",
              )}
            >
              {isSelected && (
                <CheckIcon className="h-3 w-3" aria-hidden="true" />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}