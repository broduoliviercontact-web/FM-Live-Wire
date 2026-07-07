// Story 6.8 hotfix / NFR-14 — proves the Socket.IO CLIENT uses WebSocket-only
// in production (no polling handshake that the prod server rejects with 400 on
// Render). Mirrors the server's `resolveTransports(isProd)` test
// (`apps/server/src/__tests__/socket.test.ts`).
//
// Tests are excluded from tsc + ESLint boundary rules, so this file may import
// BOTH `performer/api/socket` and `listener/api/socket` to prove the shared
// config reaches both factories.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `vi.hoisted` so the mock factory (hoisted above imports) can capture the
// options bag passed to `io()` without referencing a not-yet-initialized local.
const capture = vi.hoisted(() => ({ opts: undefined as Record<string, unknown> | undefined }));

vi.mock("socket.io-client", () => ({
  io: (a?: unknown, b?: unknown) => {
    // `io(opts)` (same-origin) vs `io(uri, opts)` — capture the options bag.
    capture.opts = (b ?? a) as Record<string, unknown>;
    return { on: () => {}, emit: () => {}, disconnect: () => {}, close: () => {} };
  },
}));

import { resolveClientTransports, isProdClient } from "../lib/socket-client";
import { connectPerformer } from "../features/performer/api/socket";
import { connectListener } from "../features/listener/api/socket";

const env = import.meta.env as unknown as Record<string, unknown>;
let savedProd: unknown;

beforeEach(() => {
  savedProd = env.PROD;
  capture.opts = undefined;
});
afterEach(() => {
  env.PROD = savedProd;
});

describe("resolveClientTransports (pure, mirrors server resolveTransports)", () => {
  it("prod → ['websocket'] only (no polling fallback)", () => {
    expect(resolveClientTransports(true)).toEqual(["websocket"]);
    expect(resolveClientTransports(true)).not.toContain("polling");
  });

  it("dev/test → polling + websocket (default, unconstrained)", () => {
    expect(resolveClientTransports(false)).toEqual(["polling", "websocket"]);
  });
});

describe("isProdClient reads import.meta.env.PROD", () => {
  it("returns true when PROD is true", () => {
    env.PROD = true;
    expect(isProdClient()).toBe(true);
  });

  it("returns false when PROD is not true", () => {
    env.PROD = false;
    expect(isProdClient()).toBe(false);
  });
});

describe("connectPerformer passes transports to io() (NFR-14, Story 6.8 hotfix)", () => {
  const handlers = {
    onConnect: () => {},
    onDisconnect: () => {},
    onReconnectAttempt: () => {},
    onReconnect: () => {},
    onReconnectError: () => {},
    onConnectError: () => {},
  };

  it("PROD → transports ['websocket'] (no polling — fixes Render 400)", () => {
    env.PROD = true;
    connectPerformer("tok", handlers);
    expect(capture.opts).toBeDefined();
    const transports = (capture.opts as { transports: string[] }).transports;
    expect(transports).toEqual(["websocket"]);
    expect(transports).not.toContain("polling");
  });

  it("DEV → transports ['polling','websocket'] (default kept)", () => {
    env.PROD = false;
    connectPerformer("tok", handlers);
    const transports = (capture.opts as { transports: string[] }).transports;
    expect(transports).toEqual(["polling", "websocket"]);
  });
});

describe("connectListener passes transports to io() (NFR-14, Story 6.8 hotfix)", () => {
  it("PROD → transports ['websocket'] (no polling — fixes Render 400)", () => {
    env.PROD = true;
    connectListener({});
    expect(capture.opts).toBeDefined();
    const transports = (capture.opts as { transports: string[] }).transports;
    expect(transports).toEqual(["websocket"]);
    expect(transports).not.toContain("polling");
  });

  it("DEV → transports ['polling','websocket'] (default kept)", () => {
    env.PROD = false;
    connectListener({});
    const transports = (capture.opts as { transports: string[] }).transports;
    expect(transports).toEqual(["polling", "websocket"]);
  });
});