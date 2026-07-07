// Roles (AD-2: one owner/performer, many listeners; performerId = socket.id).
export type Role = "performer" | "listener" | "owner";

export const ROLES: readonly Role[] = ["performer", "listener", "owner"] as const;