// Story 4.2 — `listenerStore` unit tests (AD-6 Zustand). Pure state, node env.
//
// Proves the store owns the listener's output choice + forced channel, with
// defaults (no output, channel data 0 = UI 1) and a reset.
import { describe, it, expect, beforeEach } from "vitest";
import {
  useListenerStore,
  DEFAULT_LISTENER_CHANNEL,
} from "../features/listener/store/listenerStore";

beforeEach(() => {
  useListenerStore.getState().reset();
});

describe("listenerStore — defaults", () => {
  it("starts with no selected output", () => {
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
  });
  it("starts with channel data 0 (UI channel 1, Q-UX7)", () => {
    expect(useListenerStore.getState().channel).toBe(0);
    expect(DEFAULT_LISTENER_CHANNEL).toBe(0);
  });
});

describe("listenerStore — setSelectedOutput", () => {
  it("sets the selected output id", () => {
    useListenerStore.getState().setSelectedOutput("out-1");
    expect(useListenerStore.getState().selectedOutputId).toBe("out-1");
  });
  it("clears the selection with null", () => {
    useListenerStore.getState().setSelectedOutput("out-1");
    useListenerStore.getState().setSelectedOutput(null);
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
  });
});

describe("listenerStore — setChannel", () => {
  it("sets the channel (data value)", () => {
    useListenerStore.getState().setChannel(15);
    expect(useListenerStore.getState().channel).toBe(15);
  });
});

describe("listenerStore — reset", () => {
  it("resets output + channel to defaults", () => {
    useListenerStore.getState().setSelectedOutput("out-1");
    useListenerStore.getState().setChannel(7);
    useListenerStore.getState().reset();
    expect(useListenerStore.getState().selectedOutputId).toBeNull();
    expect(useListenerStore.getState().channel).toBe(0);
  });
});