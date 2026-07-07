// @vitest-environment jsdom
// Story 3.3 — `useMidiInput` capture hook tests (AD-3, AD-5, AD-8).
//
// Drives the hook through the real `MidiAccessProvider` + `MidiPortPicker` UI
// (grant access → select a port) using the same home-typed Web MIDI mock as
// Story 3.2, then fires `onmidimessage` on the planted fake input to prove:
//   - the handler IS installed on the selected input;
//   - a valid message produces a schema-valid `MidiEvent` using
//     `event.timeStamp` and a monotone `seq`;
//   - SysEx and out-of-scope types are silently ignored (no callback, no `seq`
//     gap — the next valid event keeps the contiguous sequence);
//   - the handler is cleared when the selection changes AND on unmount;
//   - NO `socket.emit` / no network happens (socket.io-client is mocked and
//     asserted never called).
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
import { useMidiInput } from "../features/performer/hooks/useMidiInput";
import { MidiEventSchema, ROOM, type MidiEvent } from "../entities/MidiEvent";

// Prove NO network relay happens: socket.io-client is mocked and asserted never
// called. (The hook must not import or use it.)
const { ioSpy } = vi.hoisted(() => ({ ioSpy: vi.fn() }));
vi.mock("socket.io-client", () => ({
  io: ioSpy,
  default: ioSpy,
  Manager: vi.fn(),
  Socket: vi.fn(),
}));

// ---- Home-typed Web MIDI mock (mirrors midiAccess.test.tsx) ----------------

interface FakeMIDIInput {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  onmidimessage: ((ev: MIDIMessageEvent) => void) | null;
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
}): FakeMIDIInput {
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    manufacturer: opts.manufacturer ?? "TestMfg",
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
};

midiMock.spy = vi.fn(async (options?: { sysex?: boolean }) => {
  if (midiMock.nextError) {
    const e = midiMock.nextError;
    midiMock.nextError = null;
    throw e;
  }
  const access = makeMidiAccess(midiMock.nextInputs);
  midiMock.lastAccess = access;
  return access as unknown as MIDIAccess;
});

function makeMessage(bytes: number[], timeStamp: number): MIDIMessageEvent {
  return { data: new Uint8Array(bytes), timeStamp } as unknown as MIDIMessageEvent;
}

// The hook probe: forwards decoded events to the test spy.
function HookProbe({ onEvent }: { onEvent: (e: MidiEvent) => void }) {
  useMidiInput({ onEvent });
  return null;
}

function renderHarness(onEvent: (e: MidiEvent) => void) {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <MidiPortPicker />
      <HookProbe onEvent={onEvent} />
    </MidiAccessProvider>,
  );
}

async function grantAndSelect(portId: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
  });
  await waitFor(() =>
    expect(screen.getByTestId("midi-input-select")).toBeInTheDocument(),
  );
  const select = screen.getByTestId("midi-input-select") as HTMLSelectElement;
  await act(async () => {
    fireEvent.change(select, { target: { value: portId } });
  });
}

beforeEach(() => {
  midiMock.spy.mockClear();
  midiMock.nextError = null;
  midiMock.nextInputs = [];
  midiMock.lastAccess = null;
  ioSpy.mockClear();
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
});

describe("useMidiInput — handler installation", () => {
  it("installs onmidimessage on the selected input", async () => {
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(vi.fn());
    await grantAndSelect("p1");
    await waitFor(() =>
      expect(midiMock.lastAccess!.inputs.get("p1")!.onmidimessage).not.toBeNull(),
    );
  });

  it("does NOT install a handler while no input is selected", async () => {
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(vi.fn());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connecter MIDI Input" }));
    });
    await waitFor(() =>
      expect(screen.getByTestId("midi-input-select")).toBeInTheDocument(),
    );
    // No selection yet → no handler.
    expect(midiMock.lastAccess!.inputs.get("p1")!.onmidimessage).toBeNull();
  });
});

