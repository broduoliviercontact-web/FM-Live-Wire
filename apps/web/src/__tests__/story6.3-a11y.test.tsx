// @vitest-environment jsdom
// Story 6.3 — automated a11y audit (UX-DR24–28, AC-U18–AC-U20).
//
// Three surfaces are audited with axe-core (via `jest-axe`): `/` (landing),
// `/listener` and `/performer`. The run disables the `color-contrast` rule —
// jsdom cannot compute contrast from Tailwind classes (no CSS is loaded in the
// test env), and contrast is proven deterministically on the DESIGN.md hex
// tokens in `contrast.test.ts`. The gate is the story's "zéro violation
// critique/serious" bar: any `critical` or `serious` axe violation fails.
//
// Also covers the focused a11y contract in one place:
//   - StatusPill carries `aria-live="polite"` (AC-U20);
//   - LateAlert / OutputLostAlert / ProtocolVersionAlert use `role="alert"`
//     (assertive live — no double `aria-live`, per UX-DR27);
//   - MockByteStream + MonitoringPanel raw MIDI are `aria-live="off"` (excluded
//     from live announcements — UX-DR28);
//   - `prefers-reduced-motion: reduce` disables the OnAirIndicator pulse and the
//     MidiActivityIndicator pulse, while the late warning stays visible (AC-U19);
//   - PanicButton's stop icon + ForcePanicButton's warn icon are decorative
//     (`aria-hidden`), the visible text stays the accessible name;
//   - focus-ring utility is wired (`ring-ring` = on_air) so the focus indicator
//     is visible and consistent.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "jest-axe";
import { LandingPanel } from "../features/landing";
import { ListenerPanel } from "../features/listener";
import { PerformerPanel } from "../features/performer";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { usePerformerStore } from "../features/performer/store/performerStore";
import { OnAirIndicator } from "../features/landing/components/OnAirIndicator";
import { MidiActivityIndicator } from "../features/listener/components/MidiActivityIndicator";
import { LateAlert } from "../features/listener/components/LateAlert";
import { MockByteStream } from "../features/listener/components/MockByteStream";
import { MonitoringPanel } from "../features/performer/components/MonitoringPanel";
import { PanicButton } from "../features/listener/components/PanicButton";
import { ForcePanicButton } from "../features/listener/components/ForcePanicButton";
import {
  MOCK_OUTPUT_ID,
  __resetMockMidiOutput,
} from "../features/listener/lib/mock-output";

// socket.io-client is MOCKED at the module level (hoisted) — no real network
// connection is opened. The performer panel imports `api/socket` which imports
// `socket.io-client`; the listener imports `leaveListenerForNavigation` from
// `connection.ts` (same dep). The mock is inert (no `io()` call at render).
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => {},
    off: () => {},
    disconnect: () => {},
    connect: () => {},
    emit: () => {},
  }),
}));

// jsdom has no computed CSS — color-contrast is covered separately in
// `contrast.test.ts` on the raw hex tokens.
const AXE_CONFIG = {
  rules: {
    "color-contrast": { enabled: false },
  },
};

/** Fails if axe finds any `critical` or `serious` violation (the story bar). */
async function expectNoCriticalViolations(container: HTMLElement): Promise<void> {
  const results = (await axe(container, AXE_CONFIG)) as Awaited<ReturnType<typeof axe>>;
  const critical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (critical.length > 0) {
    throw new Error(
      "axe critical/serious violations:\n" +
        critical
          .map(
            (v) =>
              `  • [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`,
          )
          .join("\n"),
    );
  }
}

const midiSpy = vi.fn(async () => {
  return {
    inputs: new Map(),
    outputs: new Map(),
    sysexEnabled: false,
    onstatechange: null,
  } as unknown as MIDIAccess;
});

function setReducedMotion(reduced: boolean): void {
  const mq = {
    matches: reduced,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(() => mq),
    configurable: true,
    writable: true,
  });
}

