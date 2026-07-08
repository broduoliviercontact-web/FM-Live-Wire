// Hotfix audit — timing debug instrumentation (opt-in, MIDI-only).
//
// Silencieux par défaut en dev ET en prod. Activé uniquement par `?debugTiming=1`
// dans l'URL. Aucune donnée sensible n'est loggée : la trace ne contient QUE des
// champs MIDI (`seq`, `type`, `channel`, `note`, `velocity`) et des timestamps
// (`performerTs`/`event.timeStamp`, `performance.now()`, `receivedAt`,
// `targetLocalMs`, `sentTimestamp`). Jamais de token, `performerId` au-delà du
// wire, `OWNER_SECRET`, ni aucune autre valeur secrète.
//
// Deux étages tracés :
//   - `in`  : capture performer (handler `onmidimessage`) — `event.timeStamp` vs
//             `performance.now()` au handler, deltas depuis le précédent noteOn ;
//   - `out` : schedule listener — ancre mirror, `relativeMs`, `targetLocalMs`,
//             `targetDelta`, `outcome`, `scheduleLateMs`, `sentTimestamp`.
//
// Le miroir d'ancre (côté `out`) reproduit l'arithmétique du scheduler
// (`anchor.localMs + max(0, performerTs - anchor.performerTs)`) à partir des
// valeurs TRUE `targetLocalMs` renvoyées par le scheduler, et se resync seul
// quand le scheduler re-ancre (reset lifecycle) — détecté par une divergence
// > 1 ms entre la projection du miroir et le `targetLocalMs` réel. Aucun wiring
// des sites `resetAnchor` n'est nécessaire.

/** Borne du ring buffer (lignes). Évite l'explosion mémoire sur un long flux. */
const TIMING_BUFFER_CAP = 4096;

/** Kind d'étage : capture performer ou schedule listener. */
export type TimingKind = "in" | "out";

/** Outcome observé côté listener (inclut `stopped` pour les events non schedulés). */
export type TimingOutcome = "sent" | "fallback" | "dropped" | "stopped";

/** Ligne enrichie stockée dans le ring buffer (tous champs optionnels sauf kind/seq). */
export interface TimingRow {
  readonly kind: TimingKind;
  readonly seq: number;
  readonly type: string;
  readonly channel: number;
  readonly note: number | null;
  readonly velocity: number | null;
  readonly performerTs: number;
  readonly performerDelta: number | null;
  readonly now: number;
  readonly nowDelta: number | null;
  readonly receivedAt: number | null;
  readonly anchorPerformerTs: number | null;
  readonly anchorLocalMs: number | null;
  readonly relativeMs: number | null;
  readonly targetLocalMs: number | null;
  readonly targetDelta: number | null;
  readonly sentTimestamp: number | null;
  readonly outcome: TimingOutcome | null;
  readonly scheduleLateMs: number | null;
  readonly anchorReset: boolean;
  readonly mirrorConsistent: boolean;
}

/** Entrée de trace côté performer (capture `onmidimessage`). */
export interface PerformerCaptureInput {
  readonly seq: number;
  readonly type: string;
  readonly channel: number;
  /** Présent seulement pour noteOn/noteOff (`exactOptionalPropertyTypes`). */
  readonly note: number | undefined;
  readonly velocity: number | undefined;
  /** `event.timeStamp` (DOMHighResTimeStamp, ms). */
  readonly performerTs: number;
  /** `performance.now()` au handler. */
  readonly now: number;
}

/** Entrée de trace côté listener (après `schedule()`). */
export interface ListenerScheduleInput {
  readonly seq: number;
  readonly type: string;
  readonly channel: number;
  /** Présent seulement pour noteOn/noteOff (`exactOptionalPropertyTypes`). */
  readonly note: number | undefined;
  readonly velocity: number | undefined;
  /** `event.ts` (le `performerTs` passé au scheduler). */
  readonly performerTs: number;
  /** `Date.now()` à la réception (télémétrie epoch, NOT used for scheduling). */
  readonly receivedAt: number;
  /** Slot musical reconstruit renvoyé par le scheduler. */
  readonly targetLocalMs: number;
  /** `now` du scheduler pour cette décision. */
  readonly now: number;
  readonly outcome: TimingOutcome;
  readonly scheduleLateMs: number;
}

/** Poignée devtools exposée sur `window.__FMLW_TIMING` quand le debug est actif. */
export interface TimingDebugHandle {
  flush: () => TimingRow[];
  exportCsv: () => string;
  downloadCsv: () => void;
  rows: () => TimingRow[];
  reset: () => void;
}

