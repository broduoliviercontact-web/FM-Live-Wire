// @vitest-environment jsdom
// Story 3.4 — end-to-end integration: capture → emit("midi:event") → ack →
// store → MonitoringPanel.
//
// Drives the REAL PerformerPanel + MidiAccessProvider + useMidiInput + relay +
// store. socket.io-client is mocked with a fake socket that RECORDS outgoing
// emits and can invoke the ack callback. navigator.requestMIDIAccess is mocked
// (home-typed) so a real MIDI input can be selected and `onmidimessage` fired.
// No real network.
//
// Proves:
//   - a captured MidiEvent triggers `socket.emit("midi:event", payload, ack)`;
//   - the payload carries NO `performerId` and NO `srvTs`;
//   - ack {ok:true} → events envoyés++ + dernier event line updated;
//   - ack {ok:false,error:"invalid"} → erreurs récentes++;
//   - ack {ok:false,error:"rate:limited"} → E12 alert shown;
//   - SysEx is filtered (decode → null → no emit at all).
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
import { MemoryRouter } from "react-router-dom";
import { PerformerPanel } from "../features/performer";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { usePerformerStore } from "../features/performer/store/performerStore";

// vi.hoisted so the mock factory (hoisted above imports) can reference the
// fake socket class + the shared state without TDZ.
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
    /** Server→client event (used to fire `connect` / `connect_error`). */
    fireServer(ev: string, arg?: unknown): void {
      (this.listeners[ev] ??= []).forEach((cb) => cb(arg));
    }
    /** Client→server emit capture (PerformerPanel calls `socket.emit`). */
    emit(ev: string, payload?: unknown, ack?: (a: unknown) => void): void {
      this.emitCalls.push({ ev, payload, ack });
    }
  }
  const lastConnect = {
    socket: undefined as FakeSocket | undefined,
  };
  return { lastConnect, FakeSocket };
});

vi.mock("socket.io-client", () => ({
  io: () => {
    const socket = new FakeSocket();
    lastConnect.socket = socket;
    return socket;
  },
}));

// --- Web MIDI mock (home-typed, same pattern as midiAccess.test.tsx) --------

interface FakeMIDIInput {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  onmidimessage: ((ev: MIDIMessageEvent) => void) | null;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIInput>;
  outputs: Map<string, unknown>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIInput }) => void) | null;
}
function makeInput(id: string, name = id): FakeMIDIInput {
  return {
    id,
    name,
    manufacturer: "TestMfg",
    state: "connected",
    connection: "closed",
    onmidimessage: null,
  };
}
function makeMidiAccess(inputs: FakeMIDIInput[]): FakeMIDIAccess {
  return {
    inputs: new Map(inputs.map((i) => [i.id, i])),
    outputs: new Map(),
    sysexEnabled: false,
    onstatechange: null,
  };
}
const midiMock = {
  spy: vi.fn(),
  nextInputs: [] as FakeMIDIInput[],
  lastAccess: null as FakeMIDIAccess | null,
};
midiMock.spy = vi.fn(async () => {
  const access = makeMidiAccess(midiMock.nextInputs);
  midiMock.lastAccess = access;
  return access as unknown as MIDIAccess;
});

function makeMessage(bytes: number[], timeStamp: number): MIDIMessageEvent {
  return {
    data: new Uint8Array(bytes),
    timeStamp,
  } as unknown as MIDIMessageEvent;
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <MidiAccessProvider>
        <PerformerPanel />
      </MidiAccessProvider>
    </MemoryRouter>,
  );
}

const TOKEN = "topsecret-OWNER-token-3.4";

async function connectAndGrantAndSelect() {
  fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
    target: { value: TOKEN },
  });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
  await waitFor(() => expect(lastConnect.socket).toBeDefined());
  // Connect the socket (PerformerPanel listens for "connect").
  await act(async () => {
    lastConnect.socket!.fireServer("connect");
  });
  // Grant MIDI access + pick the input.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
  });
  await waitFor(() =>
    expect(screen.getByTestId("midi-input-select")).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.change(screen.getByTestId("midi-input-select"), {
      target: { value: "p1" },
    });
  });
  await waitFor(() =>
    expect(midiMock.lastAccess!.inputs.get("p1")!.onmidimessage).not.toBeNull(),
  );
}

