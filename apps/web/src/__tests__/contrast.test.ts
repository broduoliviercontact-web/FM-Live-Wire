// Story 6.3 — WCAG AA contrast proof for the DESIGN.md tokens (UX-DR24, AC-U18).
//
// jsdom cannot compute computed color-contrast from Tailwind classes (no CSS is
// loaded in the test env), so the automated axe run disables the `color-contrast`
// rule (see story6.3-a11y.test.tsx). This file is the dedicated, deterministic
// contrast proof: it parses the DESIGN.md hex tokens and asserts the WCAG 2.1 AA
// ratio (≥ 4.5:1) for the two pairs called out by the story:
//   - `danger_fill #E11D2E` + white text (the Panic button fill) — AA;
//   - `ink.muted #898F98` on `surface_2 #1A1D23` (secondary/muted text on the
//     darker surface) — AA.
//
// Pure node (no DOM). The luminance + ratio helpers are the WCAG 2.1 sRGB
// formula (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance).
import { describe, it, expect } from "vitest";

/** Parse a `#RRGGBB` hex string into an [r,g,b] 0–255 tuple. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length !== 6) throw new Error(`bad hex ${hex}`);
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.1 sRGB relative luminance for one 0–255 channel value. */
function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a `#RRGGBB` color (WCAG 2.1). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG 2.1 contrast ratio between two `#RRGGBB` colors (always ≥ 1). */
function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// DESIGN.md canonical tokens (mirror of `apps/web/src/shared/tokens.css`).
const DANGER_FILL = "#E11D2E";
const WHITE = "#FFFFFF";
const INK_MUTED = "#898F98";
const SURFACE_2 = "#1A1D23";
// Bonus pairs audited for completeness (AA sanity).
const INK_PRIMARY = "#E8EAED";
const SURFACE = "#121418";

describe("WCAG AA contrast — DESIGN.md tokens (Story 6.3, UX-DR24)", () => {
  it("danger_fill #E11D2E + white text ≥ 4.5:1 (AA) — Panic button fill", () => {
    const ratio = contrastRatio(WHITE, DANGER_FILL);
    // DESIGN.md declares ≈ 4.6:1; allow a tiny float slack but require AA.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(4.6, 0);
  });

  it("ink.muted #898F98 on surface_2 #1A1D23 ≥ 4.5:1 (AA) — muted text on the darker surface", () => {
    const ratio = contrastRatio(INK_MUTED, SURFACE_2);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("ink.primary #E8EAED on surface #121418 ≥ 4.5:1 (AA) — primary text on a card", () => {
    const ratio = contrastRatio(INK_PRIMARY, SURFACE);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("danger_fill #E11D2E + white text is NOT AAA (≈ 4.6 < 7) — large/bold only, as DESIGN.md states", () => {
    // Documents the design choice: danger_fill is AA for normal text but not AAA.
    const ratio = contrastRatio(WHITE, DANGER_FILL);
    expect(ratio).toBeLessThan(7);
  });
});