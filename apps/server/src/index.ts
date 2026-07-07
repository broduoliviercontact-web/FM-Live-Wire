// @fmlw/server entrypoint. Story 1.5: thin Express coque (static Vite + /health).
// Epic 2 attaches Socket.IO onto the same http.Server returned by startServer.
import { startServer } from "./app/index.js";

startServer();