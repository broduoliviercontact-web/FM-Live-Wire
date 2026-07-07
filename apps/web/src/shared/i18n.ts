// Story 6.2 — French pluralization helper (DESIGN.md microcopy + epics 6.2).
//
// French uses the "one" category for BOTH 0 and 1 (zéro évènement, un
// évènement) and "other" for ≥ 2. Naive `count === 1` checks produce the
// wrong string for 0 ("0 events reçus" instead of "0 event reçu"). We lean on
// `Intl.PluralRules("fr-FR")` so the category comes from the runtime's CLDR
// data — no hand-rolled rules to drift.
//
// `pluralize(count, singular, plural)` returns the right label form for the
// count. Callers render the number themselves (e.g. `${n} ${pluralize(n,
// "event reçu", "events reçus")}`) so the counter is always visible.

const frPlural = new Intl.PluralRules("fr-FR");

/** Exposed for tests that want to assert the category directly. */
export { frPlural };

/**
 * Returns `"one"` for 0 and 1, `"other"` for ≥ 2 (fr-FR). Wrapper around
 * `Intl.PluralRules("fr-FR").select` so callers do not import the runtime
 * instance themselves.
 */
export function selectFr(count: number): "one" | "other" {
  return frPlural.select(count) as "one" | "other";
}

/**
 * Picks the singular or plural label for a count, using fr-FR plural rules.
 * The count itself is NOT included in the returned string — callers render
 * `${count} ${pluralize(count, singular, plural)}`.
 *
 * Examples (fr-FR):
 *   pluralize(0, "event reçu",   "events reçus")   → "event reçu"
 *   pluralize(1, "event reçu",   "events reçus")   → "event reçu"
 *   pluralize(7, "event reçu",   "events reçus")   → "events reçus"
 *   pluralize(0, "erreur récente", "erreurs récentes") → "erreur récente"
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return selectFr(count) === "one" ? singular : plural;
}