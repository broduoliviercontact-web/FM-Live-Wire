// @fmlw/shared — shared wire contract (Zod MidiEventSchema, types, constants).
// Single source of the wire format, imported front and back via "workspace:*" (AD-5).

export * from "./constants.js";
export { MidiEventSchema } from "./midi-event.js";
export type { MidiEvent } from "./midi-event.js";
export { toMidiBytes } from "./encode.js";