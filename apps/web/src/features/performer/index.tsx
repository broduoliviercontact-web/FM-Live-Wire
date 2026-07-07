import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/alert";
import { DangerIcon } from "../../shared/ui/icons";
import { BrowserCompatGate } from "./components/BrowserCompatGate";
import { AdminTokenInput } from "./components/AdminTokenInput";
import { PerformerBusyAlert } from "./components/PerformerBusyAlert";
import { MidiPermissionButton } from "./components/MidiPermissionButton";
import { MidiPortPicker } from "./components/MidiPortPicker";
import { MonitoringPanel } from "./components/MonitoringPanel";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { BackToHome } from "./components/BackToHome";
import { connectPerformer } from "./api/socket";
import { emitMidiEvent, fetchListenersCount } from "./api/relay";
import { useMidiInput } from "./hooks/useMidiInput";
import {
  usePerformerStore,
  PERFORMER_END_MESSAGE,
} from "./store/performerStore";
import type { MidiEvent } from "../../entities/MidiEvent";

// Story 3.1 + 3.5 — Performer feature root.
//
// Orchestrates the `/performer` flow:
//   1. BrowserCompatGate — refuse incompatible browsers (terminal, no MIDI call).
//   2. AdminTokenInput — enter the admin token (memory only, never persisted).
//   3. connectPerformer — Socket.IO handshake with `auth: { role, token }` +
//      reconnection (Story 3.5): network drops after a successful connect are
//      recovered with backoff; `invalid` / `performer:busy` / generic initial
//      handshake failures stay terminal (no retry).
//   4. connect_error mapping:
//        - "invalid"        → Alert "Admin token invalide." (E8, anti-énumération)
//        - "performer:busy" → terminal PerformerBusyAlert (E9, no retry, link /)
//        - other (initial)  → sober generic Alert (token never exposed)
//   5. connect → "Connecté"; `ConnectionStatus` shows the live indicator.
//
// Story 3.5 — `BackToHome` ("← Retour") disconnects the socket (→ server
// releases the owner slot via 2.3) BEFORE navigating to `/` (no ghost slot).
// The `beforeunload` handler also disconnects on tab close.
//
// Does NOT import the listener feature (AD-2 isolation, enforced by ESLint).
// `performerId` is never sent by the client (server-authoritative `socket.id`).

type PerformerStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "invalid"
  | "busy"
  | "error";

