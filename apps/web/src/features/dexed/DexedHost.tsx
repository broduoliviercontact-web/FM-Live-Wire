// Dexed/WAM spike — audio host (isolated in features/dexed/).
//
// Rendered by `DexedLabPage` AFTER the user clicked « Start Audio » (so the
// AudioContext is created inside a user gesture, per autoplay policy). Owns:
//   - a small polyphonic fallback synth (oscillator + gain envelope + lowpass
//     filter) so note on/off is AUDIBLE without any Dexed WAM loaded (no WASM
//     asset is vendored in this repo — see NOTICE.md + docs/spikes/dexed-wam.md
//     for the GPL-3.0 situation);
//   - a selectable Web MIDI input (MidiInputSelector) driving the same synth;
//   - a MIDI monitor (MidiMonitor) showing the last note events;
//   - a one-octave virtual keyboard (pointer + computer keyboard) with octave
//     shift, note names and a Panic / All Notes Off button;
//   - an "FM Lab controls — fallback only" panel (FmLabPanel) shaping the
//     fallback synth (waveform / attack / release / filter cutoff / gain).
//
// The fallback synth is a STAND-IN for the Dexed WAM AudioWorklet node. The
// insertion point for the real WAM is marked below (`dexedWamInsertionPoint`).
// The controls panel is deliberately NOT called "Dexed" — it is fallback only.

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/alert";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { InfoIcon } from "../../shared/ui/icons";
import { FmLabInterface } from "./FmLabInterface";
import { type SynthParams } from "./FmLabPanel";
import { DEFAULT_PATCH, type FmPatch } from "./fmPatch";
import { MidiInputSelector } from "./MidiInputSelector";
import { MidiMonitor, type MonitorEntry } from "./MidiMonitor";
import { noteName } from "./notes";
import { useWebMidiInput, type MidiNoteEvent } from "./useWebMidiInput";

interface DexedHostProps {
  audioContext: AudioContext;
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// One octave of semitone offsets from the base note (C..C). White keys first,
// then the black-key overlay is derived from the gaps between white keys.
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];

// Computer-keyboard mapping (QWERTY row -> semitone offset from the base note).
const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};

const DEFAULT_PARAMS: SynthParams = {
  waveform: "sawtooth",
  attack: 0.01,
  release: 0.12,
  cutoff: 8000,
  gain: 0.2,
};

