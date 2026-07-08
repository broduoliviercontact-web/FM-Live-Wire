// Dexed/WAM spike — REAL 2-operator FM engine (isolated in features/dexed/).
//
// A minimal, hand-written 6-op-FM-inspired engine limited to 2 operators for
// this preview lot:
//   - OP1 (operators[0]) = CARRIER  (sine) -> amplitude envelope -> master
//   - OP2 (operators[1]) = MODULATOR (sine) -> modulation-index gain -> carrier.frequency
//
// This is NOT the real Dexed/WAM — no WASM asset is used. It is our own FM
// engine so the FM Lab patch model can finally drive real sound (for OP1/OP2
// only). OP3-OP6 remain UI/model-only (see FmLabInterface note).
//
// Audio graph per voice:
//   modulator(sine) -> modGain (modulation index in Hz) -> carrier.frequency
//   carrier(sine)   -> carrierGain (amplitude envelope) -> master -> limiter -> destination
//
// The FmEnvelope (4 rates / 4 levels) is simplified to an ADSR shape this lot:
//   attack  = f(rate1)   (0 -> level1)
//   decay   = f(rate2)   (level1 -> level3 sustain)
//   sustain = level3
//   release = f(rate4)   (current -> level4)
// level2 is intentionally unused this lot (simplification, per lot 4A spec).

import type { FmOperator, FmPatch } from "./fmPatch";

export type EngineMode = "fallback" | "fm2op";

interface FmVoice {
  readonly carrier: OscillatorNode;
  readonly modulator: OscillatorNode;
  /** Modulation index (Hz) -> carrier.frequency. */
  readonly modGain: GainNode;
  /** Amplitude envelope -> master. */
  readonly carrierGain: GainNode;
  readonly note: number;
  /** Peak amplitude used for the carrier envelope (velocity-scaled). */
  readonly carrierPeak: number;
  /** Peak modulation index used for the modulator envelope (velocity-scaled). */
  readonly modPeak: number;
}

// Safety clamps — keep the output gentle and avoid pathological modulation.
const MAX_MOD_INDEX_HZ = 4000; // max modulation index in Hz
const MAX_MASTER_GAIN = 0.5; // master output cap (a real limiter sits after it)
const CARRIER_AMP = 0.35; // carrierGain peak scale (outputLevel=1, vel=127 -> 0.35)
// Polyphony cap. When exceeded, the oldest still-held voice is stolen (its
// release is triggered, freeing a slot for the new note). Map preserves
// insertion order, so the first key is the oldest voice.
const MAX_VOICES = 12;

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// rate in 0..1 : 1 = instant, 0 = slow. Map to a segment duration in seconds.
function attackTime(rate: number): number {
  return Math.min(2.5, Math.max(0.005, (1 - rate) * 2.5));
}
function decayTime(rate: number): number {
  return Math.min(2.5, Math.max(0.005, (1 - rate) * 2.5));
}
function releaseTime(rate: number): number {
  return Math.min(3, Math.max(0.02, (1 - rate) * 3));
}

// Velocity scales an operator's level. velSens=0 -> no velocity effect;
// velSens=1 -> full velocity scaling (vel 0 -> 0).
function velScale(velSensitivity: number, velocity: number): number {
  const v = velocity / 127;
  return 1 - velSensitivity + velSensitivity * v;
}

