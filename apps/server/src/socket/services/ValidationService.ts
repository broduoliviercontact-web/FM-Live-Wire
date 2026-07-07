// ValidationService — 3rd validation layer (AD-5, AD-9, FR-21).
//
// Layer 1 = handshake (`io.use`, Stories 2.1/2.2: role + OWNER_SECRET).
// Layer 2 = per-event gate + rate limit (`socket.use`, Stories 2.4/2.5).
// Layer 3 = THIS: strict `MidiEventSchema.safeParse` on the event payload,
// invoked by the `midi:event` handler (Story 2.7). It produces a stable ack
// shape — `{ ok:true, data }` or `{ ok:false, error, issues }` — with two
// stable error codes: `invalid` (anything malformed) and `unsupported-version`
// (`v !== 1`). The raw Zod `issues` are forwarded so the UI can be actionable.
//
// This module is a pure service (`services` element, `services -> [srv-shared]`):
// no I/O, no socket, no handler. It imports the shared schema from `@fmlw/shared`
// (single source of the wire format, AD-5 — zero schema drift front/back). `zod`
// is NOT a direct server dependency, so the `ZodIssue` type is DERIVED from the
// shared schema's `safeParse` return rather than imported from `zod/v3` (avoids a
// phantom dependency and keeps `@fmlw/shared` the only coupling).

import { MidiEventSchema, type MidiEvent, ERROR_CODES } from "@fmlw/shared";

/** Stable application error codes (AD-19 ack shape, E8/E13). */
export type ValidationErrorCode = "invalid" | typeof ERROR_CODES.UNSUPPORTED_VERSION;

/**
 * `ZodIssue[]` for the shared schema, derived from its `safeParse` error so this
 * module never imports `zod/v3` directly (zod is not a declared server dep).
 */
type MidiZodIssue = Extract<
  ReturnType<typeof MidiEventSchema.safeParse>,
  { success: false }
>["error"]["issues"][number];

/**
 * Result of validating an inbound `midi:event` payload. The handler (2.7) hands
 * this straight into the Socket.IO ack: `{ ok:true, data }` to relay, or
 * `{ ok:false, error, issues }` to refuse the event with a stable code.
 */
export type ValidationResult =
  | { ok: true; data: MidiEvent }
  | { ok: false; error: ValidationErrorCode; issues: MidiZodIssue[] };

/**
 * Validate a `midi:event` payload against the shared strict Zod schema. Pure +
 * deterministic: same input → same result, no side effects.
 *
 * Error-code mapping (simple + stable — does NOT depend on fragile Zod issue
 * codes): if ANY issue sits on the `v` field (`issue.path[0] === "v"`) the code
 * is `unsupported-version` (covers `v !== 1` and a missing `v`); every other
 * rejection (unknown field, out-of-range, `performerId` present, wrong `roomId`,
 * `type: "sysex"`, ...) is `invalid`. The raw `issues` are always forwarded.
 */
export function validateMidiEvent(input: unknown): ValidationResult {
  const parsed = MidiEventSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  const issues = parsed.error.issues;
  const error: ValidationErrorCode = issues.some((issue) => issue.path[0] === "v")
    ? ERROR_CODES.UNSUPPORTED_VERSION
    : "invalid";
  return { ok: false, error, issues };
}

/**
 * Thin injectable wrapper for the `midi:event` handler (Story 2.7). Stateless —
 * every call delegates to the pure `validateMidiEvent` function. Provided as a
 * class so handlers can depend on a `ValidationService` instance (testable with
 * a fake) rather than a module-level function.
 */
export class ValidationService {
  validate(input: unknown): ValidationResult {
    return validateMidiEvent(input);
  }
}