describe("useMidiInput — decoding + seq + ts", () => {
  it("produces a schema-valid MidiEvent using event.timeStamp with seq=1", async () => {
    const onEvent = vi.fn();
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(onEvent);
    await grantAndSelect("p1");
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await waitFor(() => expect(input.onmidimessage).not.toBeNull());

    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 1111.5));
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    const ev = onEvent.mock.calls[0][0] as MidiEvent;
    expect(MidiEventSchema.safeParse(ev).success).toBe(true);
    expect(ev).toMatchObject({
      type: "noteOn",
      channel: 0,
      note: 60,
      velocity: 100,
      seq: 1,
      ts: 1111.5,
      v: 1,
      roomId: ROOM,
    });
    expect("performerId" in ev).toBe(false);
  });

  it("increments seq monotonically across valid events", async () => {
    const onEvent = vi.fn();
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(onEvent);
    await grantAndSelect("p1");
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await waitFor(() => expect(input.onmidimessage).not.toBeNull());

    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 100));
      input.onmidimessage!(makeMessage([0x80, 60, 0], 200));
      input.onmidimessage!(makeMessage([0xb0, 7, 42], 300));
    });
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect((onEvent.mock.calls[0][0] as MidiEvent).seq).toBe(1);
    expect((onEvent.mock.calls[1][0] as MidiEvent).seq).toBe(2);
    expect((onEvent.mock.calls[2][0] as MidiEvent).seq).toBe(3);
  });
});

describe("useMidiInput — silent filtering (no callback, no seq gap)", () => {
  it("ignores SysEx silently and does NOT consume a seq number", async () => {
    const onEvent = vi.fn();
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(onEvent);
    await grantAndSelect("p1");
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await waitFor(() => expect(input.onmidimessage).not.toBeNull());

    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 100)); // seq 1
      input.onmidimessage!(makeMessage([0xf0, 0x43, 0x1a, 0xf7], 200)); // SysEx → dropped
      input.onmidimessage!(makeMessage([0x90, 64, 110], 300)); // seq 2 (NOT 3)
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect((onEvent.mock.calls[1][0] as MidiEvent).seq).toBe(2);
  });

  it("ignores out-of-scope types (0xA0, 0xD0) silently", async () => {
    const onEvent = vi.fn();
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(onEvent);
    await grantAndSelect("p1");
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await waitFor(() => expect(input.onmidimessage).not.toBeNull());

    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 100)); // seq 1
      input.onmidimessage!(makeMessage([0xa0, 60, 90], 200)); // poly pressure → dropped
      input.onmidimessage!(makeMessage([0xd0, 90], 300)); // channel pressure → dropped
      input.onmidimessage!(makeMessage([0x80, 60, 0], 400)); // seq 2 (NOT 4)
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect((onEvent.mock.calls[1][0] as MidiEvent).seq).toBe(2);
  });
});

describe("useMidiInput — cleanup", () => {
  it("clears onmidimessage when the selection changes", async () => {
    midiMock.nextInputs = [
      makeInput({ id: "p1", name: "K-Board" }),
      makeInput({ id: "p2", name: "Volca FM" }),
    ];
    renderHarness(vi.fn());
    await grantAndSelect("p1");
    const p1 = midiMock.lastAccess!.inputs.get("p1")!;
    const p2 = midiMock.lastAccess!.inputs.get("p2")!;
    await waitFor(() => expect(p1.onmidimessage).not.toBeNull());
    expect(p2.onmidimessage).toBeNull();

    // Switch to p2.
    const select = screen.getByTestId("midi-input-select") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "p2" } });
    });
    await waitFor(() => expect(p2.onmidimessage).not.toBeNull());
    expect(p1.onmidimessage).toBeNull(); // cleared on the old input
  });

  it("clears onmidimessage on unmount", async () => {
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    const { unmount } = renderHarness(vi.fn());
    await grantAndSelect("p1");
    const p1 = midiMock.lastAccess!.inputs.get("p1")!;
    await waitFor(() => expect(p1.onmidimessage).not.toBeNull());

    unmount();
    expect(p1.onmidimessage).toBeNull();
  });
});

describe("useMidiInput — no network relay", () => {
  it("never calls socket.io-client (no emit / no relay)", async () => {
    const onEvent = vi.fn();
    midiMock.nextInputs = [makeInput({ id: "p1", name: "K-Board" })];
    renderHarness(onEvent);
    await grantAndSelect("p1");
    const input = midiMock.lastAccess!.inputs.get("p1")!;
    await waitFor(() => expect(input.onmidimessage).not.toBeNull());
    await act(async () => {
      input.onmidimessage!(makeMessage([0x90, 60, 100], 100));
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(ioSpy).not.toHaveBeenCalled();
  });
});