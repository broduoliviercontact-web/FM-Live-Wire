// Story 2.2 — OWNER_SECRET timing-safe validation (pure unit tests) + env
// hardening proofs (AD-10): OWNER_SECRET is server-only, never a VITE_* var, and
// the pure validator never exposes the failure reason and never throws.
//
// No fragile timing benchmark here: we assert DETERMINISTICALLY that the
// timing-safe path is reachable for equal-length inputs, that unequal lengths
// do NOT throw (length guard), and that every failure is the single generic
// `false`. Timing properties of `crypto.timingSafeEqual` are trusted from Node.
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect } from "vitest";
import { isTokenValidTimingSafe } from "../socket/middlewares/roleAuth";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SECRET = "a-very-long-and-random-owner-secret-value";

describe("isTokenValidTimingSafe (pure, AD-10)", () => {
  it("returns true only for the exact secret", () => {
    expect(isTokenValidTimingSafe(SECRET, SECRET)).toBe(true);
  });

  it("returns false for a wrong token of the same length (timing-safe path, no early-return leakage)", () => {
    // Same length so the length guard is NOT taken — the comparison reaches
    // crypto.timingSafeEqual and returns false (not throws).
    const sameLen = SECRET.split("").reverse().join("");
    expect(sameLen).toHaveLength(SECRET.length);
    expect(isTokenValidTimingSafe(sameLen, SECRET)).toBe(false);
  });

  it("returns false for a missing token (undefined)", () => {
    expect(isTokenValidTimingSafe(undefined, SECRET)).toBe(false);
  });

  it("returns false for a non-string token (number / null)", () => {
    expect(isTokenValidTimingSafe(12345, SECRET)).toBe(false);
    expect(isTokenValidTimingSafe(null, SECRET)).toBe(false);
  });

  it("returns false for an empty token", () => {
    expect(isTokenValidTimingSafe("", SECRET)).toBe(false);
  });

  it("returns false when OWNER_SECRET is empty (dev: no secret set)", () => {
    // Performer must be rejected generically until a secret is configured.
    expect(isTokenValidTimingSafe("anything", "")).toBe(false);
    expect(isTokenValidTimingSafe("", "")).toBe(false);
  });

  it("returns false for mismatched lengths WITHOUT throwing (length guard)", () => {
    // crypto.timingSafeEqual throws RangeError on unequal lengths; the guard
    // must intercept. We assert no throw + false for several length deltas.
    const run = (token: string) => {
      let result: boolean | undefined;
      expect(() => {
        result = isTokenValidTimingSafe(token, SECRET);
      }).not.toThrow();
      expect(result).toBe(false);
    };
    run("short");
    run("");
    run(SECRET + "X");
    run(SECRET.slice(0, 1));
  });

  it("never exposes the failure reason (pure boolean return)", () => {
    // The function returns ONLY a boolean — there is no error message / code to
    // distinguish missing vs wrong vs wrong-length. Anti-enumeration.
    expect(isTokenValidTimingSafe(undefined, SECRET)).toBe(false);
    expect(isTokenValidTimingSafe("wrong", SECRET)).toBe(false);
    expect(isTokenValidTimingSafe("wrong-length", SECRET)).toBe(false);
    expect(isTokenValidTimingSafe(SECRET, "")).toBe(false);
    // The single positive case:
    expect(isTokenValidTimingSafe(SECRET, SECRET)).toBe(true);
  });
});

describe("env hardening (AD-10: OWNER_SECRET server-only)", () => {
  const webRoot = path.resolve(__dirname, "../../web/src");

  it("apps/web/src contains NO reference to OWNER_SECRET or VITE_OWNER_SECRET", () => {
    // Scan the web source tree for any leak of the server-only secret. The
    // secret is read only server-side (apps/server/src/config/env.ts).
    const found: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name));
        } else if (/\.(ts|tsx|js|jsx|html|css|json)$/.test(entry.name)) {
          const full = path.join(dir, entry.name);
          const text = readFileSync(full, "utf8");
          if (text.includes("OWNER_SECRET") || text.includes("VITE_OWNER_SECRET")) {
            found.push(full);
          }
        }
      }
    };
    walk(webRoot);
    expect(found).toEqual([]);
  });

  it(".env is gitignored", () => {
    const gitignore = path.resolve(__dirname, "../../../../.gitignore");
    const text = readFileSync(gitignore, "utf8");
    expect(text).toMatch(/(^|\n)\.env(\n|$)/);
  });

  it(".env.example exists and ships NO secret VALUES (keys only)", () => {
    const envExample = path.resolve(__dirname, "../../../../.env.example");
    const text = readFileSync(envExample, "utf8");
    // OWNER_SECRET must be present as a key but with an empty value.
    expect(text).toMatch(/OWNER_SECRET\s*=\s*($|\n)/);
    // No VITE_OWNER_SECRET key in the example.
    expect(text).not.toMatch(/VITE_OWNER_SECRET/);
  });
});