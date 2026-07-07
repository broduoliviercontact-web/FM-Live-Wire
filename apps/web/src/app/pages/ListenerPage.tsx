import { ListenerPanel } from "../../features/listener";

// Listener route (`/listener`). Renders the listener feature root
// (`app -> listener`, allowed). The feature does not import the performer
// feature (AD-2 isolation, enforced by ESLint). The Card/layout live inside
// the feature so this page stays a thin route binding (mirrors `PerformerPage`).
// `MidiAccessProvider` is mounted globally in `main.tsx`, so `useMidiInputs`
// is available to the feature without wiring here.
export function ListenerPage() {
  return <ListenerPanel />;
}