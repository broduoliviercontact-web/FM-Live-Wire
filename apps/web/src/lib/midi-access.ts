import { createContext, useContext } from "react";

// Story 3.2 — Web MIDI access wrapper + context/hook (AD-3: native Web MIDI,
// sysex:false, no SysEx MVP). This is the leaf `lib` layer: it holds the
// request wrapper, the pure helpers, the React context object and the consumer
// hook. The STATEFUL provider component lives in `app/providers` (it may import
// `lib`); feature components consume via `useMidiInputs` (performer -> lib is
// allowed, performer -> app is NOT, so the hook must live here).
//
// `requestMIDIAccess` is NEVER called at module load — only when the provider's
// `requestAccess()` runs (itself triggered by a user click). No polling: the
// provider re-snapshots inputs on `midiAccess.onstatechange`.

/** AD-8: SysEx is never requested in the MVP. Hard-coded here. */
export const MIDI_ACCESS_SYSEX = false as const;

/** Permission/availability state machine for the provider. */
export type MidiPermissionStatus =
  | "idle" // not yet requested
  | "loading" // requestMIDIAccess in flight
  | "ready" // access granted, inputs snapshotted
  | "denied" // NotAllowedError (user refused)
  | "error"; // other failure

/** A flattened, serializable view of a MIDIInput port (MIDIInput extends MIDIPort). */
export interface MidiInputInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: string;
  readonly connection: string;
}

/** A flattened, serializable view of a MIDIOutput port (MIDIOutput extends MIDIPort). */
export interface MidiOutputInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: string;
  readonly connection: string;
}

/** The context value exposed to consumers via `useMidiInputs`. */
export interface MidiAccessContextValue {
  readonly status: MidiPermissionStatus;
  readonly inputs: readonly MidiInputInfo[];
  readonly outputs: readonly MidiOutputInfo[];
  readonly selectedInputId: string | null;
  /** User-gesture trigger: calls `navigator.requestMIDIAccess({ sysex:false })`. */
  requestAccess: () => Promise<void>;
  /** Select an input by id (or null to clear). Does NOT open the port / capture. */
  selectInput: (id: string | null) => void;
  /** Re-snapshot inputs from the existing MIDIAccess (no new permission prompt). */
  refreshInputs: () => void;
  /**
   * Returns the raw selected `MIDIInput` port (for capture), or `null` if no
   * port is selected / access not granted / the selected port no longer exists.
   * Story 3.3: the capture hook attaches `onmidimessage` to this port.
   */
  getSelectedInput: () => MIDIInput | null;
  /** Re-snapshot outputs from the existing MIDIAccess (no new permission prompt). */
  refreshOutputs: () => void;
  /**
   * Returns the raw `MIDIOutput` port for the given id, or `null` if access is
   * not granted / no port with that id exists. Story 4.3: the listener scheduler
   * sends to this port. The listener's chosen output id is owned by the
   * listener store (not the provider), so the id is passed in (unlike
   * `getSelectedInput`, whose selection the provider owns for the performer).
   * `MIDIOutputMap` only exposes `forEach` in the TS DOM lib (no `get`), so the
   * port is located by id via `forEach`.
   */
  getOutput: (id: string) => MIDIOutput | null;
}

/**
 * Request Web MIDI access with `sysex:false` (AD-8). Thin wrapper so the
 * sysex flag is hard-coded in ONE place and the call site is mockable.
 *
 * Must be called from a user gesture (the provider's `requestAccess`), never at
 * module load.
 */
export async function requestMidiAccess(): Promise<MIDIAccess> {
  return navigator.requestMIDIAccess({ sysex: MIDI_ACCESS_SYSEX });
}

/**
 * Pure helper: flatten a `MIDIInputMap` into a sorted array of `MidiInputInfo`.
 * `MIDIInputMap` only exposes `forEach` (no `values()`/iterator in the TS DOM
 * lib), so we build the array via `forEach` and sort by name then id for stable
 * ordering (port enumeration order is not guaranteed across browsers).
 */
export function snapshotInputs(midiAccess: MIDIAccess): MidiInputInfo[] {
  const out: MidiInputInfo[] = [];
  midiAccess.inputs.forEach((input) => {
    out.push({
      id: input.id,
      // MIDIPort.name / .manufacturer are `string | null` in the DOM lib; a
      // port may be unnamed. Coerce to "" so the UI always deals with strings.
      name: input.name ?? "",
      manufacturer: input.manufacturer ?? "",
      state: input.state,
      connection: input.connection,
    });
  });
  out.sort((a, b) =>
    a.name === b.name
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.name < b.name
        ? -1
        : 1,
  );
  return out;
}

/**
 * Pure helper: flatten a `MIDIOutputMap` into a sorted array of `MidiOutputInfo`
 * (mirrors `snapshotInputs` for the listener output side). `MIDIOutputMap` only
 * exposes `forEach` (no iterator in the TS DOM lib), so the array is built via
 * `forEach` and sorted by name then id for stable ordering.
 */
export function snapshotOutputs(midiAccess: MIDIAccess): MidiOutputInfo[] {
  const out: MidiOutputInfo[] = [];
  midiAccess.outputs.forEach((output) => {
    out.push({
      id: output.id,
      name: output.name ?? "",
      manufacturer: output.manufacturer ?? "",
      state: output.state,
      connection: output.connection,
    });
  });
  out.sort((a, b) =>
    a.name === b.name
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.name < b.name
        ? -1
        : 1,
  );
  return out;
}

/**
 * React context owning the MIDI access state. Created here (leaf `lib`) so both
 * the `app` provider and the `performer` consumers share the same object
 * without a forbidden `performer -> app` import.
 */
export const MidiAccessContext = createContext<MidiAccessContextValue | null>(
  null,
);

/**
 * Consume the MIDI access state. Throws if used outside `MidiAccessProvider`
 * (fail fast — a missing provider is a wiring bug, not a silent null).
 */
export function useMidiInputs(): MidiAccessContextValue {
  const value = useContext(MidiAccessContext);
  if (value === null) {
    throw new Error(
      "useMidiInputs must be used within a <MidiAccessProvider>.",
    );
  }
  return value;
}