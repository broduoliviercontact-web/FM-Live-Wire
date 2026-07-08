// Dexed/WAM spike — operator grid (isolated in features/dexed/).
//
// Six compact, clickable operator cards. Selecting one opens its detailed
// editor in <OperatorPanel>. Each card shows enabled state, frequency mode
// (ratio / fixed Hz) and an output-level bar. UI-only.

import { Badge } from "../../shared/ui/badge";
import type { FmOperator } from "./fmPatch";

interface OperatorGridProps {
  readonly operators: readonly FmOperator[];
  readonly selectedOp: number;
  readonly onSelect: (index: number) => void;
}

export function OperatorGrid({
  operators,
  selectedOp,
  onSelect,
}: OperatorGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {operators.map((op, i) => {
        const selected = i === selectedOp;
        const classes = [
          "flex flex-col gap-1 rounded-md border p-2 text-left text-xs transition",
          selected ? "border-foreground ring-1 ring-foreground" : "border-input",
          op.enabled ? "" : "opacity-50",
        ].join(" ");
        return (
          <button key={i} type="button" onClick={() => onSelect(i)} className={classes}>
            <div className="flex items-center justify-between">
              <span className="font-medium">Op {i + 1}</span>
              <Badge variant={op.enabled ? "connected" : "secondary"}>
                {op.enabled ? "on" : "off"}
              </Badge>
            </div>
            <span className="text-muted-foreground">
              {op.mode === "ratio"
                ? `×${op.ratio}`
                : `${op.fixedHz.toFixed(0)} Hz`}
            </span>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-foreground"
                style={{ width: `${Math.round(op.outputLevel * 100)}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}