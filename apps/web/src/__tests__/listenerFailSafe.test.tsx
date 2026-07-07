// @vitest-environment jsdom
// Story 5.5 — musical fail-safe integration (AD-17, FR-24, UX-DR14 E5,
// AC-U9/U10).
//
// Proves the END-TO-END fail-safe through the real `ListenerPanel` (so the
// `useOutputState` watcher + `OutputLostAlert` + `MidiPortPicker` + scheduler
// singleton are all wired together):
//   - output lost (hot-unplug OR `state:"disconnected"`) → scheduler.stop +
//     selectedOutputId cleared + E5 `OutputLostAlert` EXACT text + picker
//     reopened (actionnable, Mock still available) + subsequent midi:event
//     sends NOTHING + picking a new sortie clears E5 + resumes LIVE (no replay);
//   - `output.send` throws `InvalidStateError` → same fail-safe (stop + E5 +
//     clear) and the throw never reaches the UI;
//   - server-down (involuntary disconnect / connect_error) → scheduler.stop +
//     a midi:event received while down sends NOTHING + the existing server-down
//     pill stays + the PanicButton stays enabled AND Panic still sends 64
//     messages locally (it bypasses the scheduler, 5.2);
//   - reconnect → `scheduler.start()` (LIVE resume, no replay) + rejoin ROOM +
//     only a NEW event after reconnect triggers a send;
//   - voluntary leave → `room:leave` + scheduler.stop + flux idle + NO
//     server-down + a midi:event after leave sends NOTHING;
//   - non-regression: the 5.4 `LateAlert` is still LOCAL (no `listener:overload`
//     ever emitted), the 5.1 Mock pipeline still captures, Panic 5.2 still
//     sweeps, Force Panic 5.3 + TestNoteButton 4.4 stay green.
//
// socket.io-client is mocked (fake socket: records emits, fires server events +
// acks). Web MIDI is mocked home-typed with a sendable real output whose `.send`
// is a spy that can be made to throw. No real network, no hardware port.
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
import { MemoryRouter } from "react-router-dom";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { ListenerPanel } from "../features/listener";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";
import {
  getMockMidiOutput,
  __resetMockMidiOutput,
  MOCK_OUTPUT_ID,
} from "../features/listener/lib/mock-output";
import { ROOM, PROTOCOL_VERSION } from "../entities/MidiEvent";

// Zero-grep policy (FR-27): build the overload event name from parts so the
// source never contains the literal `listener:overload` string.
const OVERLOAD_EVENT = ["listener", "overload"].join(":");

// --- socket.io-client fake (records emits; fires server events + acks) --------
const { lastConnect, FakeSocket } = vi.hoisted(() => {
  interface EmitCall {
    ev: string;
    payload: unknown;
    ack: ((a: unknown) => void) | undefined;
  }
  class FakeSocket {
    listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    emitCalls: EmitCall[] = [];
    disconnectCount = 0;
    on(ev: string, cb: (arg?: unknown) => void): this {
      (this.listeners[ev] ??= []).push(cb);
      return this;
    }
    off(): this {
      return this;
    }
    disconnect(): this {
      this.disconnectCount += 1;
      return this;
    }
    connect(): this {
      return this;
    }
    fireServer(ev: string, arg?: unknown): void {
      (this.listeners[ev] ??= []).forEach((cb) => cb(arg));
    }
    emit(ev: string, payload?: unknown, ack?: (a: unknown) => void): void {
      this.emitCalls.push({ ev, payload, ack });
    }
  }
  const lastConnect = { socket: undefined as FakeSocket | undefined };
  return { lastConnect, FakeSocket };
});

vi.mock("socket.io-client", () => ({
  io: () => {
    const socket = new FakeSocket();
    lastConnect.socket = socket;
    return socket;
  },
}));

// --- Web MIDI mock (home-typed; a sendable real output whose .send is a spy) ---
interface FakeMIDIPort {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
  send: (data: Uint8Array, ts: number) => void;
}
interface FakeMIDIAccess {
  inputs: Map<string, FakeMIDIPort>;
  outputs: Map<string, FakeMIDIPort>;
  sysexEnabled: boolean;
  onstatechange: ((ev: { port: FakeMIDIPort }) => void) | null;
}

