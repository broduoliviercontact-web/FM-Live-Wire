// @vitest-environment jsdom
// Story 5.1 — `MockBadge` + `MockByteStream` component tests (UX-DR12, UX-DR13,
// UX-DR22). jsdom, no Web MIDI, no network.
//
// Proves:
//   - `MockBadge` renders the EXACT text only when the Mock is selected;
//   - `MockByteStream` renders only when Mock selected;
//   - empty Mock shows the EXACT placeholder « — en attente d'événements — »;
//   - a `send` from the shared Mock singleton re-renders the stream with a
//     monospace line `noteOn · ch1 · 60 · 100`;
//   - the 5 types are rendered with a `data-type` per line;
//   - the list is stable and ordered across several messages.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MockBadge } from "../features/listener/components/MockBadge";
import { MockByteStream } from "../features/listener/components/MockByteStream";
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

describe("MockBadge — exact text, only when Mock selected", () => {
  it("renders nothing when no output is selected", () => {
    render(<MockBadge />);
    expect(screen.queryByTestId("listener-mock-badge")).not.toBeInTheDocument();
  });
  it("renders nothing when a real output is selected", () => {
    useListenerStore.getState().setSelectedOutput("o1");
    render(<MockBadge />);
    expect(screen.queryByTestId("listener-mock-badge")).not.toBeInTheDocument();
  });
  it("renders the EXACT badge text when Mock is selected", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockBadge />);
    expect(screen.getByTestId("listener-mock-badge")).toHaveTextContent(
      "Sortie Mock / Debug — les bytes s'affichent à l'écran, aucun son n'est produit.",
    );
  });
});

describe("MockByteStream — render gate + empty placeholder", () => {
  it("renders nothing when Mock is not selected", () => {
    render(<MockByteStream />);
    expect(
      screen.queryByTestId("listener-mock-byte-stream"),
    ).not.toBeInTheDocument();
  });
  it("shows the EXACT placeholder when Mock is selected and no event yet", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    expect(
      screen.getByTestId("listener-mock-byte-stream-empty"),
    ).toHaveTextContent("— en attente d'événements —");
  });
});

describe("MockByteStream — lines from the shared Mock singleton", () => {
  it("shows 'noteOn · ch1 · 60 · 100' after a send (reactive via useSyncExternalStore)", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    expect(screen.getByTestId("listener-mock-byte-stream-empty")).toBeInTheDocument();
    act(() => {
      getMockMidiOutput().send(new Uint8Array([0x90, 60, 100]), 1040);
    });
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("noteOn · ch1 · 60 · 100");
    expect(lines[0]).toHaveAttribute("data-type", "noteOn");
    // Placeholder is gone once there is a line.
    expect(
      screen.queryByTestId("listener-mock-byte-stream-empty"),
    ).not.toBeInTheDocument();
  });

  it("renders the 5 types, each with its `data-type`, in order", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    act(() => {
      const mock = getMockMidiOutput();
      mock.send(new Uint8Array([0x90, 60, 100]), 1); // noteOn
      mock.send(new Uint8Array([0x80, 60, 0]), 2); // noteOff
      mock.send(new Uint8Array([0xb0, 7, 100]), 3); // cc
      mock.send(new Uint8Array([0xc0, 42]), 4); // program
      mock.send(new Uint8Array([0xe0, 0x00, 0x40]), 5); // pitchBend
    });
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toHaveTextContent("noteOn · ch1 · 60 · 100");
    expect(lines[0]).toHaveAttribute("data-type", "noteOn");
    expect(lines[1]).toHaveTextContent("noteOff · ch1 · 60 · 0");
    expect(lines[1]).toHaveAttribute("data-type", "noteOff");
    expect(lines[2]).toHaveTextContent("cc · ch1 · 7 · 100");
    expect(lines[2]).toHaveAttribute("data-type", "cc");
    expect(lines[3]).toHaveTextContent("program · ch1 · 42");
    expect(lines[3]).toHaveAttribute("data-type", "program");
    expect(lines[4]).toHaveTextContent("pitchBend · ch1 · 8192");
    expect(lines[4]).toHaveAttribute("data-type", "pitchBend");
  });

  it("keeps a stable, ordered list across many messages", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    act(() => {
      const mock = getMockMidiOutput();
      for (let i = 0; i < 20; i++) {
        mock.send(new Uint8Array([0x90, 60 + (i % 12), 100]), i);
      }
    });
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(20);
    // First and last are in arrival order (i=19 → 60 + 19%12 = 60 + 7 = 67).
    expect(lines[0]).toHaveTextContent("noteOn · ch1 · 60 · 100");
    expect(lines[19]).toHaveTextContent("noteOn · ch1 · 67 · 100");
  });

  it("ignores unknown bytes (SysEx) — no line, no crash", () => {
    useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    render(<MockByteStream />);
    act(() => {
      const mock = getMockMidiOutput();
      mock.send(new Uint8Array([0xf0, 0x7f, 0x7f])); // SysEx → ignored
      mock.send(new Uint8Array([0x90, 60, 100]), 1); // noteOn → shown
    });
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("noteOn · ch1 · 60 · 100");
  });
});