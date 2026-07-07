// @vitest-environment jsdom
// Story 4.1 — listener MidiPermissionButton unit tests (UX-DR6, UX-DR14 E3,
// AD-3, UX-DR23).
//
// A HOME-TYPED mock of `navigator.requestMIDIAccess` is used (same approach as
// Stories 3.2 / 3.5): the consignes permit the home-typed mock if it covers the
// AC cleanly, and a hand-rolled fake gives exact, deterministic control over
// the four scenarios here — granted, denied (`NotAllowedError`), retry, and the
// "no call at load" guarantee — plus direct control over the `onstatechange`
// handler. No `web-midi-test` dependency added.
//
// Proves:
//   - `requestMIDIAccess` is NOT called at render/load (only on click).
//   - click "Connecter MIDI" → `requestMIDIAccess({ sysex:false })` called once.
//   - denied (`NotAllowedError`) → "Autorisation MIDI refusée." + "Réessayer".
//   - click "Réessayer" → `requestMIDIAccess({ sysex:false })` called again.
//   - success → StatusPill `connected` "MIDI autorisé".
//   - No output/channel/join/reception is wired (only the permission button).
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

// ---- Home-typed Web MIDI mock ---------------------------------------------

interface FakeMIDIInput {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  onmidimessage: ((e: unknown) => void) | null;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIInput>;
  outputs: Map<string, unknown>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIInput }) => void) | null;
}
function makeInput(id: string, name = id): FakeMIDIInput {
  return {
    id,
    name,
    manufacturer: "TestMfg",
    state: "connected",
    connection: "closed",
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

function renderButton() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
    </MidiAccessProvider>,
  );
}

beforeEach(() => {
  midiMock.spy.mockClear();
  midiMock.nextError = null;
  midiMock.nextInputs = [makeInput("p1", "K-Board")];
  midiMock.lastAccess = null;
  midiMock.lastOptions = undefined;
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

describe("MidiPermissionButton (listener) — requestMIDIAccess NOT called at load", () => {
  it("renders idle (button present) without ever calling requestMIDIAccess", () => {
    renderButton();
    expect(
      screen.getByTestId("listener-midi-permission-button"),
    ).toHaveTextContent("Connecter MIDI");
    expect(midiMock.spy).not.toHaveBeenCalled();
  });
});

describe("MidiPermissionButton (listener) — granted on click", () => {
  it("click → requestMIDIAccess called exactly once with { sysex:false }", async () => {
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    expect(midiMock.spy).toHaveBeenCalledTimes(1);
    expect(midiMock.lastOptions).toEqual({ sysex: false });
  });

  it("success → StatusPill connected 'MIDI autorisé' (no permission button)", async () => {
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("listener-midi-status-pill")).toHaveTextContent(
      "MIDI autorisé",
    );
    expect(screen.getByTestId("listener-midi-status-pill")).toHaveAttribute(
      "data-status",
      "connected",
    );
    expect(
      screen.queryByTestId("listener-midi-permission-button"),
    ).not.toBeInTheDocument();
  });
});

describe("MidiPermissionButton (listener) — denied (E3)", () => {
  it("NotAllowedError → 'Autorisation MIDI refusée.' + 'Réessayer'", async () => {
    midiMock.nextError = new DOMException("Permission denied", "NotAllowedError");
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByText("Autorisation MIDI refusée.")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("listener-midi-retry-button"),
    ).toHaveTextContent("Réessayer");
    expect(midiMock.spy).toHaveBeenCalledTimes(1);
  });

  it("click 'Réessayer' calls requestMIDIAccess({ sysex:false }) again", async () => {
    midiMock.nextError = new DOMException("Permission denied", "NotAllowedError");
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
    });
    await waitFor(() =>
      expect(screen.getByText("Autorisation MIDI refusée.")).toBeInTheDocument(),
    );
    // Stage a successful grant for the retry.
    midiMock.nextError = null;
    midiMock.nextInputs = [makeInput("p1", "K-Board")];
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-midi-retry-button"));
    });
    expect(midiMock.spy).toHaveBeenCalledTimes(2);
    expect(midiMock.lastOptions).toEqual({ sysex: false });
    // The retry succeeded → StatusPill appears.
    await waitFor(() =>
      expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
    );
  });
});