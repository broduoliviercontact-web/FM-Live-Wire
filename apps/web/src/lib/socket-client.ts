// Shared Socket.IO CLIENT transport config (Story 6.8 hotfix / NFR-14).
//
// Problem on Render: socket.io-client defaults to `["polling", "websocket"]`,
// so the FIRST handshake is an HTTP long-polling request. The production
// server forces WebSocket-only (`resolveTransports(isProd)` in
// `apps/server/src/socket/index.ts`, Story 6.8) and rejects the polling
// handshake with `400 Bad Request`. Fix: the client must request
// `["websocket"]` in production too, mirroring the server.
//
// Mirrors the SERVER `resolveTransports(isProd)` exactly so the two ends are
// symmetric: prod = WebSocket-only (no polling fallback); dev/test = polling +
// websocket (so the in-process test client / Vite dev server is not constrained).
//
// `lib` element: leaf — no internal imports, no `socket.io-client` import (the
// `ClientTransport` type is defined locally so `lib` stays dependency-free).
// Both `performer` and `listener` may import this (boundary allow-list).

/** Low-level transport names (subset of socket.io-client's `string[]`). */
export type ClientTransport = "polling" | "websocket";

/**
 * Resolve enabled low-level transports for the Socket.IO CLIENT. Pure + unit-tested.
 * Mirrors the server's `resolveTransports(isProd)` (Story 6.8, NFR-14): prod
 * forces WebSocket-only so the client never opens a polling handshake that the
 * prod server would reject with 400; dev/test keeps polling + websocket.
 */
export function resolveClientTransports(isProd: boolean): ClientTransport[] {
  return isProd ? ["websocket"] : ["polling", "websocket"];
}

/**
 * Whether the client is running in a Vite production build. `import.meta.env.PROD`
 * is a Vite compile-time flag (`true` in `vite build`, `false` in dev / vitest).
 * It is NOT a secret and carries no sensitive value (verify:no-secrets only
 * flags `OWNER_SECRET` / `VITE_*SECRET|TOKEN|KEY`).
 */
export function isProdClient(): boolean {
  return import.meta.env.PROD === true;
}