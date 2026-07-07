// @vitest-environment jsdom
// Story 3.2 — MIDI access provider + MidiPermissionButton + MidiPortPicker.
//
// A HOME-TYPED mock of `navigator.requestMIDIAccess` is used instead of
// `web-midi-test`: the story permits it ("Si web-midi-test pose problème, créer
// un mock maison typé... et le justifier"), and a hand-rolled fake gives exact,
// deterministic control over the three AC scenarios that matter here — granted
// (with inputs), denied (`NotAllowedError`), empty inputs — plus direct access
// to the `onstatechange` handler to prove hot-plug WITHOUT polling and WITHOUT
// a real `web-midi-test` scheduler. No real device, no network.
//
// Proves:
//   - `requestMIDIAccess` is NOT called at render/load (only on click).
//   - click "Connecter MIDI Input" → called exactly once with `{ sysex:false }`.
//   - inputs are listed + selectable; selecting updates `selectedInputId`.
//   - denied (`NotAllowedError`) → "Autorisation MIDI refusée." + "Réessayer";
//     retry calls `requestMIDIAccess({ sysex:false })` again.
//   - empty inputs → "Aucune entrée MIDI détectée. Branchez un clavier ou un
//     bus IAC." + a refresh button (E4, info not error).
//   - hot-plug via `onstatechange` adds/removes a port live, no polling, no
//     reload; removing the selected port clears the selection (no crash).
//   - NO `onmidimessage` handler is installed (no MIDI capture in this story).
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
import { MidiPermissionButton } from "../features/performer/components/MidiPermissionButton";
import { MidiPortPicker } from "../features/performer/components/MidiPortPicker";

// ---- Home-typed Web MIDI mock ---------------------------------------------

interface FakeMIDIInput {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  /** Story 3.2 must NOT install this. */
  onmidimessage: ((e: unknown) => void) | null;
}

interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIInput>;
  outputs: Map<string, unknown>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIInput }) => void) | null;
}

function makeInput(opts: {
  id: string;
  name?: string;
  manufacturer?: string;
  state?: string;
  connection?: string;
}): FakeMIDIInput {
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    manufacturer: opts.manufacturer ?? "TestMfg",
    state: opts.state ?? "connected",
    connection: opts.connection ?? "closed",
    onmidimessage: null,
  };
}

function makeMidiAccess(inputs: FakeMIDIInput[]): FakeMIDIAccess {
  return {
    inputs: new Map(inputs.map((i) => [i.id, i])),
    outputs: new Map(),
    sysexEnabled: false,
    onstatechange: null,
  };
}

// Controller for the planted `navigator.requestMIDIAccess` spy. Each call reads
// the current `nextError` / `nextInputs` so a test can stage a denied-then-grant
// sequence by mutating the controller between clicks.
const midiMock = {
  spy: vi.fn(),
  nextError: null as DOMException | null,
  nextInputs: [] as FakeMIDIInput[],
  lastAccess: null as FakeMIDIAccess | null,
  lastOptions: undefined as unknown,
};

midiMock.spy = vi.fn(async (options?: { sysex?: boolean }) => {
  midiMock.lastOptions = options;
  if (midiMock.nextError) {
    const e = midiMock.nextError;
    midiMock.nextError = null;
    throw e;
  }
  const access = makeMidiAccess(midiMock.nextInputs);
  midiMock.lastAccess = access;
  return access as unknown as MIDIAccess;
});

// The MIDI flow under test (mirrors the PerformerPanel connected branch: both
// components are mounted and self-toggle on the provider's status).
function MidiFlow() {
  return (
    <>
      <MidiPermissionButton />
      <MidiPortPicker />
    </>
  );
}

function renderFlow() {
  return render(
    <MidiAccessProvider>
      <MidiFlow />
    </MidiAccessProvider>,
  );
}

beforeEach(() => {
  midiMock.spy.mockClear();
  midiMock.nextError = null;
  midiMock.nextInputs = [];
  midiMock.lastAccess = null;
  midiMock.lastOptions = undefined;
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  try {
    delete (navigator as unknown as Record<string, unknown>)
      .requestMIDIAccess;
  } catch {
    /* already absent */
  }
});

describe("MIDI permission — requestMIDIAccess is NOT called at load", () => {
  it("renders idle (button present) without ever calling requestMIDIAccess", () => {
    renderFlow();
    expect(screen.getByRole("button", { name: "Connecter MIDI Input" })).toBeInTheDocument();
    expect(midiMock.spy).not.toHaveBeenCalled();
  });
});

