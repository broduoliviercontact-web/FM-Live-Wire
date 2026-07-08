// @vitest-environment jsdom
// Story 6.2 — Polish UX visuel + microcopy + tokens DESIGN.md.
//
// Proves the Epic 6.2 polish invariants hold in the rendered DOM:
//   - DESIGN.md tokens are applied (PanicButton danger_fill via the destructive
//     slot, OnAirIndicator bg-on-air, MockBadge info, MidiActivityIndicator
//     bg-connected, MockByteStream MIDI tone tokens);
//   - alertes importantes carry a 3px left border in their semantic color
//     (info cyan / late amber / danger red) + an icon;
//   - JetBrains Mono is reserved to MIDI/technical data (MockByteStream,
//     LatencyStat, MonitoringPanel counters + last-event) and NOT applied to
//     general UI (the role tag);
//   - PanicButton keeps its 44px target (h-11 + min-h-11) + a stop icon;
//   - role tags PERFORMER / LISTENER + the symmetric MIDI-pas-audio intros;
//   - no gradient / glassmorphism / shadow-sm (flat "live studio" console).
//
// Component-level where possible (no socket, no real Web MIDI). The two panel
// renders mirror the existing performerPanel / listenerBackToHome setups.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Alert } from "../shared/ui/alert";
import { PanicButton } from "../features/listener/components/PanicButton";
import { MidiActivityIndicator } from "../features/listener/components/MidiActivityIndicator";
import { MockBadge } from "../features/listener/components/MockBadge";
import { MockByteStream } from "../features/listener/components/MockByteStream";
import { LatencyStat } from "../features/listener/components/LatencyStat";
import { LateAlert } from "../features/listener/components/LateAlert";
import { OutputLostAlert } from "../features/listener/components/OutputLostAlert";
import { ProtocolVersionAlert } from "../features/listener/components/ProtocolVersionAlert";
import { OnAirIndicator } from "../features/landing/components/OnAirIndicator";
import { MonitoringPanel } from "../features/performer/components/MonitoringPanel";
import { ListenerPanel } from "../features/listener";
import { PerformerPanel } from "../features/performer";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { usePerformerStore } from "../features/performer/store/performerStore";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useListenerStore.getState().reset();
  usePerformerStore.getState().reset();
  __resetMockMidiOutput();
});

// --- tokens: PanicButton --------------------------------------------------
describe("Story 6.2 — PanicButton: danger_fill + 44px + stop icon", () => {
  it("renders a stop icon, bg-destructive (danger_fill slot), h-11 + min-h-11", () => {
    render(
      <MidiAccessProvider>
        <PanicButton />
      </MidiAccessProvider>,
    );
    const btn = screen.getByTestId("listener-panic-button");
    // danger_fill is wired through the shadcn `destructive` slot (remapped to
    // #E11D2E in .dark) → the class is `bg-destructive`.
    expect(btn.className).toContain("bg-destructive");
    expect(btn.className).toContain("text-destructive-foreground");
    // 44px minimum touch target.
    expect(btn.className).toContain("h-11");
    expect(btn.className).toContain("min-h-11");
    // Stop icon (DESIGN.md `panic_button: icône stop`).
    expect(btn.querySelector("svg")).not.toBeNull();
    // The exact label is still present (icon adds no text).
    expect(btn).toHaveTextContent("Panic");
  });
});

// --- tokens: OnAirIndicator (bg-on-air replaces inline #F2A93B) -----------
describe("Story 6.2 — OnAirIndicator: bg-on-air token class", () => {
  it("uses the bg-on-air utility (not an inline style) when on air", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, uptime: 1, ownerActive: true, listeners: 1 }),
      })),
    );
    render(
      <MemoryRouter>
        <OnAirIndicator />
      </MemoryRouter>,
    );
    const indicator = await screen.findByTestId("landing-on-air-indicator");
    await waitFor(() => expect(indicator).toHaveTextContent("● On air"));
    const dot = indicator.querySelector("span[aria-hidden='true']")!;
    expect(dot.className).toContain("bg-on-air");
    // No inline backgroundColor style — the token is applied via the class.
    expect((dot as HTMLElement).style.backgroundColor).toBe("");
  });
});