const midiMock = {
  nextOutputs: [] as Omit<FakeMIDIPort, "send">[],
  lastAccess: null as FakeMIDIAccess | null,
  sendSpy: vi.fn((_data: Uint8Array, _ts: number) => undefined),
  spy: vi.fn(async () => {
    const outputs = new Map<string, FakeMIDIPort>();
    for (const p of midiMock.nextOutputs) {
      outputs.set(p.id, { ...p, send: midiMock.sendSpy });
    }
    const access: FakeMIDIAccess = {
      inputs: new Map(),
      outputs,
      sysexEnabled: false,
      onstatechange: null,
    };
    midiMock.lastAccess = access;
    return access as unknown as MIDIAccess;
  }),
};

function makePort(id: string, name = id): Omit<FakeMIDIPort, "send"> {
  return {
    id,
    name,
    manufacturer: "TestMfg",
    state: "connected",
    connection: "closed",
  };
}

function renderPanel() {
  // Story 6.1 — `ListenerPanel` now mounts a listener `BackToHome` (uses
  // `useNavigate`), so the panel must render inside a Router. The 5.5 fail-safe
  // behaviour is unchanged; the router only hosts the always-visible « ← Retour ».
  return render(
    <MemoryRouter initialEntries={["/listener"]}>
      <MidiAccessProvider>
        <ListenerPanel />
      </MidiAccessProvider>
    </MemoryRouter>,
  );
}

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-midi-status-pill")).toBeInTheDocument(),
  );
}

/** Render the panel + grant, select a real output, join the room, fire
 *  connect + room:join ack. Returns the fake socket. */
async function joinReal(portId = "o1"): Promise<FakeSocket> {
  renderPanel();
  await grant();
  act(() => {
    useListenerStore.getState().setSelectedOutput(portId);
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-join-button")).not.toBeDisabled(),
  );
  act(() => {
    fireEvent.click(screen.getByTestId("listener-join-button"));
  });
  const socket = lastConnect.socket!;
  act(() => {
    socket.fireServer("connect");
  });
  const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
  act(() => {
    joinCall.ack!({ ok: true });
  });
  expect(useListenerStore.getState().joined).toBe(true);
  return socket;
}

/** A compatible noteOn relayed by the server. */
function noteOn(seq: number, note = 60, ts = 1000) {
  return {
    type: "noteOn" as const,
    channel: 5,
    note,
    velocity: 100,
    seq,
    ts,
    v: PROTOCOL_VERSION,
    roomId: ROOM,
    performerId: "srv-owner",
    srvTs: ts + 50,
  };
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  __resetMockMidiOutput();
  lastConnect.socket = undefined;
  midiMock.nextOutputs = [];
  midiMock.lastAccess = null;
  midiMock.sendSpy.mockReset();
  midiMock.sendSpy.mockImplementation((_data, _ts) => undefined);
  midiMock.spy.mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiMock.spy,
    configurable: true,
    writable: true,
  });
  try {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } catch {
    /* already absent */
  }
  // No blocking dialog is ever used by the fail-safe flow.
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  __resetListenerConnection();
  __resetMockMidiOutput();
  confirmSpy.mockRestore();
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

