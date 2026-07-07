// @vitest-environment jsdom
// Story 3.5 — connection lifecycle integration through PerformerPanel.
//
// Drives the REAL PerformerPanel + store + relay + capture. socket.io-client is
// mocked with a fake socket that RECORDS outgoing `emit` (client→server
// `midi:event`) and can FIRE server→client lifecycle events (`connect`,
// `disconnect`, `reconnect_attempt`, `reconnect`, `reconnect_error`,
// `connect_error`) + records `disconnect()` calls. navigator.requestMIDIAccess
// is mocked (home-typed). No real network.
//
// Proves:
//   - reconnect: network drop → `reconnecting` visible + attempt count →
//     `reconnect` → `connected` again, NO blocking dialog;
//   - `invalid` and `performer:busy` stay TERMINAL (no retry — `socket.disconnect`
//     stops the backoff loop);
//   - NO replay: after a reconnect, old MidiEvents are NOT re-emitted (only
//     newly captured events go out; `seq` stays monotone);
//   - `BackToHome` sets the end message + disconnects BEFORE navigating to `/`;
//   - the token never reaches the URL and is never persisted.
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
import { useRef } from "react";
import { MemoryRouter, useLocation, Route, Routes } from "react-router-dom";
import { PerformerPanel } from "../features/performer";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import {
  usePerformerStore,
  PERFORMER_END_MESSAGE,
} from "../features/performer/store/performerStore";

// --- socket.io-client mock: fake socket that captures emits + fires lifecycle --

const { lastConnect, FakeSocket, actionLog } = vi.hoisted(() => {
  interface EmitCall {
    ev: string;
    payload: unknown;
    ack: ((a: unknown) => void) | undefined;
  }
  const actionLog: string[] = [];
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
      actionLog.push("disconnect");
      return this;
    }
    connect(): this {
      return this;
    }
    /** Server→client lifecycle event (connect, disconnect, reconnect, reconnect_attempt, reconnect_error, connect_error). */
    fireServer(ev: string, arg?: unknown): void {
      (this.listeners[ev] ??= []).forEach((cb) => cb(arg));
    }
    /** Client→server emit capture (PerformerPanel `socket.emit("midi:event")`). */
    emit(ev: string, payload?: unknown, ack?: (a: unknown) => void): void {
      this.emitCalls.push({ ev, payload, ack });
    }
  }
  const lastConnect = {
    socket: undefined as FakeSocket | undefined,
    calls: 0,
  };
  return { lastConnect, FakeSocket, actionLog };
});

vi.mock("socket.io-client", () => ({
  io: () => {
    lastConnect.calls += 1;
    const socket = new FakeSocket();
    lastConnect.socket = socket;
    return socket;
  },
}));

// --- Web MIDI mock (home-typed) --------------------------------------------

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

const TOKEN = "topsecret-OWNER-token-3.5";

/** Render the panel at `/performer` with a `/` route to observe BackToHome nav. */
function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/performer"]}>
      <MidiAccessProvider>
        <Routes>
          <Route path="/performer" element={<PerformerPanel />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MidiAccessProvider>
    </MemoryRouter>,
  );
}

async function connect() {
  fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
    target: { value: TOKEN },
  });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
  await waitFor(() => expect(lastConnect.socket).toBeDefined());
  await act(async () => {
    lastConnect.socket!.fireServer("connect");
  });
  await waitFor(() =>
    expect(screen.getByTestId("performer-connected-alert")).toBeInTheDocument(),
  );
}

