import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { BrowserCompatGate } from "./components/BrowserCompatGate";
import { MidiPermissionButton } from "./components/MidiPermissionButton";
import { MidiPortPicker } from "./components/MidiPortPicker";
import { ChannelSelector } from "./components/ChannelSelector";
import { JoinButton } from "./components/JoinButton";
import { TestNoteButton } from "./components/TestNoteButton";
import { StatusPill } from "./components/StatusPill";
import { MidiActivityIndicator } from "./components/MidiActivityIndicator";
import { EmptyState } from "./components/EmptyState";
import { ProtocolVersionAlert } from "./components/ProtocolVersionAlert";
import { MockBadge } from "./components/MockBadge";
import { MockByteStream } from "./components/MockByteStream";
import { LateAlert } from "./components/LateAlert";
import { LatencyStat } from "./components/LatencyStat";
import { OutputLostAlert } from "./components/OutputLostAlert";
import { PanicButton } from "./components/PanicButton";
import { ForcePanicButton } from "./components/ForcePanicButton";
import { BackToHome } from "./components/BackToHome";
import { useOutputState } from "./hooks/useOutputState";
import { leaveListenerForNavigation } from "./api/connection";

// Listener feature root (Story 4.1 + 4.2).
//
// Public `/listener` page (no account). The role tag `LISTENER` + the intro
// panel are ALWAYS visible (page-level, outside the gate). `BrowserCompatGate`
// wraps ONLY the MIDI flow: it blocks incompatible browsers (E1/E2) with a
// terminal screen BEFORE any `requestMIDIAccess` call. On a compatible browser,
// `MidiPermissionButton` asks for MIDI access on the user's click
// (`requestMIDIAccess({ sysex:false })`, never at load). On success it shows a
// `connected` StatusPill "MIDI autorisé".
//
// Story 4.2 — once MIDI is authorized, the output picker + channel selector
// appear (both self-toggle to null unless access is granted). The listener picks
// a real MIDI output and a forced output channel (UI 1–16, data 0–15 at the
// edge). No join / reception / scheduler / output-sending yet (later stories).
//
// Story 4.3 — `JoinButton` (« Rejoindre le flux » / « Quitter le flux ») is
// the join/leave control + the live `midi:event` → output pipeline. It is
// disabled until an output is chosen (AC-U3) and never imports the performer
// feature (AD-2 isolation).
//
// Does NOT import the performer feature (AD-2 isolation, enforced by ESLint).
// `MidiAccessProvider` is mounted globally in `main.tsx`.

export function ListenerPanel() {
  // Story 5.5 — watch the selected real output for in-session loss (port
  // unplugged / `state:"disconnected"`) and trigger the LOCAL fail-safe
  // (scheduler stop + clear selection + E5 alert). No-op for the Mock and when
  // no real port is chosen. Runs once at the panel root (under the global
  // `MidiAccessProvider`).
  useOutputState();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listener</CardTitle>
        <CardDescription>
          Réception MIDI en direct — one-way broadcast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge data-testid="listener-role-tag">LISTENER</Badge>
        {/* Story 6.1 — clean return home (Q-UX10, UX-DR1). « ← Retour » emits a
            best-effort room:leave + intentional disconnect (no ghost membership,
            no server-down pill) BEFORE navigating to `/`. Always visible so the
            listener can leave before granting MIDI access / joining. */}
        <BackToHome onDisconnect={leaveListenerForNavigation} />

        <p className="text-sm text-muted-foreground">
          Vous recevez des événements MIDI en direct. Votre synthé FM génère le
          son.
        </p>

        <BrowserCompatGate>
          <MidiPermissionButton />
          {/* Story 4.2 — output + channel selection. Both return null until
              MIDI access is granted, so they can be mounted unconditionally and
              self-toggle like the performer's input picker. */}
          <MidiPortPicker />
          <ChannelSelector />
          {/* Story 4.3 — join/leave + live reception → remap → encode → send. */}
          <JoinButton />
          {/* Story 4.4 — local test note + flux status + activity indicator. */}
          <TestNoteButton />
          <StatusPill />
          <MidiActivityIndicator />
          {/* Story 4.5 — empty/error states: waiting hint (E7-adjacent empty),
              performer-disconnected pill (E7), server-down pill, and the E13
              protocol-version alert. The pill text covers server-down/E7; this
              adds the waiting empty-state hint + the E13 terminal alert. */}
          <EmptyState />
          <ProtocolVersionAlert />
          {/* Story 5.1 — Mock / Debug output: badge + on-screen byte stream.
              Rendered only when the Mock output is selected (the components
              self-gate on `selectedOutputId === MOCK_OUTPUT_ID`). The Mock is
              an interchangeable output — the scheduler pipeline is unchanged. */}
          <MockBadge />
          <MockByteStream />
          {/* Story 5.4 — backpressure UI: a LOCAL late/overload alert (FR-27,
              UX-DR14) + an alerte-only latency stat (UX-DR12). Both self-gate
              on `lateWarning` (null on calm reception), so mounting them
              unconditionally renders nothing by default. LOCAL PUR: no network
              event is emitted when these raise (no server overload event). */}
          <LateAlert />
          <LatencyStat />
          {/* Story 5.5 — E5 output-lost alert (AD-17, UX-DR14, AC-U9). Shown
              when the selected real output was lost in session (unplugged /
              closed / `send()` threw). Self-gates on `outputLost`; the
              `MidiPortPicker` reopens (selection cleared) so the listener can
              pick another sortie, which dismisses this alert. LOCAL: no network
              event. The fail-safe (scheduler stop) is wired in `connection.ts`. */}
          <OutputLostAlert />
          {/* Story 5.3 — Force Panic (opt-in, secondary). Opens a confirmation
              dialog (`ForcePanicDialog`) before sending the 2048-message
              noteOff sweep; disabled until a local output is selected. The
              normal Panic below stays the always-available escape hatch. Like
              Panic, Force Panic is fully local (no backend dependency). */}
          <ForcePanicButton />
          {/* Story 5.2 — local Panic (AD-7, S-2). Fixed to the bottom of the
              viewport (UX-DR15), ALWAYS enabled (never disabled, in no flux
              state), and network-free: it sends the 64-message CC sweep to the
              selected local output (real or Mock) with no dependency on the
              backend — so it still cuts stuck notes with the server down.
              Story 5.3 raises the z to z-[60] so it stays visible + clickable
              above the `ForcePanicDialog` overlay (z-50) — the escape hatch
              remains available even while the Force Panic dialog is open. */}
          <PanicButton />
        </BrowserCompatGate>
      </CardContent>
    </Card>
  );
}