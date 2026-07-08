import { DexedLabPage as DexedLabPanel } from "../../features/dexed/DexedLabPage";

// Dexed/WAM spike route (`/lab/dexed`). Thin route binding — mirrors
// `ListenerPage` / `PerformerPage`: all Dexed logic lives inside
// `features/dexed/` (`app -> dexed`, allowed). The feature is self-contained
// and does NOT import `performer` / `listener` / `entities` (AD-2 isolation,
// enforced by ESLint). Hidden route — not listed on the landing hub. See
// docs/spikes/dexed-wam.md.
export function DexedLabPage() {
  return <DexedLabPanel />;
}