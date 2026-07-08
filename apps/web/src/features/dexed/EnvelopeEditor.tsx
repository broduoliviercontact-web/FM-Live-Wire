// Dexed/WAM spike — envelope editor (isolated in features/dexed/).
//
// 4 rates (segment speeds) + 4 levels (segment endpoints) with a small
// indicative contour. UI-only — not wired to the audio graph.

import type { FmEnvelope } from "./fmPatch";
import { RangeControl } from "./RangeControl";

interface EnvelopeEditorProps {
  readonly envelope: FmEnvelope;
  readonly onChange: (partial: Partial<FmEnvelope>) => void;
}

// Indicative contour: start at 0, then level1..level4 (segment endpoints).
function EnvelopeCurve({ env }: { readonly env: FmEnvelope }) {
  const W = 120;
  const H = 44;
  const pad = 4;
  const values = [0, env.level1, env.level2, env.level3, env.level4];
  const innerW = W - 2 * pad;
  const innerH = H - 2 * pad;
  const points = values
    .map((v, i) => {
      const x = pad + (i * innerW) / 4;
      const y = pad + (1 - v) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[8rem]">
      <rect
        x={pad}
        y={pad}
        width={innerW}
        height={innerH}
        rx={3}
        fill="#0f172a"
        stroke="#1e293b"
      />
      <polyline points={points} fill="none" stroke="#22c55e" strokeWidth="1.5" />
    </svg>
  );
}

export function EnvelopeEditor({ envelope, onChange }: EnvelopeEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <EnvelopeCurve env={envelope} />
        <div className="grid flex-1 grid-cols-2 gap-2">
          <RangeControl
            label="Rate 1"
            min={0}
            max={1}
            step={0.01}
            value={envelope.rate1}
            onChange={(v) => onChange({ rate1: v })}
          />
          <RangeControl
            label="Level 1"
            min={0}
            max={1}
            step={0.01}
            value={envelope.level1}
            onChange={(v) => onChange({ level1: v })}
          />
          <RangeControl
            label="Rate 2"
            min={0}
            max={1}
            step={0.01}
            value={envelope.rate2}
            onChange={(v) => onChange({ rate2: v })}
          />
          <RangeControl
            label="Level 2"
            min={0}
            max={1}
            step={0.01}
            value={envelope.level2}
            onChange={(v) => onChange({ level2: v })}
          />
          <RangeControl
            label="Rate 3"
            min={0}
            max={1}
            step={0.01}
            value={envelope.rate3}
            onChange={(v) => onChange({ rate3: v })}
          />
          <RangeControl
            label="Level 3"
            min={0}
            max={1}
            step={0.01}
            value={envelope.level3}
            onChange={(v) => onChange({ level3: v })}
          />
          <RangeControl
            label="Rate 4"
            min={0}
            max={1}
            step={0.01}
            value={envelope.rate4}
            onChange={(v) => onChange({ rate4: v })}
          />
          <RangeControl
            label="Level 4"
            min={0}
            max={1}
            step={0.01}
            value={envelope.level4}
            onChange={(v) => onChange({ level4: v })}
          />
        </div>
      </div>
    </div>
  );
}