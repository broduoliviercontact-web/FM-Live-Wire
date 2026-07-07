// Story 1.5 — server integration tests (in-process, no Socket.IO).
//
// Hermetic: the static-serving test uses a temp dist dir so it does not depend
// on `apps/web/dist` existing. A second static test asserts the REAL Vite build
// is served when present (the check sequence builds web first, so it runs there;
// it skips when the build is absent, e.g. a bare `pnpm test`).
//
// Tests are excluded from tsc + ESLint boundary rules (dev tooling only).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../app/index";
import { resolveEnv, requireOwnerSecretInProd, DEFAULT_PORT, DEFAULT_MAX_LISTENERS } from "../config/env";

const HEALTH_EXPECTED_KEYS = ["ok", "uptime", "ownerActive", "listeners"] as const;

describe("GET /health", () => {
  const app = createApp("/nonexistent-dist");

  it("returns 200 with the FR-28 / AD-20 shape (ownerActive stub)", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
    for (const key of HEALTH_EXPECTED_KEYS) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.ownerActive).toBe(false);
    expect(res.body.listeners).toBe(0);
  });

  it("does not expose server secrets in the body", async () => {
    const res = await request(app).get("/health");
    expect(JSON.stringify(res.body)).not.toContain("OWNER_SECRET");
    expect(JSON.stringify(res.body)).not.toContain("VITE_");
  });
});

describe("static serving (hermetic temp dist)", () => {
  let distDir: string;

  beforeAll(() => {
    distDir = mkdtempSync(path.join(tmpdir(), "fmlw-dist-"));
    writeFileSync(
      path.join(distDir, "index.html"),
      "<!doctype html><html><head></head><body><div id=\"root\">FM Live Wire</div></body></html>",
    );
  });

  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  it("serves index.html at /", async () => {
    const app = createApp(distDir);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('<div id="root">');
  });

  it("returns index.html for the SPA client route /listener", async () => {
    const app = createApp(distDir);
    const res = await request(app).get("/listener");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });

  it("returns index.html for the SPA client route /performer", async () => {
    const app = createApp(distDir);
    const res = await request(app).get("/performer");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });
});

describe("static serving (real Vite build, when present)", () => {
  const realDist = path.resolve(__dirname, "../../../web/dist");
  const hasBuild = existsSync(path.join(realDist, "index.html"));

  it.skipIf(!hasBuild)("serves the built web index.html at /", async () => {
    const app = createApp(realDist);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="root"');
  });
});

describe("env config applies safe defaults (AD-20)", () => {
  it("resolveEnv({}) yields defaults (OWNER_SECRET empty, logMidi false)", () => {
    const cfg = resolveEnv({});
    expect(cfg.port).toBe(DEFAULT_PORT);
    expect(cfg.publicOrigin).toBe(`http://localhost:${DEFAULT_PORT}`);
    expect(cfg.ownerSecret).toBe("");
    expect(cfg.logMidi).toBe(false);
    expect(cfg.maxListeners).toBe(DEFAULT_MAX_LISTENERS);
  });

  it("resolveEnv honors explicit values and LOG_MIDI=1", () => {
    const cfg = resolveEnv({
      PORT: "9000",
      PUBLIC_ORIGIN: "https://live.example",
      OWNER_SECRET: "s3cret",
      LOG_MIDI: "1",
      MAX_LISTENERS: "50",
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.publicOrigin).toBe("https://live.example");
    expect(cfg.ownerSecret).toBe("s3cret");
    expect(cfg.logMidi).toBe(true);
    expect(cfg.maxListeners).toBe(50);
  });

  it("resolveEnv ignores garbage integers (falls back to defaults)", () => {
    const cfg = resolveEnv({ PORT: "not-a-number", MAX_LISTENERS: "-3" });
    expect(cfg.port).toBe(DEFAULT_PORT);
    expect(cfg.maxListeners).toBe(DEFAULT_MAX_LISTENERS);
  });
});

// Story 6.8 — OWNER_SECRET must be set in production (AD-10). Fail fast at
// startup; optional in dev/tests. Pure function over the resolved config.
describe("OWNER_SECRET prod enforcement (Story 6.8, AD-10)", () => {
  const devCfg = resolveEnv({ OWNER_SECRET: "" });
  const prodCfg = resolveEnv({ OWNER_SECRET: "s3cret" });

  it("throws in production when OWNER_SECRET is empty", () => {
    expect(() => requireOwnerSecretInProd({ ...devCfg, ownerSecret: "" }, true)).toThrow(
      /OWNER_SECRET is required in production/,
    );
  });

  it("does not throw in production when OWNER_SECRET is set", () => {
    expect(() => requireOwnerSecretInProd({ ...prodCfg, ownerSecret: "s3cret" }, true)).not.toThrow();
  });

  it("does not throw in dev when OWNER_SECRET is empty", () => {
    expect(() => requireOwnerSecretInProd({ ...devCfg, ownerSecret: "" }, false)).not.toThrow();
  });
});