// --- tokens: MockBadge (info cyan) ----------------------------------------
describe("Story 6.2 — MockBadge: info (cyan) token", () => {
  it("uses text-info (DESIGN.md Mock = info)", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockBadge />);
    const badge = screen.getByTestId("listener-mock-badge");
    expect(badge.className).toContain("text-info");
  });
});

// --- tokens: MidiActivityIndicator (bg-connected) -------------------------
describe("Story 6.2 — MidiActivityIndicator: bg-connected (noteOn = connected)", () => {
  it("uses bg-connected when active", () => {
    useListenerStore.setState({ fluxStatus: "active" });
    render(<MidiActivityIndicator />);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot.className).toContain("bg-connected");
  });
});

// --- tokens: MockByteStream MIDI tone tokens + mono -----------------------
describe("Story 6.2 — MockByteStream: MIDI tone tokens + monospace", () => {
  it("colors noteOn with text-connected and renders in font-mono", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    act(() => {
      getMockMidiOutput().send(new Uint8Array([0x90, 60, 100]), 1); // noteOn
    });
    const line = screen.getByTestId("listener-mock-byte-stream-line");
    expect(line.className).toContain("text-connected");
    // The byte list is monospace (DESIGN.md mono = data).
    const list = screen.getByTestId("listener-mock-byte-stream-list");
    expect(list.className).toContain("font-mono");
  });

  it("colors cc with text-info, program with text-on-air, pitch-bend with text-pitch-bend", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    act(() => {
      const mock = getMockMidiOutput();
      mock.send(new Uint8Array([0xb0, 7, 100]), 2); // cc
      mock.send(new Uint8Array([0xc0, 42]), 3); // program
      mock.send(new Uint8Array([0xe0, 0x00, 0x40]), 4); // pitchBend
    });
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines[0].className).toContain("text-info");
    expect(lines[1].className).toContain("text-on-air");
    expect(lines[2].className).toContain("text-pitch-bend");
  });
});

// --- alertes: 3px left border + semantic color + icon ---------------------
describe("Story 6.2 — Alert variants: 3px left border + semantic color", () => {
  it("info variant → border-l-[3px] border-l-info", () => {
    render(<Alert variant="info" data-testid="a-info">x</Alert>);
    const el = screen.getByTestId("a-info");
    expect(el.className).toContain("border-l-[3px]");
    expect(el.className).toContain("border-l-info");
  });
  it("late variant → border-l-[3px] border-l-late", () => {
    render(<Alert variant="late" data-testid="a-late">x</Alert>);
    const el = screen.getByTestId("a-late");
    expect(el.className).toContain("border-l-[3px]");
    expect(el.className).toContain("border-l-late");
  });
  it("danger variant → border-l-[3px] border-l-danger", () => {
    render(<Alert variant="danger" data-testid="a-danger">x</Alert>);
    const el = screen.getByTestId("a-danger");
    expect(el.className).toContain("border-l-[3px]");
    expect(el.className).toContain("border-l-danger");
  });
  it("destructive variant stays an alias of danger (border-l-danger)", () => {
    render(<Alert variant="destructive" data-testid="a-destr">x</Alert>);
    expect(screen.getByTestId("a-destr").className).toContain("border-l-danger");
  });

  it("OutputLostAlert → danger border + danger icon", () => {
    useListenerStore.setState({ outputLost: true });
    render(<OutputLostAlert />);
    const el = screen.getByTestId("listener-output-lost-alert");
    expect(el.className).toContain("border-l-danger");
    expect(el.querySelector("svg")).not.toBeNull();
  });

  it("ProtocolVersionAlert → danger border + icon", () => {
    useListenerStore.setState({ protocolError: true });
    render(<ProtocolVersionAlert />);
    expect(screen.getByTestId("listener-protocol-alert").className).toContain(
      "border-l-danger",
    );
  });

  it("LateAlert → late (amber) 3px left border", () => {
    useListenerStore.setState({ lateWarning: true, lastLatencyMs: 312 });
    render(<LateAlert />);
    const el = screen.getByTestId("listener-late-alert");
    expect(el.className).toContain("border-l-[3px]");
    expect(el.className).toContain("border-l-late");
    // Exact microcopy preserved ("estimée" — effective/clamped latency).
    expect(el).toHaveTextContent(
      "⚠ Flux en retard / connexion instable — latence estimée 312 ms",
    );
  });
});

