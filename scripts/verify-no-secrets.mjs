#!/usr/bin/env node
// Story 6.7 — Zero-secret bundle verification (NFR-9, S-7, AD-10).
//
// Scans the PRODUCED web bundle (`apps/web/dist`) for any leaked secret
// indicator and fails the build/CI if one is found. The critical requirement
// (PRD NFR-9, S-7, addendum A.1 invariant 10, AD-10) is that the owner shared
// secret `OWNER_SECRET` — and ANY `VITE_*` env var carrying a secret — NEVER
// reach the frontend bundle, because every `VITE_*` variable is inlined
// statically by Vite at build time and is readable in DevTools (dev AND prod).
//
// What this script checks (ONLY inside `apps/web/dist`):
//   1. The literal token `OWNER_SECRET` → fail (server secret name leaked).
//   2. Any `VITE_*` identifier ending in SECRET / TOKEN / KEY → fail (a secret
//      env var was inlined into the bundle).
//
// What it does NOT do:
//   - It never scans docs/, scripts/, apps/server, tests, or source — only the
//     built frontend bundle. `OWNER_SECRET` legitimately appears server-side
//     (env, config, tests, docs); that is acceptable (AD-10: server-only).
//   - It never prints a secret VALUE. It only reports the matched token NAME
//     and the file it was found in (e.g. `OWNER_SECRET` in `assets/index.js`).
//   - It cannot false-positive on its own source: this file lives under
//     `scripts/`, which is never scanned.
//
// Allowlist: empty by design. A secret token in the bundle is always a bug.
// If a genuinely benign match ever appears, add it here with a justification —
// but the expectation is that the list stays empty for the MVP.
//
// Invoked by `pnpm verify:no-secrets` and by CI (after `pnpm -r build`).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(root, "apps", "web", "dist");

// Matched token names only (never values). These are regexes over identifiers,
// so the captured text is the variable NAME, e.g. `OWNER_SECRET` or
// `VITE_FOO_TOKEN` — not a secret value.
const PATTERNS = [
  { name: "OWNER_SECRET", re: /OWNER_SECRET/g, reason: "server shared-secret name leaked into the bundle (AD-10, NFR-9, S-7)" },
  {
    name: "VITE_*SECRET/TOKEN/KEY",
    re: /\bVITE_[A-Z0-9_]*(?:SECRET|TOKEN|KEY)\b/g,
    reason: "a VITE_* secret env var was inlined into the bundle (Vite inlines every VITE_* statically)",
  },
];

// Minimal allowlist of (token, file-basename) pairs that are known-benign.
// Empty for the MVP — see header. Each entry MUST carry a justification.
const ALLOWLIST = []; // e.g. { token: "VITE_PUBLIC_TITLE", file: "index.html", why: "public site title, not a secret" }

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(distDir)) {
  console.error(`[verify-no-secrets] FAIL: apps/web/dist does not exist.`);
  console.error(`  Run "pnpm -r build" (or "pnpm --filter @fmlw/web build") first.`);
  process.exit(1);
}

const files = listFiles(distDir);
const findings = []; // { file, token, count, sample }

for (const file of files) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    // Skip binary / non-utf8 files silently — secrets are text.
    continue;
  }
  const rel = path.relative(root, file);
  for (const { name, re, reason } of PATTERNS) {
    re.lastIndex = 0;
    const matches = src.match(re);
    if (!matches) continue;
    // Drop allowlisted (token, file-basename) pairs.
    const kept = matches.filter((m) => {
      return !ALLOWLIST.some(
        (a) => a.token === m && path.basename(file) === a.file,
      );
    });
    if (kept.length === 0) continue;
    findings.push({ file: rel, token: name, count: kept.length, sample: kept[0], reason });
  }
}

if (findings.length === 0) {
  console.log(`[verify-no-secrets] PASS: scanned ${files.length} file(s) under apps/web/dist.`);
  console.log(`  0 occurrence of OWNER_SECRET.`);
  console.log(`  0 suspect VITE_*SECRET/TOKEN/KEY variable.`);
  process.exit(0);
}

console.error(`[verify-no-secrets] FAIL: secret indicator(s) found in the web bundle.`);
for (const f of findings) {
  console.error(`  - ${f.file}: ${f.count}× "${f.sample}" (${f.token}) — ${f.reason}`);
}
console.error(`  This is a security regression: a server/shared secret reached the frontend bundle.`);
process.exit(1);