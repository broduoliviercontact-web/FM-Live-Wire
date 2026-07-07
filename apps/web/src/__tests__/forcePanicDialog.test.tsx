// @vitest-environment jsdom
// Story 5.3 — `ForcePanicButton` + `ForcePanicDialog` component tests (FR-17,
// AC-U14, UX-DR16, UX-DR23). jsdom, no real Web MIDI (Mock only), no network.
//
// Proves:
//   - the button is visible with « Force Panic » and is DISABLED until a local
//     output is selected (opt-in; the normal Panic stays always enabled);
//   - clicking the button opens the dialog and sends NOTHING before confirm;
//   - the dialog shows the EXACT title + intro copy;
//   - « Annuler » closes with no send;
//   - « Confirmer » sends exactly 2048 noteOff + the toast + closes the dialog;
//   - the normal PanicButton stays visible + enabled while the dialog is open.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Toaster } from "../shared/ui/sonner";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { ForcePanicButton } from "../features/listener/components/ForcePanicButton";
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

function renderUI(children: React.ReactNode) {
  return render(
    <MidiAccessProvider>
      {children}
      <Toaster />
    </MidiAccessProvider>,
  );
}

describe("ForcePanicButton — visibility + disabled gating", () => {
  it("is visible with the text 'Force Panic'", () => {
    renderUI(<ForcePanicButton />);
    expect(screen.getByTestId("listener-force-panic-button")).toBeInTheDocument();
    expect(screen.getByTestId("listener-force-panic-button")).toHaveTextContent("Force Panic");
  });

  it("is DISABLED when no output is selected (opt-in)", () => {
    renderUI(<ForcePanicButton />);
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(screen.getByTestId("listener-force-panic-button")).toBeDisabled();
    expect(screen.getByTestId("listener-force-panic-hint")).toBeInTheDocument();
  });

  it("is ENABLED when the Mock output is selected", () => {
    renderUI(<ForcePanicButton />);
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    expect(screen.getByTestId("listener-force-panic-button")).not.toBeDisabled();
  });
});

describe("ForcePanicButton + ForcePanicDialog — open sends nothing; exact copy", () => {
  it("clicking opens the dialog and sends NO message before confirmation (AC-U14)", () => {
    renderUI(<ForcePanicButton />);
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    // The dialog is open.
    expect(screen.getByTestId("listener-force-panic-dialog")).toBeInTheDocument();
    // NOTHING was sent yet (the sweep only runs on « Confirmer »).
    expect(getMockMidiOutput().messages).toHaveLength(0);
  });

  it("the dialog shows the EXACT title 'Panic étendu : ~1–2 s. Confirmer ?'", () => {
    renderUI(<ForcePanicButton />);
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    expect(screen.getByTestId("listener-force-panic-dialog-title")).toHaveTextContent(
      "Panic étendu : ~1–2 s. Confirmer ?",
    );
  });

  it("the dialog shows the EXACT intro copy", () => {
    renderUI(<ForcePanicButton />);
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    expect(screen.getByTestId("listener-force-panic-dialog-intro")).toHaveTextContent(
      "Force Panic envoie un noteOff sur les 128 notes × 16 canaux (2048 messages). Utile si une note reste coincée après un Panic normal.",
    );
  });
});

describe("ForcePanicDialog — Annuler / Confirmer", () => {
  it("« Annuler » closes the dialog and sends NO message", () => {
    renderUI(<ForcePanicButton />);
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    expect(screen.getByTestId("listener-force-panic-dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-cancel"));
    });
    expect(screen.queryByTestId("listener-force-panic-dialog")).not.toBeInTheDocument();
    expect(getMockMidiOutput().messages).toHaveLength(0);
  });

  it("« Confirmer » sends exactly 2048 noteOff + toast + closes the dialog", async () => {
    renderUI(<ForcePanicButton />);
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-confirm"));
    });
    // Exactly 2048 noteOff messages on the Mock singleton.
    expect(getMockMidiOutput().messages).toHaveLength(2048);
    // First + last messages.
    expect(Array.from(getMockMidiOutput().messages[0]!.data)).toEqual([0x80, 0, 0]);
    expect(Array.from(getMockMidiOutput().messages[2047]!.data)).toEqual([0x8f, 127, 0]);
    // Toast shown (sonner renders asynchronously → findByText waits).
    expect(await screen.findByText("Force Panic envoyé.")).toBeInTheDocument();
    // Dialog closed after confirm.
    expect(screen.queryByTestId("listener-force-panic-dialog")).not.toBeInTheDocument();
  });
});

describe("PanicButton coexistence — stays visible + enabled during the dialog", () => {
  it("the normal PanicButton is visible and enabled while ForcePanicDialog is open", () => {
    renderUI(
      <>
        <PanicButton />
        <ForcePanicButton />
      </>,
    );
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    // Force Panic dialog open.
    expect(screen.getByTestId("listener-force-panic-dialog")).toBeInTheDocument();
    // Normal Panic button still present + enabled (the escape hatch stays).
    const panic = screen.getByTestId("listener-panic-button");
    expect(panic).toBeInTheDocument();
    expect(panic).not.toBeDisabled();
  });
});

// `vi` imported to keep the jsdom environment consistent with the listener suite
// (no fake socket needed — Force Panic is network-free, like Story 5.2 Panic).
void vi;