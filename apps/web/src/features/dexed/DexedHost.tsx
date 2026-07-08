// Dexed/WAM spike — audio host (isolated in features/dexed/).
//
// Rendered by `DexedLabPage` AFTER the user clicked « Start Audio » (so the
// AudioContext is created inside a user gesture, per autoplay policy). Owns:
//   - a small polyphonic fallback synth (oscillator + gain envelope) so note
//     on/off is AUDIBLE without any Dexed WAM loaded (no WASM asset is vendored
//     in this repo — see NOTICE.md + docs/spikes/dexed-wam.md for the GPL-3.0
//     situation);
//   - a one-octave virtual keyboard (pointer + computer keyboard) firing note
//     on/off;
//   - Web MIDI input wiring (a real controller drives the same synth).
//
// The fallback synth is a STAND-IN for the Dexed WAM AudioWorklet node. The
// insertion point for the real WAM is marked below (`dexedWamInsertionPoint`).

import { useCallback, useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/alert";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { InfoIcon } from "../../shared/ui/icons";
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

// One octave C4..C5 (MIDI 60..72). Sharps: 61, 63, 66, 68, 70.
const WHITE_KEYS = [60, 62, 64, 65, 67, 69, 71, 72];
const BLACK_KEYS: Record<number, number> = { 61: 1, 63: 2, 66: 3, 68: 4, 70: 5 };

// Computer-keyboard mapping (QWERTY row → one octave).
const KEYMAP: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};

export function DexedHost({ audioContext }: DexedHostProps) {
  const midi = useWebMidiInput();
  const masterRef = useRef<GainNode | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const heldComputerRef = useRef<Set<number>>(new Set());

  // Master gain (created once for this context).
  if (masterRef.current === null) {
    const g = audioContext.createGain();
    g.gain.value = 0.2;
    g.connect(audioContext.destination);
    masterRef.current = g;
  }
  const master = masterRef.current;

  // --- Fallback synth (STAND-IN for the Dexed WAM). ---------------------------
  // dexedWamInsertionPoint: a real Dexed WAM AudioWorklet node would replace
  // this oscillator+gain voice with the msfa engine (see docs/spikes/dexed-wam.md).
  const noteOn = useCallback(
    (note: number, velocity: number) => {
      if (voicesRef.current.has(note)) return; // retrigger guard (monophonic-per-note)
      const ctx = audioContext;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiToFreq(note);
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const peak = Math.min(0.3, 0.2 * (velocity / 127) + 0.05);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.01); // attack
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      voicesRef.current.set(note, { osc, gain });
    },
    [audioContext, master],
  );

  const noteOff = useCallback(
    (note: number) => {
      const v = voicesRef.current.get(note);
      if (!v) return;
      const now = audioContext.currentTime;
      const cur = v.gain.gain.value;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, cur), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12); // release
      v.osc.stop(now + 0.15);
      voicesRef.current.delete(note);
    },
    [audioContext],
  );

  // MIDI input → synth.
  useEffect(() => {
    midi.setNoteHandler((e: MidiNoteEvent) => {
      if (e.kind === "noteOn") noteOn(e.note, e.velocity);
      else noteOff(e.note);
    });
    return () => midi.setNoteHandler(null);
  }, [midi, noteOn, noteOff]);

  // Computer keyboard → synth (window listeners; ignores auto-repeat).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const note = KEYMAP[e.key];
      if (note === undefined) return;
      if (heldComputerRef.current.has(note)) return;
      heldComputerRef.current.add(note);
      noteOn(note, 100);
    };
    const up = (e: KeyboardEvent) => {
      const note = KEYMAP[e.key];
      if (note === undefined) return;
      if (!heldComputerRef.current.delete(note)) return;
      noteOff(note);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [noteOn, noteOff]);

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
          vérifier — voir NOTICE.md). Synthèse de fallback (oscillateur) pour
          tester le note on/off. Le point d'insertion du vrai WAM est marqué dans{" "}
          <code>DexedHost.tsx</code>.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Clavier MIDI</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                void midi.request();
              }}
              disabled={midi.status === "requesting" || midi.status === "connected"}
            >
              {midi.status === "connected" ? "MIDI connecté" : "Connecter un clavier MIDI"}
            </Button>
            <Badge variant={midi.status === "connected" ? "connected" : "secondary"}>
              {midi.status}
            </Badge>
            {midi.inputCount > 0 ? (
              <span className="text-sm text-muted-foreground">
                {midi.inputCount} entrée(s)
              </span>
            ) : null}
          </div>
          {midi.errorMessage !== null ? (
            <p className="text-sm text-danger">{midi.errorMessage}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Branchez un contrôleur MIDI USB puis cliquez. Les notes reçues
            déclenchent le synthé de fallback.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clavier virtuel</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Cliquez les touches, ou utilisez le clavier de l'ordinateur (a w s e
            d f t g y h u j k).
          </p>
          <Keyboard noteOn={noteOn} noteOff={noteOff} />
        </CardContent>
      </Card>
    </div>
  );
}

interface KeyboardProps {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
}

function Keyboard({ noteOn, noteOff }: KeyboardProps) {
  // Track pointer-held notes to avoid stuck notes on drag-out.
  const heldRef = useRef<Set<number>>(new Set());

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

  return (
    <div
      className="relative flex select-none"
      data-testid="dexed-virtual-keyboard"
    >
      <div className="flex">
        {WHITE_KEYS.map((note) => (
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
            {note}
          </button>
        ))}
      </div>
      {/* Black keys overlaid (simple spike layout, not pixel-accurate). */}
      <div className="pointer-events-none absolute inset-0 flex">
        {WHITE_KEYS.slice(0, -1).map((note) => {
          const sharpOffset = BLACK_KEYS[note + 1];
          if (sharpOffset === undefined) {
            return <div key={note} className="w-10" />;
          }
          return (
            <div key={note} className="relative w-10">
              <button
                type="button"
                data-testid={`dexed-key-${note + 1}`}
                className="pointer-events-auto absolute -right-2 h-20 w-6 border border-input bg-zinc-900 text-[10px] text-zinc-300"
                onPointerDown={(e) => {
                  e.preventDefault();
                  press(note + 1);
                }}
                onPointerUp={() => release(note + 1)}
                onPointerLeave={() => release(note + 1)}
                onPointerCancel={() => release(note + 1)}
              >
                {note + 1}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}