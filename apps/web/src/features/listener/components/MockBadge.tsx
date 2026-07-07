import { useListenerStore } from "../store/listenerStore";
import { MOCK_OUTPUT_ID } from "../lib/mock-output";

// Story 5.1 — Mock / Debug badge (UX-DR12, AD-14).
//
// Shown when the Mock output is selected (`selectedOutputId === MOCK_OUTPUT_ID`)
// to make it explicit that the bytes are visualized on screen and NO sound is
// produced. Purely presentational: reads the store, renders the exact text.
// Does NOT mention any emergency all-notes-off state — that is a later story.

/** Exact badge text (FR). */
const MOCK_BADGE_TEXT =
  "Sortie Mock / Debug — les bytes s'affichent à l'écran, aucun son n'est produit.";

export function MockBadge() {
  const selectedOutputId = useListenerStore((s) => s.selectedOutputId);
  if (selectedOutputId !== MOCK_OUTPUT_ID) return null;
  return (
    <p
      data-testid="listener-mock-badge"
      className="text-xs text-info"
    >
      {MOCK_BADGE_TEXT}
    </p>
  );
}