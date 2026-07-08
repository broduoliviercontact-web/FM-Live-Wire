// ESLint flat config — FM Live Wire.
//
// Story 1.1 enforces directional dependencies via eslint-plugin-boundaries
// (the maintained successor; eslint-plugin-bound-modules is not used).
//
// Frontend (feature-based):  app -> features -> entities -> shared -> lib
//   - `performer` and `listener` are DISTINCT element types (the "features"
//     layer); importing one from the other is forbidden (AD-2 isolation).
// Backend:                    handlers -> services -> shared
//
// `default: "disallow"` means any from->to pair not explicitly allowed is
// rejected. The dedicated positive/negative test lives in
// scripts/verify-boundaries.mjs (fixtures under **/__fixtures__/** are
// excluded here so `pnpm lint` stays green).
//
// TypeScript readiness: `typescript-eslint` recommended (parser + TS-aware
// rules) is applied so future `.ts`/`.tsx` files are parsed and linted.
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export const boundaryElements = [
  // Frontend layers (apps/web). `performer` and `listener` are modelled as
  // DISTINCT element types (not a single `features` type): the architecture
  // treats them as isolated self-contained features that must NOT depend on
  // each other. (With a single `features` type, performer->listener would be
  // an intra-element import and `boundaries/element-types` would skip it.)
  // `app` covers the feature-based app layer AND the Vite entry module
  // `main.tsx` (lives at src root, outside `app/`). The entry is allowed to
  // import everything the app layer may import.
  { type: "app", pattern: ["apps/web/src/app/**", "apps/web/src/main.tsx"] },
  { type: "performer", pattern: "apps/web/src/features/performer/**" },
  { type: "listener", pattern: "apps/web/src/features/listener/**" },
  // Story 6.1 — `landing` is the third self-contained feature (the `/` hub:
  // project name + tagline + on-air `/health` indicator + role picker). Like
  // `performer`/`listener` it is an isolated feature that may NOT import the
  // other two (AD-2). It polls `/health` over HTTP (NO Socket.IO — Q-UX5) and
  // imports only shared UI primitives + `lib/utils` (no entities, no config).
  { type: "landing", pattern: "apps/web/src/features/landing/**" },
  // Spike Dexed/WAM — isolated experimental feature (`/lab/dexed`). Like the
  // other features it is self-contained and must NOT import performer/listener.
  // It imports only shared UI primitives + `lib/utils` (no entities, no config),
  // mirroring `landing`. See docs/spikes/dexed-wam.md.
  { type: "dexed", pattern: "apps/web/src/features/dexed/**" },
  { type: "entities", pattern: "apps/web/src/entities/**" },
  { type: "web-shared", pattern: "apps/web/src/shared/**" },
  { type: "lib", pattern: "apps/web/src/lib/**" },
  // UI runtime constants (LOOKAHEAD_MS / MAX_LATE_MS / BUFFER_CAP). Pure
  // constants, no downward deps.
  { type: "config", pattern: "apps/web/src/config/**" },
  // Backend layers (apps/server)
  // `srv-app` is the Express wiring layer + the runnable bootstrap `src/index.ts`
  // (lives at src root, outside `app/`). It may import handlers + srv-shared +
  // srv-config + socket-wiring. `srv-config` is the env module (leaf).
  // `socket-wiring` (socket/index.ts) attaches Socket.IO + origin allowlist;
  // `middlewares` holds the `io.use` middlewares (leaf: no internal deps).
  {
    type: "handlers",
    pattern: ["apps/server/src/socket/handlers/**", "apps/server/src/http/routes/**"],
  },
  { type: "services", pattern: "apps/server/src/socket/services/**" },
  { type: "middlewares", pattern: "apps/server/src/socket/middlewares/**" },
  { type: "socket-wiring", pattern: "apps/server/src/socket/index.ts" },
  { type: "srv-shared", pattern: "apps/server/src/shared/**" },
  { type: "srv-app", pattern: ["apps/server/src/app/**", "apps/server/src/index.ts"] },
  { type: "srv-config", pattern: "apps/server/src/config/**" },
  // `srv-utils` is the pure-utility leaf (AD-13 token bucket): no internal
  // imports, no side effects, injected time only. Middlewares may import it.
  { type: "srv-utils", pattern: "apps/server/src/utils/**" },
];

