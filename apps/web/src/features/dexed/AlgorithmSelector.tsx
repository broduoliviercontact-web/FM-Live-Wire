// Dexed/WAM spike — FM algorithm selector + simple SVG routing view
// (isolated in features/dexed/).
//
// Shows the 6 operators as nodes and the routing defined by the selected
// `FmAlgorithmDef`: green = carrier (-> OUT), blue = modulation (modulator ->
// carrier), amber ring = self-feedback. UI-only (no audio).

import { ALGORITHMS, type FmAlgorithmDef } from "./fmPatch";

interface AlgorithmSelectorProps {
  readonly algorithm: number;
  readonly onChange: (id: number) => void;
}

// 3 cols x 2 rows of operator nodes; OUT node to the right.
const NODES = [
  { x: 30, y: 40 },
  { x: 90, y: 40 },
  { x: 150, y: 40 },
  { x: 30, y: 88 },
  { x: 90, y: 88 },
  { x: 150, y: 88 },
] as const;
const OUT = { x: 216, y: 64 };
const R = 13;

const DEFAULT_ALGORITHM: FmAlgorithmDef =
  ALGORITHMS[0] ?? { id: 1, name: "?", carriers: [], modulations: [], feedback: [] };

export function AlgorithmSelector({ algorithm, onChange }: AlgorithmSelectorProps) {
  const def = ALGORITHMS.find((a) => a.id === algorithm) ?? DEFAULT_ALGORITHM;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Algorithme</span>
        <select
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={algorithm}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {ALGORITHMS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} — {a.name}
            </option>
          ))}
        </select>
      </div>
      <svg viewBox="0 0 240 128" className="w-full max-w-[16rem]">
        <defs>
          <marker
            id="fm-arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" fill="#64748b" />
          </marker>
        </defs>
        {/* OUT node */}
        <circle cx={OUT.x} cy={OUT.y} r={10} fill="#0f172a" stroke="#64748b" />
        <text x={OUT.x} y={OUT.y + 4} textAnchor="middle" fontSize="8" fill="#cbd5e1">
          OUT
        </text>
        {/* Modulation lines (modulator -> carrier). */}
        {def.modulations.map((m, i) => {
          const from = NODES[m.from];
          const to = NODES[m.to];
          if (from === undefined || to === undefined) return null;
          return (
            <line
              key={`m${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#3b82f6"
              strokeWidth="1.5"
              markerEnd="url(#fm-arrow)"
              opacity="0.8"
            />
          );
        })}
        {/* Carrier lines (op -> OUT). */}
        {def.carriers.map((c, i) => {
          const n = NODES[c];
          if (n === undefined) return null;
          return (
            <line
              key={`c${i}`}
              x1={n.x}
              y1={n.y}
              x2={OUT.x}
              y2={OUT.y}
              stroke="#22c55e"
              strokeWidth="1.5"
              markerEnd="url(#fm-arrow)"
              opacity="0.9"
            />
          );
        })}
        {/* Feedback rings. */}
        {def.feedback.map((f, i) => {
          const n = NODES[f];
          if (n === undefined) return null;
          return (
            <circle
              key={`f${i}`}
              cx={n.x}
              cy={n.y - 20}
              r={4}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
            />
          );
        })}
        {/* Operator nodes (drawn last so lines tuck under). */}
        {NODES.map((n, i) => {
          const isCarrier = def.carriers.includes(i);
          const fill = isCarrier ? "#14532d" : "#1e293b";
          const stroke = isCarrier ? "#22c55e" : "#475569";
          return (
            <g key={i}>
              <circle cx={n.x} cy={n.y} r={R} fill={fill} stroke={stroke} strokeWidth="1.5" />
              <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fill="#e2e8f0">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-muted-foreground">
        <span className="text-connected">vert</span> porteur ·{" "}
        <span className="text-blue-400">bleu</span> modulation ·{" "}
        <span className="text-amber-500">ambre</span> feedback
      </p>
    </div>
  );
}