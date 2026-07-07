import { useEffect, useRef } from "react";
import { useMidiInputs } from "../../../lib/midi-access";
import { decodeMidiEvent } from "../lib/decode";
import { createSeqCounter, type SeqCounter } from "../lib/seq";
import type { MidiEvent } from "../../../entities/MidiEvent";

// Story 3.3 — capture hook (AD-3, AD-5, AD-8).
//
// Binds `onmidimessage` on the selected MIDI input, decodes each message into a
// `MidiEvent` (5 allowed types only) and forwards it via `onEvent`. NO network
// emit happens here — the relay is Story 3.4. SysEx and out-of-scope types are
// silently dropped by the decoder (null) and do NOT consume a sequence number.
//
// The handler is (re)bound whenever the selected input changes, and is cleared
// (`onmidimessage = null`) on cleanup — both when the selection changes and on
// unmount — so no handler outlives the binding that installed it.

export interface UseMidiInputOptions {
  /** Called for each decoded `MidiEvent` (the 5 allowed types only). */
  readonly onEvent: (event: MidiEvent) => void;
}

/**
 * Capture MIDI from the selected input. Call inside a `MidiAccessProvider`.
 * Does nothing while no input is selected.
 */
export function useMidiInput({ onEvent }: UseMidiInputOptions): void {
  const { getSelectedInput } = useMidiInputs();

  // One monotone uint32 counter per performer, created once and kept for the
  // hook's lifetime (seq must be monotone across the whole session).
  const seqRef = useRef<SeqCounter | null>(null);
  if (seqRef.current === null) {
    seqRef.current = createSeqCounter();
  }

  // Keep the latest callback without re-binding the handler on every render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const input = getSelectedInput();
    if (input === null) return; // nothing selected (yet) — no handler installed

    const seq = seqRef.current as SeqCounter;

    const handler = (ev: MIDIMessageEvent): void => {
      // Peek the next sequence number; only commit (advance) if the message is
      // actually decoded into an event, so filtered messages leave no gap.
      const midi = decodeMidiEvent({
        data: ev.data,
        ts: ev.timeStamp,
        seq: seq.current(),
      });
      if (midi !== null) {
        seq.advance();
        onEventRef.current(midi);
      }
    };

    input.onmidimessage = handler;
    return () => {
      // Clear only the handler we installed (don't clobber a newer binding).
      if (input.onmidimessage === handler) {
        input.onmidimessage = null;
      }
    };
  }, [getSelectedInput]);
}