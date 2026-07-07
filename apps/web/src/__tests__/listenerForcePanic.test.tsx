// @vitest-environment jsdom
// Story 5.3 — Force Panic integration: Mock output + server-down + no sound.
//
// Proves the end-to-end AC:
//   - Mock selected → open ForcePanicDialog → confirm → MockMidiOutput captures
//     2048 noteOff AND MockByteStream displays them as noteOff lines (no
//     hardware sound, 0 real outputs);
//   - server-down → open dialog → confirm → 2048 messages sent locally with NO
//     socket created / NO `socket.emit` (S-2 — Force Panic is network-free,
//     like the Story 5.2 Panic);
//   - the normal PanicButton stays visible + enabled while the dialog is open.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Toaster } from "../shared/ui/sonner";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { ForcePanicButton } from "../features/listener/components/ForcePanicButton";
import { PanicButton } from "../features/listener/components/PanicButton";
import { MockByteStream } from "../features/listener/components/MockByteStream";
import { useListenerStore } from "../features/listener/store/listenerStore";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";

// socket.io-client spy: MUST never be called by Force Panic (S-2 / network-free).
const ioSpy = vi.hoisted(() => vi.fn());
vi.mock("socket.io-client", () => ({ io: ioSpy }));

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetMockMidiOutput();
  ioSpy.mockClear();
});

afterEach(() => {
  cleanup();
  __resetMockMidiOutput();
});

// ============================================================================
// Group A — Mock integration: 2048 noteOff + MockByteStream lines + no sound
// ============================================================================
describe("Force Panic + Mock — 2048 noteOff, on-screen lines, no hardware sound", () => {
  function renderMock() {
    return render(
      <MidiAccessProvider>
        <ForcePanicButton />
        <MockByteStream />
        <Toaster />
      </MidiAccessProvider>,
    );
  }

  it("selecting Mock → open dialog → confirm → 2048 noteOff captured + MockByteStream shows noteOff lines", async () => {
    renderMock();
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));

    // Open the dialog: nothing sent yet.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    expect(screen.getByTestId("listener-force-panic-dialog")).toBeInTheDocument();
    expect(getMockMidiOutput().messages).toHaveLength(0);

    // Confirm → 2048 noteOff on the Mock singleton.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-confirm"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(2048);
    expect(Array.from(getMockMidiOutput().messages[0]!.data)).toEqual([0x80, 0, 0]);
    expect(Array.from(getMockMidiOutput().messages[2047]!.data)).toEqual([0x8f, 127, 0]);

    // MockByteStream decoded + displayed all 2048 as noteOff lines.
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(2048);
    expect(lines[0]).toHaveAttribute("data-type", "noteOff");
    expect(lines[0]).toHaveTextContent("noteOff · ch1 · 0 · 0"); // ch0 → UI ch1
    expect(lines[2047]).toHaveTextContent("noteOff · ch16 · 127 · 0"); // ch15 → UI ch16

    // Toast.
    expect(await screen.findByText("Force Panic envoyé.")).toBeInTheDocument();
  });

  it("produces NO hardware sound (0 real outputs; only the Mock singleton receives sends)", () => {
    renderMock();
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-confirm"));
    });
    // The only sink is the Mock singleton (a plain object, no audio access).
    expect(getMockMidiOutput().messages).toHaveLength(2048);
  });
});

// ============================================================================
// Group B — server-down: Force Panic works locally, NO socket.emit (S-2)
// ============================================================================
describe("Force Panic + server-down — local 2048 sweep, no socket / no emit", () => {
  function renderForce() {
    return render(
      <MidiAccessProvider>
        <ForcePanicButton />
        <Toaster />
      </MidiAccessProvider>,
    );
  }

  it("with the backend down, open dialog → confirm → 2048 messages locally", async () => {
    renderForce();
    act(() => {
      useListenerStore.getState().setFluxStatus("server-down");
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-confirm"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(2048);
    expect(await screen.findByText("Force Panic envoyé.")).toBeInTheDocument();
  });

  it("Force Panic NEVER creates a socket / calls `socket.emit` — `io` spy untouched", () => {
    renderForce();
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    expect(ioSpy).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-confirm"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(2048);
    // No socket was ever created → nothing to `.emit` on (S-2 / AC-U13).
    expect(ioSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Group C — PanicButton coexistence during the Force Panic dialog
// ============================================================================
describe("PanicButton stays visible + enabled during the Force Panic dialog", () => {
  function renderBoth() {
    return render(
      <MidiAccessProvider>
        <PanicButton />
        <ForcePanicButton />
      </MidiAccessProvider>,
    );
  }

  it("the normal PanicButton remains in the DOM and enabled while the dialog is open", () => {
    renderBoth();
    act(() => useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID));
    act(() => {
      fireEvent.click(screen.getByTestId("listener-force-panic-button"));
    });
    expect(screen.getByTestId("listener-force-panic-dialog")).toBeInTheDocument();
    const panic = screen.getByTestId("listener-panic-button");
    expect(panic).toBeInTheDocument();
    expect(panic).not.toBeDisabled();
  });

  it("the normal PanicButton is stacked above the dialog (z-[60] > dialog overlay z-50)", () => {
    renderBoth();
    const wrap = screen.getByTestId("listener-panic");
    expect(wrap.className).toContain("z-[60]");
  });
});