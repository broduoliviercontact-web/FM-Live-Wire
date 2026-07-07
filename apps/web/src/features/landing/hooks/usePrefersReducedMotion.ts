import { useEffect, useState } from "react";

// Story 6.1 — `prefers-reduced-motion` detector for the landing on-air pulse
// (AC-U2, UX-DR3, UX-DR26).
//
// The on-air dot pulses when a performer is active. When the user has
// `prefers-reduced-motion: reduce` set, the animation is replaced by a static
// opacity (no motion). This hook reads the media query and keeps the value
// live (re-renders if the user toggles the preference).
//
// DUPLICATED from the listener feature's own `usePrefersReducedMotion` hook
// for AD-2 isolation (the landing feature must NOT import another feature; the
// hook is small enough that a local copy is preferable to a cross-feature
// import — same pattern as the per-feature `BrowserCompatGate`).
//
// `window.matchMedia` is read inside the effect (not during render) so SSR /
// non-DOM environments default to `false` (motion allowed). jsdom does not
// implement `matchMedia` by default; tests define it.

/**
 * Returns `true` when the user prefers reduced motion (`prefers-reduced-motion:
 * reduce`). Defaults to `false` until the effect runs (so the first paint
 * never crashes without `matchMedia`).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}