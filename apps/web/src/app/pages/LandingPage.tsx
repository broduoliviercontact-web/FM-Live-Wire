import { LandingPanel } from "../../features/landing";

// Landing route (`/`). Renders the landing feature root (`app -> landing`,
// allowed). Story 6.1: project name + exact tagline + on-air indicator (light
// `/health` polling, NO Socket.IO — Q-UX5) + role picker (`/performer` |
// `/listener`) + exact footer. No marketing hero, no transverse nav (UX-DR1):
// the landing is the hub, each surface returns via its own `BackToHome`.
export function LandingPage() {
  return <LandingPanel />;
}