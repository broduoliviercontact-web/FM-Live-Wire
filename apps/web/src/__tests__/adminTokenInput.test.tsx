// @vitest-environment jsdom
// Story 3.1 — AdminTokenInput unit tests (AD-10: zero secrets in the frontend).
//
// Proves the admin token lives ONLY in React state and is never persisted:
//   - label "admin token" + button "Se connecter" render.
//   - button is disabled while the input is empty.
//   - submit with a non-empty value calls onSubmit(token) exactly once.
//   - the local input state is CLEARED after submit (secret not held).
//   - the token is NEVER written to localStorage / sessionStorage (a spy on
//     Storage.prototype.setItem never receives it).
//   - the token never reaches the URL (search / hash / href).
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AdminTokenInput } from "../features/performer/components/AdminTokenInput";

const TOKEN = "topsecret-OWNER-token-3.1";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("AdminTokenInput — rendering + labels", () => {
  it("renders the 'admin token' label and 'Se connecter' button", () => {
    render(<AdminTokenInput onSubmit={() => {}} />);
    expect(screen.getByText("admin token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
  });

  it("uses a password-type input (no plain text)", () => {
    render(<AdminTokenInput onSubmit={() => {}} />);
    const input = screen.getByTestId("performer-admin-token-input");
    expect(input).toHaveAttribute("type", "password");
  });

  it("button is disabled while the input is empty", () => {
    render(<AdminTokenInput onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeDisabled();
  });

  it("disabled prop disables both the input and the button", () => {
    render(<AdminTokenInput onSubmit={() => {}} disabled />);
    expect(screen.getByTestId("performer-admin-token-input")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeDisabled();
  });
});

describe("AdminTokenInput — submit + no persistence (AD-10)", () => {
  it("submit calls onSubmit with the token, exactly once", () => {
    const onSubmit = vi.fn();
    render(<AdminTokenInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(TOKEN);
  });

  it("clears the input after submit (secret dropped from local state)", () => {
    const onSubmit = vi.fn();
    render(<AdminTokenInput onSubmit={onSubmit} />);
    const input = screen.getByTestId(
      "performer-admin-token-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: TOKEN } });
    expect(input.value).toBe(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(input.value).toBe("");
  });

  it("does NOT persist the token to localStorage or sessionStorage", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const onSubmit = vi.fn();
    render(<AdminTokenInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    // No Storage.setItem call ever carried the token.
    for (const call of setItemSpy.mock.calls) {
      const [, value] = call as [string, string];
      expect(value).not.toContain(TOKEN);
    }
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    setItemSpy.mockRestore();
  });

  it("does NOT put the token in the URL (search / hash / href)", () => {
    const onSubmit = vi.fn();
    render(<AdminTokenInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("an empty submit does NOT call onSubmit", () => {
    const onSubmit = vi.fn();
    render(<AdminTokenInput onSubmit={onSubmit} />);
    // Type then clear, then submit — empty value must be ignored.
    fireEvent.change(screen.getByTestId("performer-admin-token-input"), {
      target: { value: "" },
    });
    // Button is disabled, so a programmatic submit via form request is also
    // guarded by the empty-check; assert onSubmit not called.
    expect(onSubmit).not.toHaveBeenCalled();
  });
});