function mockFetchHealth(active: boolean, listeners = 0): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1, ownerActive: active, listeners }),
    })),
  );
}

beforeEach(() => {
  midiSpy.mockClear();
  useListenerStore.getState().reset();
  usePerformerStore.getState().reset();
  __resetMockMidiOutput();
  setReducedMotion(false);
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiSpy,
    configurable: true,
    writable: true,
  });
  // Mirror the prod `<html lang="fr">` + `<title>` (fixed in index.html for
  // Story 6.3) so the axe page-level rules (html-has-lang, document-title) are
  // satisfied in jsdom — they evaluate against the document, not the container.
  document.documentElement.lang = "fr";
  document.title = "FM Live Wire";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } catch {
    /* already absent */
  }
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

// ===========================================================================
// AC-U20 / UX-DR24–28 — axe audit on the three surfaces (zero critical/serious).
// ===========================================================================
describe("Story 6.3 — axe audit (zero critical/serious violations)", () => {
  it("/ (landing) has no critical/serious axe violation", async () => {
    mockFetchHealth(true);
    const { container } = render(
      <MemoryRouter>
        <LandingPanel />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("landing-on-air-indicator")).toBeInTheDocument(),
    );
    await expectNoCriticalViolations(container);
  });

  it("/listener has no critical/serious axe violation (MIDI granted, channel grid shown)", async () => {
    mockFetchHealth(true);
    const { container } = render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    // Grant MIDI access so the ChannelSelector radiogroup is exercised too.
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-channel-selector")).toBeInTheDocument(),
    );
    await expectNoCriticalViolations(container);
  });

  it("/performer has no critical/serious axe violation (idle, token form shown)", async () => {
    mockFetchHealth(true);
    const { container } = render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    await expectNoCriticalViolations(container);
  });
});

// ===========================================================================
// AC-U20 / UX-DR27 — aria-live on state regions.
// ===========================================================================
describe("Story 6.3 — aria-live on state regions (AC-U20, UX-DR27)", () => {
  it("StatusPill carries aria-live=polite + aria-atomic=true", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveAttribute("aria-live", "polite");
    expect(pill).toHaveAttribute("aria-atomic", "true");
  });

  it("LateAlert uses role=alert (assertive live) — no redundant aria-live", () => {
    useListenerStore.setState({ lateWarning: true, lastLatencyMs: 312 });
    render(<LateAlert />);
    const el = screen.getByTestId("listener-late-alert");
    expect(el).toHaveAttribute("role", "alert");
    // role=alert implies aria-live=assertive; we deliberately do NOT add a
    // second aria-live attribute (would double-announce).
    expect(el).not.toHaveAttribute("aria-live");
  });

  it("OutputLostAlert uses role=alert (assertive live)", () => {
    useListenerStore.setState({ outputLost: true });
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("listener-output-lost-alert")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("ProtocolVersionAlert uses role=alert (assertive live)", () => {
    useListenerStore.setState({ protocolError: true });
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("listener-protocol-alert")).toHaveAttribute(
      "role",
      "alert",
    );
  });
});

// ===========================================================================
// UX-DR28 — raw MIDI streams excluded from aria-live.
// ===========================================================================
describe("Story 6.3 — raw MIDI streams are NOT aria-live (UX-DR28)", () => {
  it("MockByteStream is aria-live=off (explicit exclusion)", () => {
    useListenerStore.setState({ selectedOutputId: MOCK_OUTPUT_ID });
    render(<MockByteStream />);
    const stream = screen.getByTestId("listener-mock-byte-stream");
    expect(stream).toHaveAttribute("aria-live", "off");
    expect(
      stream.querySelector('[aria-live="polite"], [aria-live="assertive"]'),
    ).toBeNull();
  });

  it("MonitoringPanel last-event + counters are aria-live=off", () => {
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-last-event")).toHaveAttribute(
      "aria-live",
      "off",
    );
    expect(screen.getByTestId("monitoring-counters")).toHaveAttribute(
      "aria-live",
      "off",
    );
  });
});

