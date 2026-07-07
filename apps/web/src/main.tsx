import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./app/router";
import { SocketProvider } from "./app/providers/SocketProvider";
import { MidiAccessProvider } from "./app/providers/MidiAccessProvider";
import { Toaster } from "./shared/ui/sonner";

// App entry. The stylesheet is linked from index.html (kept out of TS so the
// ESLint boundaries resolver only sees resolvable TS/TSX imports).
const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <SocketProvider>
      <MidiAccessProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
        <Toaster />
      </MidiAccessProvider>
    </SocketProvider>
  </StrictMode>,
);