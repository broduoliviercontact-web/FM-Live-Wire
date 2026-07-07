// TS fixture (positive): performer -> entities is ALLOWED.
// Uses real TS: type-only import + spread of a typed value.
import { ent, type MidiNote } from "../../../entities/__fixtures__/ent";

export const feat: MidiNote = { ...ent, velocity: 110 };