export class Fm2OpEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly voices = new Map<number, FmVoice>();
  private patch: FmPatch;

  constructor(ctx: AudioContext, patch: FmPatch) {
    this.ctx = ctx;
    this.patch = patch;
    this.master = ctx.createGain();
    this.master.gain.value = this.clampedMaster(patch.outputGain);
    // Safety limiter so a wild modulation index never clips the output hard.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -18;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
  }

  /** Replace the current patch. Live-updates master gain + held-voice frequencies. */
  updatePatch(patch: FmPatch): void {
    this.patch = patch;
    this.master.gain.setTargetAtTime(
      this.clampedMaster(patch.outputGain),
      this.ctx.currentTime,
      0.02,
    );
    // Live-update frequencies (ratio/fixedHz/detune/transpose) for held voices so
    // slider tweaks are audible without re-triggering. outputLevel/envelope/
    // velocity apply on the next noteOn (re-scheduling mid-envelope is risky).
    const carrierOp = patch.operators[0];
    const modOp = patch.operators[1];
    const now = this.ctx.currentTime;
    this.voices.forEach((voice) => {
      if (carrierOp) {
        voice.carrier.frequency.setTargetAtTime(
          this.opFrequency(carrierOp, voice.note),
          now,
          0.02,
        );
        voice.carrier.detune.setTargetAtTime(carrierOp.detune, now, 0.02);
      }
      if (modOp) {
        voice.modulator.frequency.setTargetAtTime(
          this.opFrequency(modOp, voice.note),
          now,
          0.02,
        );
        voice.modulator.detune.setTargetAtTime(modOp.detune, now, 0.02);
      }
    });
  }

  noteOn(note: number, velocity: number): void {
    if (this.voices.has(note)) return; // monophonic-per-note retrigger guard
    // Polyphony cap: steal the oldest held voice (proper release) before
    // adding a new one, so the engine never accumulates unbounded voices.
    if (this.voices.size >= MAX_VOICES) {
      const oldest = this.voices.keys().next().value;
      if (oldest !== undefined) this.noteOff(oldest);
    }
    const patch = this.patch;
    const carrierOp = patch.operators[0];
    if (carrierOp === undefined) return;
    // Honor `enabled`: a disabled carrier = silence; a disabled modulator = no
    // modulation (pure sine carrier).
    if (!carrierOp.enabled) return;
    const modOp = patch.operators[1];
    const modEnabled = modOp !== undefined && modOp.enabled;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = this.opFrequency(carrierOp, note);
    carrier.detune.value = carrierOp.detune;

    const modulator = ctx.createOscillator();
    modulator.type = "sine";
    modulator.frequency.value = modOp !== undefined ? this.opFrequency(modOp, note) : 1;
    if (modOp !== undefined) modulator.detune.value = modOp.detune;

    const modGain = ctx.createGain();
    const modPeak = modEnabled
      ? modOp.outputLevel *
        velScale(modOp.velocitySensitivity, velocity) *
        MAX_MOD_INDEX_HZ
      : 0;
    modGain.gain.value = 0;

    const carrierGain = ctx.createGain();
    const carrierPeak =
      carrierOp.outputLevel *
      velScale(carrierOp.velocitySensitivity, velocity) *
      CARRIER_AMP;
    carrierGain.gain.value = 0.0001;

    // Graph: modulator -> modGain -> carrier.frequency ; carrier -> carrierGain -> master
    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(carrierGain);
    carrierGain.connect(this.master);
    carrier.start(now);
    modulator.start(now);

    // Envelopes (simplified ADSR from the 4-rate/4-level model).
    this.applyAttackEnvelope(carrierGain.gain, carrierOp.envelope, carrierPeak, now);
    if (modEnabled) {
      this.applyAttackEnvelope(modGain.gain, modOp.envelope, modPeak, now);
    }

    this.voices.set(note, {
      carrier,
      modulator,
      modGain,
      carrierGain,
      note,
      carrierPeak,
      modPeak,
    });
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (voice === undefined) return;
    const patch = this.patch;
    const carrierOp = patch.operators[0];
    const modOp = patch.operators[1];
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const rel =
      carrierOp !== undefined ? releaseTime(carrierOp.envelope.rate4) : 0.12;
    const stopAt = now + rel + 0.05;

    // Carrier release -> level4 (usually 0).
    if (carrierOp !== undefined) {
      const target = Math.max(0.0001, voice.carrierPeak * carrierOp.envelope.level4);
      this.rampTo(voice.carrierGain.gain, target, now, rel);
    } else {
      this.rampTo(voice.carrierGain.gain, 0.0001, now, rel);
    }
    // Modulator release -> level4.
    if (modOp !== undefined) {
      const target = Math.max(0, voice.modPeak * modOp.envelope.level4);
      this.rampTo(voice.modGain.gain, target, now, rel);
    } else {
      this.rampTo(voice.modGain.gain, 0, now, rel);
    }

    voice.carrier.stop(stopAt);
    voice.modulator.stop(stopAt);
    this.voices.delete(note);
  }

  allNotesOff(): void {
    for (const note of [...this.voices.keys()]) this.noteOff(note);
  }

  dispose(): void {
    // Hard-stop everything immediately (do not wait for release ramps).
    this.voices.forEach((v) => {
      try {
        v.carrier.stop();
      } catch {
        /* already stopped */
      }
      try {
        v.modulator.stop();
      } catch {
        /* already stopped */
      }
    });
    this.voices.clear();
    try {
      this.master.disconnect();
      this.limiter.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  // --- internals ------------------------------------------------------------

  private opFrequency(op: FmOperator, note: number): number {
    if (op.mode === "fixed") return op.fixedHz;
    return midiToFreq(note + this.patch.transpose) * op.ratio;
  }

  private clampedMaster(outputGain: number): number {
    return Math.min(MAX_MASTER_GAIN, Math.max(0, outputGain));
  }

  /** Schedule the attack+decay+sustain portion of an envelope on a param. */
  private applyAttackEnvelope(
    param: AudioParam,
    env: FmPatch["operators"][number]["envelope"],
    peak: number,
    now: number,
  ): void {
    const atk = attackTime(env.rate1);
    const dec = decayTime(env.rate2);
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(Math.max(0.0001, peak * env.level1), now + atk);
    param.linearRampToValueAtTime(
      Math.max(0.0001, peak * env.level3),
      now + atk + dec,
    );
  }

  /** Smoothly ramp a param from its current value to `target` over `dur`. */
  private rampTo(
    param: AudioParam,
    target: number,
    now: number,
    dur: number,
  ): void {
    param.cancelScheduledValues(now);
    const cur = Math.max(0.0001, param.value);
    param.setValueAtTime(cur, now);
    param.linearRampToValueAtTime(target, now + dur);
  }
}