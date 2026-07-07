// @vitest-environment jsdom
// Story 4.2 — listener MidiPortPicker (output) tests. UX-DR7, UX-DR13 E4,
// UX-DR23 (hot-plug), AD-3.
//
// A HOME-TYPED mock of `navigator.requestMIDIAccess` is used (extended to expose
// a `MIDIOutputMap` + `onstatechange`), per the consignes. No `web-midi-test`
// dependency. No real device, no network.
//
// Proves:
//   - real outputs are listed (by name);
//   - inputs are NOT listed in the output picker;
//   - no Mock / Debug option is selectable (only the empty-state hint mentions it);
//   - empty state E4 shows the EXACT text;
//   - selecting an output updates the store;
//   - hot-plug adds/removes an output live via `onstatechange` (no polling);
//   - removing the SELECTED output clears the selection (no crash, no dangling id);
//   - the list does NOT change on its own (no polling) — only via onstatechange.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { MidiPermissionButton } from "../features/listener/components/MidiPermissionButton";
import { MidiPortPicker } from "../features/listener/components/MidiPortPicker";
import { useListenerStore } from "../features/listener/store/listenerStore";

// ---- Home-typed Web MIDI mock (with outputs) -------------------------------

interface FakeMIDIPort {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIPort>;
  outputs: Map<string, FakeMIDIPort>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIPort }) => void) | null;
}
function makePort(id: string, name = id): FakeMIDIPort {
  return { id, name, manufacturer: "TestMfg", state: "connected", connection: "closed" };
}
function makeMidiAccess(
  inputs: FakeMIDIPort[],
  outputs: FakeMIDIPort[],
): FakeMIDIAccess {
  return {
    inputs: new Map(inputs.map((p) => [p.id, p])),
    outputs: new Map(outputs.map((p) => [p.id, p])),
    sysexEnabled: false,
    onstatechange: null,
  };
}

const midiMock = {
  spy: vi.fn(),
  nextInputs: [] as FakeMIDIPort[],
  nextOutputs: [] as FakeMIDIPort[],
  lastAccess: null as FakeMIDIAccess | null,
  lastOptions: undefined as unknown,
};
midiMock.spy = vi.fn(async (options?: { sysex?: boolean }) => {
  midiMock.lastOptions = options;
  const access = makeMidiAccess(midiMock.nextInputs, midiMock.nextOutputs);
  midiMock.lastAccess = access;
  return access as unknown as MIDIAccess;
});

function renderPicker() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <MidiPortPicker />
    </MidiAccessProvider>,
  );
}

/** Grant MIDI access by clicking the permission button (real user gesture). */
async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
}

beforeEach(() => {
  midiMock.spy.mockClear();
  midiMock.nextInputs = [];
  midiMock.nextOutputs = [];
  midiMock.lastAccess = null;
  midiMock.lastOptions = undefined;
  useListenerStore.getState().reset();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  try {
    delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  } catch {
    /* already absent */
  }
  try {
    delete (window as unknown as Record<string, unknown>).isSecureContext;
  } catch {
    /* already absent */
  }
});

describe("MidiPortPicker (listener) — lists real outputs only", () => {
  it("lists the real MIDI outputs (by name)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM"), makePort("o2", "DX7")];
    renderPicker();
    await grant();
    const select = screen.getByTestId("listener-output-select") as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Volca FM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DX7" })).toBeInTheDocument();
    // The placeholder option is present too.
    expect(screen.getByRole("option", { name: "— Sélectionner —" })).toBeInTheDocument();
    // Story 5.1: the Mock / Debug option is always present alongside real ports.
    expect(select.options.length).toBe(4); // placeholder + Mock + 2 real outputs
  });

  it("does NOT list MIDI inputs in the output picker", async () => {
    midiMock.nextInputs = [makePort("i1", "IN-Keyboard")];
    midiMock.nextOutputs = [makePort("o1", "OUT-Synth")];
    renderPicker();
    await grant();
    expect(screen.getByRole("option", { name: "OUT-Synth" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "IN-Keyboard" })).not.toBeInTheDocument();
  });

  it("offers the Mock / Debug option alongside real outputs (Story 5.1)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    expect(
      screen.getByTestId("listener-output-mock-option"),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mock / Debug" })).toBeInTheDocument();
  });
});