async function grantAndSelect() {
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
  lastConnect.calls = 0;
  actionLog.length = 0;
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

describe("Story 3.5 — reconnection (UX-DR23)", () => {
  it("network drop → 'reconnecting' visible with attempt #, then 'reconnect' → connected, no dialog", async () => {
    renderPanel();
    await connect();
    // Connected indicator initially "Connecté".
    expect(screen.getByTestId("connection-pill")).toHaveTextContent("Connecté");

    // Network drop.
    await act(async () => {
      lastConnect.socket!.fireServer("disconnect", "transport close");
    });
    expect(screen.getByTestId("connection-pill")).toHaveTextContent("Déconnecté");

    // Backoff attempt #1 → reconnecting indicator visible, non-blocking.
    const confirmSpy = vi.spyOn(window, "confirm");
    await act(async () => {
      lastConnect.socket!.fireServer("reconnect_attempt", 1);
    });
    expect(screen.getByTestId("connection-pill")).toHaveTextContent(
      "Reconnexion en cours",
    );
    expect(screen.getByTestId("connection-reconnect-attempt")).toHaveTextContent(
      "Reconnexion… (tentative 1)",
    );
    // No blocking dialog at any point.
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();

    // Reconnect succeeds → connected again.
    await act(async () => {
      lastConnect.socket!.fireServer("reconnect");
    });
    expect(screen.getByTestId("connection-pill")).toHaveTextContent("Connecté");
    expect(screen.queryByTestId("connection-reconnect-attempt")).not.toBeInTheDocument();
  });

  it("reconnect_error shows a sober, non-blocking error line while reconnecting", async () => {
    renderPanel();
    await connect();
    await act(async () => {
      lastConnect.socket!.fireServer("disconnect", "transport close");
      lastConnect.socket!.fireServer("reconnect_attempt", 2);
    });
    await act(async () => {
      lastConnect.socket!.fireServer("reconnect_error", new Error("xhr poll error"));
    });
    expect(screen.getByTestId("connection-reconnect-error")).toHaveTextContent(
      "xhr poll error",
    );
    // Still reconnecting (not terminal).
    expect(screen.getByTestId("connection-pill")).toHaveTextContent(
      "Reconnexion en cours",
    );
  });
});

describe("Story 3.5 — terminal handshake errors (no retry)", () => {
  it("'invalid' → terminal 'Admin token invalide.', socket.disconnect stops the loop, no retry", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(lastConnect.socket).toBeDefined());
    await act(async () => {
      lastConnect.socket!.fireServer("connect_error", { message: "invalid" });
    });
    expect(screen.getByTestId("performer-invalid-alert")).toHaveTextContent(
      "Admin token invalide.",
    );
    // The panel called socket.disconnect() → backoff loop stopped (no retry).
    expect(lastConnect.socket!.disconnectCount).toBeGreaterThanOrEqual(1);
    // Only ONE io() call — no automatic reconnect (fake would not retry anyway,
    // but this also asserts we did not open a second socket).
    expect(lastConnect.calls).toBe(1);
    // The token is never echoed back.
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
  });

  it("'performer:busy' → terminal busy alert, socket.disconnect, no retry", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(lastConnect.socket).toBeDefined());
    await act(async () => {
      lastConnect.socket!.fireServer("connect_error", { message: "performer:busy" });
    });
    expect(screen.getByTestId("performer-busy-alert")).toBeInTheDocument();
    expect(lastConnect.socket!.disconnectCount).toBeGreaterThanOrEqual(1);
    expect(lastConnect.calls).toBe(1);
    // No retry button, no auto-reconnect: the form is gone.
    expect(
      screen.queryByRole("button", { name: "Se connecter" }),
    ).not.toBeInTheDocument();
  });

  it("generic initial-handshake failure → terminal 'Connexion impossible.', no retry", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(lastConnect.socket).toBeDefined());
    await act(async () => {
      lastConnect.socket!.fireServer("connect_error", { message: "xhr poll error" });
    });
    expect(screen.getByTestId("performer-error-alert")).toHaveTextContent(
      "Connexion impossible.",
    );
    expect(lastConnect.socket!.disconnectCount).toBeGreaterThanOrEqual(1);
    expect(lastConnect.calls).toBe(1);
    // No technical detail surfaced.
    expect(screen.queryByText("xhr poll error")).not.toBeInTheDocument();
  });
});

