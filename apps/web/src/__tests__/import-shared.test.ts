// Importability proof (frontend side): `@fmlw/shared` resolves via `workspace:*`
// to the built dist (Story 1.2 AC). Front+back both import the same contract.
import { describe, it, expect } from "vitest";
import { MidiEventSchema, ROOM, type MidiEvent } from "@fmlw/shared";

describe("@fmlw/shared importable from @fmlw/web (workspace:*)", () => {
  it("resolves the package, schema and types", () => {
    const r = MidiEventSchema.safeParse({
      v: 1,
      type: "noteOn",
      channel: 0,
      roomId: ROOM,
      seq: 1,
      ts: 123.4,
      note: 60,
      velocity: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const _typed: MidiEvent = r.data; // type resolves through the workspace
      void _typed;
      expect(r.data.type).toBe("noteOn");
    }
  });
});