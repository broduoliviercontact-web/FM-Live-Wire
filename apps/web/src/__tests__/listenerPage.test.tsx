// @vitest-environment jsdom
// Story 4.1 — `/listener` page integration tests.
//
// Renders the real `ListenerPage` (route binding) → `ListenerPanel` (feature
// root) under a compatible browser (secure context + Web MIDI present) and the
// global `MidiAccessProvider`. Proves:
//   - the role tag `LISTENER` is present;
//   - the intro panel renders the EXACT required text;
//   - on a compatible browser the permission button ("Connecter MIDI") is
//     reachable (the gate did not block);
//   - `requestMIDIAccess` is NOT called at load (the page mounts without
//     triggering any MIDI prompt).
//
// No `SocketProvider` is mounted: the listener page must not need a socket for
// this story (no `room:join` / `midi:event` reception until 4.3).
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { ListenerPage } from "../app/pages/ListenerPage";
import { useListenerStore } from "../features/listener/store/listenerStore";

const EXACT_INTRO =
  "Vous recevez des événements MIDI en direct. Votre synthé FM génère le son.";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/listener"]}>
      <MidiAccessProvider>
        <ListenerPage />
      </MidiAccessProvider>
    </MemoryRouter>,
  );
}

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
});

describe("ListenerPage — role tag + intro (compatible browser)", () => {
  it("renders the LISTENER role tag", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: vi.fn(() => Promise.resolve({})),
      configurable: true,
      writable: true,
    });
    renderPage();
    expect(screen.getByTestId("listener-role-tag")).toHaveTextContent(
      "LISTENER",
    );
  });

  it("renders the EXACT intro text", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: vi.fn(() => Promise.resolve({})),
      configurable: true,
      writable: true,
    });
    renderPage();
    expect(screen.getByText(EXACT_INTRO)).toBeInTheDocument();
  });

  it("reaches the permission button on a compatible browser (gate did not block)", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: vi.fn(() => Promise.resolve({})),
      configurable: true,
      writable: true,
    });
    renderPage();
    expect(
      screen.getByTestId("listener-midi-permission-button"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("listener-compat-insecure"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("listener-compat-no-webmidi"),
    ).not.toBeInTheDocument();
  });

  it("does NOT call requestMIDIAccess at load (no prompt on mount)", () => {
    const spy = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: spy,
      configurable: true,
      writable: true,
    });
    renderPage();
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---- Story 4.2 — page integration after MIDI access is granted -------------

// A proper home-typed mock (with inputs/outputs Maps + onstatechange) so the
// provider can snapshot after a grant without crashing.
function makeAccess() {
  return {
    inputs: new Map(),
    outputs: new Map(),
    sysexEnabled: false,
    onstatechange: null,
  } as unknown as MIDIAccess;
}

describe("ListenerPage — Story 4.2 (after MIDI access is granted)", () => {
  beforeEach(() => {
    useListenerStore.getState().reset();
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: vi.fn(async () => makeAccess()),
      configurable: true,
      writable: true,
    });
  });

  it("shows the output picker + ChannelSelector after permission is granted", async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
    );
    // Output picker present (empty state since the mock has no outputs).
    expect(screen.getByTestId("listener-output-empty-alert")).toBeInTheDocument();
    // Channel selector present with default channel 1 (data 0).
    expect(screen.getByTestId("listener-channel-selector")).toBeInTheDocument();
    expect(screen.getByTestId("listener-channel-selected")).toHaveTextContent("1");
  });

  it("renders the « Rejoindre le flux » button, disabled with the hint (no output selected)", async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
    );
    // Story 4.3 — the JoinButton is now present. With no output selected (the
    // page mock has no outputs), it is disabled with the AC-U3 hint. No
    // `room:join` is emitted in this state (JoinButton self-gates on the
    // selection; socket.io-client is not even imported by the page wiring).
    const btn = screen.getByTestId("listener-join-button") as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Rejoindre le flux");
    expect(screen.getByTestId("listener-join-hint")).toHaveTextContent(
      "Choisissez une sortie MIDI pour rejoindre.",
    );
  });

  it("mounts no SocketProvider / no socket wiring at the page level", async () => {
    // The page does not mount a SocketProvider; JoinButton owns the listener
    // socket lazily on join. Before joining, nothing references a socket state.
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
    );
    // No socket-driven UI (no connection pill, etc.) before joining.
    expect(screen.queryByTestId("connection-pill")).not.toBeInTheDocument();
  });
});