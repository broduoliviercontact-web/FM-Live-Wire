// @vitest-environment jsdom
// Story 6.1 — Landing surface tests (UX-DR1, UX-DR3, AC-U2, FR-28, AD-20).
//
// Covers the LandingPanel assembly + the OnAirIndicator polling + the
// RolePicker navigation + the reduced-motion gating of the on-air pulse. The
// landing polls `GET /health` over plain `fetch` (NO Socket.IO on the landing —
// Q-UX5). `fetch` is mocked per-test; `matchMedia` is stubbed for the
// reduced-motion path.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useRef } from "react";
import { LandingPanel } from "../features/landing";
import { OnAirIndicator } from "../features/landing/components/OnAirIndicator";
import { RolePicker } from "../features/landing/components/RolePicker";

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LandingPanel — exact strings + assembly (UX-DR3, UX-DR1)", () => {
  it("renders the exact project name, tagline, and footer", () => {
    render(
      <MemoryRouter>
        <LandingPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("landing-project-name")).toHaveTextContent("FM Live Wire");
    expect(screen.getByTestId("landing-tagline")).toHaveTextContent(
      "Radio live de contrôle MIDI. Le son naît chez vous, sur votre synthé.",
    );
    expect(screen.getByTestId("landing-footer")).toHaveTextContent("Chrome/Edge · HTTPS · Web MIDI");
  });

  it("renders both role-picker buttons with exact labels", () => {
    render(
      <MemoryRouter>
        <LandingPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("landing-role-performer")).toHaveTextContent("Je diffuse (performer)");
    expect(screen.getByTestId("landing-role-listener")).toHaveTextContent("J'écoute (listener)");
  });

  it("renders the on-air indicator (the landing surface is assembled)", () => {
    render(
      <MemoryRouter>
        <LandingPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("landing-on-air-indicator")).toBeInTheDocument();
  });

  it("shows the off-air text by default before the first poll resolves", () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      // Never resolves synchronously: keep the default off-air state.
      return new Promise<Response>(() => {});
    }));
    render(
      <MemoryRouter>
        <LandingPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("landing-on-air-indicator")).toHaveTextContent("○ Hors antenne");
    expect(screen.getByTestId("landing-on-air-indicator")).toHaveAttribute("data-on-air", "false");
    vi.unstubAllGlobals();
    expect(calls).toBeGreaterThanOrEqual(1); // the immediate first poll fired
  });
});

describe("RolePicker — navigation (UX-DR1)", () => {
  it("routes 'Je diffuse (performer)' to /performer", () => {
    const log: string[] = [];
    render(
      <MemoryRouter initialEntries={["/"]}>
        <LocationProbe log={log} />
        <Routes>
          <Route path="/" element={<RolePicker />} />
          <Route path="/performer" element={<div data-testid="perf">perf</div>} />
          <Route path="/listener" element={<div data-testid="lst">lst</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("landing-role-performer"));
    expect(screen.getByTestId("perf")).toBeInTheDocument();
    expect(log).toEqual(["navigate:/performer"]);
  });

  it("routes 'J'écoute (listener)' to /listener", () => {
    const log: string[] = [];
    render(
      <MemoryRouter initialEntries={["/"]}>
        <LocationProbe log={log} />
        <Routes>
          <Route path="/" element={<RolePicker />} />
          <Route path="/performer" element={<div data-testid="perf">perf</div>} />
          <Route path="/listener" element={<div data-testid="lst">lst</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("landing-role-listener"));
    expect(screen.getByTestId("lst")).toBeInTheDocument();
    expect(log).toEqual(["navigate:/listener"]);
  });
});

describe("OnAirIndicator — /health polling (NO Socket.IO, Q-UX5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("polls GET /health (ownerActive:true → '● On air')", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1, ownerActive: true, listeners: 2 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><OnAirIndicator /></MemoryRouter>);
    // Real timers: the immediate `void poll()` on mount resolves on a microtask;
    // waitFor catches the state update (no fake-timer deadlock).
    await waitFor(() =>
      expect(screen.getByTestId("landing-on-air-indicator")).toHaveTextContent("● On air"),
    );
    expect(screen.getByTestId("landing-on-air-indicator")).toHaveAttribute("data-on-air", "true");
    // Confirms a request was actually made to /health (NOT a Socket.IO poll).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/health");
  });

  it("shows '○ Hors antenne' when ownerActive is false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1, ownerActive: false, listeners: 0 }),
    })));
    render(<MemoryRouter><OnAirIndicator /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByTestId("landing-on-air-indicator")).toHaveTextContent("○ Hors antenne"),
    );
    expect(screen.getByTestId("landing-on-air-indicator")).toHaveAttribute("data-on-air", "false");
  });

  it("shows '○ Hors antenne' on fetch failure (sober, never crashes)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    render(<MemoryRouter><OnAirIndicator /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByTestId("landing-on-air-indicator")).toHaveTextContent("○ Hors antenne"),
    );
    expect(screen.getByTestId("landing-on-air-indicator")).toHaveAttribute("data-on-air", "false");
  });

  it("re-polls on the interval (light polling, cleanup on unmount)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1, ownerActive: true, listeners: 1 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<MemoryRouter><OnAirIndicator /></MemoryRouter>);
    // Flush the immediate mount poll (microtask resolution under fake timers).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Advance past one polling interval → the setInterval callback fires a
    // second poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Unmount → the interval is cleaned up; advancing again does NOT poll.
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("OnAirIndicator — reduced-motion gating (AC-U2, UX-DR26)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables the pulse when prefers-reduced-motion: reduce (data-reduced-motion)", async () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) => ({
        matches: q === "(prefers-reduced-motion: reduce)",
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1, ownerActive: true, listeners: 1 }),
    })));

    render(<MemoryRouter><OnAirIndicator /></MemoryRouter>);
    const indicator = await screen.findByTestId("landing-on-air-indicator");
    await waitFor(() => expect(indicator).toHaveTextContent("● On air"));
    // On-air AND reduced-motion → pulse disabled.
    expect(indicator).toHaveAttribute("data-reduced-motion", "true");
    const dot = indicator.querySelector("span[aria-hidden='true']")!;
    expect(dot).not.toHaveClass("animate-pulse-on-air");
  });

  it("keeps the pulse when motion is allowed", async () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) => ({
        matches: false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1, ownerActive: true, listeners: 1 }),
    })));

    render(<MemoryRouter><OnAirIndicator /></MemoryRouter>);
    const indicator = await screen.findByTestId("landing-on-air-indicator");
    await waitFor(() => expect(indicator).toHaveTextContent("● On air"));
    expect(indicator).toHaveAttribute("data-reduced-motion", "false");
    const dot = indicator.querySelector("span[aria-hidden='true']")!;
    expect(dot).toHaveClass("animate-pulse-on-air");
  });
});