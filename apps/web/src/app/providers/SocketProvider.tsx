import { createContext, useContext, type ReactNode } from "react";
import { createSocket, type SocketPlaceholder } from "../../lib/socket";

// Placeholder provider — real Socket.IO client is wired in Epic 2.
const SocketContext = createContext<SocketPlaceholder | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const socket = createSocket();
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketPlaceholder | null {
  return useContext(SocketContext);
}