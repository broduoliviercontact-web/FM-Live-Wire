// Story 6.2 — French pluralization helper (`shared/i18n.ts`).
//
// French uses the "one" category for BOTH 0 and 1 (zéro / un évènement) and
// "other" for ≥ 2. The helper leans on `Intl.PluralRules("fr-FR")` so the
// category comes from the runtime's CLDR data — no hand-rolled `count === 1`
// rule that would mis-render 0 as plural.
//
// Covers the counters audited by Story 6.2: events reçus / envoyés, listeners,
// erreurs récentes, fallbacks/drops. Pure node (no DOM).
import { describe, it, expect } from "vitest";
import { pluralize, selectFr, frPlural } from "../shared/i18n";

describe("selectFr — Intl.PluralRules(\"fr-FR\") categories", () => {
  it("returns \"one\" for 0 and 1 (fr-FR), \"other\" for ≥ 2", () => {
    expect(selectFr(0)).toBe("one");
    expect(selectFr(1)).toBe("one");
    expect(selectFr(2)).toBe("other");
    expect(selectFr(7)).toBe("other");
    expect(selectFr(1000)).toBe("other");
  });

  it("exposes the underlying Intl.PluralRules instance (fr-FR locale)", () => {
    expect(frPlural.resolvedOptions().locale).toMatch(/^fr/);
  });
});

describe("pluralize — events reçus (0 / 1 / 7)", () => {
  it("uses the singular form for 0 and 1, plural for 7", () => {
    expect(pluralize(0, "event reçu", "events reçus")).toBe("event reçu");
    expect(pluralize(1, "event reçu", "events reçus")).toBe("event reçu");
    expect(pluralize(7, "event reçu", "events reçus")).toBe("events reçus");
  });
});

describe("pluralize — events envoyés (performer counters)", () => {
  it("uses the singular form for 0 and 1, plural for 3", () => {
    expect(pluralize(0, "event envoyé", "events envoyés")).toBe("event envoyé");
    expect(pluralize(1, "event envoyé", "events envoyés")).toBe("event envoyé");
    expect(pluralize(3, "event envoyé", "events envoyés")).toBe("events envoyés");
  });
});

describe("pluralize — listeners (0 / 1 / 3)", () => {
  it("uses the singular form for 0 and 1, plural for 3", () => {
    expect(pluralize(0, "listener", "listeners")).toBe("listener");
    expect(pluralize(1, "listener", "listeners")).toBe("listener");
    expect(pluralize(3, "listener", "listeners")).toBe("listeners");
  });
});

describe("pluralize — erreurs récentes (0 / 1 / 5)", () => {
  it("uses the singular form for 0 and 1, plural for 5", () => {
    expect(pluralize(0, "erreur récente", "erreurs récentes")).toBe("erreur récente");
    expect(pluralize(1, "erreur récente", "erreurs récentes")).toBe("erreur récente");
    expect(pluralize(5, "erreur récente", "erreurs récentes")).toBe("erreurs récentes");
  });
});

describe("pluralize — fallbacks / drops (if ever surfaced)", () => {
  it("uses the singular form for 0 and 1, plural for 2", () => {
    expect(pluralize(0, "fallback", "fallbacks")).toBe("fallback");
    expect(pluralize(1, "fallback", "fallbacks")).toBe("fallback");
    expect(pluralize(2, "fallback", "fallbacks")).toBe("fallbacks");
    expect(pluralize(0, "drop", "drops")).toBe("drop");
    expect(pluralize(1, "drop", "drops")).toBe("drop");
    expect(pluralize(2, "drop", "drops")).toBe("drops");
  });
});