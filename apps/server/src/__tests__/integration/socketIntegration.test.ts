// Story 6.5 — in-process Socket.IO integration (NFR-17, AD-19).
//
// One cohesive integration suite that exercises the REAL server wiring
// (`createIoServer`: roleAuth → eventGate → rateLimit → handlers) against REAL
// `socket.io-client` clients in the same Vitest process, with the REAL
// `InMemoryRelayService` fan-out (NO spy relay). A broadcast reaching — or NOT
// reaching — a joined listener is a genuine end-to-end signal, not a mocked
// call. No external server, no browser, no real MIDI port.
//
// Scenarios (S-3 / S-4 / S-5): join+relay (performerId+srvTs attached server-
// side; no broadcast before join), listener read-only (forbidden, 3rd →
// disconnect, no broadcast), owner-unique (performer:busy, no ghost slot),
// performer:disconnected (slot released), invalid event (ack error + no
// broadcast; SysEx rejected S-5), rate:limited (burst 200, 201st not broadcast),
// origin non-allowlisted rejected (no ghost slot).
//
// The scenarios are already covered story-by-story in socket.test.ts (often
// with a spy relay). This suite CONSOLIDATES them as integration proofs with
// real fan-out: the "no broadcast" assertion is a joined listener observing
// silence, and the rate-limit assertion counts real broadcasts (200, not 201).
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, afterEach } from "vitest";
import { ROOM, PROTOCOL_VERSION } from "@fmlw/shared";
import type { RelayedMidiEvent } from "../../../socket/services/RelayService";
import type { MidiEventAck } from "../../../socket/handlers/performerEvents";
import {
  createIntegrationHarness,
  INTEGRATION_PUBLIC_ORIGIN,
  INTEGRATION_BAD_ORIGIN,
  INTEGRATION_OWNER_SECRET,
  expectNoEvent,
  emitWithAck,
  onceEvent,
  closeClient,
  wait,
  midiEvent,
  type IntegrationHarness,
} from "./helpers/socketIntegrationHarness";

// One harness per test; drained in afterEach. `null` between tests so a
// connect failure can't leak a previous test's server.
let h: IntegrationHarness | null = null;

afterEach(async () => {
  if (h) {
    await h.close();
    h = null;
  }
});

