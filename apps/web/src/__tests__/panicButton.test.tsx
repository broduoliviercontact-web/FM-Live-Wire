// @vitest-environment jsdom
// Story 5.2 — `PanicButton` component tests (UX-DR15, S-2, AC-U13).
// jsdom, no real Web MIDI (Mock output only), no network.
//
// Proves:
//   - the button is visible with the text « Panic » and the EXACT hint;
//   - it is NEVER disabled, in every flux state (idle / waiting / active /
//     server-down / performer-disconnected) and even with NO output selected;
//   - it is fixed to the bottom of the viewport (sticky, never hidden by
//     scroll) and meets the 44px minimum touch target;
//   - clicking with the Mock selected sends the 64-message Panic sweep to the
//     shared `MockMidiOutput` (no hardware sound);
//   - clicking with NO output is a no-op (no crash, button stays enabled).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { PanicButton } from "../features/listener/components/PanicButton";
import { useListenerStore } from "../features/listener/store/listenerStore";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetMockMidiOutput();
});

afterEach(() => {
  cleanup();
  __resetMockMidiOutput();
});

function renderPanic() {
  return render(
    <MidiAccessProvider>
      <PanicButton />
    </MidiAccessProvider>,
  );
}

describe("PanicButton — visibility + text + hint", () => {
  it("is visible with the text 'Panic'", () => {
    renderPanic();
    expect(screen.getByTestId("listener-panic-button")).toBeInTheDocument();
    expect(screen.getByTestId("listener-panic-button")).toHaveTextContent("Panic");
  });

  it("shows the EXACT persistent hint", () => {
    renderPanic();
    expect(screen.getByTestId("listener-panic-hint")).toHaveTextContent(
      "Coupe toutes les notes sur votre sortie locale. Fonctionne même si le serveur est injoignable.",
    );
  });
});

describe("PanicButton — sticky / fixed + 44px touch target", () => {
  it("is fixed to the bottom of the viewport (never hidden by scroll)", () => {
    renderPanic();
    const wrap = screen.getByTestId("listener-panic");
    expect(wrap.className).toContain("fixed");
    expect(wrap.className).toContain("bottom-4");
    // Story 5.3 raised the z to z-[60] so the escape hatch stays above the
    // `ForcePanicDialog` overlay (Radix dialog overlay is z-50).
    expect(wrap.className).toContain("z-[60]");
  });

  it("meets the 44px minimum touch target (h-11 + min-h-11)", () => {
    renderPanic();
    const btn = screen.getByTestId("listener-panic-button");
    // `size="lg"` yields `h-11` (44px); `min-h-11` makes the guarantee explicit.
    expect(btn.className).toContain("h-11");
    expect(btn.className).toContain("min-h-11");
  });

  it("is red (destructive variant)", () => {
    renderPanic();
    const btn = screen.getByTestId("listener-panic-button");
    expect(btn.className).toContain("bg-destructive");
  });
});

describe("PanicButton — ALWAYS enabled, in every flux state", () => {
  it("is enabled in idle (default)", () => {
    renderPanic();
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });

  it("is enabled in waiting", () => {
    renderPanic();
    act(() => useListenerStore.getState().setFluxStatus("waiting"));
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });

  it("is enabled in active", () => {
    renderPanic();
    act(() => useListenerStore.getState().setFluxStatus("active"));
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });

  it("is enabled in server-down (backend killed — S-2)", () => {
    renderPanic();
    act(() => useListenerStore.getState().setFluxStatus("server-down"));
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });

  it("is enabled in performer-disconnected", () => {
    renderPanic();
    act(() => useListenerStore.getState().setFluxStatus("performer-disconnected"));
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });

  it("is enabled even with NO output selected", () => {
    renderPanic();
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });
});

describe("PanicButton — click behavior", () => {
  it("clicking with the Mock selected sends 64 messages to MockMidiOutput (no sound)", () => {
    renderPanic();
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(64);
  });

  it("clicking with NO output is a no-op (no crash, button stays enabled)", () => {
    renderPanic();
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(0);
    expect(screen.getByTestId("listener-panic-button")).not.toBeDisabled();
  });

  it("Panic works in server-down: clicking sends 64 messages locally", () => {
    renderPanic();
    act(() => {
      useListenerStore.getState().setFluxStatus("server-down");
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(64);
  });
});

// `vi` is imported to keep the jsdom environment consistent with the rest of the
// listener test suite (no fake socket needed here — Panic is network-free).
void vi;