describe("MidiPortPicker (listener) — empty state E4 (exact text, Mock still selectable)", () => {
  it("shows the EXACT empty-state text + refresh button when no outputs and Mock not selected", async () => {
    midiMock.nextOutputs = [];
    renderPicker();
    await grant();
    expect(screen.getByTestId("listener-output-empty-alert")).toHaveTextContent(
      "Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester.",
    );
    expect(
      screen.getByTestId("listener-output-refresh-button"),
    ).toHaveTextContent("Rafraîchir");
    // Story 5.1: the select is now present even with no real ports, so Mock is
    // selectable right there (the Alert is info, not a blocker).
    expect(screen.getByTestId("listener-output-select")).toBeInTheDocument();
    expect(
      screen.getByTestId("listener-output-mock-option"),
    ).toBeInTheDocument();
  });

  it("hides the E4 Alert once Mock is selected (non-blocking while Mock active)", async () => {
    midiMock.nextOutputs = [];
    renderPicker();
    await grant();
    expect(screen.getByTestId("listener-output-empty-alert")).toBeInTheDocument();
    act(() => {
      fireEvent.change(screen.getByTestId("listener-output-select"), {
        target: { value: "mock" },
      });
    });
    expect(
      screen.queryByTestId("listener-output-empty-alert"),
    ).not.toBeInTheDocument();
  });
});

describe("MidiPortPicker (listener) — selection updates the store", () => {
  it("selecting an output sets selectedOutputId in the store", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    fireEvent.change(screen.getByTestId("listener-output-select"), {
      target: { value: "o1" },
    });
    expect(useListenerStore.getState().selectedOutputId).toBe("o1");
  });
});

describe("MidiPortPicker (listener) — hot-plug via onstatechange (no polling)", () => {
  it("adds a new output live when one appears (no polling, via onstatechange)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    expect(screen.queryByRole("option", { name: "DX7" })).not.toBeInTheDocument();
    // Hot-plug: add a port to the live map, then fire the state-change handler
    // the provider registered. No timer/polling involved.
    await act(async () => {
      midiMock.lastAccess!.outputs.set("o2", makePort("o2", "DX7"));
      midiMock.lastAccess!.onstatechange!({ port: makePort("o2", "DX7") });
    });
    expect(screen.getByRole("option", { name: "DX7" })).toBeInTheDocument();
  });

  it("removes an output live when one disappears (via onstatechange)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM"), makePort("o2", "DX7")];
    renderPicker();
    await grant();
    expect(screen.getByRole("option", { name: "DX7" })).toBeInTheDocument();
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o2");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o2", "DX7") });
    });
    expect(screen.queryByRole("option", { name: "DX7" })).not.toBeInTheDocument();
  });

  it("clears the selection when the selected output disappears (no dangling id)", async () => {
    midiMock.nextOutputs = [
      makePort("o1", "Volca FM"),
      makePort("o2", "DX7"),
    ];
    renderPicker();
    await grant();
    fireEvent.change(screen.getByTestId("listener-output-select"), {
      target: { value: "o1" },
    });
    expect(useListenerStore.getState().selectedOutputId).toBe("o1");
    // Hot-unplug the SELECTED port; the other port remains, so the picker stays
    // mounted (not the empty state) and the selection must be cleared.
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    const select = screen.getByTestId("listener-output-select") as HTMLSelectElement;
    expect(select.value).toBe("");
    // The remaining port is still listed.
    expect(screen.getByRole("option", { name: "DX7" })).toBeInTheDocument();
  });

  it("does NOT change the list on its own — only via onstatechange (no polling)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderPicker();
    await grant();
    expect(screen.queryByRole("option", { name: "DX7" })).not.toBeInTheDocument();
    // Mutate the live map WITHOUT firing onstatechange, then wait a real tick.
    // The UI must NOT spontaneously pick up the change (no polling / no timer).
    midiMock.lastAccess!.outputs.set("o2", makePort("o2", "DX7"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(screen.queryByRole("option", { name: "DX7" })).not.toBeInTheDocument();
    // Now fire the state-change handler the provider registered → it appears.
    await act(async () => {
      midiMock.lastAccess!.onstatechange!({ port: makePort("o2", "DX7") });
    });
    expect(screen.getByRole("option", { name: "DX7" })).toBeInTheDocument();
  });
});