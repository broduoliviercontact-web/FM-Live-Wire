// @vitest-environment jsdom
// Story 5.2 — Panic integration: Mock output + server-down + real output.
//
// Proves the end-to-end behavior the AC demands:
//   - Mock selected → click Panic → MockMidiOutput captures 192 messages (128
//     noteOff channel sweep + 64 CC) AND MockByteStream displays them (no sound);
//   - server-down → click Panic → 192 messages sent locally, with NO socket
//     created / NO `socket.emit` (S-2 / AC-U13 — Panic is network-free);
//   - a real output selected → click Panic → `output.send` is called exactly
//     192 times (128 noteOff sweep + the AD-7 CC 64/120/121/123 × 16 channels);
//   - no Force Panic / backpressure / buffer / drop / late alert is introduced.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { MidiPermissionButton } from "../features/listener/components/MidiPermissionButton";
import { PanicButton } from "../features/listener/components/PanicButton";
import { MockByteStream } from "../features/listener/components/MockByteStream";
import { useListenerStore } from "../features/listener/store/listenerStore";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";

// --- socket.io-client spy: MUST never be called by Panic (S-2) --------------
const ioSpy = vi.hoisted(() => vi.fn());
vi.mock("socket.io-client", () => ({ io: ioSpy }));

// --- Web MIDI mock (home-typed; 0 or 1 real outputs) -----------------------
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

const midiMock = {
  nextOutputs: [] as FakeMIDIPort[],
  lastAccess: null as FakeMIDIAccess | null,
  sendSpy: vi.fn(), // real output .send spy (set on grant)
  spy: vi.fn(async () => {
    const outputs = new Map<string, FakeMIDIPort & { send: typeof midiMock.sendSpy }>();
    for (const p of midiMock.nextOutputs) {
      outputs.set(p.id, { ...p, send: midiMock.sendSpy });
    }
    const access: FakeMIDIAccess = {
      inputs: new Map(),
      outputs: outputs as unknown as Map<string, FakeMIDIPort>,
      sysexEnabled: false,
      onstatechange: null,
    };
    midiMock.lastAccess = access;
    return access as unknown as MIDIAccess;
  }),
};

function makePort(id: string, name = id): FakeMIDIPort {
  return { id, name, manufacturer: "TestMfg", state: "connected", connection: "closed" };
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetMockMidiOutput();
  midiMock.nextOutputs = [];
  midiMock.lastAccess = null;
  midiMock.sendSpy.mockClear();
  midiMock.spy.mockClear();
  ioSpy.mockClear();
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  __resetMockMidiOutput();
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

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
}

