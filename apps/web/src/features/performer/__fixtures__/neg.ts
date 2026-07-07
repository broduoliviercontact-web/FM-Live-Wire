// TS fixture (NEGATIVE): performer -> listener is FORBIDDEN (AD-2 isolation).
// Real TS: type-only import alongside a value import.
import { target, type ListenerState } from "../../listener/__fixtures__/target";

export const neg: ListenerState = target;