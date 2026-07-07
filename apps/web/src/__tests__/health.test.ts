// Story 6.1 — `fetchHealth` unit tests (FR-28, AD-20, UX-DR3, AC-U2).
//
// Pure node tests (no DOM): `fetchHealth` is a thin same-origin `GET /health`
// reader that returns the `ownerActive` flag. The `/health` CONTRACT is final
// and untouched (AD-20): `{ ok, uptime, ownerActive, listeners }`. A fetch
// failure (network error / non-2xx / malformed JSON / missing `ownerActive`)
// is SOBER → returns `false` (landing shows « ○ Hors antenne », never crashes,
// never blocks the role buttons).
//
// `fetch` is injected so no real server is needed.
import { describe, it, expect } from "vitest";
import { fetchHealth, HEALTH_POLL_INTERVAL_MS } from "../features/landing/api/health";

/** Build a fake `fetch` returning the given JSON body + status. */
function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("fetchHealth — /health ownerActive reader (AD-20, FR-28)", () => {
  it("returns true when ownerActive is true (on air)", async () => {
    const res = await fetchHealth(
      fakeFetch({ ok: true, uptime: 42, ownerActive: true, listeners: 3 }),
    );
    expect(res).toBe(true);
  });

  it("returns false when ownerActive is false (off air)", async () => {
    const res = await fetchHealth(
      fakeFetch({ ok: true, uptime: 42, ownerActive: false, listeners: 0 }),
    );
    expect(res).toBe(false);
  });

  it("returns false when ownerActive is missing (sober, never throws)", async () => {
    const res = await fetchHealth(fakeFetch({ ok: true, uptime: 42, listeners: 0 }));
    expect(res).toBe(false);
  });

  it("returns false on a non-2xx status (sober off-air)", async () => {
    const res = await fetchHealth(
      fakeFetch({ ok: true, uptime: 1, ownerActive: true, listeners: 0 }, false),
    );
    expect(res).toBe(false);
  });

  it("returns false when fetch throws (network failure → never crashes)", async () => {
    const throwing: typeof fetch = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const res = await fetchHealth(throwing);
    expect(res).toBe(false);
  });

  it("returns false when res.json() throws (malformed body)", async () => {
    const malformed: typeof fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    })) as unknown as typeof fetch;
    const res = await fetchHealth(malformed);
    expect(res).toBe(false);
  });

  it("sends the /health request with an Accept: application/json header", async () => {
    let received: { url: string; headers: Record<string, string> } | null = null;
    const spy: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers as Record<string, string>;
        for (const [k, v] of Object.entries(h)) headers[k] = v;
      }
      received = { url, headers };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, uptime: 1, ownerActive: false, listeners: 0 }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await fetchHealth(spy);
    expect(received!.url).toBe("/health");
    expect(received!.headers.Accept).toBe("application/json");
  });

  it("exposes a light polling interval in the 5–10 s range (UX-DR3)", () => {
    expect(HEALTH_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
    expect(HEALTH_POLL_INTERVAL_MS).toBeLessThanOrEqual(10_000);
  });
});