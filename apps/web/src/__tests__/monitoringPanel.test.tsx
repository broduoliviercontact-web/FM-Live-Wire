// @vitest-environment jsdom
// Story 3.4 — MonitoringPanel + RateLimitAlert component tests.
//
// Proves: "Diffusion active" pill, the permanent MIDI-not-audio reminder, the
// SysEx-filtered note, pluralised counters via `Intl.PluralRules('fr-FR')`,
// the last-event mono line for all 5 types (CH 1–16), and the E12 rate-limit
// alert (shown only when rate-limited, with the exact message).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MonitoringPanel } from "../features/performer/components/MonitoringPanel";
import { RateLimitAlert } from "../features/performer/components/RateLimitAlert";
import { usePerformerStore } from "../features/performer/store/performerStore";
import type { MidiEvent } from "../entities/MidiEvent";

function ev(over: Partial<MidiEvent>): MidiEvent {
  return {
    v: 1,
    roomId: "fm-live-wire:main",
    seq: 1,
    ts: 1,
    channel: 0,
    ...over,
  } as MidiEvent;
}

beforeEach(() => {
  usePerformerStore.getState().reset();
});
afterEach(() => {
  cleanup();
});

describe("MonitoringPanel — permanent content", () => {
  it("shows the 'Diffusion active' status pill", () => {
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-status-pill")).toHaveTextContent(
      "Diffusion active",
    );
  });

  it("shows the permanent MIDI-not-audio reminder", () => {
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-midi-note")).toHaveTextContent(
      "Seul le MIDI est diffusé, jamais l'audio.",
    );
  });

  it("shows the SysEx-filtered note", () => {
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-sysex-note")).toHaveTextContent(
      "SysEx silencieusement filtré, jamais affiché ni relayé",
    );
  });
});

describe("MonitoringPanel — counters pluralised (Intl.PluralRules fr-FR)", () => {
  it("events envoyés: 0 → '0 event envoyé' (FR singular), 1 → singular, 2 → plural", () => {
    const { rerender } = render(<MonitoringPanel />);
    usePerformerStore.getState().setListeners(0);
    usePerformerStore.setState({ eventsSent: 0 });
    rerender(<MonitoringPanel />);
    expect(screen.getByTestId("counter-events-sent")).toHaveTextContent(
      "0 event envoyé",
    );

    usePerformerStore.setState({ eventsSent: 1 });
    rerender(<MonitoringPanel />);
    expect(screen.getByTestId("counter-events-sent")).toHaveTextContent(
      "1 event envoyé",
    );

    usePerformerStore.setState({ eventsSent: 2 });
    rerender(<MonitoringPanel />);
    expect(screen.getByTestId("counter-events-sent")).toHaveTextContent(
      "2 events envoyés",
    );
  });

  it("listeners: pluralises", () => {
    usePerformerStore.setState({ listeners: 3 });
    render(<MonitoringPanel />);
    expect(screen.getByTestId("counter-listeners")).toHaveTextContent(
      "3 listeners",
    );
  });

  it("erreurs récentes: 0 → singular, 5 → plural", () => {
    usePerformerStore.setState({ recentErrors: 0 });
    const { rerender } = render(<MonitoringPanel />);
    expect(screen.getByTestId("counter-recent-errors")).toHaveTextContent(
      "0 erreur récente",
    );
    usePerformerStore.setState({ recentErrors: 5 });
    rerender(<MonitoringPanel />);
    expect(screen.getByTestId("counter-recent-errors")).toHaveTextContent(
      "5 erreurs récentes",
    );
  });
});

describe("MonitoringPanel — last event line (5 types, CH 1–16)", () => {
  it("renders the last event as `TYPE · CH · VAL`", () => {
    usePerformerStore.setState({
      lastEvent: ev({ type: "noteOn", channel: 0, note: 60, velocity: 100 }),
    });
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-last-event")).toHaveTextContent(
      "noteOn · CH 1 · note=60 vel=100",
    );
  });

  it.each([
    ["noteOn", ev({ type: "noteOn", channel: 0, note: 60, velocity: 100 }), "noteOn"],
    ["noteOff", ev({ type: "noteOff", channel: 2, note: 72, velocity: 0 }), "noteOff"],
    [
      "controlChange",
      ev({ type: "controlChange", channel: 4, controller: 7, value: 99 }),
      "controlChange",
    ],
    ["programChange", ev({ type: "programChange", channel: 0, program: 42 }), "programChange"],
    ["pitchBend", ev({ type: "pitchBend", channel: 15, pitchBend: 8192 }), "pitchBend"],
  ] as const)("%s is formatted", (_name, event, typeLabel) => {
    usePerformerStore.setState({ lastEvent: event });
    render(<MonitoringPanel />);
    const line = screen.getByTestId("monitoring-last-event").textContent ?? "";
    expect(line.startsWith(typeLabel + " · CH ")).toBe(true);
  });

  it("shows a placeholder when no event yet", () => {
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-last-event")).toHaveTextContent("—");
  });

  it("never displays a SysEx event (decode filters it — none can reach here)", () => {
    // A SysEx event is not a valid MidiEvent (no sysex variant); the store only
    // accepts MidiEvent, and decode drops SysEx upstream (Story 3.3). So the
    // last-event line stays at its placeholder. The "SysEx silencieusement
    // filtré…" note is informational copy, NOT a payload — it is present, but
    // no SysEx bytes are ever rendered in the event line.
    render(<MonitoringPanel />);
    expect(screen.getByTestId("monitoring-last-event")).toHaveTextContent("—");
    expect(screen.getByTestId("monitoring-sysex-note")).toBeInTheDocument();
  });
});

describe("MonitoringPanel — rate-limit alert (E12)", () => {
  it("does NOT show the alert when not rate-limited", () => {
    render(<MonitoringPanel />);
    expect(screen.queryByTestId("rate-limit-alert")).not.toBeInTheDocument();
  });

  it("shows the exact rate-limit message when rate-limited", () => {
    usePerformerStore.setState({ rateLimited: true });
    render(<MonitoringPanel />);
    expect(screen.getByTestId("rate-limit-alert")).toHaveTextContent(
      "Limite de débit atteinte — certains events ont été ignorés par le serveur.",
    );
  });

  it("dismiss clears the alert from the panel", () => {
    usePerformerStore.setState({ rateLimited: true });
    render(<MonitoringPanel />);
    fireEvent.click(screen.getByTestId("rate-limit-dismiss"));
    // The store flag is cleared → re-render no longer shows the alert.
    expect(usePerformerStore.getState().rateLimited).toBe(false);
  });
});

describe("RateLimitAlert — exact message + dismiss", () => {
  it("renders the exact E12 message", () => {
    render(<RateLimitAlert />);
    expect(
      screen.getByText(
        "Limite de débit atteinte — certains events ont été ignorés par le serveur.",
      ),
    ).toBeInTheDocument();
  });

  it("dismiss button clears the store flag", () => {
    usePerformerStore.setState({ rateLimited: true });
    render(<RateLimitAlert />);
    fireEvent.click(screen.getByTestId("rate-limit-dismiss"));
    expect(usePerformerStore.getState().rateLimited).toBe(false);
  });
});