describe("MIDI permission — granted on click", () => {
  it("click → requestMIDIAccess called exactly once with { sysex:false }", async () => {
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    expect(midiMock.spy).toHaveBeenCalledTimes(1);
    expect(midiMock.lastOptions).toEqual({ sysex: false });
  });

  it("inputs are listed in the picker after access is granted", async () => {
    midiMock.nextInputs = [
      makeInput({ id: "p1", name: "K-Board", manufacturer: "Korg" }),
      makeInput({ id: "p2", name: "Volca FM", manufacturer: "Korg" }),
    ];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "K-Board" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: "Volca FM" })).toBeInTheDocument();
    // The permission button is gone (picker took over).
    expect(screen.queryByRole("button", { name: "Connecter MIDI Input" })).not.toBeInTheDocument();
  });
});

describe("MIDI permission — denied (E3)", () => {
  it("NotAllowedError → 'Autorisation MIDI refusée.' + 'Réessayer'", async () => {
    midiMock.nextError = new DOMException("Permission denied", "NotAllowedError");
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByText("Autorisation MIDI refusée.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
    expect(midiMock.spy).toHaveBeenCalledTimes(1);
  });

  it("retry calls requestMIDIAccess({ sysex:false }) again and succeeds", async () => {
    midiMock.nextError = new DOMException("Permission denied", "NotAllowedError");
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByText("Autorisation MIDI refusée.")).toBeInTheDocument(),
    );
    // Stage a successful grant for the retry.
    midiMock.nextError = null;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "K-Board" })).toBeInTheDocument(),
    );
    expect(midiMock.spy).toHaveBeenCalledTimes(2);
    expect(midiMock.spy.mock.calls[1][0]).toEqual({ sysex: false });
  });
});

describe("MIDI port picker — empty state (E4)", () => {
  it("no inputs → 'Aucune entrée MIDI détectée...' + refresh button", async () => {
    midiMock.nextInputs = [];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Aucune entrée MIDI détectée. Branchez un clavier ou un bus IAC.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Rafraîchir" })).toBeInTheDocument();
    // E4 is an info Alert, not the destructive denial Alert.
    expect(screen.queryByText("Autorisation MIDI refusée.")).not.toBeInTheDocument();
  });

  it("refresh re-snapshots WITHOUT a new requestMIDIAccess call", async () => {
    midiMock.nextInputs = [];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rafraîchir" })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    });
    expect(midiMock.spy).toHaveBeenCalledTimes(1); // still just the initial grant
  });
});

describe("MIDI port picker — selection (no capture)", () => {
  it("choosing a port updates selectedInputId; no onmidimessage installed", async () => {
    midiMock.nextInputs = [
      makeInput({ id: "p1", name: "K-Board" }),
      makeInput({ id: "p2", name: "Volca FM" }),
    ];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByTestId("midi-input-select")).toBeInTheDocument(),
    );
    const select = screen.getByTestId("midi-input-select") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "p2" } });
    });
    expect(select.value).toBe("p2");
    // No MIDI capture: the selected input's onmidimessage stays null.
    const selectedInput = midiMock.lastAccess!.inputs.get("p2")!;
    expect(selectedInput.onmidimessage).toBeNull();
    // None of the inputs got an onmidimessage handler.
    midiMock.lastAccess!.inputs.forEach((input) => {
      expect(input.onmidimessage).toBeNull();
    });
  });
});

describe("MIDI hot-plug — onstatechange (no polling, no reload)", () => {
  it("firing onstatechange with a new port ADDS it to the list live", async () => {
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "K-Board" })).toBeInTheDocument(),
    );
    // Hot-plug a second port, then fire the event the provider subscribed to.
    const added = makeInput({ id: "p2", name: "Volca FM" });
    midiMock.lastAccess!.inputs.set("p2", added);
    await act(async () => {
      midiMock.lastAccess!.onstatechange?.({ port: added });
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Volca FM" })).toBeInTheDocument(),
    );
    // No re-request (no polling / no reload): still a single requestMIDIAccess.
    expect(midiMock.spy).toHaveBeenCalledTimes(1);
  });

  it("firing onstatechange after removing a port REMOVES it; selected port is cleared", async () => {
    midiMock.nextInputs = [
      makeInput({ id: "p1", name: "K-Board" }),
      makeInput({ id: "p2", name: "Volca FM" }),
    ];
    renderFlow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByTestId("midi-input-select")).toBeInTheDocument(),
    );
    const select = screen.getByTestId("midi-input-select") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "p2" } });
    });
    expect(select.value).toBe("p2");
    // Disconnect the selected port, then fire onstatechange.
    const removed = midiMock.lastAccess!.inputs.get("p2")!;
    midiMock.lastAccess!.inputs.delete("p2");
    await act(async () => {
      midiMock.lastAccess!.onstatechange?.({ port: removed });
    });
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Volca FM" })).not.toBeInTheDocument(),
    );
    // Selection cleared (no dangling id, no crash) — back to the placeholder.
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "K-Board" })).toBeInTheDocument();
    expect(midiMock.spy).toHaveBeenCalledTimes(1); // no re-request
  });
});