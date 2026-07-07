// @vitest-environment jsdom
// Story 4.2 — listener ChannelSelector tests. UX-DR8, AC-U5, AD-12.
// Story 6.3 — refactored to an accessible `radiogroup` (UX-DR25, AC-U18).
//
// Proves:
//   - it shows channels 1–16 (16 buttons);
//   - channel 1 is selected by default (data 0) — `aria-checked="true"` on 1;
//   - clicking channel 16 sets the store channel to data 15;
//   - clicking channel 1 sets the store channel to data 0;
//   - the EXACT tooltip text is present in the DOM (testable);
//   - it renders only once MIDI access is granted (null before);
//   - (Story 6.3) the grid is `role="radiogroup"`, the 16 buttons are
//     `role="radio"`, only the active radio is in the tab order (roving
//     tabindex), and arrow / Home / End keys move the selection + focus.
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
import { ChannelSelector } from "../features/listener/components/ChannelSelector";
import { useListenerStore } from "../features/listener/store/listenerStore";

const TOOLTIP =
  "Le canal ici = la sortie vers votre synthé. Le flux d'origine est ignoré : tout passe sur ce canal.";

const midiSpy = vi.fn(async () => {
  return {
    inputs: new Map(),
    outputs: new Map(),
    sysexEnabled: false,
    onstatechange: null,
  } as unknown as MIDIAccess;
});

function renderSelector() {
  return render(
    <MidiAccessProvider>
      <MidiPermissionButton />
      <ChannelSelector />
    </MidiAccessProvider>,
  );
}

async function grant() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("listener-midi-permission-button"));
  });
  await waitFor(() =>
    expect(screen.getByTestId("listener-channel-selector")).toBeInTheDocument(),
  );
}

