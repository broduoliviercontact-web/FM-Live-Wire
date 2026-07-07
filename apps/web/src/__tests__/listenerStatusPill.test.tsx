// @vitest-environment jsdom
// Story 4.4 — StatusPill tests (UX-DR11, AC-U18). Purely presentational: reads
// `fluxStatus` + `eventsReceived` from the store. No MIDI access, no socket.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusPill } from "../features/listener/components/StatusPill";
import { useListenerStore } from "../features/listener/store/listenerStore";

beforeEach(() => {
  useListenerStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe("StatusPill — idle (default)", () => {
  it("shows the idle text and data-state=idle", () => {
    render(<StatusPill />);
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveTextContent("● Inactif");
    expect(pill).toHaveAttribute("data-state", "idle");
  });
});

describe("StatusPill — waiting (joined, no event)", () => {
  it("shows the EXACT waiting text « En attente du performer… »", () => {
    useListenerStore.getState().setFluxStatus("waiting");
    render(<StatusPill />);
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveTextContent("En attente du performer…");
    expect(pill).toHaveAttribute("data-state", "waiting");
  });
});

describe("StatusPill — active (reception)", () => {
  it("shows the EXACT active text with the event count (plural)", () => {
    useListenerStore.getState().setFluxStatus("active");
    useListenerStore.getState().incEventsReceived();
    useListenerStore.getState().incEventsReceived(); // n = 2
    render(<StatusPill />);
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveTextContent("● Réception active — 2 events reçus");
    expect(pill).toHaveAttribute("data-state", "active");
  });

  it("uses the French singular form for 1 event reçu", () => {
    useListenerStore.getState().setFluxStatus("active");
    useListenerStore.getState().incEventsReceived(); // n = 1
    render(<StatusPill />);
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveTextContent("● Réception active — 1 event reçu");
  });

  it("reflects a growing count as more events arrive", () => {
    useListenerStore.getState().setFluxStatus("active");
    for (let i = 0; i < 5; i++) useListenerStore.getState().incEventsReceived();
    render(<StatusPill />);
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Réception active — 5 events reçus",
    );
  });

  it("shows « ● Réception active — 0 event reçu » when active with 0 event (Story 4.5 AC)", () => {
    useListenerStore.getState().setFluxStatus("active");
    // eventsReceived stays 0 (no event fired) — the connected state alone is
    // enough, not an error.
    render(<StatusPill />);
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "● Réception active — 0 event reçu",
    );
    expect(screen.getByTestId("listener-status-pill")).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});

describe("StatusPill — Story 4.5 extended states (server-down, performer-disconnected)", () => {
  it("server-down: shows the EXACT server-down text + data-state", () => {
    useListenerStore.getState().setFluxStatus("server-down");
    render(<StatusPill />);
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveTextContent(
      "Serveur déconnecté. Reconnexion automatique en cours…",
    );
    expect(pill).toHaveAttribute("data-state", "server-down");
  });

  it("performer-disconnected (E7): shows the EXACT text + data-state", () => {
    useListenerStore.getState().setFluxStatus("performer-disconnected");
    render(<StatusPill />);
    const pill = screen.getByTestId("listener-status-pill");
    expect(pill).toHaveTextContent("Performer déconnecté");
    expect(pill).toHaveAttribute("data-state", "performer-disconnected");
  });
});