beforeEach(() => {
  lastConnect.socket = undefined;
  midiMock.spy.mockClear();
  midiMock.nextInputs = [makeInput("p1", "K-Board")];
  midiMock.lastAccess = null;
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  usePerformerStore.getState().reset();
  // /health fetch used on connect — stub it.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, listeners: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  try {
    delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  } catch {
    /* absent */
  }
  try {
    delete (window as unknown as Record<string, unknown>).isSecureContext;
  } catch {
    /* absent */
  }
});

describe("PerformerPanel relay — capture → emit → ack", () => {
  it("a captured MidiEvent triggers socket.emit('midi:event', payload, ack)", async () => {
    renderPanel();
    await connectAndGrantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 5000));
    });
    const midiEmits = lastConnect.socket!.emitCalls.filter(
      (c) => c.ev === "midi:event",
    );
    expect(midiEmits).toHaveLength(1);
    expect(midiEmits[0].payload).toMatchObject({
      type: "noteOn",
      channel: 0,
      note: 60,
      velocity: 100,
    });
  });

  it("the emitted payload has NO performerId and NO srvTs", async () => {
    renderPanel();
    await connectAndGrantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 5000));
    });
    const payload = lastConnect.socket!.emitCalls.find(
      (c) => c.ev === "midi:event",
    )!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("performerId");
    expect(payload).not.toHaveProperty("srvTs");
  });

  it("ack {ok:true} → events envoyés++ and the last-event line updates", async () => {
    renderPanel();
    await connectAndGrantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 5000));
    });
    const midiEmit = lastConnect.socket!.emitCalls.find(
      (c) => c.ev === "midi:event",
    )!;
    // Server acks ok.
    await act(async () => {
      midiEmit.ack!({ ok: true });
    });
    expect(usePerformerStore.getState().eventsSent).toBe(1);
    expect(screen.getByTestId("monitoring-last-event")).toHaveTextContent(
      "noteOn · CH 1 · note=60 vel=100",
    );
    expect(screen.getByTestId("counter-events-sent")).toHaveTextContent(
      "1 event envoyé",
    );
  });

  it("ack {ok:false,error:'invalid'} → erreurs récentes++ (non-blocking)", async () => {
    renderPanel();
    await connectAndGrantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 5000));
    });
    const midiEmit = lastConnect.socket!.emitCalls.find(
      (c) => c.ev === "midi:event",
    )!;
    await act(async () => {
      midiEmit.ack!({ ok: false, error: "invalid" });
    });
    expect(usePerformerStore.getState().recentErrors).toBe(1);
    expect(usePerformerStore.getState().eventsSent).toBe(0);
    // No rate-limit alert for invalid.
    expect(screen.queryByTestId("rate-limit-alert")).not.toBeInTheDocument();
  });

  it("ack {ok:false,error:'rate:limited'} → E12 alert with the exact message", async () => {
    renderPanel();
    await connectAndGrantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 5000));
    });
    const midiEmit = lastConnect.socket!.emitCalls.find(
      (c) => c.ev === "midi:event",
    )!;
    await act(async () => {
      midiEmit.ack!({ ok: false, error: "rate:limited" });
    });
    expect(screen.getByTestId("rate-limit-alert")).toHaveTextContent(
      "Limite de débit atteinte — certains events ont été ignorés par le serveur.",
    );
    expect(usePerformerStore.getState().rateLimited).toBe(true);
  });

  it("SysEx is filtered: no emit at all (decode → null → no relay)", async () => {
    renderPanel();
    await connectAndGrantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    // Fire a SysEx message — decode returns null → useMidiInput never calls onEvent.
    await act(async () => {
      input.onmidimessage!(makeMessage([0xf0, 0x43, 0x1a, 0xf7], 5000));
    });
    const midiEmits = lastConnect.socket!.emitCalls.filter(
      (c) => c.ev === "midi:event",
    );
    expect(midiEmits).toHaveLength(0);
    // No SysEx PAYLOAD is displayed: the last-event line stays at its
    // placeholder (decode → null → no lastEvent update). The permanent
    // "SysEx silencieusement filtré…" note is informational copy, not a
    // payload — it is present, but no SysEx bytes ever reach the line.
    expect(screen.getByTestId("monitoring-last-event")).toHaveTextContent("—");
  });
});