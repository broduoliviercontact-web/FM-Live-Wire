// Story 2.7 — performerEvents handler unit tests (AD-2, AD-5, AD-6, AD-9,
// FR-19, FR-20, FR-21). DETERMINISTIC — no Socket.IO server.
//
// The handler is exercised with a FAKE socket + a FAKE RelayService (the AD-6
// seam) + the REAL ValidationService (shared schema). This proves:
//   - valid event → relay.broadcast(ROOM, relayed) with performerId===socket.id
//     + srvTs number, MIDI payload unchanged, ack {ok:true}
//   - invalid / client-supplied performerId / v!==1 → stable error ack, NO broadcast
//   - the RelayService is mockable + swappable WITHOUT a handler rewrite (two
//     different fakes, same handler code)
//   - missing ack does not throw
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, vi } from "vitest";
import type { Socket } from "socket.io";
import { ROOM, PROTOCOL_VERSION } from "@fmlw/shared";
import { registerPerformerHandlers, type MidiEventAck } from "../socket/handlers/performerEvents";
import { ValidationService } from "../socket/services/ValidationService";
import type { RelayService, RelayedMidiEvent } from "../socket/services/RelayService";

/** Base valid noteOn payload (NO performerId / srvTs — those are server-only). */
function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    channel: 0,
    seq: 1,
    ts: 100,
    type: "noteOn",
    note: 60,
    velocity: 100,
    ...over,
  };
}

/** Fake socket: captures the handler registered via `on`, exposes `invoke`. */
function fakeSocket(id = "S1") {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    id,
    data: {},
    on: vi.fn((ev: string, cb: (...args: unknown[]) => void) => {
      handlers[ev] = cb;
    }),
    invoke(ev: string, ...args: unknown[]) {
      handlers[ev]?.(...args);
    },
  };
}

/** Fake relay that records every broadcast (the AD-6 mock). */
class RecordingRelay implements RelayService {
  broadcasts: Array<{ room: string; event: RelayedMidiEvent }> = [];
  broadcast(room: string, event: RelayedMidiEvent): void {
    this.broadcasts.push({ room, event });
  }
}

/** A SECOND, different fake — proves the handler works with ANY impl (swap). */
class CountingRelay implements RelayService {
  count = 0;
  last: RelayedMidiEvent | null = null;
  broadcast(room: string, event: RelayedMidiEvent): void {
    this.count += 1;
    this.last = event;
    expect(room).toBe(ROOM);
  }
}

function rig(id = "S1", relay: RelayService = new RecordingRelay()) {
  const socket = fakeSocket(id);
  const validation = new ValidationService();
  registerPerformerHandlers(socket as unknown as Socket, { validation, relay });
  const ack = vi.fn();
  return { socket, relay, ack, emit: (payload: unknown) => socket.invoke("midi:event", payload, ack) };
}