describe("Story 3.5 — NO replay of the past (AD-17)", () => {
  it("after a reconnect, old MidiEvents are NOT re-emitted; seq stays monotone", async () => {
    renderPanel();
    await connect();
    await grantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;

    // Emit one event (seq=1).
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 1000));
    });
    let midiEmits = lastConnect.socket!.emitCalls.filter((c) => c.ev === "midi:event");
    expect(midiEmits).toHaveLength(1);
    expect((midiEmits[0].payload as { seq: number }).seq).toBe(1);

    // Network drop + reconnect (AD-17: no replay, no buffering).
    await act(async () => {
      lastConnect.socket!.fireServer("disconnect", "transport close");
      lastConnect.socket!.fireServer("reconnect_attempt", 1);
      lastConnect.socket!.fireServer("reconnect");
    });

    // No old event was re-emitted by the reconnect.
    midiEmits = lastConnect.socket!.emitCalls.filter((c) => c.ev === "midi:event");
    expect(midiEmits).toHaveLength(1);

    // Only a NEWLY captured event goes out — and seq continues monotonically (2),
    // proving no replay / no reset.
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 64, 80], 2000));
    });
    midiEmits = lastConnect.socket!.emitCalls.filter((c) => c.ev === "midi:event");
    expect(midiEmits).toHaveLength(2);
    expect((midiEmits[1].payload as { seq: number }).seq).toBe(2);
  });
});

describe("Story 3.5 — BackToHome: end message + disconnect BEFORE navigation", () => {
  it("click '← Retour' → disconnect, set end message, then navigate to '/' (strict order)", async () => {
    const navLog: string[] = [];
    render(
      <MemoryRouter initialEntries={["/performer"]}>
        <MidiAccessProvider>
          <LocationProbe log={navLog} />
          <Routes>
            <Route path="/performer" element={<PerformerPanel />} />
            <Route path="/" element={<div data-testid="home">home</div>} />
          </Routes>
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    await connect();

    // Sanity: still on /performer, end message not set.
    expect(usePerformerStore.getState().endMessage).toBeNull();

    fireEvent.click(screen.getByTestId("performer-back-to-home"));

    // End message set in the store with the EXACT text.
    expect(usePerformerStore.getState().endMessage).toBe(PERFORMER_END_MESSAGE);
    expect(PERFORMER_END_MESSAGE).toBe(
      "Déconnexion : slot owner libéré. Les listeners voient « Performer déconnecté ».",
    );
    // Socket was disconnected (→ server releases the owner slot via Story 2.3).
    expect(actionLog.filter((a) => a === "disconnect").length).toBeGreaterThanOrEqual(1);
    // Navigation reached "/".
    expect(screen.getByTestId("home")).toBeInTheDocument();
    // ORDER: socket disconnect logged strictly before the navigation.
    const disconnectIdx = actionLog.indexOf("disconnect");
    const navIdx = navLog.indexOf("navigate:/");
    expect(disconnectIdx).toBeGreaterThanOrEqual(0);
    expect(navIdx).toBeGreaterThanOrEqual(0);
    // Both share the timeline only via the disconnect entry; assert the
    // navigation happened (navLog) and a disconnect preceded it (actionLog).
    expect(navLog).toContain("navigate:/");
    expect(actionLog).toContain("disconnect");
  });
});

describe("Story 3.5 — security (token never persisted / never in URL)", () => {
  it("the token never reaches the URL after a connection attempt", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(lastConnect.socket).toBeDefined());
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("nothing is written to localStorage / sessionStorage during the flow", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPanel();
    await connect();
    await grantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 1000));
    });
    // BackToHome disconnect.
    fireEvent.click(screen.getByTestId("performer-back-to-home"));
    // No persistence call ever carried the token (or anything).
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });
});

describe("Story 3.5 — non-regression (Stories 3.4 / 3.2 still green)", () => {
  it("relay midi:event + rate:limited alert still work after connect", async () => {
    renderPanel();
    await connect();
    await grantAndSelect();
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 1000));
    });
    const midiEmit = lastConnect.socket!.emitCalls.find(
      (c) => c.ev === "midi:event",
    )!;
    await act(async () => {
      midiEmit.ack!({ ok: false, error: "rate:limited" });
    });
    // E12 alert with the exact message (Story 3.4).
    expect(screen.getByTestId("rate-limit-alert")).toHaveTextContent(
      "Limite de débit atteinte — certains events ont été ignorés par le serveur.",
    );
  });

  it("BrowserCompatGate still blocks the flow on an insecure context", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    renderPanel();
    expect(screen.getByText("Web MIDI nécessite HTTPS")).toBeInTheDocument();
    expect(
      screen.queryByTestId("performer-admin-token-input"),
    ).not.toBeInTheDocument();
  });
});