export function PerformerPanel() {
  const [status, setStatus] = useState<PerformerStatus>("idle");
  const socketRef = useRef<Socket | null>(null);
  // True once the socket has connected at least once. Distinguishes an INITIAL
  // handshake `connect_error` (terminal, per Story 3.1) from a `connect_error`
  // fired during reconnection (non-terminal, part of the backoff loop).
  const hasConnectedRef = useRef(false);

  // Story 3.4 — relay each captured MidiEvent to the server. The payload is
  // forwarded as-is (no `performerId` / `srvTs` — AD-5: server-authoritative).
  // The ack updates the monitoring store (events envoyés / erreurs récentes /
  // dernier événement / E12 rate-limit). No auto-retry of MIDI events.
  const handleMidiEvent = useCallback((event: MidiEvent) => {
    const socket = socketRef.current;
    if (socket === null) return;
    emitMidiEvent(socket, event, (ack) => {
      usePerformerStore.getState().handleAck(event, ack);
    });
  }, []);

  // Capture hook (Story 3.3). Called unconditionally; it only binds
  // `onmidimessage` once an input is selected, so it is a no-op before that.
  // No replay: only newly captured events are forwarded (AD-17).
  useMidiInput({ onEvent: handleMidiEvent });

  // Clean disconnect helper: drops the socket (→ server releases the owner slot
  // via Story 2.3) and clears the ref. Idempotent. Used by `BackToHome` and by
  // the unmount / `beforeunload` cleanups.
  const disconnectPerformer = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  // Tear down on unmount (and a `beforeunload` listener for tab close) so we
  // never leak an owner slot.
  useEffect(() => {
    const onUnload = () => disconnectPerformer();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      disconnectPerformer();
    };
  }, [disconnectPerformer]);

  function handleConnect(token: string) {
    // Fresh attempt: drop any previous socket + reset the store (clears stale
    // counters / connection state / end message from a previous session).
    disconnectPerformer();
    hasConnectedRef.current = false;
    usePerformerStore.getState().reset();
    usePerformerStore.getState().setConnectionStatus("connecting");
    setStatus("connecting");

    const socket = connectPerformer(
      token,
      {
        onConnect: () => {
          hasConnectedRef.current = true;
          setStatus("connected");
          usePerformerStore.getState().setConnectionStatus("connected");
          // Initialise the listener count from /health (same-origin), no
          // aggressive polling. Failure is silent (counter stays at its last
          // value). Re-fetched on reconnect too.
          void fetchListenersCount()
            .then((n) => usePerformerStore.getState().setListeners(n))
            .catch(() => {
              /* offline / non-OK — keep last value; not surfaced */
            });
        },
        onDisconnect: () => {
          // Only the drop-after-connect case updates the live indicator (the
          // terminal branches below already render their own UI). The reconnection
          // loop will follow with `reconnect_attempt`.
          if (hasConnectedRef.current) {
            usePerformerStore.getState().setConnectionStatus("disconnected");
          }
        },
        onReconnectAttempt: (attempt) => {
          usePerformerStore.getState().setReconnecting(attempt);
        },
        onReconnect: () => {
          usePerformerStore.getState().setConnectionStatus("connected");
          usePerformerStore.getState().setReconnectAttempt(0);
          usePerformerStore.getState().setReconnectError(null);
          // Re-sync the listener count after a reconnect.
          void fetchListenersCount()
            .then((n) => usePerformerStore.getState().setListeners(n))
            .catch(() => {
              /* keep last value */
            });
        },
        onReconnectError: (err) => {
          usePerformerStore.getState().setReconnectError(err.message);
        },
        onConnectError: (err) => {
          // Map the server's single-word messages (roleAuth middleware) to UI
          // states. No technical detail is surfaced (anti-énumération); the token
          // is never echoed back. `invalid` / `performer:busy` and a GENERIC
          // initial-handshake failure are terminal: disconnect stops the backoff
          // loop. A `connect_error` fired DURING reconnection (after a connect)
          // is non-terminal — it's a failed attempt, leave the loop running.
          const code = err?.message;
          if (code === "invalid") {
            setStatus("invalid");
            usePerformerStore.getState().setConnectionStatus("disconnected");
          } else if (code === "performer:busy") {
            setStatus("busy");
            usePerformerStore.getState().setConnectionStatus("disconnected");
          } else if (!hasConnectedRef.current) {
            // Generic initial-handshake failure → terminal (Story 3.1 behavior).
            setStatus("error");
            usePerformerStore.getState().setConnectionStatus("disconnected");
          } else {
            // Mid-session reconnect attempt failed — sober, non-blocking.
            usePerformerStore.getState().setReconnectError(code ?? "erreur");
          }
          // Terminal cases stop the reconnection loop by disconnecting; a
          // mid-session failure leaves the loop running (no disconnect here).
          if (
            code === "invalid" ||
            code === "performer:busy" ||
            !hasConnectedRef.current
          ) {
            socket.disconnect();
            socketRef.current = null;
          }
        },
      },
    );
    socketRef.current = socket;

    // Defensive: if the server ever emits `listeners:update`, adopt the value.
    // Not relied upon (no server change in this story) — passive listener only.
    socket.on("listeners:update", (n: unknown) => {
      if (typeof n === "number") usePerformerStore.getState().setListeners(n);
    });
  }

  // Story 3.5 — clean disconnect before navigating home. Sets the end message
  // in the store; `BackToHome` performs the navigation AFTER this runs.
  const handleReturn = useCallback(() => {
    disconnectPerformer();
    usePerformerStore.getState().setEndMessage(PERFORMER_END_MESSAGE);
  }, [disconnectPerformer]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performer</CardTitle>
        <CardDescription>
          Diffusion MIDI en direct — one-way broadcast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge data-testid="performer-role-tag">PERFORMER</Badge>

        <p className="text-sm text-muted-foreground">
          Saisissez l'admin token pour ouvrir une session de diffusion MIDI. La
          capture MIDI est activée une fois connecté.
        </p>
        {/* Story 6.2 — intro symétrique MIDI-pas-audio (AC-U16b miroir
            performer). Rappelle que le performer diffuse des événements MIDI
            et que l'audio n'est jamais streamé — le son naît chez chaque
            listener sur son propre synthé. Symétrique à l'intro listener. */}
        <p className="text-sm text-muted-foreground">
          Vous diffusez des événements MIDI en direct — l'audio n'est jamais
          streamé, le son naît chez chaque listener sur son propre synthé.
        </p>

        <BrowserCompatGate>
          {status === "busy" ? (
            <PerformerBusyAlert />
          ) : status === "invalid" ? (
            <Alert variant="danger" data-testid="performer-invalid-alert">
              <DangerIcon />
              <AlertTitle>Admin token invalide.</AlertTitle>
              <AlertDescription>
                Vérifiez le token et réessayez.
              </AlertDescription>
            </Alert>
          ) : status === "error" ? (
            <Alert variant="danger" data-testid="performer-error-alert">
              <DangerIcon />
              <AlertTitle>Connexion impossible.</AlertTitle>
              <AlertDescription>
                Réessayez dans un instant.
              </AlertDescription>
            </Alert>
          ) : status === "connected" ? (
            <div className="space-y-4">
              <Alert data-testid="performer-connected-alert">
                <AlertTitle>Connecté</AlertTitle>
                <AlertDescription>
                  Session ouverte. Autorisez l'accès MIDI puis choisissez une
                  entrée.
                </AlertDescription>
              </Alert>
              {/* Story 3.5 — live connection indicator + clean return home. */}
              <ConnectionStatus />
              <div>
                <BackToHome onDisconnect={handleReturn} />
              </div>
              {/* MIDI permission + port selection (Story 3.2). Only after the
                  performer socket is connected. MidiPermissionButton renders
                  null once access is granted; MidiPortPicker renders null until
                  then — so both can be mounted and self-toggle. Captured events
                  are relayed by `useMidiInput` → `emitMidiEvent` (Story 3.4). */}
              <MidiPermissionButton />
              <MidiPortPicker />
              <MonitoringPanel />
            </div>
          ) : (
            <AdminTokenInput
              onSubmit={handleConnect}
              disabled={status === "connecting"}
            />
          )}
        </BrowserCompatGate>
      </CardContent>
    </Card>
  );
}