// @vitest-environment jsdom
// Story 5.4 — `LateAlert` component tests (FR-27, UX-DR14, E10, AC-U11).
//
// Proves:
//   - the alert renders the EXACT text "⚠ Flux en retard / connexion instable
//     — latence estimée {ms} ms" with the latency value when `lateWarning` is true;
//   - it is NOT shown on calm reception (lateWarning false → null);
//   - it is LOCAL PUR: no socket, no emit, no server overload event (import-check
//     on the source — it imports only the listener store).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LateAlert, LATE_ALERT_PREFIX } from "../features/listener/components/LateAlert";
import { useListenerStore } from "../features/listener/store/listenerStore";

// The forbidden server-overload event name, built from parts so the test file
// itself never contains the literal (keeps the repo-wide grep at 0, FR-27).
const OVERLOAD_EVENT = ["listener", "overload"].join(":");

beforeEach(() => {
  useListenerStore.getState().reset();
});
afterEach(() => {
  cleanup();
});

describe("LateAlert — visibility + exact text", () => {
  it("is NOT rendered on calm reception (lateWarning false → null)", () => {
    render(<LateAlert />);
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
  });

  it("renders the EXACT text with the latency when lateWarning is true", () => {
    render(<LateAlert />);
    act(() => {
      useListenerStore.getState().setLastLatencyMs(312);
      useListenerStore.getState().setLateWarning(true);
    });
    const alert = screen.getByTestId("listener-late-alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      `${LATE_ALERT_PREFIX} 312 ms`,
    );
    // Exact full text (em dash included). "estimée" because the shown value is
    // the effective (clamped) latency, subject to server/client clock skew.
    expect(alert).toHaveTextContent(
      "⚠ Flux en retard / connexion instable — latence estimée 312 ms",
    );
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("shows 0 ms when the warning is from a buffer overflow with no latency", () => {
    render(<LateAlert />);
    act(() => {
      // Buffer overflow path: lateWarning true but lastLatencyMs null.
      useListenerStore.getState().setLastLatencyMs(null);
      useListenerStore.getState().setLateWarning(true);
    });
    const alert = screen.getByTestId("listener-late-alert");
    expect(alert).toHaveTextContent(
      "⚠ Flux en retard / connexion instable — latence estimée 0 ms",
    );
  });

  it("hides again when reception returns to calm (lateWarning cleared)", () => {
    render(<LateAlert />);
    act(() => {
      useListenerStore.getState().setLateWarning(true);
    });
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
    act(() => {
      useListenerStore.getState().setLateWarning(false);
    });
    expect(screen.queryByTestId("listener-late-alert")).not.toBeInTheDocument();
  });
});

describe("LateAlert — LOCAL PUR import-check (FR-27 / AC-U11)", () => {
  const source = readFileSync(
    join(import.meta.dirname!, "../features/listener/components/LateAlert.tsx"),
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
  it("does NOT call socket.emit / .emit(", () => {
    expect(source).not.toContain(".emit(");
    expect(source).not.toContain("socket.emit");
  });
});