describe("Story 6.5 — Socket.IO in-process integration: join/relay/forbidden/busy", () => {
  describe("1. join + relay (performer → listener)", () => {
    it("a joined listener receives the broadcast with server-attached performerId + srvTs (one-way model)", async () => {
      h = await createIntegrationHarness();
      const listener = await h.listener();
      const joinAck = await emitWithAck<{ ok: true }>(listener, "room:join", {});
      expect(joinAck).toEqual({ ok: true });
      const owner = await h.performer();

      const received = onceEvent<RelayedMidiEvent>(listener, "midi:event");
      const ack = await emitWithAck<{ ok: true }>(owner, "midi:event", midiEvent({ seq: 7, note: 64 }));
      expect(ack).toEqual({ ok: true });
      const evt = await received;

      // Server-authoritative fields (never read from the client payload):
      expect(evt.performerId).toBe(owner.id); // = server socket.id (one-way, AD-2)
      expect(typeof evt.srvTs).toBe("number");
      // MIDI payload passed through unchanged:
      expect(evt.type).toBe("noteOn");
      expect(evt.note).toBe(64);
      expect(evt.seq).toBe(7);
      expect(evt.v).toBe(PROTOCOL_VERSION);
      expect(evt.roomId).toBe(ROOM);
    });

    it("a listener that has NOT joined ROOM does NOT receive the broadcast (one-way room scoping)", async () => {
      h = await createIntegrationHarness();
      const listener = await h.listener(); // NOT joined
      const owner = await h.performer();

      const guard = expectNoEvent(listener, "midi:event", 200);
      const ack = await emitWithAck<{ ok: true }>(owner, "midi:event", midiEvent({ seq: 1 }));
      expect(ack).toEqual({ ok: true });
      await guard; // the non-joined listener observes silence
    });
  });

  describe("2. listener read-only / forbidden (S-4)", () => {
    it("a listener emitting midi:event receives a forbidden ack and nothing is broadcast", async () => {
      h = await createIntegrationHarness();
      // A joined watcher proves the relay never fan-outs the forbidden event.
      const watcher = await h.listener();
      await emitWithAck(watcher, "room:join", {});
      const guard = expectNoEvent(watcher, "midi:event", 250);

      const offender = await h.listener();
      const res = await emitWithAck<{ ok: false; error: string }>(offender, "midi:event", midiEvent());
      expect(res).toEqual({ ok: false, error: "forbidden" });
      await guard; // S-4: listeners are read-only — no broadcast ever
    });

    it("3rd forbidden disconnects the listener; no event is ever broadcast (S-4)", async () => {
      h = await createIntegrationHarness();
      const watcher = await h.listener();
      await emitWithAck(watcher, "room:join", {});
      const guard = expectNoEvent(watcher, "midi:event", 600); // window covers 3 emits

      const offender = await h.listener();
      // 1st + 2nd: forbidden, still connected.
      await emitWithAck(offender, "midi:event", midiEvent());
      await emitWithAck(offender, "midi:event", midiEvent());
      expect(offender.connected).toBe(true);
      // Attach the disconnect listener BEFORE the 3rd emit: the server may drop
      // the socket in the same flush as the ack.
      const disconnected = onceEvent(offender, "disconnect");
      const third = emitWithAck<{ ok: false; error: string }>(offender, "midi:event", midiEvent());
      await expect(third).resolves.toEqual({ ok: false, error: "forbidden" });
      await disconnected;
      expect(offender.connected).toBe(false);
      await guard; // nothing was broadcast across the 3 forbidden attempts
    });
  });

  describe("3. owner unique / performer:busy (S-3)", () => {
    it("a 2nd valid performer is refused with performer:busy; the first owner stays active (no ghost slot)", async () => {
      h = await createIntegrationHarness();
      const first = await h.performer();

      const err = await h.performer().catch((e) => e);
      expect(err).toMatchObject({ message: expect.stringMatching(/performer:busy/) });

      // The first owner is NOT replaced.
      expect(first.connected).toBe(true);
      expect(h.registry.isOwnerActive()).toBe(true);
      expect(h.registry.getOwnerPerformerId()).toBe(first.id); // no ghost slot
    });
  });

  describe("4. performer:disconnected → listeners notified + slot released", () => {
    it("joined listeners receive performer:disconnected and the owner slot is freed", async () => {
      h = await createIntegrationHarness();
      const listener = await h.listener();
      await emitWithAck(listener, "room:join", {});
      const owner = await h.performer();
      expect(h.registry.isOwnerActive()).toBe(true);
      // Capture the owner's id BEFORE disconnecting: socket.io-client clears
      // `socket.id` to undefined once the socket disconnects, so reading it
      // after `closeClient` would yield undefined.
      const ownerId = owner.id;

      const received = onceEvent<{ performerId: string; reason: string }>(
        listener,
        "performer:disconnected",
      );
      await closeClient(owner);
      const evt = await received;
      expect(evt.performerId).toBe(ownerId);
      expect(typeof evt.reason).toBe("string");

      // Slot released (registry equivalent of /health ownerActive:false).
      await wait(50);
      expect(h.registry.isOwnerActive()).toBe(false);
      expect(h.registry.getOwnerPerformerId()).toBeNull();
    });
  });

  describe("5. invalid midi:event → ack error + no broadcast (S-5 for SysEx)", () => {
    // Shared body: a joined watcher observes silence while the performer emits
    // an invalid event → the relay never fan-outs it.
    async function assertInvalidNoBroadcast(
      over: Record<string, unknown>,
      expectedError: "invalid" | "unsupported-version",
    ): Promise<void> {
      h = await createIntegrationHarness();
      const watcher = await h.listener();
      await emitWithAck(watcher, "room:join", {});
      const guard = expectNoEvent(watcher, "midi:event", 200);
      const owner = await h.performer();

      const res = await emitWithAck<MidiEventAck>(owner, "midi:event", midiEvent(over));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(expectedError);
      await guard; // no broadcast for an invalid event
    }

    it("unknown field (strict schema) → ack 'invalid', no broadcast", async () => {
      await assertInvalidNoBroadcast({ extra: 1 }, "invalid");
    });

    it("v !== 1 → ack 'unsupported-version', no broadcast", async () => {
      await assertInvalidNoBroadcast({ v: 2 }, "unsupported-version");
    });

    it("SysEx (type excluded from the schema) → ack 'invalid', no broadcast (S-5)", async () => {
      await assertInvalidNoBroadcast({ type: "sysex", data: [0xf0, 0x00, 0xf7] }, "invalid");
    });

    it("channel out of range (16 > 15) → ack 'invalid', no broadcast", async () => {
      await assertInvalidNoBroadcast({ channel: 16 }, "invalid");
    });
  });

  describe("6. rate:limited beyond the burst (200)", () => {
    it("200 midi:event pass and are broadcast; the 201st is rate:limited and NOT broadcast", async () => {
      // Frozen injected clock → no refill interferes; capacity 200 (default).
      h = await createIntegrationHarness({ rateLimit: { now: () => 0 } });
      const listener = await h.listener();
      await emitWithAck(listener, "room:join", {});
      let received = 0;
      listener.on("midi:event", () => {
        received += 1;
      });

      const owner = await h.performer();
      // Burst of 200 — all reach the handler → ack {ok:true} → real broadcast.
      for (let i = 0; i < 200; i += 1) {
        const res = await emitWithAck<{ ok: true }>(owner, "midi:event", midiEvent({ seq: i + 1 }));
        expect(res).toEqual({ ok: true });
      }
      // 201st → blocked by the limiter BEFORE the handler: rate:limited, no broadcast.
      const blocked = await emitWithAck<{ ok: false; error: string }>(
        owner,
        "midi:event",
        midiEvent({ seq: 201 }),
      );
      expect(blocked).toEqual({ ok: false, error: "rate:limited" });
      await wait(100); // flush any in-flight broadcasts

      // Real-fan-out proof: exactly 200 broadcasts reached the joined listener
      // (the 201st was never relayed).
      expect(received).toBe(200);
    });
  });

  describe("7. origin non-allowlisted rejected (AD-15, anti-CSWSH)", () => {
    it("a performer from a non-allowlisted origin is rejected (WS upgrade denied) and leaves no ghost slot", async () => {
      h = await createIntegrationHarness();
      const err = await h
        .performer(INTEGRATION_OWNER_SECRET, INTEGRATION_BAD_ORIGIN)
        .catch((e) => e);
      expect(err).toBeTruthy();
      // The handshake was refused at the origin gate (before roleAuth) → the
      // owner slot was never claimed.
      expect(h.registry.isOwnerActive()).toBe(false);
      expect(h.registry.getOwnerPerformerId()).toBeNull();
    });

    it("a listener from a non-allowlisted origin is rejected too (origin gate is role-agnostic)", async () => {
      h = await createIntegrationHarness();
      const err = await h.listener(INTEGRATION_BAD_ORIGIN).catch((e) => e);
      expect(err).toBeTruthy();
    });

    it("the allowlisted origin still connects (regression: the gate is not over-restrictive)", async () => {
      h = await createIntegrationHarness();
      const listener = await h.listener(INTEGRATION_PUBLIC_ORIGIN);
      expect(listener.connected).toBe(true);
      const owner = await h.performer(INTEGRATION_OWNER_SECRET, INTEGRATION_PUBLIC_ORIGIN);
      expect(owner.connected).toBe(true);
    });
  });
});