// ============================================================================
// Group A — Mock integration: 192 messages (128 sweep + 64 CC) + MockByteStream lines + no sound
// ============================================================================
describe("Panic + Mock — 192 messages (128 sweep + 64 CC), lines on screen, no hardware sound", () => {
  function renderMock() {
    return render(
      <MidiAccessProvider>
        <PanicButton />
        <MockByteStream />
      </MidiAccessProvider>,
    );
  }

  it("selecting Mock + clicking Panic → 128 noteOff sweep + 64 CC captured + MockByteStream shows lines", () => {
    midiMock.nextOutputs = []; // NO real device — only Mock (no hardware sound).
    renderMock();
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });

    // Hotfix fidélité musicale — normal Panic = 128-noteOff channel sweep
    // (Option B) + the 64-CC sweep (5.2) = 192 messages (no tracked noteOffs
    // here since no noteOn was played). Distinct from Force Panic (2048).
    const mock = getMockMidiOutput();
    expect(mock.messages).toHaveLength(192);

    // The first 128 are noteOff `[0x80|ch, note, 0]` on the selected channel 0.
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x80, 0, 0]);
    expect(Array.from(mock.messages[127]!.data)).toEqual([0x80, 127, 0]);
    // The last 64 are the CC sweep. Index 128 = channel 0 CC 64; 131 = CC 123.
    expect(Array.from(mock.messages[128]!.data)).toEqual([0xb0, 64, 0]);
    expect(Array.from(mock.messages[131]!.data)).toEqual([0xb0, 123, 0]);
    // The very last is channel 15 (status 0xBF) CC 123.
    expect(Array.from(mock.messages[191]!.data)).toEqual([0xbf, 123, 0]);

    // MockByteStream decoded + displayed all 192 lines: 128 noteOff + 64 cc.
    const lines = screen.getAllByTestId("listener-mock-byte-stream-line");
    expect(lines).toHaveLength(192);
    expect(lines[0]).toHaveAttribute("data-type", "noteOff");
    expect(lines[0]).toHaveTextContent("noteOff · ch1 · 0 · 0"); // ch0 → UI ch1
    expect(lines[128]).toHaveAttribute("data-type", "cc");
    expect(lines[128]).toHaveTextContent("cc · ch1 · 64 · 0");
    expect(lines[191]).toHaveTextContent("cc · ch16 · 123 · 0"); // ch15 → UI ch16
  });

  it("produces NO hardware sound (0 real outputs; only the Mock singleton receives sends)", () => {
    midiMock.nextOutputs = []; // zero real outputs → no hardware send is possible
    renderMock();
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    // The only sink is the Mock singleton (a plain object with no audio access).
    expect(getMockMidiOutput().messages).toHaveLength(192);
    // No real output port exists, so no hardware send could have happened.
    expect(midiMock.nextOutputs).toHaveLength(0);
  });
});

// ============================================================================
// Group B — server-down: Panic works locally, NO socket.emit (S-2 / AC-U13)
// ============================================================================
describe("Panic + server-down — local sweep, no socket created / no emit", () => {
  function renderPanic() {
    return render(
      <MidiAccessProvider>
        <PanicButton />
      </MidiAccessProvider>,
    );
  }

  it("with the backend down, clicking Panic sends 192 messages locally (Mock)", () => {
    renderPanic();
    act(() => {
      useListenerStore.getState().setFluxStatus("server-down");
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(192);
  });

  it("Panic NEVER creates a socket / calls `socket.emit` — `io` spy untouched", () => {
    renderPanic();
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    expect(ioSpy).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(getMockMidiOutput().messages).toHaveLength(192);
    // The socket.io-client `io` factory was never called by Panic — there is
    // no socket to `.emit` on. Panic is fully network-free (S-2 / AC-U13).
    expect(ioSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Group C — real output: `output.send` called 192 times (128 sweep + AD-7 CC)
// ============================================================================
describe("Panic + real output — `output.send` called 192 times (128 sweep + AD-7 CC)", () => {
  function renderReal() {
    return render(
      <MidiAccessProvider>
        <MidiPermissionButton />
        <PanicButton />
      </MidiAccessProvider>,
    );
  }

  it("selecting a real port + clicking Panic → `output.send` called 192 times (128 sweep + 64 CC)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    renderReal();
    await grant();
    act(() => {
      useListenerStore.getState().setSelectedOutput("o1");
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    // 128-noteOff channel sweep + 64-CC panic = 192 sends.
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(192);
    // First call: channel 0 noteOff, note 0, value 0 (the Option B sweep).
    const first = midiMock.sendSpy.mock.calls[0]!;
    expect(Array.from(first[0] as Uint8Array)).toEqual([0x80, 0, 0]);
    // The CC sweep starts at index 128: channel 0, CC 64, value 0.
    const ccFirst = midiMock.sendSpy.mock.calls[128]!;
    expect(Array.from(ccFirst[0] as Uint8Array)).toEqual([0xb0, 64, 0]);
    // Last call: channel 15, CC 123, value 0.
    const last = midiMock.sendSpy.mock.calls[191]!;
    expect(Array.from(last[0] as Uint8Array)).toEqual([0xbf, 123, 0]);
    // No socket created during the real-output Panic either.
    expect(ioSpy).not.toHaveBeenCalled();
  });
});