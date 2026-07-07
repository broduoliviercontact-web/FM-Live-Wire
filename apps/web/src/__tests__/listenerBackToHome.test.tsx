// @vitest-environment jsdom
// Story 6.1 — listener `BackToHome` + `leaveListenerForNavigation` (Q-UX10,
// UX-DR1, AD-2). Proves the CLEAN leave/disconnect happens BEFORE the route
// change to `/`, that a joined listener emits `room:leave` (best-effort) +
// disconnects the socket, that the flux is reset to idle (NOT `server-down` —
// the leave is voluntary → `intentionalClose`), and that the AD-2 duplication
// (listener owns its own `BackToHome`) does not break the `JoinButton`.
//
// Pattern: the `socket.io-client` fake + Web MIDI mock mirror
// `listenerFailSafe.test.tsx` (Story 5.5) so the full `ListenerPanel` lifecycle
// (grant → select output → join → click « ← Retour ») is exercised end-to-end.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { ListenerPanel } from "../features/listener";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";
import { BackToHome } from "../features/listener/components/BackToHome";
import {
  __resetMockMidiOutput,
} from "../features/listener/lib/mock-output";

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

// --- Web MIDI mock (home-typed; a sendable real output whose .send is a spy) ---
interface FakeMIDIPort {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  send: (data: Uint8Array, ts: number) => void;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIPort>;
  outputs: Map<string, FakeMIDIPort>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIPort }) => void) | null;
}

const midiMock = {
  nextOutputs: [] as Omit<FakeMIDIPort, "send">[],
  lastAccess: null as FakeMIDIAccess | null,
  sendSpy: vi.fn((_data: Uint8Array, _ts: number) => undefined),
  spy: vi.fn(async () => {
    const outputs = new Map<string, FakeMIDIPort>();
    for (const p of midiMock.nextOutputs) {
      outputs.set(p.id, { ...p, send: midiMock.sendSpy });
    }
    const access: FakeMIDIAccess = {
      inputs: new Map(),
      outputs,
      sysexEnabled: false,
      onstatechange: null,
    };
    midiMock.lastAccess = access;
    return access as unknown as MIDIAccess;
  }),
};

function makePort(id: string, name = id): Omit<FakeMIDIPort, "send"> {
  return {
    id,
    name,
    manufacturer: "TestMfg",
    state: "connected",
    connection: "closed",
  };
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  __resetMockMidiOutput();
  lastConnect.socket = undefined;
  midiMock.nextOutputs = [];
  midiMock.lastAccess = null;
  midiMock.sendSpy.mockReset();
  midiMock.sendSpy.mockImplementation((_data, _ts) => undefined);
  midiMock.spy.mockClear();
  // BrowserCompatGate requires a secure context + `navigator.requestMIDIAccess`
  // (it NEVER calls it — pure feature detection). Mirror listenerFailSafe.
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
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
  vi.unstubAllGlobals();
});

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/listener"]}>
      <MidiAccessProvider>
        <ListenerPanel />
      </MidiAccessProvider>
    </MemoryRouter>,
  );
}

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
}

