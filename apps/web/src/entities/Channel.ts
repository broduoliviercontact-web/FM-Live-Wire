// Wire channel: 0–15 (UI shows 1–16; conversion −1 at the edge, AD-5).
export type Channel = number;

export {
  CHANNEL_MIN as WIRE_CHANNEL_MIN,
  CHANNEL_MAX as WIRE_CHANNEL_MAX,
} from "@fmlw/shared";