// --- état module -------------------------------------------------------------

let enabledCache: boolean | null = null;
const buffer: TimingRow[] = [];

// Miroir d'ancre listener (reproduit l'ancre du scheduler, sans y toucher).
let debugAnchor: { performerTs: number; localMs: number } | null = null;
let lastInNoteOnTs: number | null = null;
let lastInNoteOnNow: number | null = null;
let lastOutNoteOnTarget: number | null = null;

function computeEnabledFromUrl(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return false;
  }
  try {
    return new URLSearchParams(window.location.search).get("debugTiming") === "1";
  } catch {
    return false;
  }
}

/** `true` quand `?debugTiming=1`. Caché après le 1er appel. */
export function isTimingDebugEnabled(): boolean {
  if (enabledCache === null) enabledCache = computeEnabledFromUrl();
  return enabledCache;
}

/** Test hook : force l'état (jsdom : `window.location.search===""` → disabled). */
export function __setTimingDebugEnabledForTest(v: boolean): void {
  enabledCache = v;
  if (!v) {
    buffer.length = 0;
    debugAnchor = null;
    lastInNoteOnTs = null;
    lastInNoteOnNow = null;
    lastOutNoteOnTarget = null;
  }
}

function pushRow(row: TimingRow): void {
  buffer.push(row);
  if (buffer.length > TIMING_BUFFER_CAP) buffer.shift();
}

/** Trace une capture performer. No-op quand le debug est inactif. */
export function logPerformerCapture(input: PerformerCaptureInput): void {
  if (!isTimingDebugEnabled()) return;
  // Deltas depuis le précédent noteOn IN (pour mesurer la régularité de
  // `event.timeStamp` vs `performance.now()` à l'arrivée).
  const isNoteOn = input.type === "noteOn";
  const performerDelta =
    isNoteOn && lastInNoteOnTs !== null ? input.performerTs - lastInNoteOnTs : null;
  const nowDelta =
    isNoteOn && lastInNoteOnNow !== null ? input.now - lastInNoteOnNow : null;
  if (isNoteOn) {
    lastInNoteOnTs = input.performerTs;
    lastInNoteOnNow = input.now;
  }
  pushRow({
    kind: "in",
    seq: input.seq,
    type: input.type,
    channel: input.channel,
    note: input.note ?? null,
    velocity: input.velocity ?? null,
    performerTs: input.performerTs,
    performerDelta,
    now: input.now,
    nowDelta,
    receivedAt: null,
    anchorPerformerTs: null,
    anchorLocalMs: null,
    relativeMs: null,
    targetLocalMs: null,
    targetDelta: null,
    sentTimestamp: null,
    outcome: null,
    scheduleLateMs: null,
    anchorReset: false,
    mirrorConsistent: true,
  });
}

/** Trace un schedule listener. No-op quand le debug est inactif. */
export function logListenerSchedule(input: ListenerScheduleInput): void {
  if (!isTimingDebugEnabled()) return;
  // Miroir d'ancre : projection depuis l'ancre courante, comparée au TRUE
  // `targetLocalMs`. Divergence > 1 ms → le scheduler a re-anchored (reset
  // lifecycle). Au 1er event (ancre nulle), on établit sans marquer de reset.
  let anchorPerformerTs: number;
  let anchorLocalMs: number;
  let anchorReset = false;
  let mirrorConsistent = true;
  if (debugAnchor === null) {
    // 1er event : établissement du miroir (pas une divergence).
    debugAnchor = { performerTs: input.performerTs, localMs: input.targetLocalMs };
    anchorPerformerTs = debugAnchor.performerTs;
    anchorLocalMs = debugAnchor.localMs;
  } else {
    const mirrorTarget =
      debugAnchor.localMs + Math.max(0, input.performerTs - debugAnchor.performerTs);
    if (Math.abs(mirrorTarget - input.targetLocalMs) > 1) {
      // Reset lifecycle détecté : le scheduler a re-anchored.
      anchorReset = true;
      mirrorConsistent = false;
      debugAnchor = { performerTs: input.performerTs, localMs: input.targetLocalMs };
    }
    anchorPerformerTs = debugAnchor.performerTs;
    anchorLocalMs = debugAnchor.localMs;
  }
  const relativeMs = input.targetLocalMs - anchorLocalMs;
  // `sentTimestamp` : ce qui est réellement passé à `output.send`.
  const sentTimestamp =
    input.outcome === "sent"
      ? input.targetLocalMs
      : input.outcome === "fallback"
        ? input.now
        : null;
  // Δ targetLocalMs depuis le précédent noteOn OUT.
  const isNoteOn = input.type === "noteOn";
  const targetDelta =
    isNoteOn && lastOutNoteOnTarget !== null
      ? input.targetLocalMs - lastOutNoteOnTarget
      : null;
  if (isNoteOn) lastOutNoteOnTarget = input.targetLocalMs;
  pushRow({
    kind: "out",
    seq: input.seq,
    type: input.type,
    channel: input.channel,
    note: input.note ?? null,
    velocity: input.velocity ?? null,
    performerTs: input.performerTs,
    performerDelta: null,
    now: input.now,
    nowDelta: null,
    receivedAt: input.receivedAt,
    anchorPerformerTs,
    anchorLocalMs,
    relativeMs,
    targetLocalMs: input.targetLocalMs,
    targetDelta,
    sentTimestamp,
    outcome: input.outcome,
    scheduleLateMs: input.scheduleLateMs,
    anchorReset,
    mirrorConsistent,
  });
}

