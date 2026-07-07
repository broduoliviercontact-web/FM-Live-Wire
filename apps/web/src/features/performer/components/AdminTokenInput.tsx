import { useState, type FormEvent } from "react";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";

// Story 3.1 — AdminTokenInput (AD-10: zero secrets in the frontend).
//
// The admin token (the server-side shared secret) is entered here and travels
// ONLY in React state → the Socket.IO `auth` payload. It is NEVER written to:
//   - localStorage / sessionStorage
//   - the URL, query string, or hash
//   - any build-time env variable (no secret is baked into the frontend bundle)
// On submit the local state is CLEARED immediately so the secret is not held in
// memory longer than necessary, and the value is handed to the parent which
// opens the connection with `auth.token`.

export interface AdminTokenInputProps {
  /** Called with the entered token when the user submits a non-empty value. */
  onSubmit: (token: string) => void;
  /** Disable the field + button while a connection attempt is in flight. */
  disabled?: boolean;
}

export function AdminTokenInput({ onSubmit, disabled }: AdminTokenInputProps) {
  const [token, setToken] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token;
    setToken(""); // drop the secret from local state immediately
    if (value.length > 0) onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" autoComplete="off">
      <label
        htmlFor="performer-admin-token"
        className="text-sm font-medium leading-none"
      >
        admin token
      </label>
      <Input
        id="performer-admin-token"
        type="password"
        value={token}
        disabled={disabled}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        data-testid="performer-admin-token-input"
      />
      <Button
        type="submit"
        disabled={disabled || token.length === 0}
        data-testid="performer-connect-button"
      >
        Se connecter
      </Button>
    </form>
  );
}