// @fmlw/shared — MidiEventSchema (single source of the wire format, AD-5).
// Story 1.2: contract only. No business logic, no server validation mapping.
//
// Zod 3 API is used via the `zod/v3` compat entry (AD-5 note). `.strict()` rejects
// unknown keys (so `performerId` and any extra field fail). The discriminator
// `type` is limited to the 5 channel-voice messages — there is deliberately NO
// `sysex` variant (AD-8: SysEx is never accepted on the wire).
import { z } from "zod/v3";
import {
  PROTOCOL_VERSION,
  ROOM,
  CHANNEL_MIN,
  CHANNEL_MAX,
  DATA_MIN,
  DATA_MAX,
  PITCH_BEND_MIN,
  PITCH_BEND_MAX,
  SEQ_MIN,
  SEQ_MAX,
} from "./constants.js";

// --- Shared primitive schemas (reused across all event variants) ---

/** Wire channel is 0–15 (UI 1–16 converted at the edge). */
const channelSchema = z.number().int().min(CHANNEL_MIN).max(CHANNEL_MAX);

/** 7-bit data byte: note, velocity, controller, value, program. */
const data7Schema = z.number().int().min(DATA_MIN).max(DATA_MAX);

/** 14-bit pitch bend: 0–16383 (8192 = center). */
const pitchBendValueSchema = z.number().int().min(PITCH_BEND_MIN).max(PITCH_BEND_MAX);

/** Monotone uint32 sequence number (prepares future replay, AD-5). */
const seqSchema = z.number().int().min(SEQ_MIN).max(SEQ_MAX);

/** Performance timestamp (ms, float — `performance.now()`). */
const tsSchema = z.number();

/** Common fields present on every event variant (AD-5). */
const commonFields = {
  /** Protocol version, pinned (AD-9). A non-1 value fails on the `v` field. */
  v: z.literal(PROTOCOL_VERSION),
  /** Forced to the single broadcast room (AD-4). */
  roomId: z.literal(ROOM),
  /** Wire channel 0–15. */
  channel: channelSchema,
  /** Monotone uint32. */
  seq: seqSchema,
  /** Timestamp (ms). */
  ts: tsSchema,
} as const;

// --- Event variants (strict: unknown keys rejected) ---

const noteOnSchema = z
  .object({
    ...commonFields,
    type: z.literal("noteOn"),
    note: data7Schema,
    velocity: data7Schema,
  })
  .strict();

const noteOffSchema = z
  .object({
    ...commonFields,
    type: z.literal("noteOff"),
    note: data7Schema,
    velocity: data7Schema,
  })
  .strict();

const controlChangeSchema = z
  .object({
    ...commonFields,
    type: z.literal("controlChange"),
    controller: data7Schema,
    value: data7Schema,
  })
  .strict();

const programChangeSchema = z
  .object({
    ...commonFields,
    type: z.literal("programChange"),
    program: data7Schema,
  })
  .strict();

const pitchBendSchema = z
  .object({
    ...commonFields,
    type: z.literal("pitchBend"),
    pitchBend: pitchBendValueSchema,
  })
  .strict();

/**
 * Strict wire contract for a MIDI event. Discriminated by `type` over the 5
 * channel-voice messages only (no `sysex`). Each variant is `.strict()`, so any
 * unknown field — notably `performerId` (AD-5: forbidden; the server attaches
 * `socket.id`) — is rejected.
 */
export const MidiEventSchema = z.discriminatedUnion("type", [
  noteOnSchema,
  noteOffSchema,
  controlChangeSchema,
  programChangeSchema,
  pitchBendSchema,
]);

/** Inferred TypeScript type for a validated MIDI event. */
export type MidiEvent = z.infer<typeof MidiEventSchema>;