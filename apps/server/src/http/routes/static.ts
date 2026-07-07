import express from "express";
import path from "node:path";

// Serves the Vite production build (apps/web/dist) on the SAME origin as the
// API (AD-1 / AD-15: mono-process, mono-domain, zero CORS). The build is
// produced by `pnpm --filter @fmlw/web build`.
//
// SPA fallback: client routes (`/`, `/listener`, `/performer`) are handled by
// BrowserRouter in the bundle, so any non-asset GET must return index.html.
// We avoid Express 5 wildcard path syntax (`*` requires a named param in
// path-to-regexp v8) by using a trailing middleware keyed on `req.method` and
// the absence of a file extension.
//
// handlers element: pure (no internal imports). `distDir` is injected by the
// app layer so this module does not need to import config (handlers -> config
// is not in the boundary allow-list).

export function staticRouter(distDir: string): express.Router {
  const indexFile = path.join(distDir, "index.html");
  const router = express.Router();
  // 1. Serve built assets (js/css/images) with correct mime types + caching.
  router.use(express.static(distDir));
  // 2. SPA fallback for client routes — non-asset GETs return index.html.
  router.use((req, res, next) => {
    if (req.method === "GET" && path.extname(req.path) === "") {
      res.sendFile(indexFile);
      return;
    }
    next();
  });
  return router;
}