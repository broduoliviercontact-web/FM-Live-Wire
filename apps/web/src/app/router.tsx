import { Routes, Route } from "react-router-dom";
import { RootLayout } from "./layouts/RootLayout";
import { LandingPage } from "./pages/LandingPage";
import { ListenerPage } from "./pages/ListenerPage";
import { PerformerPage } from "./pages/PerformerPage";
import { DexedLabPage } from "./pages/DexedLabPage";

// Declarative routes (React Router v7). Three placeholder pages under the
// shared RootLayout. Real pages are built in Epics 3–6.
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RootLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="listener" element={<ListenerPage />} />
        <Route path="performer" element={<PerformerPage />} />
        {/* Spike Dexed/WAM — experimental, isolated (see docs/spikes/dexed-wam.md). */}
        <Route path="lab/dexed" element={<DexedLabPage />} />
      </Route>
    </Routes>
  );
}