/** Render + grant + select a real output + join + fire connect + room:join ack. */
async function joinReal(portId = "o1"): Promise<FakeSocket> {
  midiMock.nextOutputs = [makePort(portId, "Volca FM")];
  renderPanel();
  await grant();
  act(() => {
    useListenerStore.getState().setSelectedOutput(portId);
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-join-button")).not.toBeDisabled(),
  );
  act(() => {
    fireEvent.click(screen.getByTestId("listener-join-button"));
  });
  const socket = lastConnect.socket!;
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

/** Records pathname CHANGES (after the initial mount) to a shared log. */
function LocationProbe({ log }: { log: string[] }) {
  const { pathname } = useLocation();
  const prev = useRef<string | null>(null);
  if (prev.current === null) {
    prev.current = pathname;
  } else if (prev.current !== pathname) {
    log.push("navigate:" + pathname);
    prev.current = pathname;
  }
  return null;
}

describe("listener BackToHome — disconnect BEFORE navigation (Q-UX10)", () => {
  it("calls onDisconnect, then navigates to '/' (strict order)", () => {
    const log: string[] = [];
    const onDisconnect = vi.fn(() => log.push("disconnect"));

    render(
      <MemoryRouter initialEntries={["/listener"]}>
        <LocationProbe log={log} />
        <Routes>
          <Route path="/listener" element={<BackToHome onDisconnect={onDisconnect} />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("listener-back-to-home"));

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("home")).toBeInTheDocument();
    // ORDER: disconnect logged strictly before the navigation change.
    expect(log).toEqual(["disconnect", "navigate:/"]);
  });

  it("renders the exact '← Retour' label", () => {
    render(
      <MemoryRouter initialEntries={["/listener"]}>
        <Routes>
          <Route path="/listener" element={<BackToHome onDisconnect={vi.fn()} />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("listener-back-to-home")).toHaveTextContent("← Retour");
  });

  it("opens NO confirmation dialog (leaving is a natural end)", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <MemoryRouter initialEntries={["/listener"]}>
        <Routes>
          <Route path="/listener" element={<BackToHome onDisconnect={vi.fn()} />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("listener-back-to-home"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("listener BackToHome — clean leave via ListenerPanel (Q-UX10, AD-2)", () => {
  it("is always visible (mounted before the BrowserCompatGate / JoinButton)", () => {
    renderPanel();
    expect(screen.getByTestId("listener-back-to-home")).toBeInTheDocument();
  });

  it("emits room:leave + disconnects + resets joined BEFORE navigating home", async () => {
    const logWrap: string[] = [];
    function App() {
      return (
        <MidiAccessProvider>
          <LocationProbe log={logWrap} />
          <Routes>
            <Route path="/listener" element={<ListenerPanel />} />
            <Route path="/" element={<div data-testid="home">home</div>} />
          </Routes>
        </MidiAccessProvider>
      );
    }
    render(<MemoryRouter initialEntries={["/listener"]}><App /></MemoryRouter>);
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    // Grant picks up the outputs above; the picker offers "o1".
    await grant();
    act(() => useListenerStore.getState().setSelectedOutput("o1"));
    await waitFor(() =>
      expect(screen.getByTestId("listener-join-button")).not.toBeDisabled(),
    );
    act(() => fireEvent.click(screen.getByTestId("listener-join-button")));
    const socket = lastConnect.socket!;
    act(() => socket.fireServer("connect"));
    const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
    act(() => joinCall.ack!({ ok: true }));
    expect(useListenerStore.getState().joined).toBe(true);
    expect(socket.disconnectCount).toBe(0);

    // Snapshot emit count BEFORE the leave, then click « ← Retour ».
    const emitsBefore = socket.emitCalls.length;
    fireEvent.click(screen.getByTestId("listener-back-to-home"));

    // 1) room:leave was emitted (best-effort) on the click — BEFORE navigation.
    const leaveCall = socket.emitCalls.slice(emitsBefore).find((c) => c.ev === "room:leave");
    expect(leaveCall).toBeTruthy();
    // 2) the socket was disconnected (no ghost membership).
    expect(socket.disconnectCount).toBe(1);
    // 3) joined flipped to false + flux is idle (NOT server-down: voluntary).
    expect(useListenerStore.getState().joined).toBe(false);
    expect(useListenerStore.getState().fluxStatus).not.toBe("server-down");
    // 4) navigation reached `/` strictly after the leave/disconnect.
    expect(screen.getByTestId("home")).toBeInTheDocument();
    expect(logWrap).toEqual(["navigate:/"]);
  });

  it("does NOT break the JoinButton flow (AD-2: own BackToHome, no cross-import)", async () => {
    // Sanity: the listener can still grant + select + join with the new
    // BackToHome mounted (the BackToHome is outside the compat gate and does
    // not touch the join control).
    const socket = await joinReal();
    expect(useListenerStore.getState().joined).toBe(true);
    // A relayed noteOn still flows through the scheduler to the output.
    expect(socket.emitCalls.some((c) => c.ev === "room:join")).toBe(true);
  });

  it("is safe when clicked before joining (no socket yet → no-op leave, then navigate)", () => {
    const log: string[] = [];
    function App() {
      return (
        <MidiAccessProvider>
          <LocationProbe log={log} />
          <Routes>
            <Route path="/listener" element={<ListenerPanel />} />
            <Route path="/" element={<div data-testid="home">home</div>} />
          </Routes>
        </MidiAccessProvider>
      );
    }
    render(<MemoryRouter initialEntries={["/listener"]}><App /></MemoryRouter>);
    // No grant / no join: click « ← Retour » immediately.
    fireEvent.click(screen.getByTestId("listener-back-to-home"));
    expect(screen.getByTestId("home")).toBeInTheDocument();
    expect(log).toEqual(["navigate:/"]);
    expect(useListenerStore.getState().joined).toBe(false);
    expect(useListenerStore.getState().fluxStatus).not.toBe("server-down");
  });
});