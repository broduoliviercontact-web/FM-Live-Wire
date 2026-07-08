// Dexed/WAM spike — FM patch MODEL (isolated in features/dexed/).
//
// Pure data model for our own 6-operator FM interface ("FM Lab — custom
// interface"). NO audio, NO React, NO Dexed/WASM. This lot is UI/model-first:
// none of these parameters are wired to the audio graph yet — the sound still
// comes from the fallback oscillator+filter (see DexedHost + FmLabPanel). The
// model exists so the next lot can wire a real FM engine to a structured patch
// instead of ad-hoc sliders.
//
// This is NOT a Dexed patch format and NOT a copy of Dexed's UI — it is a
// custom, simpler model inspired by classic 6-op FM synths. Ranges are
// normalized (0..1) unless otherwise noted.

export type FmOpMode = "ratio" | "fixed";

/** DX7-style 4-segment envelope: 4 rates (segment speeds) + 4 levels. */
export interface FmEnvelope {
  readonly rate1: number;
  readonly rate2: number;
  readonly rate3: number;
  readonly rate4: number;
  readonly level1: number;
  readonly level2: number;
  readonly level3: number;
  readonly level4: number;
}

export interface FmOperator {
  /** Whether the operator contributes to the algorithm. */
  readonly enabled: boolean;
  /** Frequency multiplier vs the played note (mode "ratio"). */
  readonly ratio: number;
  /** Fixed frequency in Hz (mode "fixed"). */
  readonly fixedHz: number;
  /** Detune in cents. */
  readonly detune: number;
  /** Operator output level (modulation index / amplitude). */
  readonly outputLevel: number;
  /** Ratio (tracks note pitch) or fixed (constant Hz). */
  readonly mode: FmOpMode;
  /** How much velocity scales this operator's level. */
  readonly velocitySensitivity: number;
  /** Keyboard scaling: -1 (less level high up) .. +1 (more level high up). */
  readonly keyboardScaling: number;
  readonly envelope: FmEnvelope;
}

export interface FmPatch {
  /** Algorithm id (index into ALGORITHMS, 1-based). */
  readonly algorithm: number;
  /** Global feedback amount (0..1). */
  readonly feedback: number;
  /** Transpose in semitones (-24..24). */
  readonly transpose: number;
  /** Pitch bend range in semitones. */
  readonly pitchBendRange: number;
  /** LFO speed (0..1 normalized). */
  readonly lfoSpeed: number;
  /** LFO delay before onset (0..1). */
  readonly lfoDelay: number;
  /** LFO pitch modulation depth (0..1). */
  readonly lfoPitchDepth: number;
  /** LFO amplitude modulation depth (0..1). */
  readonly lfoAmpDepth: number;
  /** Master output gain (0..1). */
  readonly outputGain: number;
  /** Exactly 6 operators. */
  readonly operators: readonly FmOperator[];
}

/** Routing definition for the algorithm visualizer (AlgorithmSelector). */
export interface FmAlgorithmDef {
  readonly id: number;
  readonly name: string;
  /** Op indices that feed the output sum (carriers). */
  readonly carriers: readonly number[];
  /** `from` modulates `to` (modulator -> carrier) op indices. */
  readonly modulations: readonly { from: number; to: number }[];
  /** Op indices carrying self-feedback. */
  readonly feedback: readonly number[];
}

// A small, custom set of 6-operator algorithms (NOT copied from Dexed).
// Op indices are 0-based (display shows +1). "OUT" is the audio sum.
export const ALGORITHMS: readonly FmAlgorithmDef[] = [
  {
    id: 1,
    name: "Chaîne 6→1 (cascade)",
    carriers: [0],
    modulations: [
      { from: 1, to: 0 },
      { from: 2, to: 1 },
      { from: 3, to: 2 },
      { from: 4, to: 3 },
      { from: 5, to: 4 },
    ],
    feedback: [5],
  },
  {
    id: 2,
    name: "3× (modulateur→porteur)",
    carriers: [0, 1, 2],
    modulations: [
      { from: 3, to: 0 },
      { from: 4, to: 1 },
      { from: 5, to: 2 },
    ],
    feedback: [5],
  },
  {
    id: 3,
    name: "Double chaîne + 2 porteurs",
    carriers: [0, 1],
    modulations: [
      { from: 2, to: 0 },
      { from: 3, to: 1 },
      { from: 5, to: 4 },
      { from: 4, to: 1 },
    ],
    feedback: [5],
  },
  {
    id: 4,
    name: "3 modulateurs → 1 porteur",
    carriers: [0],
    modulations: [
      { from: 1, to: 0 },
      { from: 2, to: 0 },
      { from: 3, to: 0 },
    ],
    feedback: [3],
  },
  {
    id: 5,
    name: "2 chaînes parallèles",
    carriers: [0, 2],
    modulations: [
      { from: 1, to: 0 },
      { from: 3, to: 2 },
      { from: 4, to: 2 },
      { from: 5, to: 2 },
    ],
    feedback: [5],
  },
  {
    id: 6,
    name: "6 porteurs (additif)",
    carriers: [0, 1, 2, 3, 4, 5],
    modulations: [],
    feedback: [],
  },
];

