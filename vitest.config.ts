import { defineConfig } from "vitest/config";

// Root Vitest config. Story 1.2 runs the @fmlw/shared contract unit tests in
// node (pure Zod — no DOM). Web/jsdom tests (Story 1.4+) will extend this config.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/src/__tests__/**/*.test.ts",
      // Story 3.1: web component tests use jsdom + JSX → `.test.tsx`. The
      // per-file `// @vitest-environment jsdom` annotation opts those files into
      // jsdom; all other tests stay in the default node environment.
      "apps/**/src/__tests__/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      // Story 6.4 — coverage is scoped to the 6 CRITICAL modules only (NFR-16):
      // wire→bytes mapping, Panic/Force Panic, scheduler (lookahead + backpressure
      // + fail-safe), the shared wire schema, server-side validation, the owner
      // registry, and the rate-limit token bucket. Global 100 % is intentionally
      // NOT enforced — it would make CI fragile on out-of-scope UI / plumbing
      // files. The per-file 100 % threshold below gates EXACTLY these modules.
      include: [
        // 1. Mapping: toMidiBytes (Story 1.3).
        "packages/shared/src/encode.ts",
        // 4. Schéma: MidiEventSchema (Story 1.2).
        "packages/shared/src/midi-event.ts",
        // 2. Panic (Story 5.2) + Force Panic (Story 5.3).
        "apps/web/src/features/listener/lib/panic.ts",
        "apps/web/src/features/listener/lib/force-panic.ts",
        // 3. Scheduler: lookahead + backpressure + fail-safe (Story 4.3 / 5.4 / 5.5).
        "apps/web/src/features/listener/lib/scheduler.ts",
        // 4. ValidationService (Story 2.6, server 3rd layer).
        "apps/server/src/socket/services/ValidationService.ts",
        // 5. PerformerRegistry — single-slot owner registry (Story 2.3).
        "apps/server/src/socket/services/PerformerRegistry.ts",
        // 6. tokenBucket — per-socket rate limit (Story 2.5).
        "apps/server/src/utils/tokenBucket.ts",
      ],
      exclude: [],
      // Story 6.4 (NFR-16) — CI gate: every critical module MUST stay at 100 %
      // statements / branches / functions / lines. `perFile: true` applies the
      // threshold to EACH listed file individually, so a regression on any one
      // module fails the run. Global 100 % is intentionally NOT enforced (it
      // would make CI fragile on out-of-scope UI / plumbing files); only the 6
      // critical modules listed in `include` are gated.
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});