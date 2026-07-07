// Story 1.4 — import-resolution proofs for the web scaffolding.
//
// These tests do NOT exercise business logic (there is none yet). They prove
// the wiring contracts of the skeleton:
//   1. `@fmlw/shared` is re-exported through the `entities` layer and is
//      usable from the web app (AD-5 shared contract).
//   2. The Zustand store is installed and usable (AD-6).
//   3. The declarative router module loads (all route pages + layout resolve).
//
// Tests are excluded from tsc (`tsconfig.json` exclude) and from ESLint
// boundary rules (`**/__tests__/**` ignore) — they are dev tooling only.
import { describe, it, expect } from "vitest";
import { MidiEventSchema, toMidiBytes, type MidiEvent } from "../entities/MidiEvent";
import { type Channel, WIRE_CHANNEL_MIN, WIRE_CHANNEL_MAX } from "../entities/Channel";
import { type Role, ROLES } from "../entities/Role";
import { useUiStore } from "../app/store";
import { AppRouter } from "../app/router";
import { ROOM } from "@fmlw/shared";

describe("entities layer re-exports @fmlw/shared (AD-5)", () => {
  it("exposes the schema, encoder and type", () => {
    expect(typeof MidiEventSchema.safeParse).toBe("function");
    expect(typeof toMidiBytes).toBe("function");
    const event: MidiEvent = {
      v: 1,
      type: "noteOn",
      channel: 0,
      roomId: ROOM,
      seq: 1,
      ts: 0,
      note: 60,
      velocity: 100,
    };
    const parsed = MidiEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toMidiBytes(parsed.data)).toEqual(new Uint8Array([0x90, 60, 100]));
    }
  });

  it("re-exports channel bounds", () => {
    const min: Channel = WIRE_CHANNEL_MIN;
    const max: Channel = WIRE_CHANNEL_MAX;
    expect(min).toBe(0);
    expect(max).toBe(15);
  });

  it("re-exports roles", () => {
    const r: Role = "performer";
    expect(ROLES).toContain(r);
    expect(ROLES).toEqual(["performer", "listener", "owner"]);
  });
});

describe("Zustand store is installed and usable (AD-6)", () => {
  it("exposes the initial placeholder state and a setter", () => {
    const state = useUiStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.ready).toBe(false);
    expect(typeof state.setReady).toBe("function");
    state.setReady(true);
    expect(useUiStore.getState().ready).toBe(true);
    // restore
    state.setReady(false);
    expect(useUiStore.getState().ready).toBe(false);
  });
});

describe("declarative router module loads (routes /, /listener, /performer)", () => {
  it("exports the AppRouter component", () => {
    expect(typeof AppRouter).toBe("function");
  });
});