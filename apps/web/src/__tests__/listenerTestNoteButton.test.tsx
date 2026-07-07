// @vitest-environment jsdom
// Story 4.4 — TestNoteButton tests (FR-14, UX-DR9, AC-U4).
//
// Proves:
//   - without a selected output: « Note de test » is disabled with the EXACT
//     hint « Choisissez une sortie et un canal pour tester. », and clicking is
//     a no-op (no socket, no send, no toast);
//   - with a selected output + channel: clicking sends the local noteOn
//     `[0x90|ch, 60, 100]`, emits `midi:test` (NOT `room:join`) on the shared
//     listener socket, and shows the toast « Note de test envoyée. »;
//   - it does NOT emit `room:join` (no implicit join from the test button).
//
// socket.io-client is mocked with a fake socket (records emits). Web MIDI is
// mocked home-typed so the chosen output's `send` is observable. The global
// `Toaster` is mounted so sonner toasts render into the DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { MidiAccessProvider } from "../app/providers/MidiAccessProvider";
import { Toaster } from "../shared/ui/sonner";
import { MidiPermissionButton } from "../features/listener/components/MidiPermissionButton";
import { TestNoteButton } from "../features/listener/components/TestNoteButton";
import { useListenerStore } from "../features/listener/store/listenerStore";
import { __resetListenerConnection } from "../features/listener/api/connection";

const HINT = "Choisissez une sortie et un canal pour tester.";

// --- socket.io-client fake (records emits) ---------------------------------
const { lastConnect, FakeSocket } = vi.hoisted(() => {
  interface EmitCall {
    ev: string;
    payload: unknown;
    ack: ((a: unknown) => void) | undefined;
  }
  class FakeSocket {
    listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    emitCalls: EmitCall[] = [];
    on(ev: string, cb: (arg?: unknown) => void): this {
      (this.listeners[ev] ??= []).push(cb);
      return this;
    }
    off(): this {
      return this;
    }
    disconnect(): this {
      return this;
    }
    connect(): this {
      return this;
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

// --- Web MIDI mock (home-typed, sendable output) ----------------------------
const outSend = vi.fn((_data: Uint8Array, _ts?: number) => undefined);
const fakeOutput = {
  id: "o1",
  name: "Volca FM",
  manufacturer: "Korg",
  state: "connected",
  connection: "closed",
  send: outSend,
};
const midiSpy = vi.fn(async () => {
  const access = {
    inputs: new Map(),
    outputs: new Map([["o1", fakeOutput]]),
    sysexEnabled: false,
    onstatechange: null,
  } as unknown as MIDIAccess;
  return access;
});

function renderButton() {
  return render(
    <MidiAccessProvider>
      <TestNoteButton />
      <Toaster />
    </MidiAccessProvider>,
  );
}

async function renderFlowWithPermission() {
  render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <TestNoteButton />
      <Toaster />
    </MidiAccessProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
}

beforeEach(() => {
  useListenerStore.getState().reset();
  __resetListenerConnection();
  lastConnect.socket = undefined;
  outSend.mockClear();
  midiSpy.mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: midiSpy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  __resetListenerConnection();
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

describe("TestNoteButton — disabled without an output (AC-U4)", () => {
  it("renders « Note de test » disabled with the EXACT hint, no socket", () => {
    renderButton();
    const btn = screen.getByTestId(
      "listener-test-note-button",
    ) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Note de test");
    expect(screen.getByTestId("listener-test-note-hint")).toHaveTextContent(
      HINT,
    );
    // No socket opened.
    expect(lastConnect.socket).toBeUndefined();
  });

  it("clicking the disabled button is a no-op (no send, no socket, no toast)", () => {
    renderButton();
    const btn = screen.getByTestId(
      "listener-test-note-button",
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn); // disabled → onClick not fired by the browser
    });
    expect(outSend).not.toHaveBeenCalled();
    expect(lastConnect.socket).toBeUndefined();
    expect(
      screen.queryByText("Note de test envoyée."),
    ).not.toBeInTheDocument();
  });
});

describe("TestNoteButton — local note + midi:test + toast with an output", () => {
  it("sends local noteOn [0x90|ch,60,100], emits midi:test (no room:join), shows toast", async () => {
    await renderFlowWithPermission();
    act(() => {
      useListenerStore.getState().setSelectedOutput("o1");
    });

    const btn = screen.getByTestId(
      "listener-test-note-button",
    ) as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    act(() => {
      fireEvent.click(btn);
    });

    // Local noteOn sent immediately on the chosen output (canal data 0).
    expect(outSend).toHaveBeenCalled();
    const first = outSend.mock.calls[0] as [Uint8Array, number | undefined];
    expect(Array.from(first[0])).toEqual([0x90, 60, 100]);

    // midi:test emitted to the server.
    const socket = lastConnect.socket!;
    expect(socket).toBeDefined();
    const testCall = socket.emitCalls.find((c) => c.ev === "midi:test");
    expect(testCall).toBeDefined();
    // NOT room:join (no implicit join from the test button).
    const joinCall = socket.emitCalls.find((c) => c.ev === "room:join");
    expect(joinCall).toBeUndefined();
    // joined stays false.
    expect(useListenerStore.getState().joined).toBe(false);

    // Toast shown (sonner renders asynchronously → findByText waits).
    expect(await screen.findByText("Note de test envoyée.")).toBeInTheDocument();

    // Hint is gone once an output is selected.
    expect(
      screen.queryByTestId("listener-test-note-hint"),
    ).not.toBeInTheDocument();
  });

  it("uses the chosen canal (data 15) for the local noteOn status byte", async () => {
    await renderFlowWithPermission();
    act(() => {
      useListenerStore.getState().setSelectedOutput("o1");
      useListenerStore.getState().setChannel(15);
    });
    const btn = screen.getByTestId(
      "listener-test-note-button",
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn);
    });
    const first = outSend.mock.calls[0] as [Uint8Array, number | undefined];
    expect(Array.from(first[0])).toEqual([0x9f, 60, 100]);
  });

  it("plays the local note even before joining the flux (no join needed)", async () => {
    await renderFlowWithPermission();
    act(() => {
      useListenerStore.getState().setSelectedOutput("o1");
    });
    const btn = screen.getByTestId(
      "listener-test-note-button",
    ) as HTMLButtonElement;
    expect(useListenerStore.getState().joined).toBe(false);
    act(() => {
      fireEvent.click(btn);
    });
    expect(outSend).toHaveBeenCalled();
    expect(await screen.findByText("Note de test envoyée.")).toBeInTheDocument();
  });
});