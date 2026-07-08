// Dexed/WAM spike — FM Lab custom interface (isolated in features/dexed/).
//
// Composes the FM patch model UI (presets, globals, algorithm, operator grid,
// operator detail) and renders the existing fallback synth panel below it.
//
// IMPORTANT: this lot wires a REAL 2-operator FM engine (OP1 carrier, OP2
// modulator) to the patch model when engineMode is "fm2op". In "fallback"
// mode the only sound comes from the fallback oscillator+filter (FmLabPanel).
// OP3-OP6 remain UI/model-only in both modes (clearly labeled below). The
// "Dexed WAM non chargé" alert stays (DexedHost). This panel is "FM Lab —
// custom interface", NOT a real Dexed UI, and no Dexed/WASM asset is used.

import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { FmLabPanel, type SynthParams } from "./FmLabPanel";
import { AlgorithmSelector } from "./AlgorithmSelector";
import { OperatorGrid } from "./OperatorGrid";
import { OperatorPanel } from "./OperatorPanel";
import { PresetPanel } from "./PresetPanel";
import { RangeControl } from "./RangeControl";
import { updateOperator, updatePatch, type FmPatch } from "./fmPatch";
import { type EngineMode } from "./fmEngine";

interface FmLabInterfaceProps {
  readonly patch: FmPatch;
  readonly onPatchChange: (patch: FmPatch) => void;
  readonly selectedOp: number;
  readonly onSelectOp: (index: number) => void;
  /** Which audio engine is active ("fallback" | "fm2op"). */
  readonly engineMode: EngineMode;
  readonly onEngineModeChange: (mode: EngineMode) => void;
  /** Fallback synth controls (these act on the sound only in "fallback" mode). */
  readonly fallbackParams: SynthParams;
  readonly onFallbackChange: (partial: Partial<SynthParams>) => void;
}

export function FmLabInterface({
  patch,
  onPatchChange,
  selectedOp,
  onSelectOp,
  engineMode,
  onEngineModeChange,
  fallbackParams,
  onFallbackChange,
}: FmLabInterfaceProps) {
  const op = patch.operators[selectedOp] ?? patch.operators[0];
  if (op === undefined) return null;
  const fm2op = engineMode === "fm2op";
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>FM Lab — custom interface</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Modèle de patch FM 6 opérateurs. En mode « FM 2-op preview »,
            OP1 (porteur) et OP2 (modulateur) pilotent un vrai moteur FM maison ;
            OP3-OP6 restent UI uniquement dans tous les modes. Aucun asset
            Dexed/WASM chargé (alerte « Dexed WAM non chargé »).
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Engine mode</span>
              <select
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                value={engineMode}
                onChange={(e) => onEngineModeChange(e.target.value as EngineMode)}
              >
                <option value="fallback">Fallback synth</option>
                <option value="fm2op">FM 2-op preview</option>
              </select>
            </label>
            {fm2op ? (
              <span className="text-xs text-muted-foreground">
                FM 2-op preview — OP1 carrier, OP2 modulator. OP3-OP6 UI-only.
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Fallback synth actif — contrôles FM OP1/OP2 UI/model uniquement.
              </span>
            )}
          </div>

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

      {fm2op ? (
        <p className="text-xs text-muted-foreground">
          Le panneau « FM Lab controls — fallback only » ci-dessous est inactif
          en mode FM 2-op preview (il ne pilote le son qu'en mode Fallback synth).
        </p>
      ) : null}
      <FmLabPanel params={fallbackParams} onChange={onFallbackChange} />
    </>
  );
}