describe("performerEvents — valid event → broadcast + ack {ok:true}", () => {
  it("relays to ROOM with performerId===socket.id + srvTs number, payload unchanged", () => {
    const relay = new RecordingRelay();
    const { socket, emit, ack } = rig("S1", relay);
    emit(base());
    expect(relay.broadcasts).toHaveLength(1);
    const { room, event } = relay.broadcasts[0];
    expect(room).toBe(ROOM);
    // Server-attached fields:
    expect(event.performerId).toBe(socket.id); // server-authoritative, never from payload
    expect(typeof event.srvTs).toBe("number");
    // MIDI payload passed through unchanged:
    expect(event.v).toBe(PROTOCOL_VERSION);
    expect(event.roomId).toBe(ROOM);
    expect(event.type).toBe("noteOn");
    expect(event.note).toBe(60);
    expect(event.velocity).toBe(100);
    expect(event.channel).toBe(0);
    expect(event.seq).toBe(1);
    expect(event.ts).toBe(100);
    // ack:
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("broadcasts exactly once per valid event", () => {
    const relay = new RecordingRelay();
    const { emit, ack } = rig("S1", relay);
    emit(base({ note: 60 }));
    emit(base({ note: 61, seq: 2 }));
    expect(relay.broadcasts).toHaveLength(2);
    expect(ack).toHaveBeenCalledTimes(2);
  });

  it("a missing ack does NOT throw (handler still broadcasts)", () => {
    const relay = new RecordingRelay();
    const socket = fakeSocket("S1");
    registerPerformerHandlers(socket as unknown as Socket, {
      validation: new ValidationService(),
      relay,
    });
    expect(() => socket.invoke("midi:event", base())).not.toThrow(); // no ack arg
    expect(relay.broadcasts).toHaveLength(1);
  });
});

describe("performerEvents — invalid event → stable error ack, NO broadcast", () => {
  it("unknown field → ack {ok:false,error:'invalid',issues}, no broadcast", () => {
    const relay = new RecordingRelay();
    const { emit, ack } = rig("S1", relay);
    emit(base({ extra: 1 }));
    expect(relay.broadcasts).toHaveLength(0);
    expect(ack).toHaveBeenCalledTimes(1);
    const res = ack.mock.calls[0][0] as MidiEventAck;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid");
      expect(Array.isArray(res.issues)).toBe(true);
      expect(res.issues.length).toBeGreaterThan(0);
    }
  });

  it("client-supplied performerId → ack 'invalid', NO broadcast (never read from payload)", () => {
    // The strict schema rejects performerId; the handler must NOT broadcast and
    // must NOT use the client value even if it sneaks through elsewhere.
    const relay = new RecordingRelay();
    const { emit, ack, socket } = rig("S1", relay);
    emit(base({ performerId: "CLIENT-HACK" }));
    expect(relay.broadcasts).toHaveLength(0);
    const res = ack.mock.calls[0][0] as MidiEventAck;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
    // The server-side id is unaffected (it would have been socket.id, not the hack).
    expect(socket.id).toBe("S1");
  });

  it("v !== 1 → ack 'unsupported-version', no broadcast", () => {
    const relay = new RecordingRelay();
    const { emit, ack } = rig("S1", relay);
    emit(base({ v: 2 }));
    expect(relay.broadcasts).toHaveLength(0);
    const res = ack.mock.calls[0][0] as MidiEventAck;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("unsupported-version");
  });

  it("out-of-range note → ack 'invalid', no broadcast", () => {
    const relay = new RecordingRelay();
    const { emit, ack } = rig("S1", relay);
    emit(base({ note: 200 }));
    expect(relay.broadcasts).toHaveLength(0);
    const res = ack.mock.calls[0][0] as MidiEventAck;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
  });

  it("non-object payload → ack 'invalid', no broadcast", () => {
    const relay = new RecordingRelay();
    const { emit, ack } = rig("S1", relay);
    emit("not-an-event");
    expect(relay.broadcasts).toHaveLength(0);
    expect((ack.mock.calls[0][0] as MidiEventAck).ok).toBe(false);
  });
});

describe("performerEvents — RelayService adapter is swappable WITHOUT a rewrite (AD-6)", () => {
  // The SAME handler code (registerPerformerHandlers) works with two DIFFERENT
  // RelayService implementations. Swapping the in-memory adapter for a Redis
  // adapter later requires NO handler change — proven here by injecting two
  // unrelated fakes and observing identical behavior.
  it("works with RecordingRelay", () => {
    const relay = new RecordingRelay();
    const { socket, emit } = rig("S1", relay);
    emit(base());
    expect(relay.broadcasts).toHaveLength(1);
    expect(relay.broadcasts[0].event.performerId).toBe(socket.id);
  });

  it("works with CountingRelay (a different impl) — handler code unchanged", () => {
    const relay = new CountingRelay();
    const { socket, emit, ack } = rig("S2", relay);
    emit(base());
    expect(relay.count).toBe(1);
    expect(relay.last?.performerId).toBe(socket.id);
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });
});