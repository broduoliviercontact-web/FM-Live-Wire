// @vitest-environment jsdom
// Story 3.1 — PerformerPanel integration tests (the /performer flow).
//
// socket.io-client is MOCKED — no real network connection is opened. A fake
// socket records the `io()` options (auth + reconnection) and lets the test
// fire `connect` / `connect_error` to drive the state machine.
//
// Proves:
//   - the PERFORMER role tag renders.
//   - BrowserCompatGate blocks the flow on an incompatible (insecure) jsdom
//     context: the terminal "Web MIDI nécessite HTTPS" shows and the token form
//     is absent.
//   - on a compatible context, submitting the token calls `io()` exactly once
//     with `auth: { role: "performer", token }` and `reconnection: false`.
//   - `performerId` is never sent (auth carries only role + token).
//   - connect_error "invalid" → Alert "Admin token invalide." (E8), socket
//     disconnected, no technical detail / token echoed.
//   - connect_error "performer:busy" → terminal alert, link back to "/", NO
//     automatic retry (`io()` called once, no reconnect).
//   - connect → "Connecté".
//   - the token never reaches the URL.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PerformerPanel } from "../features/performer";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";

// vi.hoisted so the mock factory (hoisted above imports) can reference these
// without TDZ. The fake socket captures listeners + disconnect count; the
// `io()` mock records its options + call count.
const { lastConnect, FakeSocket } = vi.hoisted(() => {
  class FakeSocket {
    listeners: Record<string, Array<(arg?: unknown) => void>> = {};
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
    emit(ev: string, arg?: unknown): void {
      (this.listeners[ev] ??= []).forEach((cb) => cb(arg));
    }
  }
  const lastConnect = {
    calls: 0,
    opts: undefined as unknown,
    socket: undefined as FakeSocket | undefined,
  };
  return { lastConnect, FakeSocket };
});

vi.mock("socket.io-client", () => ({
  io: (uriOrOpts: unknown, opts?: unknown) => {
    lastConnect.calls += 1;
    // `io(opts)` (same-origin) vs `io(uri, opts)` — capture the options bag.
    lastConnect.opts = opts ?? uriOrOpts;
    const socket = new FakeSocket();
    lastConnect.socket = socket;
    return socket;
  },
}));

const TOKEN = "topsecret-OWNER-token-3.1";

function setCompat({ secure, midi }: { secure: boolean; midi: boolean }) {
  Object.defineProperty(window, "isSecureContext", {
    value: secure,
    configurable: true,
  });
  if (midi) {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: () => Promise.resolve({}),
      configurable: true,
      writable: true,
    });
  } else {
    try {
      delete (navigator as unknown as Record<string, unknown>)
        .requestMIDIAccess;
    } catch {
      /* already absent */
    }
  }
}

beforeEach(() => {
  lastConnect.calls = 0;
  lastConnect.opts = undefined;
  lastConnect.socket = undefined;
  // Story 3.5 — `onConnect` now fetches `/health` for the listener count; stub
  // it so no real network is opened in jsdom.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, listeners: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  setCompat({ secure: false, midi: false });
});

function submitToken() {
  fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
    target: { value: TOKEN },
  });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
}

describe("PerformerPanel — role tag + BrowserCompatGate integration", () => {
  it("renders the PERFORMER role tag", () => {
    setCompat({ secure: false, midi: false });
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("PERFORMER")).toBeInTheDocument();
  });

  it("blocks the flow on an insecure context: 'Web MIDI nécessite HTTPS' shown, no token form", () => {
    setCompat({ secure: false, midi: true });
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Web MIDI nécessite HTTPS")).toBeInTheDocument();
    expect(screen.queryByText("admin token")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Se connecter" })).not.toBeInTheDocument();
  });
});

describe("PerformerPanel — Socket.IO connection auth (AD-10, AD-15)", () => {
  beforeEach(() => setCompat({ secure: true, midi: true }));

  it("submits the token → io() called once with auth {role:'performer', token} + reconnection:true + backoff", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    expect(lastConnect.calls).toBe(1);
    const opts = lastConnect.opts as {
      auth: { role: string; token: string };
      reconnection: boolean;
      reconnectionAttempts: number;
      reconnectionDelay: number;
      reconnectionDelayMax: number;
    };
    // Story 3.5: reconnection enabled (backoff recovers network drops after a
    // successful connect); terminal handshake errors stop the loop themselves.
    expect(opts.reconnection).toBe(true);
    expect(opts.reconnectionAttempts).toBeGreaterThan(0);
    expect(opts.reconnectionDelay).toBeGreaterThan(0);
    expect(opts.reconnectionDelayMax).toBeGreaterThanOrEqual(opts.reconnectionDelay);
    expect(opts.auth).toEqual({ role: "performer", token: TOKEN });
  });

  it("never sends performerId in auth (client-supplied identity is forbidden)", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    const opts = lastConnect.opts as { auth: Record<string, unknown> };
    expect(opts.auth).not.toHaveProperty("performerId");
    expect(Object.keys(opts.auth).sort()).toEqual(["role", "token"]);
  });

  it("token never reaches the URL after a connection attempt", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
  });
});

describe("PerformerPanel — connect_error mapping (E8 / E9)", () => {
  beforeEach(() => setCompat({ secure: true, midi: true }));

  it("'invalid' → Alert 'Admin token invalide.', socket disconnected, no token echoed", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    const socket = lastConnect.socket!;
    act(() => {
      socket.emit("connect_error", { message: "invalid" });
    });
    expect(screen.getByText("Admin token invalide.")).toBeInTheDocument();
    expect(screen.queryByTestId("performer-admin-token-input")).not.toBeInTheDocument();
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    expect(socket.disconnectCount).toBeGreaterThanOrEqual(1);
  });

  it("'performer:busy' → terminal alert + link to '/', NO automatic retry", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    const socket = lastConnect.socket!;
    act(() => {
      socket.emit("connect_error", { message: "performer:busy" });
    });
    expect(
      screen.getByText(
        "Un performer est déjà connecté. Attendez la fin de sa session.",
      ),
    ).toBeInTheDocument();
    // Terminal: a back link to "/" is present.
    const backLink = screen.getByTestId("performer-busy-back-link");
    expect(backLink).toHaveAttribute("href", "/");
    // No retry: the form is gone and io() was called exactly once (no reconnect).
    expect(screen.queryByRole("button", { name: "Se connecter" })).not.toBeInTheDocument();
    expect(lastConnect.calls).toBe(1);
    expect(socket.disconnectCount).toBeGreaterThanOrEqual(1);
  });

  it("other error → sober generic Alert (no technical detail, no token)", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    act(() => {
      lastConnect.socket!.emit("connect_error", { message: "transport close" });
    });
    expect(screen.getByText("Connexion impossible.")).toBeInTheDocument();
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    expect(screen.queryByText("transport close")).not.toBeInTheDocument();
  });
});

describe("PerformerPanel — connect success", () => {
  beforeEach(() => setCompat({ secure: true, midi: true }));

  it("'connect' → connected branch rendered (no MIDI capture in this story)", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    submitToken();
    act(() => {
      lastConnect.socket!.emit("connect");
    });
    // The connected branch shows the "Connecté" alert + the Story 3.5 indicator.
    expect(screen.getByTestId("performer-connected-alert")).toBeInTheDocument();
    expect(screen.getByTestId("connection-pill")).toHaveTextContent("Connecté");
  });
});