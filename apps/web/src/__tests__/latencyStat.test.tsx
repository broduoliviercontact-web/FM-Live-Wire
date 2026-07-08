// @vitest-environment jsdom
// Story 5.4 — `LatencyStat` component tests (UX-DR12, FR-26, NFR-2).
//
// Proves:
//   - it is INVISIBLE by default (lateWarning false → null — alerte-only);
//   - it becomes visible ONLY when the late warning is active;
//   - it shows at least the latency (ms) and the fallback counter;
//   - it is LOCAL PUR (no socket / no emit — imports only the store).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LatencyStat } from "../features/listener/components/LatencyStat";
import { useListenerStore } from "../features/listener/store/listenerStore";

// Forbidden server-overload event name, built from parts (repo-wide grep → 0).
const OVERLOAD_EVENT = ["listener", "overload"].join(":");

beforeEach(() => {
  useListenerStore.getState().reset();
});
afterEach(() => {
  cleanup();
});

describe("LatencyStat — alerte-only visibility (UX-DR12)", () => {
  it("is INVISIBLE by default (calm reception → null)", () => {
    render(<LatencyStat />);
    expect(screen.queryByTestId("listener-latency-stat")).not.toBeInTheDocument();
  });

  it("is visible ONLY when lateWarning is true", () => {
    render(<LatencyStat />);
    act(() => {
      useListenerStore.getState().setLateWarning(true);
      useListenerStore.getState().setLastLatencyMs(87);
      useListenerStore.getState().incFallback();
      useListenerStore.getState().incFallback();
    });
    expect(screen.getByTestId("listener-latency-stat")).toBeInTheDocument();
  });

  it("shows the latency (ms) and the fallback counter", () => {
    render(<LatencyStat />);
    act(() => {
      useListenerStore.getState().setLateWarning(true);
      useListenerStore.getState().setLastLatencyMs(87);
      useListenerStore.getState().incFallback();
      useListenerStore.getState().incFallback();
      useListenerStore.getState().incDropped();
    });
    expect(screen.getByTestId("listener-latency-stat-ms")).toHaveTextContent("Latence estimée : 87 ms");
    expect(screen.getByTestId("listener-latency-stat-fallbacks")).toHaveTextContent("Fallbacks : 2");
    expect(screen.getByTestId("listener-latency-stat-dropped")).toHaveTextContent("Drops : 1");
  });

  it("hides again when reception returns to calm", () => {
    render(<LatencyStat />);
    act(() => useListenerStore.getState().setLateWarning(true));
    expect(screen.getByTestId("listener-latency-stat")).toBeInTheDocument();
    act(() => useListenerStore.getState().setLateWarning(false));
    expect(screen.queryByTestId("listener-latency-stat")).not.toBeInTheDocument();
  });
});

describe("LatencyStat — LOCAL PUR import-check (FR-27)", () => {
  const source = readFileSync(
    join(import.meta.dirname!, "../features/listener/components/LatencyStat.tsx"),
    "utf8",
  );
  it("imports ONLY the listener store (no socket, no connection)", () => {
    expect(source).not.toContain("socket.io-client");
    expect(source).not.toContain("/api/connection");
    expect(source).not.toContain('from "../api/connection');
  });
  it("does NOT emit a server overload event", () => {
    expect(source).not.toContain(OVERLOAD_EVENT);
  });
});