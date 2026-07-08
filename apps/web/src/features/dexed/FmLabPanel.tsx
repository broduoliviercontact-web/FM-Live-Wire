// Dexed/WAM spike — FM Lab fallback control panel (isolated in features/dexed/).
//
// IMPORTANT naming: this is the FALLBACK synth only (oscillator + envelope +
// lowpass filter). It is NOT the real Dexed WAM — no WASM asset is vendored
// (see NOTICE.md). The panel is deliberately called "FM Lab controls —
// fallback only" so nobody mistakes it for a loaded Dexed engine. The real
// WAM insertion point lives in `DexedHost.tsx` (`dexedWamInsertionPoint`).
//
// Pure presentational: edits a `SynthParams` object via `onChange(partial)`;
// `DexedHost` owns the params + the audio graph that consumes them.

import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";

export interface SynthParams {
  /** Oscillator waveform. */
  readonly waveform: OscillatorType;
  /** Attack time in seconds. */
  readonly attack: number;
  /** Release time in seconds. */
  readonly release: number;
  /** Lowpass filter cutoff in Hz (20–20000). */
  readonly cutoff: number;
  /** Master output gain (0–1). */
  readonly gain: number;
}

interface FmLabPanelProps {
  params: SynthParams;
  onChange: (patch: Partial<SynthParams>) => void;
}

// Log-spaced cutoff mapping so the slider is usable across 20 Hz–20 kHz:
// t=0 -> 20 Hz, t=1 -> 20 kHz (20 * 1000^t).
function cutoffToT(c: number): number {
  return Math.log(c / 20) / Math.log(1000);
}
function tToCutoff(t: number): number {
  return 20 * Math.pow(1000, t);
}

interface RangeControlProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: RangeControlProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

export function FmLabPanel({ params, onChange }: FmLabPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>FM Lab controls — fallback only</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Synthèse de fallback (oscillateur + enveloppe + filtre résonant). Pas
          le vrai Dexed — aucun asset WASM n'est vendu (GPL-3.0 à vérifier, voir
          NOTICE.md). Le point d'insertion du vrai WAM est marqué dans{" "}
          <code>DexedHost.tsx</code>.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Waveform</span>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={params.waveform}
            onChange={(e) =>
              onChange({ waveform: e.target.value as OscillatorType })
            }
          >
            <option value="sawtooth">Sawtooth</option>
            <option value="sine">Sine</option>
            <option value="square">Square</option>
            <option value="triangle">Triangle</option>
          </select>
        </label>

        <RangeControl
          label={`Attack — ${params.attack.toFixed(3)} s`}
          min={0}
          max={1}
          step={0.005}
          value={params.attack}
          onChange={(v) => onChange({ attack: v })}
        />

        <RangeControl
          label={`Release — ${params.release.toFixed(3)} s`}
          min={0}
          max={1}
          step={0.005}
          value={params.release}
          onChange={(v) => onChange({ release: v })}
        />

        <RangeControl
          label={`Filter cutoff — ${params.cutoff.toFixed(0)} Hz`}
          min={0}
          max={1}
          step={0.001}
          value={cutoffToT(params.cutoff)}
          onChange={(v) => onChange({ cutoff: tToCutoff(v) })}
        />

        <RangeControl
          label={`Output gain — ${Math.round(params.gain * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          value={params.gain}
          onChange={(v) => onChange({ gain: v })}
        />
      </CardContent>
    </Card>
  );
}