// @vitest-environment jsdom
// CC rate-limiter / coalescer — UI tests for `CcModeSelector` + `CcDebugStats`.
//
// `CcModeSelector` mirrors `ChannelSelector` (accessible `radiogroup`, UX-DR25):
//   - renders nothing before MIDI access is granted;
//   - renders 3 buttons (Raw / Smooth / Safe) after access;
//   - Smooth is selected by default (`aria-checked`, roving tabindex, check icon);
//   - clicking Safe / Raw calls `setListenerCcMode` (flush coalescer + set store);
//   - arrow / Home / End keys move the selection + focus;
//   - the EXACT tooltip text is present in the DOM.
//
// `CcDebugStats` is DEBUG-ONLY: rendered by `listener/index.tsx` ONLY under
// `?debugTiming=1` (mirrors the timing-CSV export button). The full `ListenerPanel`
// is rendered with debug toggled via `__setTimingDebugEnabledForTest` to prove the
// gating (absent by default, present when debug is on).
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
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { MidiPermissionButton } from "../features/listener/components/MidiPermissionButton";
import { CcModeSelector } from "../features/listener/components/CcModeSelector";
import { CcDebugStats } from "../features/listener/components/CcDebugStats";
import { ListenerPage } from "../app/pages/ListenerPage";
import { useListenerStore } from "../features/listener/store/listenerStore";
import {
  isTimingDebugEnabled,
  __setTimingDebugEnabledForTest,
} from "../lib/timing-debug";

const TOOLTIP =
  "Limite le débit CC (filter cutoff, modwheel…) pour ne pas saturer le synthé. Smooth 60 Hz, Safe 30 Hz, Raw aucun lissage.";

const midiSpy = vi.fn(async () => {
  return {
    inputs: new Map(),
    outputs: new Map(),
    sysexEnabled: false,
    onstatechange: null,
  } as unknown as MIDIAccess;
});

function renderSelector() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <CcModeSelector />
    </MidiAccessProvider>,
  );
}

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-cc-mode-selector")).toBeInTheDocument(),
  );
}

function compatBrowser() {
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiSpy,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  midiSpy.mockClear();
  useListenerStore.getState().reset();
  __setTimingDebugEnabledForTest(false);
  compatBrowser();
});

