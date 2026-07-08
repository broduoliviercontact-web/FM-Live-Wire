// @vitest-environment jsdom
// Story 4.3 — end-to-end listener integration: join → receive `midi:event` →
// remap → toMidiBytes → MIDIOutput.send(data, performance.now()+LOOKAHEAD_MS).
//
// Drives the REAL JoinButton + MidiAccessProvider + listenerStore + scheduler +
// encode. socket.io-client is mocked (fake socket: records emits, fires server
// events + acks). Web MIDI is mocked home-typed so a real output port can be
// selected and `send` observed. `performance.now()` is spied to 1000 so the
// deferred send timestamp is deterministic (1000 + PLAYBACK_DELAY_MS 1500 = 2500).
// No real network, no hardware port.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { MidiPermissionButton } from "../features/listener/components/MidiPermissionButton";
import { JoinButton } from "../features/listener/components/JoinButton";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

// --- socket.io-client fake (records emits; fires server events + acks) --------
const { lastConnect, FakeSocket } = vi.hoisted(() => {
  interface EmitCall {
    ev: string;
    payload: unknown;
    ack: ((a: unknown) => void) | undefined;
  }
  class FakeSocket {
    listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    emitCalls: EmitCall[] = [];
    disconnectCount = 0;
    on(ev: string, cb: (arg?: unknown) => void): this {
      (this.listeners[ev] ??= []).push(cb);
      return this;
    }
    off(): this {
      return this;
    }
    disconnect(): this {
      this.disconnectCount += 1;
      return this;
    }
    connect(): this {
      return this;
    }
    fireServer(ev: string, arg?: unknown): void {
      (this.listeners[ev] ??= []).forEach((cb) => cb(arg));
    }
    emit(ev: string, payload?: unknown, ack?: (a: unknown) => void): void {
      this.emitCalls.push({ ev, payload, ack });
    }
  }
  const lastConnect = { socket: undefined as FakeSocket | undefined };
  return { lastConnect, FakeSocket };
});

vi.mock("socket.io-client", () => ({
  io: () => {
    const socket = new FakeSocket();
    lastConnect.socket = socket;
    return socket;
  },
}));

// --- Web MIDI mock (home-typed, with a sendable output) ----------------------

interface FakeMIDIOutput {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  send: (data: Uint8Array, ts: number) => void;
}
interface FakeMIDIAccess {
  inputs: Map<string, unknown>;
  outputs: Map<string, FakeMIDIOutput>;
  sysexEnabled: boolean;
  onstatechange: (() => void) | null;
}

const outSend = vi.fn((data: Uint8Array, _ts: number) => undefined);
const fakeOutput: FakeMIDIOutput = {
  id: "o1",
  name: "Volca FM",
  manufacturer: "Korg",
  state: "connected",
  connection: "closed",
  send: outSend,
};
const midiSpy = vi.fn(async () => {
  const access: FakeMIDIAccess = {
    inputs: new Map(),
    outputs: new Map([["o1", fakeOutput]]),
    sysexEnabled: false,
    onstatechange: null,
  };
  return access as unknown as MIDIAccess;
});

function renderFlow() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <JoinButton />
    </MidiAccessProvider>,
  );
}

/** Grant MIDI access, select the output, join the room, return the fake socket. */
async function join() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
  act(() => {
    useListenerStore.getState().setSelectedOutput("o1");
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-join-button")).not.toBeDisabled(),
  );
  act(() => {
    fireEvent.click(screen.getByTestId("listener-join-button"));
  });
  const socket = lastConnect.socket!;
  expect(socket).toBeDefined();
  act(() => {
    socket.fireServer("connect");
  });
  const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
  act(() => {
    joinCall.ack!({ ok: true });
  });
  expect(useListenerStore.getState().joined).toBe(true);
  return socket;
}

beforeEach(() => {
  useListenerStore.getState().reset();
  lastConnect.socket = undefined;
  outSend.mockClear();
  midiSpy.mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiSpy,
    configurable: true,
    writable: true,
  });
  vi.spyOn(performance, "now").mockReturnValue(1000);
  // Story 6.8 hotfix — the wiring stamps `receivedAtMs = Date.now()` (epoch) at
  // reception and computes latency as `receivedAtMs - srvTs` (both epoch). Mock
  // `Date.now()` to 1100 so a relayed `srvTs: 1050` yields a calm 50 ms latency
  // (1100 - 1050), keeping this test on the lookahead path (sendAt 1000 + 40).
  vi.spyOn(Date, "now").mockReturnValue(1100);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  } catch {
    /* already absent */
  }
  try {
    delete (window as unknown as Record<string, unknown>).isSecureContext;
  } catch {
    /* already absent */
  }
});

describe("Listener reception — midi:event → remap → toMidiBytes → send", () => {
  it("a relayed noteOn (canal 5) on listener canal 1 (data 0) → send([0x90,60,100], 2500)", async () => {
    renderFlow();
    const socket = await join();

    // Server relays the midi:event WITH envelope fields (performerId, srvTs).
    // Hotfix fidélité musicale: the performer `ts` (5, a performance.now()-relative
    // value) is used ONLY as RELATIVE musical time. The first event anchors to
    // performance.now() (1000) + PLAYBACK_DELAY_MS (1500) = 2500 locally; its
    // relative offset is 0 (ts 5 - anchor 5), so the deferred send target is 2500.
    // The epoch latency (Date.now()=1100 - srvTs=1050 = 50 ms) is telemetry only.
    const relayed = {
      type: "noteOn" as const,
      channel: 5,
      note: 60,
      velocity: 100,
      seq: 1,
      ts: 5,
      v: PROTOCOL_VERSION,
      roomId: ROOM,
      performerId: "srv-owner",
      srvTs: 1050,
    };
    act(() => {
      socket.fireServer("midi:event", relayed);
    });

    expect(outSend).toHaveBeenCalledTimes(1);
    const [data, ts] = outSend.mock.calls[0] as [Uint8Array, number];
    // Status byte 0x90 (noteOn, canal 0 — the original canal 5 was remapped to
    // the listener's forced canal data 0). note + velocity preserved.
    expect(Array.from(data)).toEqual([0x90, 60, 100]);
    // Deferred target = performance.now() (1000) + PLAYBACK_DELAY_MS (1500) = 2500.
    expect(ts).toBe(2500);
  });

  it("uses the listener's forced canal (data 15) when the store channel changes mid-session", async () => {
    renderFlow();
    const socket = await join();
    // Change the channel AFTER joining (the handler re-reads the store).
    useListenerStore.getState().setChannel(15);
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 2,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 1050,
      });
    });
    const [data] = outSend.mock.calls[0] as [Uint8Array, number];
    expect(data[0]).toBe(0x9f); // noteOn | canal 15
  });

  it("skips (no crash, no send) when the selected output is gone (hot-unplug)", async () => {
    renderFlow();
    await join();
    // Simulate the output disappearing from the provider (selection cleared).
    useListenerStore.getState().setSelectedOutput(null);
    act(() => {
      lastConnect.socket!.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 3,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
      });
    });
    expect(outSend).not.toHaveBeenCalled();
  });
});