// Frontend import point for the shared wire contract (AD-5: `entities/MidiEvent`
// is the single source of the contract for the web app). Re-exports `@fmlw/shared`.
//
// `ROOM` and `PROTOCOL_VERSION` are re-exported here so the performer capture
// layer (Story 3.3) builds payloads against the same pinned constants without
// reaching past the `entities` boundary into `@fmlw/shared` directly.
export type { MidiEvent } from "@fmlw/shared";
export { MidiEventSchema, toMidiBytes, ROOM, PROTOCOL_VERSION } from "@fmlw/shared";