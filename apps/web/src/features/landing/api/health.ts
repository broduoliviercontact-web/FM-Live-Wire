// Story 6.1 — landing `/health` polling (FR-28, AD-20, AC-U2, UX-DR3).
//
// The landing shows an *On air* indicator driven by a LIGHT polling of
// `GET /health` (`ownerActive: boolean`). There is NO Socket.IO on the landing
// (Q-UX5): real-time is reserved for the listener surface. The `/health`
// contract is FINAL and untouched here (AD-20):
//   `{ ok: true, uptime: number, ownerActive: boolean, listeners: number }`.
//
// A fetch failure is SOBER: `fetchHealth` returns `false` (the indicator shows
// « ○ Hors antenne », muted) — it never throws, never blocks the role buttons,
// and never crashes the landing. The landing polling is light (every
// `HEALTH_POLL_INTERVAL_MS`); the interval is owned + cleaned up by the
// `OnAirIndicator` effect.

/** Final `/health` response shape (AD-20 / FR-28). Read-only here. */
export interface HealthResponse {
  readonly ok: true;
  readonly uptime: number;
  readonly ownerActive: boolean;
  readonly listeners: number;
}

/**
 * Landing on-air polling interval (UX-DR3, light). 8 s is a sober cadence:
 * frequent enough to reflect an owner going on/off air without a manual
 * refresh, infrequent enough to be negligible on the server (no WebSocket on
 * the landing, Q-UX5).
 */
export const HEALTH_POLL_INTERVAL_MS = 8000;

/**
 * Fetch `GET /health` same-origin and return the `ownerActive` flag.
 *
 * On ANY failure — network error, non-2xx status, malformed JSON, or a body
 * missing `ownerActive` — return `false` (sober « Hors antenne »). The landing
 * never crashes and the role buttons stay active (a listener can still go to
 * `/listener` and wait for the performer).
 *
 * `fetchImpl` is injectable for tests (jsdom has no real server); the default
 * is the global `fetch`. `url` defaults to `/health` (same-origin).
 */
export async function fetchHealth(
  fetchImpl: typeof fetch = fetch,
  url: string = "/health",
): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as Partial<HealthResponse>;
    return body.ownerActive === true;
  } catch {
    // Network failure / thrown fetch → sober off-air (never crash the landing).
    return false;
  }
}