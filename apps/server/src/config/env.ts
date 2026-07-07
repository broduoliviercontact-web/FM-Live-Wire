// Server env config (AD-20). SERVER-ONLY — these values never reach the Vite
// bundle (no `VITE_` prefix, see AD-10). `OWNER_SECRET` is the owner auth token
// and is intentionally allowed to stay empty in dev (Epic 2 enforces it).
//
// `resolveEnv` is a PURE function over a record so the defaults are unit-testable
// without touching the real `process.env`. The runtime `env` is computed once at
// import from `process.env`.

/** Default port for the mono-process HTTP server (dev). */
export const DEFAULT_PORT = 8787;
/** Default max concurrent listeners (enforced in Epic 2; config only here). */
export const DEFAULT_MAX_LISTENERS = 100;

export interface ServerConfig {
  /** HTTP port the Express + (later) Socket.IO server listens on. */
  readonly port: number;
  /** Public origin the server is served from (single-origin, AD-15). */
  readonly publicOrigin: string;
  /** Server-only owner auth secret (empty = not required in dev). Never `VITE_*`. */
  readonly ownerSecret: string;
  /** When true, log full MIDI event flow in dev (AD-18). Wiring in Epic 2. */
  readonly logMidi: boolean;
  /** Max concurrent listeners guard (enforced in Epic 2). */
  readonly maxListeners: number;
}

/** Parse a positive integer; returns `undefined` on missing/invalid input. */
function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

/**
 * Resolve server config from an env record (pure). Pass `process.env` in
 * production; pass `{}` in tests to assert the safe defaults.
 */
export function resolveEnv(raw: NodeJS.ProcessEnv): ServerConfig {
  const port = parsePositiveInt(raw.PORT) ?? DEFAULT_PORT;
  return {
    port,
    publicOrigin: raw.PUBLIC_ORIGIN ?? `http://localhost:${port}`,
    ownerSecret: raw.OWNER_SECRET ?? "",
    logMidi: raw.LOG_MIDI === "1",
    maxListeners: parsePositiveInt(raw.MAX_LISTENERS) ?? DEFAULT_MAX_LISTENERS,
  };
}

/**
 * Fail-fast in production: OWNER_SECRET MUST be set (AD-10, Story 6.8). In dev
 * it stays optional (empty = performers rejected generically). Pure over the
 * resolved config + the prod flag — unit-tested; wired in `startServer`.
 */
export function requireOwnerSecretInProd(config: ServerConfig, isProd: boolean): void {
  if (isProd && config.ownerSecret === "") {
    throw new Error(
      "OWNER_SECRET is required in production (NODE_ENV=production) but was not set. Set OWNER_SECRET in the server environment.",
    );
  }
}

/** Runtime config, resolved once from the real `process.env`. */
export const env: ServerConfig = resolveEnv(process.env);