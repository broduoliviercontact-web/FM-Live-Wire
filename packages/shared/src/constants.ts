// @fmlw/shared — wire protocol constants.
// Story 1.2: contract constants only. No business logic.

/**
 * Wire protocol version. Pinned to 1 (AD-9). The MidiEventSchema enforces this
 * via `z.literal(PROTOCOL_VERSION)`; any other value fails safeParse on the `v`
 * field. The stable application code `unsupported-version` is mapped later
 * (Story 2.6, ValidationService) — here we only expose the constant.
 */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Socket.IO room used for the one-way MIDI broadcast (AD-4). The MidiEventSchema
 * forces `roomId` to be exactly this value via `z.literal(ROOM)`.
 */
export const ROOM = "fm-live-wire:main" as const;

// --- MIDI Control Change panic controllers (AD-7 / panic button) ---
/** CC 64 — Sustain. Used in the panic sequence (held, then released). */
export const CC_SUSTAIN = 64 as const;
/** CC 120 — All Sound Off. */
export const CC_ALL_SOUND_OFF = 120 as const;
/** CC 121 — Reset All Controllers. */
export const CC_RESET_ALL_CONTROLLERS = 121 as const;
/** CC 123 — All Notes Off. */
export const CC_ALL_NOTES_OFF = 123 as const;

// --- MIDI status bytes (high nibble; channel 0–15 is ORed in at encode time) ---
export const STATUS_NOTE_OFF = 0x80 as const;
export const STATUS_NOTE_ON = 0x90 as const;
export const STATUS_CONTROL_CHANGE = 0xb0 as const;
export const STATUS_PROGRAM_CHANGE = 0xc0 as const;
export const STATUS_PITCH_BEND = 0xe0 as const;

// --- Wire value limits (enforced by MidiEventSchema) ---
/** MIDI channel on the wire is 0–15 (UI shows 1–16; conversion −1 at the edge). */
export const CHANNEL_MIN = 0 as const;
export const CHANNEL_MAX = 15 as const;
/** 7-bit data bytes (note, velocity, controller, value, program). */
export const DATA_MIN = 0 as const;
export const DATA_MAX = 127 as const;
/** 14-bit pitch bend: 0–16383, center 8192. */
export const PITCH_BEND_MIN = 0 as const;
export const PITCH_BEND_MAX = 16383 as const;
export const PITCH_BEND_CENTER = 8192 as const;
/** `seq` is a monotone uint32 (AD-5; prepares future replay). */
export const SEQ_MIN = 0 as const;
export const SEQ_MAX = 4294967295 as const;

/**
 * Stable application error codes (AD-19 ack shape). Exposed as constants only —
 * Story 1.2 does NOT map ZodIssue → code. The ValidationService (Story 2.6) will
 * map a `v !== 1` failure to `UNSUPPORTED_VERSION`.
 */
export const ERROR_CODES = {
  /** Protocol version mismatch (`v !== 1`). */
  UNSUPPORTED_VERSION: "unsupported-version",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];