export const ALGORITHM_COUNT = ALGORITHMS.length;
export const OPERATOR_COUNT = 6;

const DEFAULT_ENVELOPE: FmEnvelope = {
  rate1: 0.9,
  rate2: 0.5,
  rate3: 0.3,
  rate4: 0.4,
  level1: 1,
  level2: 0.7,
  level3: 0.6,
  level4: 0,
};

function makeOperator(
  ratio: number,
  outputLevel: number,
  enabled: boolean,
): FmOperator {
  return {
    enabled,
    ratio,
    fixedHz: 220,
    detune: 0,
    outputLevel,
    mode: "ratio",
    velocitySensitivity: 0.5,
    keyboardScaling: 0,
    envelope: DEFAULT_ENVELOPE,
  };
}

const DEFAULT_OPERATORS: readonly FmOperator[] = [
  makeOperator(1, 0.8, true), // op 1 — porteur
  makeOperator(1, 0.5, true), // op 2 — modulateur
  makeOperator(2, 0.3, false),
  makeOperator(3, 0.2, false),
  makeOperator(2, 0.4, false),
  makeOperator(1, 0.6, false),
];

export const DEFAULT_PATCH: FmPatch = {
  algorithm: 1,
  feedback: 0,
  transpose: 0,
  pitchBendRange: 2,
  lfoSpeed: 0.3,
  lfoDelay: 0.2,
  lfoPitchDepth: 0,
  lfoAmpDepth: 0,
  outputGain: 0.2,
  operators: DEFAULT_OPERATORS,
};

// --- Immutable update helpers -------------------------------------------------

export function updatePatch(
  patch: FmPatch,
  partial: Partial<FmPatch>,
): FmPatch {
  return { ...patch, ...partial };
}

export function updateOperator(
  patch: FmPatch,
  index: number,
  partial: Partial<FmOperator>,
): FmPatch {
  const target = patch.operators[index];
  if (target === undefined) return patch;
  const operators = patch.operators.map((op, i) =>
    i === index ? { ...op, ...partial } : op,
  );
  return { ...patch, operators };
}

export function updateEnvelope(
  patch: FmPatch,
  index: number,
  partial: Partial<FmEnvelope>,
): FmPatch {
  const target = patch.operators[index];
  if (target === undefined) return patch;
  return updateOperator(patch, index, {
    envelope: { ...target.envelope, ...partial },
  });
}

// --- Presets -----------------------------------------------------------------

const RATIO_CHOICES = [0.5, 1, 2, 3, 4, 5, 7] as const;

function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomEnvelope(): FmEnvelope {
  return {
    rate1: rnd(0.4, 1),
    rate2: rnd(0.2, 0.9),
    rate3: rnd(0.1, 0.6),
    rate4: rnd(0.2, 0.7),
    level1: rnd(0.4, 1),
    level2: rnd(0.2, 0.9),
    level3: rnd(0.1, 0.8),
    level4: 0,
  };
}

function randomOperator(index: number): FmOperator {
  const ratio =
    RATIO_CHOICES[Math.floor(Math.random() * RATIO_CHOICES.length)] ?? 1;
  // Keep op 1 a carrier; randomly enable the rest.
  const enabled = index === 0 ? true : Math.random() > 0.4;
  return {
    enabled,
    ratio,
    fixedHz: Math.round(rnd(80, 600)),
    detune: Math.round(rnd(-12, 12)),
    outputLevel: index === 0 ? rnd(0.6, 0.9) : rnd(0.1, 0.7),
    mode: Math.random() > 0.7 ? "fixed" : "ratio",
    velocitySensitivity: rnd(0, 1),
    keyboardScaling: rnd(-0.5, 0.5),
    envelope: randomEnvelope(),
  };
}