afterEach(() => {
  cleanup();
  __setTimingDebugEnabledForTest(false);
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

// --- CcModeSelector — render gating + defaults -------------------------------

describe("CcModeSelector (listener) — render gating", () => {
  it("renders nothing before MIDI access is granted", () => {
    renderSelector();
    expect(screen.queryByTestId("listener-cc-mode-selector")).not.toBeInTheDocument();
  });
});

describe("CcModeSelector (listener) — 3 buttons, Smooth default, store wiring", () => {
  it("renders 3 buttons Raw / Smooth / Safe after access is granted", async () => {
    renderSelector();
    await grant();
    expect(screen.getByTestId("listener-cc-mode-button-raw")).toHaveTextContent("Raw");
    expect(screen.getByTestId("listener-cc-mode-button-smooth")).toHaveTextContent("Smooth");
    expect(screen.getByTestId("listener-cc-mode-button-safe")).toHaveTextContent("Safe");
  });

  it("Smooth is selected by default (store ccMode === smooth) — aria-checked + tabindex + check", async () => {
    renderSelector();
    await grant();
    expect(useListenerStore.getState().ccMode).toBe("smooth");
    expect(screen.getByTestId("listener-cc-mode-selected")).toHaveTextContent("Smooth");
    expect(screen.getByTestId("listener-cc-mode-button-smooth")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("listener-cc-mode-button-raw")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // Roving tabindex: only the active radio is tabbable.
    expect(screen.getByTestId("listener-cc-mode-button-smooth")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("listener-cc-mode-button-raw")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    // Visible check icon on the active radio (not color-only).
    const check = screen
      .getByTestId("listener-cc-mode-button-smooth")
      .querySelector("svg");
    expect(check).not.toBeNull();
    expect(check).toHaveAttribute("aria-hidden", "true");
    const inactiveCheck = screen
      .getByTestId("listener-cc-mode-button-raw")
      .querySelector("svg");
    expect(inactiveCheck).toBeNull();
  });

  it("clicking Safe sets the store ccMode to safe (orchestrator flush + setCcMode)", async () => {
    renderSelector();
    await grant();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-cc-mode-button-safe"));
    });
    expect(useListenerStore.getState().ccMode).toBe("safe");
    expect(screen.getByTestId("listener-cc-mode-selected")).toHaveTextContent("Safe");
    expect(screen.getByTestId("listener-cc-mode-button-safe")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Roving tabindex moved with the selection.
    expect(screen.getByTestId("listener-cc-mode-button-safe")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("listener-cc-mode-button-smooth")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("clicking Raw sets the store ccMode to raw", async () => {
    renderSelector();
    await grant();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-cc-mode-button-raw"));
    });
    expect(useListenerStore.getState().ccMode).toBe("raw");
    expect(screen.getByTestId("listener-cc-mode-selected")).toHaveTextContent("Raw");
  });

  it("the preference persists across store resetFlux (lives in INITIAL, not FLUX_IDLE)", async () => {
    // Mirrors `channel`: ccMode is a PREFERENCE, not session telemetry.
    renderSelector();
    await grant();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-cc-mode-button-safe"));
    });
    expect(useListenerStore.getState().ccMode).toBe("safe");
    useListenerStore.getState().resetFlux();
    expect(useListenerStore.getState().ccMode).toBe("safe"); // persisted
    // Counters reset on resetFlux (session telemetry):
    expect(useListenerStore.getState().ccReceived).toBe(0);
    expect(useListenerStore.getState().ccSent).toBe(0);
    expect(useListenerStore.getState().ccCoalesced).toBe(0);
  });
});

// --- CcModeSelector — exact tooltip + accessible radiogroup -------------------

describe("CcModeSelector (listener) — tooltip + accessible radiogroup", () => {
  it("renders the EXACT tooltip text (testable) + native title on the label", async () => {
    renderSelector();
    await grant();
    expect(screen.getByTestId("listener-cc-mode-tooltip")).toHaveTextContent(TOOLTIP);
    expect(screen.getByTestId("listener-cc-mode-label")).toHaveAttribute("title", TOOLTIP);
  });

  it("the row is role=radiogroup labelled by the visible label", async () => {
    renderSelector();
    await grant();
    const group = screen.getByTestId("listener-cc-mode-selector");
    expect(group).toHaveAttribute("role", "radiogroup");
    expect(group).toHaveAttribute("aria-labelledby", "listener-cc-mode-label");
    expect(screen.getByTestId("listener-cc-mode-label")).toHaveAttribute(
      "id",
      "listener-cc-mode-label",
    );
  });

  it("the 3 buttons are role=radio with aria-label « Mode CC X »", async () => {
    renderSelector();
    await grant();
    for (const m of ["raw", "smooth", "safe"] as const) {
      const radio = screen.getByTestId(`listener-cc-mode-button-${m}`);
      expect(radio).toHaveAttribute("role", "radio");
      expect(radio).toHaveAttribute("aria-label", `Mode CC ${m === "raw" ? "Raw" : m === "smooth" ? "Smooth" : "Safe"}`);
    }
  });
});

// --- CcModeSelector — keyboard navigation (roving tabindex) ------------------

describe("CcModeSelector (listener) — keyboard navigation", () => {
  it("ArrowRight on Smooth advances the selection + focus to Safe", async () => {
    renderSelector();
    await grant();
    const smooth = screen.getByTestId("listener-cc-mode-button-smooth");
    smooth.focus();
    expect(document.activeElement).toBe(smooth);
    await act(async () => {
      fireEvent.keyDown(smooth, { key: "ArrowRight" });
    });
    expect(useListenerStore.getState().ccMode).toBe("safe");
    expect(screen.getByTestId("listener-cc-mode-button-safe")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-cc-mode-button-safe"),
    );
  });

  it("ArrowLeft on Smooth recedes the selection + focus to Raw", async () => {
    renderSelector();
    await grant();
    const smooth = screen.getByTestId("listener-cc-mode-button-smooth");
    smooth.focus();
    await act(async () => {
      fireEvent.keyDown(smooth, { key: "ArrowLeft" });
    });
    expect(useListenerStore.getState().ccMode).toBe("raw");
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-cc-mode-button-raw"),
    );
  });

  it("ArrowRight from Safe clamps to Safe (no escape); ArrowLeft from Raw clamps to Raw", async () => {
    renderSelector();
    await grant();
    // Move to Safe first.
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-cc-mode-button-safe"));
    });
    const safe = screen.getByTestId("listener-cc-mode-button-safe");
    safe.focus();
    await act(async () => {
      fireEvent.keyDown(safe, { key: "ArrowRight" });
    });
    expect(useListenerStore.getState().ccMode).toBe("safe"); // clamped
    // Move to Raw.
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-cc-mode-button-raw"));
    });
    const raw = screen.getByTestId("listener-cc-mode-button-raw");
    raw.focus();
    await act(async () => {
      fireEvent.keyDown(raw, { key: "ArrowLeft" });
    });
    expect(useListenerStore.getState().ccMode).toBe("raw"); // clamped
  });

  it("Home jumps to Raw; End jumps to Safe", async () => {
    renderSelector();
    await grant();
    const smooth = screen.getByTestId("listener-cc-mode-button-smooth");
    smooth.focus();
    await act(async () => {
      fireEvent.keyDown(smooth, { key: "End" });
    });
    expect(useListenerStore.getState().ccMode).toBe("safe");
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-cc-mode-button-safe"),
    );
    const safe = screen.getByTestId("listener-cc-mode-button-safe");
    await act(async () => {
      fireEvent.keyDown(safe, { key: "Home" });
    });
    expect(useListenerStore.getState().ccMode).toBe("raw");
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-cc-mode-button-raw"),
    );
  });
});

