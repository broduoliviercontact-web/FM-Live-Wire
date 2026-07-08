import { useRef } from "react";
import { useMidiOutputs } from "../hooks/useMidiOutputs";
import { useListenerStore } from "../store/listenerStore";
import { changeListenerChannel } from "../api/connection";
import {
  uiChannelToData,
  dataChannelToUi,
  UI_CHANNEL_MIN,
  UI_CHANNEL_MAX,
} from "../lib/remap";
import { cn } from "../../../lib/utils";
import { CheckIcon } from "../../../shared/ui/icons";

// Story 4.2 — output channel selector (UX-DR8, AC-U5, AD-12).
// Story 6.3 — refactored to an accessible `radiogroup` (UX-DR25, AC-U18):
//   - `role="radiogroup"` on the grid, labelled by the visible label;
//   - each button is `role="radio"` with `aria-checked`;
//   - roving tabindex: the active radio is `tabindex=0`, others `tabindex=-1`;
//   - arrow (↑↓←→) + Home/End move the selection and move focus along;
//   - a visible check icon marks the active radio so the selection does NOT
//     rely on color alone.
//
// A grid of 16 buttons labelled 1–16 (UI). The listener's forced output channel
// is stored as a WIRE/DATA value 0–15 in `listenerStore`; the UI↔data conversion
// happens at the edge (`uiChannelToData` / `dataChannelToUi`). Default is UI
// channel 1 (data 0) per Q-UX7. The original channel of incoming events is
// ignored — the tooltip explains the forced remap (exact text below).
//
// The tooltip text is rendered as an always-present, accessible help paragraph
// (data-testid `listener-channel-tooltip`) rather than a hover-only radix
// Tooltip, so it is reliably present in the DOM and testable in jsdom. A native
// `title` on the label mirrors it for hover affordance.
//
// Only shown once MIDI access is granted (status === "ready"). No join, no
// reception, no scheduler here.

const TOOLTIP_TEXT =
  "Le canal ici = la sortie vers votre synthé. Le flux d'origine est ignoré : tout passe sur ce canal.";

const RADIO_BASE =
  "relative inline-flex h-9 items-center justify-center gap-1 rounded-md border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ChannelSelector() {
  const { status, getOutput } = useMidiOutputs();
  const channel = useListenerStore((s) => s.channel);
  const groupRef = useRef<HTMLDivElement>(null);

  if (status !== "ready") {
    return null;
  }

  const selectedUi = dataChannelToUi(channel);
  const channels = Array.from(
    { length: UI_CHANNEL_MAX - UI_CHANNEL_MIN + 1 },
    (_, i) => UI_CHANNEL_MIN + i,
  );

  // Move selection to `ui` and focus the target radio (roving tabindex: the
  // newly-active radio becomes the tab stop and receives focus). Clamped to
  // 1–16 so the arrow keys can't escape the group.
  const moveFocusTo = (ui: number) => {
    const clamped = Math.max(UI_CHANNEL_MIN, Math.min(UI_CHANNEL_MAX, ui));
    changeListenerChannel(uiChannelToData(clamped), getOutput);
    const btn = groupRef.current?.querySelector<HTMLButtonElement>(
      `[data-ui="${clamped}"]`,
    );
    btn?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, ui: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveFocusTo(ui + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveFocusTo(ui - 1);
        break;
      case "Home":
        e.preventDefault();
        moveFocusTo(UI_CHANNEL_MIN);
        break;
      case "End":
        e.preventDefault();
        moveFocusTo(UI_CHANNEL_MAX);
        break;
      default:
        break;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span
          id="listener-channel-label"
          className="text-sm font-medium leading-none"
          title={TOOLTIP_TEXT}
          data-testid="listener-channel-label"
        >
          Canal de sortie
        </span>
        <span
          data-testid="listener-channel-selected"
          className="text-xs text-muted-foreground"
        >
          {selectedUi}
        </span>
      </div>

      <p
        data-testid="listener-channel-tooltip"
        className="text-xs text-muted-foreground"
      >
        {TOOLTIP_TEXT}
      </p>

      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby="listener-channel-label"
        data-testid="listener-channel-selector"
        className="grid grid-cols-8 gap-2"
      >
        {channels.map((ui) => {
          const isSelected = ui === selectedUi;
          return (
            <button
              key={ui}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              aria-label={`Canal ${ui}`}
              data-ui={ui}
              data-testid={`listener-channel-button-${ui}`}
              onClick={() => changeListenerChannel(uiChannelToData(ui), getOutput)}
              onKeyDown={(e) => handleKeyDown(e, ui)}
              className={cn(
                RADIO_BASE,
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent",
              )}
            >
              {/* Story 6.3 — visible check on the active radio (not color-only). */}
              {isSelected && (
                <CheckIcon className="h-3 w-3" aria-hidden="true" />
              )}
              <span>{ui}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}