// --- mono reserved to data ------------------------------------------------
describe("Story 6.2 — JetBrains Mono reserved to MIDI/technical data", () => {
  it("LatencyStat renders in font-mono (technical stat)", () => {
    useListenerStore.setState({ lateWarning: true, lastLatencyMs: 87, fallbackCount: 2, droppedCount: 1 });
    render(<LatencyStat />);
    expect(screen.getByTestId("listener-latency-stat").className).toContain(
      "font-mono",
    );
  });

  it("MonitoringPanel counters + last-event are font-mono", () => {
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-counters").className).toContain(
      "font-mono",
    );
    expect(screen.getByTestId("monitoring-last-event").className).toContain(
      "font-mono",
    );
  });
});

// --- role tags + symmetric MIDI-pas-audio intros --------------------------
describe("Story 6.2 — role tags + symmetric MIDI-pas-audio intros", () => {
  beforeEach(() => {
    // BrowserCompatGate needs a secure context + requestMIDIAccess present
    // (feature detection only — never called).
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: () => Promise.resolve({}),
      configurable: true,
      writable: true,
    });
  });

  it("listener: LISTENER tag + MIDI-pas-audio intro", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("listener-role-tag")).toHaveTextContent("LISTENER");
    expect(
      screen.getByText(
        "Vous recevez des événements MIDI en direct. Votre synthé FM génère le son.",
      ),
    ).toBeInTheDocument();
    // The role tag is general UI → NOT monospace.
    expect(screen.getByTestId("listener-role-tag").className).not.toContain(
      "font-mono",
    );
  });

  it("performer: PERFORMER tag + symmetric MIDI-pas-audio intro", () => {
    vi.mock("socket.io-client", () => ({
      io: () => ({
        on: () => {},
        off: () => {},
        disconnect: () => {},
        connect: () => {},
        emit: () => {},
      }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, listeners: 0 }),
      })),
    );
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <PerformerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("performer-role-tag")).toHaveTextContent("PERFORMER");
    expect(
      screen.getByText(
        "Vous diffusez des événements MIDI en direct — l'audio n'est jamais streamé, le son naît chez chaque listener sur son propre synthé.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("performer-role-tag").className).not.toContain(
      "font-mono",
    );
  });
});

// --- flat "live studio" console: no gradient / glassmorphism / shadow-sm --
describe("Story 6.2 — no gradient / glassmorphism / hero marketing", () => {
  beforeEach(() => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: () => Promise.resolve({}),
      configurable: true,
      writable: true,
    });
  });

  it("listener panel has no shadow-sm / gradient / backdrop-blur class", () => {
    render(
      <MemoryRouter>
        <MidiAccessProvider>
          <ListenerPanel />
        </MidiAccessProvider>
      </MemoryRouter>,
    );
    expect(document.querySelector('[class*="shadow-sm"]')).toBeNull();
    expect(document.querySelector('[class*="bg-gradient"]')).toBeNull();
    expect(document.querySelector('[class*="backdrop-blur"]')).toBeNull();
  });
});