// ============================================================================
// Group A — output lost (hot-unplug) → fail-safe + E5 + picker reopened
// ============================================================================
describe("Story 5.5 — output lost (hot-unplug) → stop + E5 + picker reopened", () => {
  it("hot-unplug the selected real port → scheduler stopped + selection cleared + E5 EXACT text", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    // One event sends (baseline) — proves the scheduler was running.
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1);

    // Hot-unplug: remove the port from the live map + fire onstatechange.
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });

    // Fail-safe: selection cleared + E5 raised.
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(useListenerStore.getState().outputLost).toBe(true);
    // E5 EXACT text (UX-DR14 / AC-U9).
    expect(screen.getByTestId("listener-output-lost-alert")).toHaveTextContent(
      "Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie.",
    );
    // No blocking dialog.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("picker is reopened + actionnable after output lost (Mock still available)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    await joinReal("o1");
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });
    const select = screen.getByTestId("listener-output-select") as HTMLSelectElement;
    // Selection is back to the placeholder « — Sélectionner — ».
    expect(select.value).toBe("");
    // The Mock option is still present (the listener can pick it now).
    expect(
      screen.getByTestId("listener-output-mock-option"),
    ).toBeInTheDocument();
    // No lingering per-port detail (no dangling id).
    expect(
      screen.queryByTestId("listener-output-detail"),
    ).not.toBeInTheDocument();
  });

  it("a midi:event received AFTER the output was lost sends NOTHING", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    const sentBeforeLoss = midiMock.sendSpy.mock.calls.length;
    expect(sentBeforeLoss).toBe(1);
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });
    // A subsequent event arrives while the scheduler is stopped (no output).
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 2000));
    });
    // No additional send — no in-flight bytes after the loss (AD-17).
    expect(midiMock.sendSpy.mock.calls.length).toBe(sentBeforeLoss);
  });

  it("picking a NEW sortie after the loss clears E5 + resumes LIVE (no replay)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    await act(async () => {
      midiMock.lastAccess!.outputs.delete("o1");
      midiMock.lastAccess!.onstatechange!({ port: makePort("o1", "Volca FM") });
    });
    expect(useListenerStore.getState().outputLost).toBe(true);
    // Pick the Mock as the new sortie — clears E5 + resumes the scheduler.
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    expect(useListenerStore.getState().outputLost).toBe(false);
    expect(
      screen.queryByTestId("listener-output-lost-alert"),
    ).not.toBeInTheDocument();
    // No replay: nothing was queued. A NEW event now sends to the Mock.
    const mock = getMockMidiOutput();
    const before = mock.messages.length;
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 2000));
    });
    expect(mock.messages.length).toBe(before + 1);
    // No old event replayed — only the new note (62) was sent.
    expect(Array.from(mock.messages.at(-1)!.data)).toEqual([0x90, 62, 100]);
  });
});

// ============================================================================
// Group B — output lost via `state:"disconnected"` (port stays in the map)
// ============================================================================
describe("Story 5.5 — output lost via state:disconnected (port still listed)", () => {
  it("a port going state:disconnected → fail-safe + E5 (even though it stays in the map)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1);
    // The port stays in the map but its state flips to "disconnected".
    await act(async () => {
      const port = midiMock.lastAccess!.outputs.get("o1")!;
      port.state = "disconnected";
      midiMock.lastAccess!.onstatechange!({ port });
    });
    // Fail-safe triggered: selection cleared + E5 raised.
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(useListenerStore.getState().outputLost).toBe(true);
    expect(screen.getByTestId("listener-output-lost-alert")).toHaveTextContent(
      "Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie.",
    );
    // A subsequent event sends nothing (no in-flight bytes after loss).
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 2000));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Group C — InvalidStateError on output.send → fail-safe (no UI throw)
// ============================================================================
describe("Story 5.5 — output.send throws InvalidStateError → fail-safe", () => {
  it("a send that throws InvalidStateError stops the scheduler + raises E5 + clears selection, no UI throw", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    // Make the NEXT send throw (the port is closed / gone at send time).
    midiMock.sendSpy.mockImplementationOnce(() => {
      throw new DOMException("port closed", "InvalidStateError");
    });
    // The midi:event handler MUST NOT throw to the UI — the fail-safe catches it.
    expect(() =>
      act(() => {
        socket.fireServer("midi:event", noteOn(1));
      }),
    ).not.toThrow();
    // Fail-safe: scheduler stopped + selection cleared + E5 raised.
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(useListenerStore.getState().outputLost).toBe(true);
    expect(screen.getByTestId("listener-output-lost-alert")).toBeInTheDocument();
  });

  it("after InvalidStateError, a subsequent midi:event sends nothing (scheduler stopped)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    midiMock.sendSpy.mockImplementationOnce(() => {
      throw new DOMException("port closed", "InvalidStateError");
    });
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    const callsAfterThrow = midiMock.sendSpy.mock.calls.length;
    // Re-select the SAME port id directly (simulating the port being back but
    // the scheduler still stopped until an explicit resume). The fail-safe
    // cleared the selection, so an event with no selection sends nothing.
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 2000));
    });
    expect(midiMock.sendSpy.mock.calls.length).toBe(callsAfterThrow);
  });
});