export function DexedHost({ audioContext }: DexedHostProps) {
  const midi = useWebMidiInput();
  const [params, setParams] = useState<SynthParams>(DEFAULT_PARAMS);
  const [octave, setOctave] = useState(4);
  const [monitor, setMonitor] = useState<MonitorEntry[]>([]);
  const [panicNonce, setPanicNonce] = useState(0);
  // FM patch model (lot 3) — UI/model-only this lot; not wired to the audio
  // graph. The fallback synth (SynthParams above) still produces the sound.
  const [fmPatch, setFmPatch] = useState<FmPatch>(DEFAULT_PATCH);
  const [selectedOp, setSelectedOp] = useState(0);

  const masterRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const heldComputerRef = useRef<Set<number>>(new Set());
  const paramsRef = useRef<SynthParams>(params);
  const monitorIdRef = useRef(0);

  // --- Audio graph (created once for this context). --------------------------
  // Chain: osc -> voiceGain (envelope) -> filter (shared lowpass) -> master
  // (output gain) -> destination. The filter + master are shared; each note
  // gets its own osc + voiceGain.
  if (masterRef.current === null) {
    const master = audioContext.createGain();
    master.gain.value = params.gain;
    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = params.cutoff;
    filter.connect(master);
    master.connect(audioContext.destination);
    masterRef.current = master;
    filterRef.current = filter;
  }
  const master = masterRef.current;
  const filter = filterRef.current ?? master;

  // Mirror params into a ref so the stable noteOn/noteOff read fresh values
  // without being rebuilt (and without re-binding the MIDI handler) on every
  // slider tweak.
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Push live panel changes to the shared audio nodes.
  useEffect(() => {
    const f = filterRef.current;
    if (f) f.frequency.value = params.cutoff;
  }, [params.cutoff]);
  useEffect(() => {
    const m = masterRef.current;
    if (m) m.gain.value = params.gain;
  }, [params.gain]);

  // --- Fallback synth (STAND-IN for the Dexed WAM). --------------------------
  // dexedWamInsertionPoint: a real Dexed WAM AudioWorklet node would replace
  // this oscillator+gain+filter voice with the msfa engine (see
  // docs/spikes/dexed-wam.md). The FmLabPanel controls shape THIS fallback
  // only — they are not Dexed parameters.
  const noteOn = useCallback(
    (note: number, velocity: number) => {
      if (voicesRef.current.has(note)) return; // retrigger guard (monophonic-per-note)
      const p = paramsRef.current;
      const ctx = audioContext;
      const osc = ctx.createOscillator();
      osc.type = p.waveform;
      osc.frequency.value = midiToFreq(note);
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const peak = Math.min(0.3, 0.2 * (velocity / 127) + 0.05);
      const atk = Math.max(0.001, p.attack);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + atk); // attack
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      voicesRef.current.set(note, { osc, gain });
    },
    [audioContext, filter],
  );

  const noteOff = useCallback(
    (note: number) => {
      const v = voicesRef.current.get(note);
      if (!v) return;
      const p = paramsRef.current;
      const now = audioContext.currentTime;
      const cur = v.gain.gain.value;
      const rel = Math.max(0.02, p.release);
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, cur), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + rel); // release
      v.osc.stop(now + rel + 0.05);
      voicesRef.current.delete(note);
    },
    [audioContext],
  );

  // Panic / all notes off — releases every sounding voice and clears the
  // computer-keyboard held set, then bumps `panicNonce` so the virtual
  // keyboard clears its own held set. Used by the Panic button AND by every
  // octave change (so a shift never leaves a stuck note behind).
  const allNotesOff = useCallback(() => {
    const notes = [...voicesRef.current.keys()];
    notes.forEach((n) => noteOff(n));
    heldComputerRef.current.clear();
    setPanicNonce((n) => n + 1);
  }, [noteOff]);

  const shiftOctave = useCallback(
    (delta: number) => {
      allNotesOff();
      setOctave((o) => Math.min(8, Math.max(0, o + delta)));
    },
    [allNotesOff],
  );

  // MIDI input -> synth + monitor.
  useEffect(() => {
    midi.setNoteHandler((e: MidiNoteEvent) => {
      if (e.kind === "noteOn") noteOn(e.note, e.velocity);
      else noteOff(e.note);
      setMonitor((prev) => {
        const id = monitorIdRef.current++;
        const entry: MonitorEntry = {
          id,
          kind: e.kind,
          note: e.note,
          velocity: e.velocity,
          channel: e.channel,
          source: e.source,
        };
        return [entry, ...prev].slice(0, 10);
      });
    });
    return () => midi.setNoteHandler(null);
  }, [midi, noteOn, noteOff]);

  // Computer keyboard -> synth (window listeners; ignores auto-repeat).
  // `baseNote` shifts with the octave control so a/w/s/.../k always span one
  // octave starting at the current base.
  const baseNote = (octave + 1) * 12; // octave 4 -> MIDI 60 (C4)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const offset = KEYMAP[e.key];
      if (offset === undefined) return;
      const note = baseNote + offset;
      if (heldComputerRef.current.has(note)) return;
      heldComputerRef.current.add(note);
      noteOn(note, 100);
    };
    const up = (e: KeyboardEvent) => {
      const offset = KEYMAP[e.key];
      if (offset === undefined) return;
      const note = baseNote + offset;
      if (!heldComputerRef.current.delete(note)) return;
      noteOff(note);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [baseNote, noteOn, noteOff]);

  // Tear down all voices on unmount.
  useEffect(() => {
    return () => {
      voicesRef.current.forEach((v) => {
        try {
          v.osc.stop();
        } catch {
          /* already stopped */
        }
      });
      voicesRef.current.clear();
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <InfoIcon className="size-5" />
        <AlertTitle>Dexed WAM non chargé</AlertTitle>
        <AlertDescription>
          Aucun asset WASM Dexed n'est vendu dans ce dépôt (licence GPL-3.0 à
          vérifier — voir NOTICE.md). Synthèse de fallback (oscillateur + filtre)
          pour tester le note on/off et les contrôles FM Lab. Le point
          d'insertion du vrai WAM est marqué dans <code>DexedHost.tsx</code>.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Clavier MIDI</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                void midi.request();
              }}
              disabled={
                midi.status === "requesting" || midi.status === "connected"
              }
            >
              {midi.status === "connected"
                ? "MIDI connecté"
                : "Connecter un clavier MIDI"}
            </Button>
            <Badge
              variant={midi.status === "connected" ? "connected" : "secondary"}
            >
              {midi.status}
            </Badge>
            {midi.inputs.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                {midi.inputs.length} entrée(s)
              </span>
            ) : null}
          </div>
          <MidiInputSelector
            inputs={midi.inputs}
            selectedInputId={midi.selectedInputId}
            onSelect={midi.setSelectedInputId}
            disabled={midi.status !== "connected"}
          />
          {midi.errorMessage !== null ? (
            <p className="text-sm text-danger">{midi.errorMessage}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Branchez un contrôleur MIDI USB puis cliquez. « Tous les inputs »
            laisse tout déclencher le synthé ; un input précis le restreint. Le
            choix est mémorisé.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MIDI monitor</CardTitle>
        </CardHeader>
        <CardContent>
          <MidiMonitor
            messages={monitor}
            onClear={() => setMonitor([])}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clavier virtuel</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => shiftOctave(-1)}
              disabled={octave <= 0}
            >
              Octave −
            </Button>
            <Badge variant="secondary">Octave {octave}</Badge>
            <Button
              type="button"
              variant="outline"
              onClick={() => shiftOctave(1)}
              disabled={octave >= 8}
            >
              Octave +
            </Button>
            <Button type="button" variant="outline" onClick={allNotesOff}>
              Panic / All Notes Off
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Cliquez les touches, ou utilisez le clavier de l'ordinateur
            (a w s e d f t g y h u j k). Changer d'octave relâche toutes les
            notes actives.
          </p>
          <Keyboard
            noteOn={noteOn}
            noteOff={noteOff}
            baseNote={baseNote}
            panicNonce={panicNonce}
          />
        </CardContent>
      </Card>

      <FmLabInterface
        patch={fmPatch}
        onPatchChange={setFmPatch}
        selectedOp={selectedOp}
        onSelectOp={setSelectedOp}
        fallbackParams={params}
        onFallbackChange={(patch) => setParams((prev) => ({ ...prev, ...patch }))}
      />
    </div>
  );
}