/** Colonnes CSV (ordre fixe, un seul schéma pour `in` et `out`). */
const CSV_COLUMNS = [
  "seq",
  "type",
  "channel",
  "note",
  "velocity",
  "performerTs",
  "performerDelta",
  "receivedAt",
  "anchorPerformerTs",
  "anchorLocalMs",
  "relativeMs",
  "targetLocalMs",
  "targetDelta",
  "sentTimestamp",
  "outcome",
  "scheduleLateMs",
  "anchorReset",
] as const;

function csvCell(v: number | string | null | boolean | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

/** Extrait un champ nommé d'une `TimingRow` (typé, pas de cast `Record`). */
function rowField(r: TimingRow, c: (typeof CSV_COLUMNS)[number]): unknown {
  switch (c) {
    case "seq": return r.seq;
    case "type": return r.type;
    case "channel": return r.channel;
    case "note": return r.note;
    case "velocity": return r.velocity;
    case "performerTs": return r.performerTs;
    case "performerDelta": return r.performerDelta;
    case "receivedAt": return r.receivedAt;
    case "anchorPerformerTs": return r.anchorPerformerTs;
    case "anchorLocalMs": return r.anchorLocalMs;
    case "relativeMs": return r.relativeMs;
    case "targetLocalMs": return r.targetLocalMs;
    case "targetDelta": return r.targetDelta;
    case "sentTimestamp": return r.sentTimestamp;
    case "outcome": return r.outcome;
    case "scheduleLateMs": return r.scheduleLateMs;
    case "anchorReset": return r.anchorReset;
    default: return null;
  }
}

/** Sérialise le ring buffer en CSV (en-tête + lignes). */
export function exportTimingCsv(): string {
  const header = CSV_COLUMNS.join(",");
  const lines = buffer.map((r) =>
    CSV_COLUMNS.map((c) => csvCell(rowField(r, c) as string | number | null | boolean)).join(","),
  );
  return [header, ...lines].join("\n");
}

/** Affiche la trace via `console.table` et la retourne. */
export function flushTimingTrace(): TimingRow[] {
  console.table(buffer);
  return [...buffer];
}

/** Télécharge le CSV (`fm-live-wire-timing.csv`). No-op sans `document`. */
export function downloadTimingCsv(): void {
  if (typeof document === "undefined") return;
  const csv = exportTimingCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fm-live-wire-timing.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Réinitialise le buffer + le miroir (isolation tests / nouvelle session). */
export function resetTimingTrace(): void {
  buffer.length = 0;
  debugAnchor = null;
  lastInNoteOnTs = null;
  lastInNoteOnNow = null;
  lastOutNoteOnTarget = null;
}

// --- poignée devtools (uniquement quand le debug est actif) -------------------

function buildHandle(): TimingDebugHandle {
  return {
    flush: flushTimingTrace,
    exportCsv: exportTimingCsv,
    downloadCsv: downloadTimingCsv,
    rows: () => [...buffer],
    reset: resetTimingTrace,
  };
}

if (typeof window !== "undefined" && isTimingDebugEnabled()) {
  window.__FMLW_TIMING = buildHandle();
}

// Déclaration du type global pour `window.__FMLW_TIMING` (évite les erreurs
// TS/build quand un opérateur l'utilise depuis la console devtools).
declare global {
  interface Window {
    __FMLW_TIMING?: TimingDebugHandle;
  }
}