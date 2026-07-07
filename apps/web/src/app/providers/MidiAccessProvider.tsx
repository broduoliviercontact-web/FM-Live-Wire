import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MidiAccessContext,
  requestMidiAccess,
  snapshotInputs,
  snapshotOutputs,
  type MidiAccessContextValue,
  type MidiInputInfo,
  type MidiOutputInfo,
  type MidiPermissionStatus,
} from "../../lib/midi-access";

// Story 3.2 — stateful MIDI access provider (AD-3). Replaces the Story 1.4
// placeholder. Holds the permission state machine + the snapshotted input list
// + the selected input, and exposes actions via the `MidiAccessContext` (the
// context object + `useMidiInputs` hook live in `lib` so feature layers can
// consume them without importing `app`).
//
// Invariants:
//   - `requestMIDIAccess({ sysex:false })` is called ONLY from `requestAccess`
//     (a user gesture), NEVER at mount/load.
//   - No polling. The input list is re-snapshotted on `midiAccess.onstatechange`
//     and on explicit `refreshInputs()`.
//   - If the selected port disappears from the snapshot, the selection is
//     cleared (no crash, no dangling id).
//   - No MIDI message handler is installed here (MIDI capture is Story 3.3).
//   - The `MIDIAccess` reference is kept in a ref (not state) so `onstatechange`
//     can re-snapshot without re-rendering on identity changes.

export function MidiAccessProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MidiPermissionStatus>("idle");
  const [inputs, setInputs] = useState<readonly MidiInputInfo[]>([]);
  const [outputs, setOutputs] = useState<readonly MidiOutputInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);

  const midiAccessRef = useRef<MIDIAccess | null>(null);

  /** Re-snapshot inputs + outputs from the current MIDIAccess + reconcile the
   *  input selection. (Output selection is owned by the listener store, which
   *  reconciles itself against this list.) */
  const resnapshot = useCallback(() => {
    const access = midiAccessRef.current;
    if (access === null) return;
    const nextInputs = snapshotInputs(access);
    setInputs(nextInputs);
    setOutputs(snapshotOutputs(access));
    // Clear the input selection if the selected port is no longer present.
    setSelectedInputId((current) =>
      current === null || nextInputs.some((i) => i.id === current)
        ? current
        : null,
    );
  }, []);

  /** User-gesture trigger. Calls requestMIDIAccess({sysex:false}) exactly once per click. */
  const requestAccess = useCallback(async () => {
    if (midiAccessRef.current !== null) {
      // Already granted: just re-snapshot (no new permission prompt).
      setStatus("ready");
      resnapshot();
      return;
    }
    setStatus("loading");
    try {
      const access = await requestMidiAccess();
      midiAccessRef.current = access;
      // Hot-plug: re-snapshot whenever a port state changes (no polling).
      access.onstatechange = () => {
        resnapshot();
      };
      setStatus("ready");
      resnapshot();
    } catch (err) {
      // Distinguish user refusal (E3) from other failures; never expose details.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setStatus("denied");
      } else {
        setStatus("error");
      }
    }
  }, [resnapshot]);

  const selectInput = useCallback((id: string | null) => {
    setSelectedInputId(id);
  }, []);

  const refreshInputs = useCallback(() => {
    resnapshot();
  }, [resnapshot]);

  const refreshOutputs = useCallback(() => {
    resnapshot();
  }, [resnapshot]);

  /**
   * Return the raw `MIDIOutput` port for the given id (Story 4.3 listener
   * scheduler), or null. `MIDIOutputMap` only exposes `forEach` in the TS DOM
   * lib (no `get`), so the port is located by id via `forEach`. The id is passed
   * in because the listener owns its output choice in the listener store.
   */
  const getOutput = useCallback((id: string): MIDIOutput | null => {
    const access = midiAccessRef.current;
    if (access === null) return null;
    let found: MIDIOutput | null = null;
    access.outputs.forEach((output) => {
      if (output.id === id) found = output;
    });
    return found;
  }, []);

  /**
   * Return the raw selected `MIDIInput` port for capture (Story 3.3), or null.
   * `MIDIInputMap` only exposes `forEach` in the TS DOM lib (no `get`), so the
   * port is located by id via `forEach`. The callback depends on
   * `selectedInputId` so its identity changes when the selection changes (the
   * capture hook re-binds `onmidimessage` on that change).
   */
  const getSelectedInput = useCallback((): MIDIInput | null => {
    const access = midiAccessRef.current;
    if (access === null) return null;
    const selected = selectedInputId;
    if (selected === null) return null;
    let found: MIDIInput | null = null;
    access.inputs.forEach((input) => {
      if (input.id === selected) found = input;
    });
    return found;
  }, [selectedInputId]);

  // Release the access reference + drop the handler on unmount (no leak).
  useEffect(() => {
    return () => {
      const access = midiAccessRef.current;
      if (access !== null) {
        access.onstatechange = null;
        midiAccessRef.current = null;
      }
    };
  }, []);

  const value: MidiAccessContextValue = {
    status,
    inputs,
    outputs,
    selectedInputId,
    requestAccess,
    selectInput,
    refreshInputs,
    getSelectedInput,
    refreshOutputs,
    getOutput,
  };

  return (
    <MidiAccessContext.Provider value={value}>
      {children}
    </MidiAccessContext.Provider>
  );
}