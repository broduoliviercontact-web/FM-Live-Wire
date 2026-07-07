// @vitest-environment jsdom
// Story 3.5 — `BackToHome` unit tests (UX-DR1, Q-UX10).
//
// Proves the critical ORDER: "← Retour" calls the clean-disconnect handler
// BEFORE navigating to `/`. A `LocationProbe` (useLocation + useRef) records
// the pathname change AFTER the disconnect spy fires, so a shared call-log
// asserts the strict sequence: ["disconnect", "navigate:/"]. No confirmation
// dialog; the click is a natural end of the session.
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter, useLocation, Route, Routes } from "react-router-dom";
import { BackToHome } from "../features/performer/components/BackToHome";

/** Records pathname CHANGES (after the initial mount) to a shared log. */
function LocationProbe({ log }: { log: string[] }) {
  const { pathname } = useLocation();
  const prev = useRef<string | null>(null);
  if (prev.current === null) {
    prev.current = pathname; // initial mount — record baseline, do not log
  } else if (prev.current !== pathname) {
    log.push("navigate:" + pathname);
    prev.current = pathname;
  }
  return null;
}

afterEach(() => {
  cleanup();
});

describe("BackToHome — disconnect BEFORE navigation (Q-UX10)", () => {
  it("calls onDisconnect, then navigates to '/' (strict order)", () => {
    const log: string[] = [];
    const onDisconnect = vi.fn(() => log.push("disconnect"));

    render(
      <MemoryRouter initialEntries={["/performer"]}>
        <LocationProbe log={log} />
        <Routes>
          <Route path="/performer" element={<BackToHome onDisconnect={onDisconnect} />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("performer-back-to-home"));

    // The disconnect spy fired exactly once.
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    // Navigation reached "/".
    expect(screen.getByTestId("home")).toBeInTheDocument();
    // ORDER: disconnect logged strictly before the navigation change.
    expect(log).toEqual(["disconnect", "navigate:/"]);
  });

  it("renders the exact '← Retour' label", () => {
    render(
      <MemoryRouter initialEntries={["/performer"]}>
        <Routes>
          <Route path="/performer" element={<BackToHome onDisconnect={vi.fn()} />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("performer-back-to-home")).toHaveTextContent("← Retour");
  });

  it("opens NO confirmation dialog (leaving is a natural end)", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <MemoryRouter initialEntries={["/performer"]}>
        <Routes>
          <Route path="/performer" element={<BackToHome onDisconnect={vi.fn()} />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("performer-back-to-home"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});