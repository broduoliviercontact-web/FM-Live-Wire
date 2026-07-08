// Dexed/WAM spike — shared range slider (isolated in features/dexed/).
//
// Tiny presentational helper used by the FM Lab interface globals, operator
// panel and envelope editor so they all render sliders the same compact way.

interface RangeControlProps {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (v: number) => void;
  /** Optional value formatter (e.g. Hz, %, semitones). */
  readonly format?: (v: number) => string;
}

export function RangeControl({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: RangeControlProps) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">
        {label}
        <span className="text-foreground">
          {" "}
          {format ? format(value) : value}
        </span>
      </span>
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