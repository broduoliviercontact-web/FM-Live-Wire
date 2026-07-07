import { Outlet, Link } from "react-router-dom";

// Story 6.1 — shared layout (UX-DR1: 3 surfaces, NO transverse nav).
//
// The landing `/` is the navigation hub (role-picker → `/performer` |
// `/listener`); each surface returns via its OWN `BackToHome` with a clean
// disconnect before navigation (Q-UX10). There is therefore NO transverse
// NavLink bar: only the brand (links home). The Story 1.4 placeholder NavLinks
// (Landing / Listener / Performer) are removed here as part of the final
// 3-surface assembly.
//
// `main` is centered; the landing caps itself at 720px (DESIGN.md) internally.

export function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center p-4">
          <Link
            to="/"
            className="font-semibold text-foreground hover:opacity-80"
            data-testid="brand-home"
          >
            FM Live Wire
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <Outlet />
      </main>
    </div>
  );
}