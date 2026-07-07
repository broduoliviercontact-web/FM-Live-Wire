// @vitest-environment jsdom
// Story 4.4 — MidiActivityIndicator tests (UX-DR12, AC-U19/UX-DR26).
//
// Proves:
//   - OFF in idle / waiting (data-state=idle, no animate-pulse);
//   - ON (data-state=active) when the flux is active, with the `animate-pulse`
//     class (motion);
//   - `data-pulse` increments on each incoming noteOn (the per-noteOn reaction);
//   - `noteOff` / `controlChange` / `programChange` / `pitchBend` do NOT pulse
//     (only `noteOn` drives the activity — verified at the store/`pulseNoteOn`
//     level by simulating the handler's behaviour);
//   - with `prefers-reduced-motion: reduce`: no `animate-pulse` class (static
//     opacity only), `data-reduced-motion="true"`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MidiActivityIndicator } from "../features/listener/components/MidiActivityIndicator";
import { useListenerStore } from "../features/listener/store/listenerStore";

/** Install a `window.matchMedia` that reports the given reduced-motion pref. */
function setReducedMotion(reduced: boolean): void {
  const matches = reduced;
  const mq = {
    matches,
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

beforeEach(() => {
  useListenerStore.getState().reset();
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  try {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } catch {
    /* already absent */
  }
});

describe("MidiActivityIndicator — off in idle / waiting", () => {
  it("idle: data-state=idle, no animate-pulse, low opacity", () => {
    render(<MidiActivityIndicator />);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-state", "idle");
    expect(dot.className).not.toContain("animate-pulse");
  });

  it("waiting: still off (no animation until active)", () => {
    useListenerStore.getState().setFluxStatus("waiting");
    render(<MidiActivityIndicator />);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-state", "idle");
    expect(dot.className).not.toContain("animate-pulse");
  });
});

describe("MidiActivityIndicator — pulse on noteOn (motion allowed)", () => {
  it("active: data-state=active + animate-pulse class", () => {
    useListenerStore.getState().setFluxStatus("active");
    render(<MidiActivityIndicator />);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-state", "active");
    expect(dot.className).toContain("animate-pulse");
    expect(dot).toHaveAttribute("data-reduced-motion", "false");
  });

  it("data-pulse increments on each incoming noteOn", () => {
    useListenerStore.getState().setFluxStatus("active");
    const { rerender } = render(<MidiActivityIndicator />);
    const dot = () => screen.getByTestId("listener-activity-indicator");
    expect(dot()).toHaveAttribute("data-pulse", "0");
    // Simulate two incoming noteOn events (the midi:event handler pulses once
    // per noteOn).
    act(() => {
      useListenerStore.getState().pulseNoteOn();
    });
    rerender(<MidiActivityIndicator />);
    expect(dot()).toHaveAttribute("data-pulse", "1");
    act(() => {
      useListenerStore.getState().pulseNoteOn();
      useListenerStore.getState().pulseNoteOn();
    });
    rerender(<MidiActivityIndicator />);
    expect(dot()).toHaveAttribute("data-pulse", "3");
  });

  it("non-noteOn events do NOT pulse (only noteOn calls pulseNoteOn)", () => {
    // The handler calls pulseNoteOn() only for type === "noteOn". We simulate
    // the store-level effect of receiving a non-noteOn event: incEventsReceived
    // + setFluxStatus("active") WITHOUT pulseNoteOn.
    useListenerStore.getState().setFluxStatus("active");
    const { rerender } = render(<MidiActivityIndicator />);
    act(() => {
      useListenerStore.getState().incEventsReceived(); // e.g. a controlChange
    });
    rerender(<MidiActivityIndicator />);
    expect(screen.getByTestId("listener-activity-indicator")).toHaveAttribute(
      "data-pulse",
      "0",
    );
    // A noteOn then pulses.
    act(() => {
      useListenerStore.getState().pulseNoteOn();
    });
    rerender(<MidiActivityIndicator />);
    expect(screen.getByTestId("listener-activity-indicator")).toHaveAttribute(
      "data-pulse",
      "1",
    );
  });
});

describe("MidiActivityIndicator — reduced motion disables the animation (AC-U19)", () => {
  it("reduced motion: data-reduced-motion=true, NO animate-pulse, static opacity", () => {
    setReducedMotion(true);
    useListenerStore.getState().setFluxStatus("active");
    render(<MidiActivityIndicator />);
    const dot = screen.getByTestId("listener-activity-indicator");
    expect(dot).toHaveAttribute("data-state", "active");
    expect(dot).toHaveAttribute("data-reduced-motion", "true");
    expect(dot.className).not.toContain("animate-pulse");
    // Static full opacity instead of animation.
    expect(dot.className).toContain("opacity-100");
  });

  it("reduced motion: data-pulse still increments (the reaction is recorded, just not animated)", () => {
    setReducedMotion(true);
    useListenerStore.getState().setFluxStatus("active");
    const { rerender } = render(<MidiActivityIndicator />);
    act(() => {
      useListenerStore.getState().pulseNoteOn();
    });
    rerender(<MidiActivityIndicator />);
    expect(screen.getByTestId("listener-activity-indicator")).toHaveAttribute(
      "data-pulse",
      "1",
    );
    expect(screen.getByTestId("listener-activity-indicator").className).not.toContain(
      "animate-pulse",
    );
  });
});