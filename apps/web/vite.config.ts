import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev/preview run on http://localhost in dev (HTTPS is a prod concern —
// AD-20; dev server check just needs Vite to start without error).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});