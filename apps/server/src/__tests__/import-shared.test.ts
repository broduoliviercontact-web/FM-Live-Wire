// Importability proof (backend side): `@fmlw/shared` resolves via `workspace:*`
// to the built dist (Story 1.2 AC). Run by the root `pnpm test` AFTER
// `pnpm --filter @fmlw/shared build`, so dist exists.
import { describe, it, expect } from "vitest";
import { MidiEventSchema, ROOM, type MidiEvent } from "@fmlw/shared";

describe("@fmlw/shared importable from @fmlw/server (workspace:*)", () => {
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