// `performer` and `listener` together form the "features" layer: both may
// import downward (entities -> shared -> lib) but never each other.
export const boundaryAllowRules = [
  // Frontend chain: app -> features(performer|listener) -> entities -> shared -> lib
  { from: "app", allow: ["performer", "listener", "landing", "dexed", "entities", "web-shared", "lib", "config"] },
  { from: "performer", allow: ["entities", "web-shared", "lib"] },
  // Story 4.3 — `listener` may also import `config` (UI runtime constants:
  // `LOOKAHEAD_MS` for the scheduler). `config` is a pure-constants leaf (no
  // downward deps), so this does not widen the dependency surface. Mirrors
  // `app`, which already allows `config`. `performer` does not need `config`
  // yet, so it is left unchanged (surgical).
  { from: "listener", allow: ["entities", "web-shared", "lib", "config"] },
  // Story 6.1 — `landing` may import only shared UI primitives + `lib/utils`.
  // It does NOT import `entities`, `config`, `performer`, or `listener` (the
  // role picker navigates via React Router, not via cross-feature imports), so
  // the surface stays minimal and the AD-2 isolation between the three features
  // is preserved.
  { from: "landing", allow: ["web-shared", "lib"] },
  // Spike Dexed/WAM — same minimal surface as `landing` (shared UI + lib only;
  // no entities, no config, no cross-feature). Keeps the feature isolated.
  { from: "dexed", allow: ["web-shared", "lib"] },
  { from: "entities", allow: ["web-shared", "lib"] },
  { from: "web-shared", allow: ["lib"] },
  { from: "lib", allow: [] },
  { from: "config", allow: [] },
  // Backend chain: srv-app -> socket-wiring -> middlewares + services + handlers
  // ; srv-app -> handlers -> services -> shared ; srv-config leaf. socket-wiring
  // is the composition root for socket middlewares AND the owner registry +
  // listener counter + relay adapter (services) AND the Story 2.7 handlers: it
  // constructs/wires PerformerRegistry/RoomService/RelayService/ValidationService
  // and registers the room/control/performer handlers on each socket AFTER the
  // middlewares. middlewares import ONLY `srv-utils` (the pure token bucket,
  // Story 2.5); the registry + logger are injected via local structural ports,
  // so roleAuth/eventGate/rateLimit never import `services` or `srv-shared`
  // directly (the rate-limit logger port is satisfied by the socket-wiring-owned
  // Logger instance). handlers import `services` (RoomService/RelayService/
  // ValidationService) + @fmlw/shared, and read `socket.data.role` via a LOCAL
  // structural type (never import `middlewares`).
  { from: "srv-app", allow: ["handlers", "srv-shared", "srv-config", "socket-wiring"] },
  { from: "socket-wiring", allow: ["middlewares", "services", "srv-config", "srv-shared", "handlers"] },
  { from: "middlewares", allow: ["srv-utils"] },
  { from: "handlers", allow: ["services", "srv-shared"] },
  { from: "services", allow: ["srv-shared"] },
  { from: "srv-shared", allow: [] },
  { from: "srv-config", allow: [] },
  { from: "srv-utils", allow: [] },
];

export function boundaryRulesConfig() {
  return {
    files: ["apps/**/src/**"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": boundaryElements,
      // eslint-module-utils (used by the plugin to resolve imports) needs a
      // resolver. `extensions` lets the node resolver resolve extensionless TS
      // imports (e.g. `from "./ent"` -> `ent.ts`).
      "import/resolver": {
        node: { extensions: [".ts", ".tsx", ".js", ".jsx", ".json"] },
      },
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: boundaryAllowRules,
        },
      ],
    },
  };
}

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/__fixtures__/**",
      // Tests are dev tooling; architectural boundary rules are not meaningful
      // for them. Test correctness is covered by Vitest + tsc.
      "**/__tests__/**",
    ],
  },
  // Parser + TS-aware rules for .ts / .tsx / .mts / .cts (non-type-checked).
  ...tseslint.configs.recommended,
  boundaryRulesConfig(),
];