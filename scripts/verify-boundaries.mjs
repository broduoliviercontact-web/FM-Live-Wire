#!/usr/bin/env node
// Dedicated boundary-rule test for Story 1.1.
//
// Runs ESLint (with eslint.fixtures.config.js — same directional rules as
// the main config, but no ignores) against fixture files placed at the
// real layer paths, and asserts:
//   - POSITIVE: allowed directional imports produce ZERO errors.
//   - NEGATIVE: a forbidden `features/performer -> features/listener` import
//     is rejected with a `boundaries/element-types` error.
//
// This is the lint-rule test required by the Story 1.1 acceptance criteria
// ("Un test lint dédié vérifie qu'un import `performer -> listener` est
// rejeté"). Invoked by `pnpm test`.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const eslintBin = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
const fixturesConfig = path.join(root, "eslint.fixtures.config.js");

// Each fixture is linted in isolation so only the importer's rule is exercised.
// expect: "pass" -> 0 errors.  "fail" -> >=1 error with the expected ruleId.
const FIXTURES = [
  // --- Frontend positive chain: app -> features -> entities -> shared -> lib ---
  { file: "apps/web/src/app/__fixtures__/root.js", expect: "pass", desc: "app -> features" },
  { file: "apps/web/src/features/performer/__fixtures__/feat.js", expect: "pass", desc: "performer -> entities" },
  { file: "apps/web/src/features/listener/__fixtures__/lst.js", expect: "pass", desc: "listener -> entities" },
  { file: "apps/web/src/entities/__fixtures__/ent.js", expect: "pass", desc: "entities -> shared" },
  { file: "apps/web/src/shared/__fixtures__/mid.js", expect: "pass", desc: "shared -> lib" },
  { file: "apps/web/src/lib/__fixtures__/leaf.js", expect: "pass", desc: "lib (no internal imports)" },
  // --- Backend positive chain: handlers -> services -> shared ---
  { file: "apps/server/src/socket/handlers/__fixtures__/h.js", expect: "pass", desc: "handlers -> services" },
  { file: "apps/server/src/socket/services/__fixtures__/svc.js", expect: "pass", desc: "services -> shared" },
  { file: "apps/server/src/shared/__fixtures__/base.js", expect: "pass", desc: "server shared (no internal imports)" },
  // --- Frontend NEGATIVE: performer <-> listener isolation (AD-2, both directions) ---
  {
    file: "apps/web/src/features/performer/__fixtures__/neg.js",
    expect: "fail",
    ruleId: "boundaries/element-types",
    desc: "performer -> listener (FORBIDDEN)",
  },
  {
    file: "apps/web/src/features/listener/__fixtures__/neg-rev.js",
    expect: "fail",
    ruleId: "boundaries/element-types",
    desc: "listener -> performer (FORBIDDEN, reverse)",
  },
  // --- TypeScript fixtures (.ts/.tsx): prove ESLint parses real TS syntax
  //     and the boundary rule fires on TS imports, not only on .js. ---
  { file: "apps/web/src/entities/__fixtures__/ent.ts", expect: "pass", desc: "TS: entities leaf (interface + typed const)" },
  { file: "apps/web/src/features/performer/__fixtures__/feat.ts", expect: "pass", desc: "TS: performer -> entities (allowed)" },
  { file: "apps/web/src/features/listener/__fixtures__/target.ts", expect: "pass", desc: "TS: listener leaf (typed)" },
  { file: "apps/web/src/app/__fixtures__/root.tsx", expect: "pass", desc: "TSX: app -> performer (allowed, JSX parsed)" },
  {
    file: "apps/web/src/features/performer/__fixtures__/neg.ts",
    expect: "fail",
    ruleId: "boundaries/element-types",
    desc: "TS: performer -> listener (FORBIDDEN)",
  },
];

function lint(file) {
  const args = ["--no-ignore", "--config", fixturesConfig, "-f", "json", file];
  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync("node", [eslintBin, ...args], {
      cwd: root,
      encoding: "utf8",
    });
  } catch (err) {
    stdout = err.stdout ?? "";
    code = err.status ?? 1;
  }
  let results = [];
  try {
    results = JSON.parse(stdout || "[]");
  } catch {
    // non-JSON output (e.g. config error) -> treat as a hard failure
  }
  const res = results[0] ?? { errorCount: 0, messages: [] };
  return { code, errorCount: res.errorCount ?? 0, messages: res.messages ?? [] };
}

let failures = 0;
const lines = [];

for (const f of FIXTURES) {
  const { errorCount, messages } = lint(path.join(root, f.file));
  let ok;
  let detail = "";
  if (f.expect === "pass") {
    ok = errorCount === 0;
    detail = ok ? "0 errors" : `${errorCount} error(s)`;
  } else {
    const hit = messages.some((m) => m.ruleId === f.ruleId);
    ok = errorCount >= 1 && hit;
    if (!ok) {
      detail = errorCount === 0
        ? "expected a boundary error but got none"
        : `got errors but none with ruleId=${f.ruleId}; rules=${JSON.stringify(messages.map((m) => m.ruleId))}`;
    } else {
      const m = messages.find((x) => x.ruleId === f.ruleId);
      detail = `rejected by ${f.ruleId}: "${m.message}"`;
    }
  }
  const status = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  const expectLabel = f.expect.toUpperCase().padEnd(5);
  lines.push(`  [${status}] ${expectLabel} ${f.desc.padEnd(46)} ${detail}`);
}

console.log("Boundaries rule test (positive + negative):");
console.log(lines.join("\n"));
console.log("");

if (failures === 0) {
  console.log(`✅ All ${FIXTURES.length} boundary assertions passed.`);
  process.exit(0);
} else {
  console.log(`❌ ${failures} boundary assertion(s) failed.`);
  process.exit(1);
}