beforeEach(() => {
  midiSpy.mockClear();
  useListenerStore.getState().reset();
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

describe("ChannelSelector (listener) — render gating", () => {
  it("renders nothing before MIDI access is granted", () => {
    renderSelector();
    expect(screen.queryByTestId("listener-channel-selector")).not.toBeInTheDocument();
  });
});

describe("ChannelSelector (listener) — grid 1–16, default 1, edge conversion", () => {
  it("renders 16 buttons labelled 1–16 after access is granted", async () => {
    renderSelector();
    await grant();
    for (let n = 1; n <= 16; n++) {
      expect(
        screen.getByTestId(`listener-channel-button-${n}`),
      ).toHaveTextContent(String(n));
    }
  });

  it("channel 1 is selected by default (store channel data 0) — aria-checked", async () => {
    renderSelector();
    await grant();
    expect(useListenerStore.getState().channel).toBe(0);
    expect(screen.getByTestId("listener-channel-selected")).toHaveTextContent("1");
    expect(screen.getByTestId("listener-channel-button-1")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("listener-channel-button-16")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("clicking channel 16 sets the store channel to data 15 (UI 16 → data 15)", async () => {
    renderSelector();
    await grant();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-channel-button-16"));
    });
    expect(useListenerStore.getState().channel).toBe(15);
    expect(screen.getByTestId("listener-channel-selected")).toHaveTextContent("16");
    expect(screen.getByTestId("listener-channel-button-16")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("clicking channel 1 sets the store channel to data 0 (UI 1 → data 0)", async () => {
    renderSelector();
    await grant();
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-channel-button-16"));
    });
    expect(useListenerStore.getState().channel).toBe(15);
    await act(async () => {
      fireEvent.click(screen.getByTestId("listener-channel-button-1"));
    });
    expect(useListenerStore.getState().channel).toBe(0);
    expect(screen.getByTestId("listener-channel-selected")).toHaveTextContent("1");
  });
});

describe("ChannelSelector (listener) — exact tooltip text present in the DOM", () => {
  it("renders the EXACT tooltip text (testable)", async () => {
    renderSelector();
    await grant();
    expect(screen.getByTestId("listener-channel-tooltip")).toHaveTextContent(
      TOOLTIP,
    );
    // The label also carries the same text as a native title affordance.
    expect(screen.getByTestId("listener-channel-label")).toHaveAttribute(
      "title",
      TOOLTIP,
    );
  });
});

// ---------------------------------------------------------------------------
// Story 6.3 — accessible radiogroup (UX-DR25).
// ---------------------------------------------------------------------------
describe("ChannelSelector (listener) — Story 6.3 accessible radiogroup", () => {
  it("the grid is role=radiogroup labelled by the visible label", async () => {
    renderSelector();
    await grant();
    const group = screen.getByTestId("listener-channel-selector");
    expect(group).toHaveAttribute("role", "radiogroup");
    expect(group).toHaveAttribute("aria-labelledby", "listener-channel-label");
    expect(screen.getByTestId("listener-channel-label")).toHaveAttribute(
      "id",
      "listener-channel-label",
    );
  });

  it("the 16 buttons are role=radio with aria-label « Canal N »", async () => {
    renderSelector();
    await grant();
    const radios = screen
      .getAllByRole("radio")
      .filter((el) => el.hasAttribute("data-testid"));
    expect(radios).toHaveLength(16);
    for (let n = 1; n <= 16; n++) {
      const radio = screen.getByTestId(`listener-channel-button-${n}`);
      expect(radio).toHaveAttribute("role", "radio");
      expect(radio).toHaveAttribute("aria-label", `Canal ${n}`);
    }
  });

  it("roving tabindex: only the active radio is tabbable (0), others -1", async () => {
    renderSelector();
    await grant();
    expect(screen.getByTestId("listener-channel-button-1")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("listener-channel-button-2")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByTestId("listener-channel-button-16")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("ArrowRight on channel 1 advances the selection + focus to channel 2 (data 1)", async () => {
    renderSelector();
    await grant();
    const ch1 = screen.getByTestId("listener-channel-button-1");
    ch1.focus();
    expect(document.activeElement).toBe(ch1);
    await act(async () => {
      fireEvent.keyDown(ch1, { key: "ArrowRight" });
    });
    expect(useListenerStore.getState().channel).toBe(1);
    expect(screen.getByTestId("listener-channel-button-2")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-channel-button-2"),
    );
  });

  it("ArrowDown advances; ArrowUp recedes", async () => {
    renderSelector();
    await grant();
    const ch8 = screen.getByTestId("listener-channel-button-8");
    await act(async () => {
      fireEvent.click(ch8);
    });
    ch8.focus();
    await act(async () => {
      fireEvent.keyDown(ch8, { key: "ArrowDown" });
    });
    expect(useListenerStore.getState().channel).toBe(8); // UI 9 → data 8
    expect(screen.getByTestId("listener-channel-button-9")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const ch9 = screen.getByTestId("listener-channel-button-9");
    await act(async () => {
      fireEvent.keyDown(ch9, { key: "ArrowUp" });
    });
    expect(useListenerStore.getState().channel).toBe(7); // back to UI 8 → data 7
    expect(screen.getByTestId("listener-channel-button-8")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("ArrowLeft recedes; ArrowRight from channel 16 wraps-via-clamp to 16 (no escape)", async () => {
    renderSelector();
    await grant();
    const ch16 = screen.getByTestId("listener-channel-button-16");
    await act(async () => {
      fireEvent.click(ch16);
    });
    ch16.focus();
    await act(async () => {
      fireEvent.keyDown(ch16, { key: "ArrowRight" });
    });
    // Clamped at the upper edge: stays on 16 (data 15).
    expect(useListenerStore.getState().channel).toBe(15);
    expect(screen.getByTestId("listener-channel-button-16")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("ArrowLeft from channel 1 clamps to 1 (no escape below the group)", async () => {
    renderSelector();
    await grant();
    const ch1 = screen.getByTestId("listener-channel-button-1");
    ch1.focus();
    await act(async () => {
      fireEvent.keyDown(ch1, { key: "ArrowLeft" });
    });
    expect(useListenerStore.getState().channel).toBe(0); // UI 1 → data 0
    expect(screen.getByTestId("listener-channel-button-1")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Home jumps to channel 1 (data 0); End jumps to channel 16 (data 15)", async () => {
    renderSelector();
    await grant();
    // Move away from the default first.
    const ch8 = screen.getByTestId("listener-channel-button-8");
    await act(async () => {
      fireEvent.click(ch8);
    });
    ch8.focus();
    await act(async () => {
      fireEvent.keyDown(ch8, { key: "Home" });
    });
    expect(useListenerStore.getState().channel).toBe(0);
    expect(screen.getByTestId("listener-channel-button-1")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-channel-button-1"),
    );

    const ch1 = screen.getByTestId("listener-channel-button-1");
    await act(async () => {
      fireEvent.keyDown(ch1, { key: "End" });
    });
    expect(useListenerStore.getState().channel).toBe(15);
    expect(screen.getByTestId("listener-channel-button-16")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("listener-channel-button-16"),
    );
  });

  it("the active radio carries a visible check icon (not color-only)", async () => {
    renderSelector();
    await grant();
    // Channel 1 is active by default → its radio contains an svg check mark.
    const ch1 = screen.getByTestId("listener-channel-button-1");
    const check = ch1.querySelector("svg");
    expect(check).not.toBeNull();
    expect(check).toHaveAttribute("aria-hidden", "true");
    // An inactive radio has no check icon.
    const ch2 = screen.getByTestId("listener-channel-button-2");
    expect(ch2.querySelector("svg")).toBeNull();
  });

  it("store keeps the 0–15 data range after keyboard navigation (no UI/UI-1 off-by-one)", async () => {
    renderSelector();
    await grant();
    const ch1 = screen.getByTestId("listener-channel-button-1");
    ch1.focus();
    await act(async () => {
      fireEvent.keyDown(ch1, { key: "End" });
    });
    expect(useListenerStore.getState().channel).toBe(15);
    await act(async () => {
      fireEvent.keyDown(
        screen.getByTestId("listener-channel-button-16"),
        { key: "ArrowDown" },
      );
    });
    // Clamped — stays in [0, 15].
    expect(useListenerStore.getState().channel).toBe(15);
  });
});