// --- CcDebugStats — unit (renders the 3 spans) -------------------------------

describe("CcDebugStats (listener) — renders the 3 CC counters", () => {
  it("renders received / sent / coalesced spans reading the store", () => {
    useListenerStore.setState({
      ccReceived: 120,
      ccSent: 30,
      ccCoalesced: 89,
    });
    render(<CcDebugStats />);
    expect(screen.getByTestId("listener-cc-debug-stats")).toBeInTheDocument();
    expect(screen.getByTestId("listener-cc-stat-received")).toHaveTextContent("CC reçus : 120");
    expect(screen.getByTestId("listener-cc-stat-sent")).toHaveTextContent("CC envoyés : 30");
    expect(screen.getByTestId("listener-cc-stat-coalesced")).toHaveTextContent("CC coalescés : 89");
  });

  it("defaults to 0 / 0 / 0 on a fresh store", () => {
    render(<CcDebugStats />);
    expect(screen.getByTestId("listener-cc-stat-received")).toHaveTextContent("CC reçus : 0");
    expect(screen.getByTestId("listener-cc-stat-sent")).toHaveTextContent("CC envoyés : 0");
    expect(screen.getByTestId("listener-cc-stat-coalesced")).toHaveTextContent("CC coalescés : 0");
  });
});

// --- CcDebugStats — debug-only gating in the full ListenerPanel --------------

describe("CcDebugStats (listener) — rendered ONLY under ?debugTiming=1 (full panel)", () => {
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/listener"]}>
        <MidiAccessProvider>
          <ListenerPage />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
  }

  it("is ABSENT by default (jsdom location.search has no ?debugTiming=1)", () => {
    expect(isTimingDebugEnabled()).toBe(false);
    renderPage();
    expect(screen.queryByTestId("listener-cc-debug-stats")).not.toBeInTheDocument();
    expect(screen.queryByTestId("listener-cc-stat-received")).not.toBeInTheDocument();
  });

  it("is PRESENT when debug timing is enabled", () => {
    __setTimingDebugEnabledForTest(true);
    expect(isTimingDebugEnabled()).toBe(true);
    renderPage();
    expect(screen.getByTestId("listener-cc-debug-stats")).toBeInTheDocument();
    expect(screen.getByTestId("listener-cc-stat-received")).toBeInTheDocument();
    expect(screen.getByTestId("listener-cc-stat-sent")).toBeInTheDocument();
    expect(screen.getByTestId("listener-cc-stat-coalesced")).toBeInTheDocument();
  });
});