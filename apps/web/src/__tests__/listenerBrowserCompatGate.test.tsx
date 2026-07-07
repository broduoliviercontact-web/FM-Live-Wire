// @vitest-environment jsdom
// Story 4.1 — listener BrowserCompatGate unit tests (AD-3: feature detection
// ONLY).
//
// Proves:
//   - `detectBrowserCompat` reads `window.isSecureContext` + the PRESENCE of
//     `navigator.requestMIDIAccess` (never calls it).
//   - Insecure context → terminal "Web MIDI nécessite HTTPS" (E2).
//   - Missing Web MIDI API (secure) → terminal "Chrome/Edge requis" (E1).
//   - Compatible → children render.
//   - `navigator.requestMIDIAccess` is NEVER invoked by the gate (a spy planted
//     on it stays uncalled through render).
//
// jsdom defaults to an insecure `http://localhost` context with NO Web MIDI,
// so each case sets the compat flags explicitly via `setCompat`.
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  BrowserCompatGate,
  detectBrowserCompat,
} from "../features/listener/components/BrowserCompatGate";

function setCompat({ secure, midi }: { secure: boolean; midi: boolean }) {
  Object.defineProperty(window, "isSecureContext", {
    value: secure,
    configurable: true,
  });
  if (midi) {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: () => Promise.resolve({}),
      configurable: true,
      writable: true,
    });
  } else {
    try {
      delete (navigator as unknown as Record<string, unknown>)
        .requestMIDIAccess;
    } catch {
      /* already absent */
    }
  }
}

afterEach(() => {
  cleanup();
  setCompat({ secure: false, midi: false });
});

describe("detectBrowserCompat — pure feature detection (listener)", () => {
  it("insecure context + no Web MIDI → { false, false }", () => {
    setCompat({ secure: false, midi: false });
    expect(detectBrowserCompat()).toEqual({
      secureContext: false,
      hasWebMidi: false,
    });
  });

  it("secure context but no Web MIDI → secure true, midi false", () => {
    setCompat({ secure: true, midi: false });
    expect(detectBrowserCompat()).toEqual({
      secureContext: true,
      hasWebMidi: false,
    });
  });

  it("secure context + Web MIDI present → both true", () => {
    setCompat({ secure: true, midi: true });
    expect(detectBrowserCompat()).toEqual({
      secureContext: true,
      hasWebMidi: true,
    });
  });
});

describe("BrowserCompatGate — terminal screens (listener)", () => {
  it("insecure context → terminal 'Web MIDI nécessite HTTPS', no children", () => {
    setCompat({ secure: false, midi: true });
    render(
      <BrowserCompatGate>
        <span>SHOULD-NOT-RENDER</span>
      </BrowserCompatGate>,
    );
    expect(
      screen.getByTestId("listener-compat-insecure"),
    ).toHaveTextContent("Web MIDI nécessite HTTPS");
    expect(screen.queryByText("SHOULD-NOT-RENDER")).not.toBeInTheDocument();
  });

  it("secure but no Web MIDI → terminal 'Chrome/Edge requis'", () => {
    setCompat({ secure: true, midi: false });
    render(
      <BrowserCompatGate>
        <span>SHOULD-NOT-RENDER</span>
      </BrowserCompatGate>,
    );
    expect(
      screen.getByTestId("listener-compat-no-webmidi"),
    ).toHaveTextContent("Chrome/Edge requis");
    expect(screen.queryByText("SHOULD-NOT-RENDER")).not.toBeInTheDocument();
  });

  it("secure + Web MIDI → renders children", () => {
    setCompat({ secure: true, midi: true });
    render(
      <BrowserCompatGate>
        <span>REAL-LISTENER-FLOW</span>
      </BrowserCompatGate>,
    );
    expect(screen.getByText("REAL-LISTENER-FLOW")).toBeInTheDocument();
    expect(screen.queryByText("Web MIDI nécessite HTTPS")).not.toBeInTheDocument();
    expect(screen.queryByText("Chrome/Edge requis")).not.toBeInTheDocument();
  });
});

describe("BrowserCompatGate — NEVER calls navigator.requestMIDIAccess (AD-3)", () => {
  it("a planted spy stays uncalled through render in compatible mode", () => {
    const spy = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: spy,
      configurable: true,
      writable: true,
    });
    render(
      <BrowserCompatGate>
        <span>FLOW</span>
      </BrowserCompatGate>,
    );
    // The gate only checks existence; it must NOT invoke the API.
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText("FLOW")).toBeInTheDocument();
  });
});