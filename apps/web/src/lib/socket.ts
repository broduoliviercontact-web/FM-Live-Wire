// Placeholder — real Socket.IO client is wired in Epic 2. No connection here.
export type SocketPlaceholder = { readonly connected: false };

export function createSocket(): SocketPlaceholder {
  // Story 1.4: placeholder only. Returns a disconnected stub.
  return { connected: false };
}