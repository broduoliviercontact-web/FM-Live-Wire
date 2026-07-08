// Dexed/WAM spike — operator detail editor (isolated in features/dexed/).
//
// Edits the selected operator: enabled, frequency mode (ratio / fixed), ratio
// or fixed Hz, detune, output level, velocity sensitivity, keyboard scaling,
// and its envelope (via <EnvelopeEditor>). UI-only — no audio wiring.

import { EnvelopeEditor } from "./EnvelopeEditor";
import type { FmOperator, FmOpMode } from "./fmPatch";
import { RangeControl } from "./RangeControl";

interface OperatorPanelProps {
  readonly op: FmOperator;
  readonly index: number;
  readonly onChange: (partial: Partial<FmOperator>) => void;
}

export function OperatorPanel({ op, index, onChange }: OperatorPanelProps) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-input p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Opérateur {index + 1}</span>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={op.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span className="text-muted-foreground">activé</span>
        </label>
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={op.mode}
          onChange={(e) => onChange({ mode: e.target.value as FmOpMode })}
        >
          <option value="ratio">Ratio (× note)</option>
          <option value="fixed">Fixe (Hz)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {op.mode === "ratio" ? (
          <RangeControl
            label="Ratio"
            min={0.0625}
            max={16}
            step={0.0625}
            value={op.ratio}
            onChange={(v) => onChange({ ratio: v })}
            format={(v) => `×${v.toFixed(2)}`}
          />
        ) : (
          <RangeControl
            label="Fréquence"
            min={1}
            max={12000}
            step={1}
            value={op.fixedHz}
            onChange={(v) => onChange({ fixedHz: v })}
            format={(v) => `${v.toFixed(0)} Hz`}
          />
        )}
        <RangeControl
          label="Detune"
          min={-100}
          max={100}
          step={1}
          value={op.detune}
          onChange={(v) => onChange({ detune: v })}
          format={(v) => `${v} cents`}
        />
        <RangeControl
          label="Output level"
          min={0}
          max={1}
          step={0.01}
          value={op.outputLevel}
          onChange={(v) => onChange({ outputLevel: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <RangeControl
          label="Velocity sens."
          min={0}
          max={1}
          step={0.01}
          value={op.velocitySensitivity}
          onChange={(v) => onChange({ velocitySensitivity: v })}
        />
        <RangeControl
          label="Keyboard scaling"
          min={-1}
          max={1}
          step={0.01}
          value={op.keyboardScaling}
          onChange={(v) => onChange({ keyboardScaling: v })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Enveloppe</span>
        <EnvelopeEditor
          envelope={op.envelope}
          onChange={(partial) =>
            onChange({ envelope: { ...op.envelope, ...partial } })
          }
        />
      </div>
    </div>
  );
}