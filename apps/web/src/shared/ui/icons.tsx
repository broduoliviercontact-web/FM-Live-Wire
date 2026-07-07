// Story 6.2 — small inline SVG icons for alerts and the Panic button
// (DESIGN.md: alertes = bordure gauche 3px + icône + couleur sémantique ;
// PanicButton = icône stop). Kept inline (no icon dependency) and currentColor
// so they inherit the alert's semantic text color.
import * as React from "react";

type IconProps = React.SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

/** Stop / square icon — PanicButton (DESIGN.md `panic_button: icône stop`). */
export function StopIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Info icon — info alerts (cyan, Mock/Debug, empty-output hint). */
export function InfoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Warning triangle — late / rate-limit alerts (amber). */
export function WarnIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 22 20 2 20 Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Danger / alert octagon — blocking errors (incompatible protocol, output
 * lost, MIDI denied, busy performer, insecure/no-Web-MIDI). */
export function DangerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 3h8l4 4v8l-4 4H8l-4-4V7Z" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Check mark — ChannelSelector active radio (Story 6.3, UX-DR25). The active
 * channel carries a visible check icon so the selection does NOT rely on color
 * alone. Always rendered `aria-hidden` (decorative — the `aria-checked` state on
 * the radio is the programmatic signal). */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}