// ===========================================================================
// AC-U19 / UX-DR26 — reduced-motion disables pulses, late warning stays.
// ===========================================================================
describe("Story 6.3 — reduced-motion disables pulses, late warning visible (AC-U19)", () => {
  it("OnAirIndicator: reduced-motion → no animate-pulse-on-air + data-reduced-motion=true", async () => {
    setReducedMotion(true);
    mockFetchHealth(true);
    render(
      <MemoryRouter>
        <OnAirIndicator />
      </MemoryRouter>,
    );
    const ind = await screen.findByTestId("landing-on-air-indicator");
    await waitFor(() => expect(ind).toHaveTextContent("● On air"));
    const dot = ind.querySelector("span[aria-hidden='true']")!;
    expect(dot.className).not.toContain("animate-pulse-on-air");
    expect(ind).toHaveAttribute("data-reduced-motion", "true");
  });

  it("MidiActivityIndicator: reduced-motion → no animate-pulse + data-reduced-motion=true", () => {
    setReducedMotion(true);
    useListenerStore.getState().setFluxStatus("active");
    render(<MidiActivityIndicator />);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-reduced-motion", "true");
    expect(dot.className).not.toContain("animate-pulse");
  });

  it("LateAlert stays visible under reduced-motion (no animation dependency)", () => {
    setReducedMotion(true);
    useListenerStore.setState({ lateWarning: true, lastLatencyMs: 88 });
    render(<LateAlert />);
    expect(screen.getByTestId("listener-late-alert")).toHaveTextContent(
      "⚠ Flux en retard / connexion instable — latence estimée 88 ms",
    );
  });
});

// ===========================================================================
// UX-DR25 / Panic — decorative icons + visible focus on critical controls.
// ===========================================================================
describe("Story 6.3 — Panic icons decorative + focus (UX-DR25)", () => {
  it("PanicButton: the stop icon is aria-hidden, visible text is the accessible name, never disabled", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PanicButton />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    const btn = screen.getByTestId("listener-panic-button");
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // Visible text stays the accessible name.
    expect(btn).toHaveTextContent("Panic");
    expect(btn).not.toBeDisabled();
    // Focus-ring utility is wired (ring = on_air in .dark).
    expect(btn.className).toContain("focus-visible:ring-ring");
  });

  it("ForcePanicButton: the warn icon is aria-hidden, visible text is the accessible name", () => {
    // Mock output selected → button enabled (opt-in control).
    useListenerStore.setState({ selectedOutputId: MOCK_OUTPUT_ID });
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ForcePanicButton />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    const btn = screen.getByTestId("listener-force-panic-button");
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(btn).toHaveTextContent("Force Panic");
  });
});

// ===========================================================================
// AC-U18 / UX-DR25 — keyboard focus visible + tab order is the guided flow.
// ===========================================================================
describe("Story 6.3 — keyboard focus visible + tab order (AC-U18)", () => {
  it("the ChannelSelector radios carry a visible on_air focus ring (focus-visible:ring-ring)", async () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-channel-button-1")).toBeInTheDocument(),
    );
    const radio = screen.getByTestId("listener-channel-button-1");
    expect(radio.className).toContain("focus-visible:ring-ring");
    expect(radio.className).toContain("focus-visible:ring-offset-2");
  });

  it("only the active radio is in the tab order (roving tabindex), so tab follows the guided flow", async () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-channel-selector")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("listener-channel-button-1")).toHaveAttribute(
      "tabindex",
      "0",
    );
    for (let n = 2; n <= 16; n++) {
      expect(screen.getByTestId(`listener-channel-button-${n}`)).toHaveAttribute(
        "tabindex",
        "-1",
      );
    }
  });

  it("no interactive control is abusively disabled on /listener (only ForcePanic opt-in without output)", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    // Panic is the escape hatch — never disabled.
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
    // ForcePanic is the only opt-in disabled-without-output control (validated 5.3).
    expect(screen.getByTestId("listener-force-panic-button")).toBeDisabled();
  });
});