import { PerformerPanel } from "../../features/performer";

// Performer route (`/performer`). Renders the performer feature root
// (`app -> performer`, allowed). The feature does not import the listener
// feature (AD-2 isolation, enforced by ESLint). The Card/layout live inside the
// feature so this page stays a thin route binding.
export function PerformerPage() {
  return <PerformerPanel />;
}