interface KeyboardProps {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
  baseNote: number;
  panicNonce: number;
}

function Keyboard({ noteOn, noteOff, baseNote, panicNonce }: KeyboardProps) {
  // Track pointer-held notes to avoid stuck notes on drag-out.
  const heldRef = useRef<Set<number>>(new Set());

  // Panic / octave change: clear the held set so a later pointer-up does not
  // fire a redundant noteOff for a note the synth has already released.
  useEffect(() => {
    heldRef.current.clear();
  }, [panicNonce]);

  const press = useCallback(
    (note: number) => {
      if (heldRef.current.has(note)) return;
      heldRef.current.add(note);
      noteOn(note, 100);
    },
    [noteOn],
  );
  const release = useCallback(
    (note: number) => {
      if (!heldRef.current.delete(note)) return;
      noteOff(note);
    },
    [noteOff],
  );

  const whiteNotes = WHITE_OFFSETS.map((o) => baseNote + o);

  return (
    <div
      className="relative flex select-none"
      data-testid="dexed-virtual-keyboard"
    >
      <div className="flex">
        {whiteNotes.map((note) => (
          <button
            key={note}
            type="button"
            data-testid={`dexed-key-${note}`}
            className="h-32 w-10 border border-input bg-background text-xs text-muted-foreground"
            onPointerDown={(e) => {
              e.preventDefault();
              press(note);
            }}
            onPointerUp={() => release(note)}
            onPointerLeave={() => release(note)}
            onPointerCancel={() => release(note)}
          >
            {noteName(note)}
          </button>
        ))}
      </div>
      {/* Black keys overlaid between white keys where a semitone gap exists. */}
      <div className="pointer-events-none absolute inset-0 flex">
        {whiteNotes.slice(0, -1).map((note, i) => {
          const next = whiteNotes[i + 1];
          if (next === undefined) return <div key={note} className="w-10" />;
          // A black key sits between two whites only when they are a whole
          // tone apart (gap === 2); then it is one semitone above `note`.
          if (next - note !== 2) return <div key={note} className="w-10" />;
          const blackNote = note + 1;
          return (
            <div key={note} className="relative w-10">
              <button
                type="button"
                data-testid={`dexed-key-${blackNote}`}
                className="pointer-events-auto absolute -right-2 h-20 w-6 border border-input bg-zinc-900 text-[10px] text-zinc-300"
                onPointerDown={(e) => {
                  e.preventDefault();
                  press(blackNote);
                }}
                onPointerUp={() => release(blackNote)}
                onPointerLeave={() => release(blackNote)}
                onPointerCancel={() => release(blackNote)}
              >
                {noteName(blackNote)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}