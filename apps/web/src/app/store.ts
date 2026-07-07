import { create } from "zustand";

// Minimal Zustand store proving the integration (AD-6: Zustand, no TanStack
// Query). Real state lands in Epics 3–6; this is a placeholder.
interface UiState {
  readonly theme: "dark";
  readonly ready: boolean;
  setReady: (ready: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: "dark",
  ready: false,
  setReady: (ready) => set({ ready }),
}));