/** Produce a musically-plausible random patch (safe ranges, op 1 always on). */
export function randomizePatch(): FmPatch {
  const operators = Array.from({ length: OPERATOR_COUNT }, (_v, i) =>
    randomOperator(i),
  );
  return {
    algorithm: 1 + Math.floor(Math.random() * ALGORITHM_COUNT),
    feedback: rnd(0, 0.4),
    transpose: Math.round(rnd(-12, 12)),
    pitchBendRange: Math.round(rnd(2, 7)),
    lfoSpeed: rnd(0, 0.6),
    lfoDelay: rnd(0, 0.4),
    lfoPitchDepth: rnd(0, 0.3),
    lfoAmpDepth: rnd(0, 0.3),
    outputGain: rnd(0.15, 0.3),
    operators,
  };
}

// --- Import validation / sanitization ---------------------------------------

function clampNumber(v: unknown, min: number, max: number, def: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function sanitizeEnvelope(raw: unknown): FmEnvelope {
  const o = (raw ?? {}) as Partial<FmEnvelope>;
  return {
    rate1: clampNumber(o.rate1, 0, 1, DEFAULT_ENVELOPE.rate1),
    rate2: clampNumber(o.rate2, 0, 1, DEFAULT_ENVELOPE.rate2),
    rate3: clampNumber(o.rate3, 0, 1, DEFAULT_ENVELOPE.rate3),
    rate4: clampNumber(o.rate4, 0, 1, DEFAULT_ENVELOPE.rate4),
    level1: clampNumber(o.level1, 0, 1, DEFAULT_ENVELOPE.level1),
    level2: clampNumber(o.level2, 0, 1, DEFAULT_ENVELOPE.level2),
    level3: clampNumber(o.level3, 0, 1, DEFAULT_ENVELOPE.level3),
    level4: clampNumber(o.level4, 0, 1, DEFAULT_ENVELOPE.level4),
  };
}

function sanitizeOperator(raw: unknown): FmOperator {
  const o = (raw ?? {}) as Partial<FmOperator>;
  const mode: FmOpMode = o.mode === "fixed" ? "fixed" : "ratio";
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : true,
    ratio: clampNumber(o.ratio, 0.0625, 16, 1),
    fixedHz: clampNumber(o.fixedHz, 1, 12000, 220),
    detune: clampNumber(o.detune, -100, 100, 0),
    outputLevel: clampNumber(o.outputLevel, 0, 1, 0.5),
    mode,
    velocitySensitivity: clampNumber(o.velocitySensitivity, 0, 1, 0.5),
    keyboardScaling: clampNumber(o.keyboardScaling, -1, 1, 0),
    envelope: sanitizeEnvelope(o.envelope),
  };
}

/** Coerce an unknown parsed value into a valid FmPatch, or null if unusable. */
export function sanitizePatch(raw: unknown): FmPatch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Partial<FmPatch>;
  const ops = o.operators;
  if (!Array.isArray(ops) || ops.length !== OPERATOR_COUNT) return null;
  const operators = ops.map((op) => sanitizeOperator(op));
  return {
    algorithm: clampNumber(o.algorithm, 1, ALGORITHM_COUNT, DEFAULT_PATCH.algorithm),
    feedback: clampNumber(o.feedback, 0, 1, DEFAULT_PATCH.feedback),
    transpose: clampNumber(o.transpose, -24, 24, DEFAULT_PATCH.transpose),
    pitchBendRange: clampNumber(o.pitchBendRange, 0, 24, DEFAULT_PATCH.pitchBendRange),
    lfoSpeed: clampNumber(o.lfoSpeed, 0, 1, DEFAULT_PATCH.lfoSpeed),
    lfoDelay: clampNumber(o.lfoDelay, 0, 1, DEFAULT_PATCH.lfoDelay),
    lfoPitchDepth: clampNumber(o.lfoPitchDepth, 0, 1, DEFAULT_PATCH.lfoPitchDepth),
    lfoAmpDepth: clampNumber(o.lfoAmpDepth, 0, 1, DEFAULT_PATCH.lfoAmpDepth),
    outputGain: clampNumber(o.outputGain, 0, 1, DEFAULT_PATCH.outputGain),
    operators,
  };
}

export type ValidatePatchResult =
  | { readonly ok: true; readonly patch: FmPatch }
  | { readonly ok: false; readonly error: string };

/** Validate + sanitize an imported JSON value. */
export function validatePatch(data: unknown): ValidatePatchResult {
  const patch = sanitizePatch(data);
  if (patch === null) {
    return {
      ok: false,
      error:
        "Patch invalide : objet attendu avec 6 opérateurs (operators: FmOperator[6]).",
    };
  }
  return { ok: true, patch };
}