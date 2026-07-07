// Minimal structured-ish logger (AD-18 / Epic 8 expand it). No MIDI detail yet —
// `logMidi` gating is wired in Epic 2. srv-shared is a leaf: no internal imports.

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function emit(level: LogLevel, name: string, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    name,
    msg: message,
    ...(meta ? { meta } : {}),
  });
  const stream = level === "error" ? console.error : console.log;
  stream(line);
}

/** Create a named logger. Writes one JSON line per call to stdout/stderr. */
export function createLogger(name = "server"): Logger {
  return {
    info: (message, meta) => emit("info", name, message, meta),
    warn: (message, meta) => emit("warn", name, message, meta),
    error: (message, meta) => emit("error", name, message, meta),
  };
}