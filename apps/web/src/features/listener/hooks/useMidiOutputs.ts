import { useCallback } from "react";
import { useMidiInputs } from "../../../lib/midi-access";
import { useListenerStore } from "../store/listenerStore";
import { MOCK_OUTPUT_ID, getMockMidiOutput } from "../lib/mock-output";
import type { MidiSendable } from "../lib/sendable";

// Story 4.2 — listener output hook (AD-3).
//
// Composes the shared `MidiAccessProvider` (the output LIST + permission
// status + refresh) with the listener store (the listener's CHOICE of output).
// The provider owns the port list (single source of truth for what's plugged
// in, re-snapshotted on hot-plug `onstatechange`); the store owns which output
// the listener picked. This hook is the focused API the listener UI consumes
// so components do not reach across concerns.
//
// Story 4.3 — also exposes `getOutput(id)` so the join pipeline can reach the
// raw `MIDIOutput` port to `send` scheduled bytes. The port lookup lives in the
// shared provider (it owns the `MIDIAccess` reference); the id comes from the
// listener store.
//
// Story 5.1 — `getOutput` now returns a `MidiSendable`: the real `MIDIOutput`
// for a port id, or the shared `MockMidiOutput` singleton when
// `id === MOCK_OUTPUT_ID`. The scheduler / test note are agnostic to which one
// (they only call `.send`), so the Mock is an interchangeable output. No new
// store field: the Mock is represented by the `MOCK_OUTPUT_ID` sentinel in the
// existing `selectedOutputId`, so `JoinButton` / `TestNoteButton` gating
// (`selectedOutputId !== null`) works unchanged for both Mock and real.

export interface UseMidiOutputsValue {
  /** Permission/access status from the shared provider. */
  readonly status: ReturnType<typeof useMidiInputs>["status"];
  /** Live list of real MIDI outputs (re-snapshotted on hot-plug, no polling). */
  readonly outputs: ReturnType<typeof useMidiInputs>["outputs"];
  /** The listener's chosen output id (null = none, "mock" = Mock) — owned by the store. */
  readonly selectedOutputId: string | null;
  /** Select an output by id (or null to clear). Use `MOCK_OUTPUT_ID` for the Mock. */
  readonly selectOutput: (id: string | null) => void;
  /** Re-snapshot outputs from the existing MIDIAccess (no new prompt). */
  readonly refreshOutputs: () => void;
  /**
   * Return the sendable output for the given id, or null:
   *   - `MOCK_OUTPUT_ID` → the shared `MockMidiOutput` (Story 5.1);
   *   - a real port id   → the raw `MIDIOutput` (via the shared provider).
   * The result is typed `MidiSendable` so the scheduler treats both identically.
   */
  readonly getOutput: (id: string) => MidiSendable | null;
}

export function useMidiOutputs(): UseMidiOutputsValue {
  const { status, outputs, refreshOutputs, getOutput: providerGetOutput } =
    useMidiInputs();
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);
  const setSelectedOutput = useListenerStore((s) => s.setSelectedOutput);

  const getOutput = useCallback(
    (id: string): MidiSendable | null => {
      if (id === MOCK_OUTPUT_ID) return getMockMidiOutput();
      return providerGetOutput(id);
    },
    [providerGetOutput],
  );

  return {
    status,
    outputs,
    selectedOutputId,
    selectOutput: setSelectedOutput,
    refreshOutputs,
    getOutput,
  };
}