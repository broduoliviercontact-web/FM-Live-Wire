// Dexed/WAM spike — FM Lab custom interface (isolated in features/dexed/).
//
// Composes the FM patch model UI (presets, globals, algorithm, operator grid,
// operator detail) and renders the existing fallback synth panel below it.
//
// IMPORTANT: this lot is UI/MODEL-FIRST. None of the FM patch parameters are
// wired to the audio graph yet — the only sound comes from the fallback
// oscillator+filter (FmLabPanel), unchanged. The "Dexed WAM non chargé" alert
// stays (DexedHost). This panel is "FM Lab — custom interface", NOT a real
// Dexed UI, and no Dexed/WASM asset is used.

import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { FmLabPanel, type SynthParams } from "./FmLabPanel";
import { AlgorithmSelector } from "./AlgorithmSelector";
import { OperatorGrid } from "./OperatorGrid";
import { OperatorPanel } from "./OperatorPanel";
import { PresetPanel } from "./PresetPanel";
import { RangeControl } from "./RangeControl";
import { updateOperator, updatePatch, type FmPatch } from "./fmPatch";

interface FmLabInterfaceProps {
  readonly patch: FmPatch;
  readonly onPatchChange: (patch: FmPatch) => void;
  readonly selectedOp: number;
  readonly onSelectOp: (index: number) => void;
  /** Fallback synth controls (these still act on the sound). */
  readonly fallbackParams: SynthParams;
  readonly onFallbackChange: (partial: Partial<SynthParams>) => void;
}

export function FmLabInterface({
  patch,
  onPatchChange,
  selectedOp,
  onSelectOp,
  fallbackParams,
  onFallbackChange,
}: FmLabInterfaceProps) {
  const op = patch.operators[selectedOp] ?? patch.operators[0];
  if (op === undefined) return null;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>FM Lab — custom interface</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Modèle de patch FM 6 opérateurs — interface uniquement, pas encore
            connectée au moteur audio. Le son actif reste le fallback ci-dessous
            (« FM Lab controls — fallback only »). Aucun asset Dexed/WASM chargé
            (alerte « Dexed WAM non chargé »).
          </p>

          <PresetPanel patch={patch} onPatchChange={onPatchChange} />

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Global</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <RangeControl
                label="Transpose"
                min={-24}
                max={24}
                step={1}
                value={patch.transpose}
                onChange={(v) => onPatchChange(updatePatch(patch, { transpose: v }))}
                format={(v) => `${v} st`}
              />
              <RangeControl
                label="Pitch bend"
                min={0}
                max={24}
                step={1}
                value={patch.pitchBendRange}
                onChange={(v) =>
                  onPatchChange(updatePatch(patch, { pitchBendRange: v }))
                }
                format={(v) => `${v} st`}
              />
              <RangeControl
                label="Feedback"
                min={0}
                max={1}
                step={0.01}
                value={patch.feedback}
                onChange={(v) => onPatchChange(updatePatch(patch, { feedback: v }))}
              />
              <RangeControl
                label="LFO speed"
                min={0}
                max={1}
                step={0.01}
                value={patch.lfoSpeed}
                onChange={(v) => onPatchChange(updatePatch(patch, { lfoSpeed: v }))}
              />
              <RangeControl
                label="LFO delay"
                min={0}
                max={1}
                step={0.01}
                value={patch.lfoDelay}
                onChange={(v) => onPatchChange(updatePatch(patch, { lfoDelay: v }))}
              />
              <RangeControl
                label="LFO pitch depth"
                min={0}
                max={1}
                step={0.01}
                value={patch.lfoPitchDepth}
                onChange={(v) =>
                  onPatchChange(updatePatch(patch, { lfoPitchDepth: v }))
                }
              />
              <RangeControl
                label="LFO amp depth"
                min={0}
                max={1}
                step={0.01}
                value={patch.lfoAmpDepth}
                onChange={(v) =>
                  onPatchChange(updatePatch(patch, { lfoAmpDepth: v }))
                }
              />
              <RangeControl
                label="Output gain"
                min={0}
                max={1}
                step={0.01}
                value={patch.outputGain}
                onChange={(v) => onPatchChange(updatePatch(patch, { outputGain: v }))}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
            <AlgorithmSelector
              algorithm={patch.algorithm}
              onChange={(id) => onPatchChange(updatePatch(patch, { algorithm: id }))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Opérateurs</span>
            <OperatorGrid
              operators={patch.operators}
              selectedOp={selectedOp}
              onSelect={onSelectOp}
            />
            <OperatorPanel
              op={op}
              index={selectedOp}
              onChange={(partial) => onPatchChange(updateOperator(patch, selectedOp, partial))}
            />
          </div>
        </CardContent>
      </Card>

      <FmLabPanel params={fallbackParams} onChange={onFallbackChange} />
    </>
  );
}