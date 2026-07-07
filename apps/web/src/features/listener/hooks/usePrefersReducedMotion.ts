import { useEffect, useState } from "react";

// Story 4.4 — `prefers-reduced-motion` detector (UX-DR12, AC-U19/UX-DR26).
//
// The `MidiActivityIndicator` pulses on each incoming `noteOn`. When the user
// has `prefers-reduced-motion: reduce` set, the animation is replaced by a
// static opacity change (no motion). This hook reads the media query and keeps
// the value live (re-renders if the user toggles the preference).
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