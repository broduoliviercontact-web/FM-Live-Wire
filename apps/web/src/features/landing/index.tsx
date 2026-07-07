import { OnAirIndicator } from "./components/OnAirIndicator";
import { RolePicker } from "./components/RolePicker";

// Story 6.1 — Landing feature root (UX-DR1, UX-DR3, AC-U2, FR-28, AD-20).
//
// The landing `/` is the hub: it states what the product is (MIDI, not audio),
// shows whether someone is on air (light `/health` polling — NO Socket.IO,
// Q-UX5), and routes the visitor to the right surface via two buttons. No
// marketing hero, no transverse nav (UX-DR1): each surface returns via its own
// `BackToHome` with a clean disconnect before navigation (Q-UX10).
//
// Exact strings (validated by Zub / story spec):
//   - tagline : « Radio live de contrôle MIDI. Le son naît chez vous, sur votre
//                synthé. »
//   - footer  : « Chrome/Edge · HTTPS · Web MIDI »
//
// Layout: centered, max 720px (DESIGN.md). The footer is the production
// requirements hint (compatible browser + secure context + Web MIDI).

/** Project name (also the brand in `RootLayout`). */
const PROJECT_NAME = "FM Live Wire";
/** Exact tagline (story spec / UX-DR3). */
const TAGLINE = "Radio live de contrôle MIDI. Le son naît chez vous, sur votre synthé.";
/** Exact footer (story spec). */
const FOOTER = "Chrome/Edge · HTTPS · Web MIDI";

export function LandingPanel() {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col items-center gap-6 py-8 text-center">
      <header className="space-y-3">
        <h1
          className="text-3xl font-semibold tracking-tight"
          data-testid="landing-project-name"
        >
          {PROJECT_NAME}
        </h1>
        <p
          className="text-balance text-muted-foreground"
          data-testid="landing-tagline"
        >
          {TAGLINE}
        </p>
      </header>

      {/* On-air indicator: light /health polling (NO Socket.IO on the landing). */}
      <OnAirIndicator />

      {/* Role picker → /performer | /listener. Buttons stay active off-air. */}
      <RolePicker />

      <footer
        className="pt-4 text-xs text-muted-foreground"
        data-testid="landing-footer"
      >
        {FOOTER}
      </footer>
    </div>
  );
}