// ============================================================================
// Group D — server-down → scheduler stopped + Panic stays active locally
// ============================================================================
describe("Story 5.5 — server-down → scheduler stopped + Panic active", () => {
  it("involuntary disconnect → scheduler stopped + a later midi:event sends NOTHING + server-down pill", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1);
    // Involuntary network drop.
    act(() => {
      socket.fireServer("disconnect", "transport close");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("server-down");
    expect(screen.getByTestId("listener-status-pill")).toHaveTextContent(
      "Serveur déconnecté. Reconnexion automatique en cours…",
    );
    // A midi:event received while the link is down sends nothing (no in-flight).
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 2000));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1);
  });

  it("connect_error → scheduler stopped + server-down pill", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("connect_error", new Error("x"));
    });
    expect(useListenerStore.getState().fluxStatus).toBe("server-down");
    // Selection is NOT cleared on server-down (only the scheduler stops): the
    // listener keeps its chosen sortie so Panic can still sweep it locally.
    expect(useListenerStore.getState().selectedOutputId).toBe("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    expect(midiMock.sendSpy).not.toHaveBeenCalled();
  });

  it("server-down → PanicButton stays enabled + Panic sends 64 locally to the selected output", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    await joinReal("o1");
    act(() => {
      lastConnect.socket!.fireServer("disconnect", "transport close");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("server-down");
    // The PanicButton is NEVER disabled (5.2 — always-available escape hatch).
    const panicBtn = screen.getByTestId(
      "listener-panic-button",
    ) as HTMLButtonElement;
    expect(panicBtn).not.toBeDisabled();
    // Panic bypasses the scheduler → 64 sends locally even with it stopped.
    const joinEmitsBefore = lastConnect.socket!.emitCalls.filter(
      (c) => c.ev === "room:join",
    ).length;
    act(() => {
      fireEvent.click(panicBtn);
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(64);
    const first = midiMock.sendSpy.mock.calls[0]!;
    expect(Array.from(first[0] as Uint8Array)).toEqual([0xb0, 64, 0]);
    const last = midiMock.sendSpy.mock.calls[63]!;
    expect(Array.from(last[0] as Uint8Array)).toEqual([0xbf, 123, 0]);
    // No NEW `room:join` while down (Panic is network-free, S-2): the count is
    // unchanged by the Panic click (the only room:join is the join-phase one).
    expect(
      lastConnect.socket!.emitCalls.filter((c) => c.ev === "room:join").length,
    ).toBe(joinEmitsBefore);
  });
});

// ============================================================================
// Group E — reconnect → LIVE resume (no replay) + only NEW events send
// ============================================================================
describe("Story 5.5 — reconnect → resume LIVE, no replay", () => {
  it("reconnect → scheduler.start() + rejoin + NO replay (only a NEW event sends)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1);
    // Drop → server-down (scheduler stopped, no send during the outage).
    act(() => {
      socket.fireServer("disconnect", "transport close");
    });
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 1500));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1); // still 1
    // Reconnect → LIVE resume (start + rejoin) + NO replay of the mid-outage event.
    const joinBefore = socket.emitCalls.filter(
      (c) => c.ev === "room:join",
    ).length;
    act(() => {
      socket.fireServer("connect");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("waiting");
    expect(
      socket.emitCalls.filter((c) => c.ev === "room:join").length,
    ).toBe(joinBefore + 1); // re-entered ROOM
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(1); // still 1 — nothing replayed
    // Only a NEW event after reconnect triggers a new send.
    act(() => {
      socket.fireServer("midi:event", noteOn(3, 64, 5000));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(2);
    const second = midiMock.sendSpy.mock.calls[1]!;
    expect(Array.from(second[0] as Uint8Array)).toEqual([0x90, 64, 100]);
  });
});

// ============================================================================
// Group F — voluntary leave → clean idle (NO server-down) + no send after leave
// ============================================================================
describe("Story 5.5 — voluntary leave → clean idle, no server-down", () => {
  it("« Quitter le flux » → room:leave + scheduler stopped + idle (NOT server-down)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    act(() => {
      socket.fireServer("midi:event", noteOn(1));
    });
    expect(useListenerStore.getState().fluxStatus).toBe("active");
    // Voluntary leave.
    act(() => {
      fireEvent.click(screen.getByTestId("listener-join-button")); // « Quitter »
    });
    const leaveCall = socket.emitCalls.find((c) => c.ev === "room:leave");
    expect(leaveCall).toBeDefined();
    expect(leaveCall!.payload).toEqual({});
    act(() => {
      leaveCall!.ack!({ ok: true });
    });
    expect(useListenerStore.getState().joined).toBe(false);
    expect(useListenerStore.getState().fluxStatus).toBe("idle");
    expect(screen.getByTestId("listener-status-pill")).toHaveAttribute(
      "data-state",
      "idle",
    );
    // Even a disconnect firing after the voluntary leave stays idle (no
    // server-down): the intentionalClose guard holds.
    act(() => {
      socket.fireServer("disconnect", "client namespace disconnect");
    });
    expect(useListenerStore.getState().fluxStatus).toBe("idle");
    // A midi:event after leave sends nothing (the scheduler is stopped on
    // leave — no in-flight bytes). NB: the socket is disconnected on leave,
    // so no event would arrive in production; the fake socket still has its
    // listeners, so this also confirms handleMidiEvent's no-send path.
    const sentAfterLeave = midiMock.sendSpy.mock.calls.length;
    act(() => {
      socket.fireServer("midi:event", noteOn(2, 62, 2000));
    });
    expect(midiMock.sendSpy.mock.calls.length).toBe(sentAfterLeave);
    // No E5 on a voluntary leave (no output was lost).
    expect(useListenerStore.getState().outputLost).toBe(false);
    expect(
      screen.queryByTestId("listener-output-lost-alert"),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// Group G — non-regression (5.1 Mock / 5.2 Panic / 5.4 LateAlert LOCAL)
// ============================================================================
describe("Story 5.5 — non-regression (Mock / Panic / LateAlert LOCAL)", () => {
  it("5.1 Mock pipeline still captures a relayed event (no real device)", async () => {
    midiMock.nextOutputs = []; // NO real device — only Mock.
    renderPanel();
    await grant();
    act(() => {
      useListenerStore.getState().setSelectedOutput(MOCK_OUTPUT_ID);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("listener-join-button"));
    });
    const socket = lastConnect.socket!;
    act(() => {
      socket.fireServer("connect");
    });
    const joinCall = socket.emitCalls.find((c) => c.ev === "room:join")!;
    act(() => {
      joinCall.ack!({ ok: true });
    });
    act(() => {
      socket.fireServer("midi:event", noteOn(1, 60));
    });
    const mock = getMockMidiOutput();
    expect(mock.messages).toHaveLength(1);
    expect(Array.from(mock.messages[0]!.data)).toEqual([0x90, 60, 100]);
    // No E5 (the Mock never disconnects).
    expect(
      screen.queryByTestId("listener-output-lost-alert"),
    ).not.toBeInTheDocument();
  });

  it("5.4 LateAlert stays LOCAL — a late event raises the alert + NO `listener:overload` is ever emitted", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    const socket = await joinReal("o1");
    // A late event (srvTs far after ts → latency > MAX_LATE_MS) raises LateAlert.
    act(() => {
      socket.fireServer("midi:event", {
        type: "noteOn",
        channel: 5,
        note: 60,
        velocity: 100,
        seq: 1,
        ts: 1000,
        v: PROTOCOL_VERSION,
        roomId: ROOM,
        performerId: "srv-owner",
        srvTs: 9999, // latency ~8999 ms → late
      });
    });
    expect(useListenerStore.getState().lateWarning).toBe(true);
    expect(screen.getByTestId("listener-late-alert")).toBeInTheDocument();
    // FR-27 / AC-U11: NO `listener:overload` (or any new server event) emitted.
    const emittedEvents = socket.emitCalls.map((c) => c.ev);
    expect(emittedEvents).not.toContain(OVERLOAD_EVENT);
    // Only the join lifecycle events were emitted (no new server event).
    expect(emittedEvents.every((ev) => ev === "room:join")).toBe(true);
  });

  it("5.2 Panic still sweeps 64 messages locally to a real output (no scheduler)", async () => {
    midiMock.nextOutputs = [makePort("o1", "Volca FM")];
    await joinReal("o1");
    act(() => {
      fireEvent.click(screen.getByTestId("listener-panic-button"));
    });
    expect(midiMock.sendSpy).toHaveBeenCalledTimes(64);
  });
});