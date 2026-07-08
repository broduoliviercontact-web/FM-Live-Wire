// Dexed/WAM spike — lab page (isolated in features/dexed/).
//
// Route: /lab/dexed (registered in app/router.tsx). Experimental, NOT linked
// from the landing hub (hidden route). Validates the browser capabilities
// needed for a Dexed Web Audio Module integration BEFORE attempting to load
// any WAM (no WASM asset is vendored in this repo — see NOTICE.md).
//
// Flow:
//   1. Pure feature detection (AudioContext / AudioWorklet / WebAssembly /
//      WebMIDI) — mirrors the listener's `BrowserCompatGate` discipline.
//   2. If AudioContext is missing → blocking alert, no Start button.
//   3. « Start Audio » creates + resumes the AudioContext inside the user
//      gesture (autoplay policy), then renders <DexedHost />.
//   4. Safari without WebMIDI → dedicated « MIDI non supporté » alert (the
//      MIDI connect itself lives in DexedHost and also reports it).

import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/alert";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { CheckIcon, DangerIcon } from "../../shared/ui/icons";
import { DexedHost } from "./DexedHost";

interface Capabilities {
  hasAudioContext: boolean;
  hasAudioWorklet: boolean;
  hasWebAssembly: boolean;
  hasWebMidi: boolean;
  isSafari: boolean;
}

function detectSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const vendor = typeof navigator.vendor === "string" ? navigator.vendor : "";
  return vendor.includes("Apple") && !/CriOS|Chrome|Edi|Fxi/i.test(ua);
}

function detectCapabilities(): Capabilities {
  const w = typeof window !== "undefined" ? window : undefined;
  const hasAudioContext =
    w !== undefined &&
    (typeof w.AudioContext !== "undefined" ||
      typeof (
        w as unknown as { webkitAudioContext?: unknown }
      ).webkitAudioContext !== "undefined");
  const hasAudioWorklet =
    w !== undefined && typeof w.AudioWorkletNode === "function";
  const hasWebAssembly = typeof WebAssembly !== "undefined";
  const hasWebMidi =
    typeof navigator !== "undefined" &&
    typeof navigator.requestMIDIAccess === "function";
  return {
    hasAudioContext,
    hasAudioWorklet,
    hasWebAssembly,
    hasWebMidi,
    isSafari: detectSafari(),
  };
}

export function DexedLabPage() {
  // Detect once (pure feature detection — no side effects).
  const [caps] = useState<Capabilities>(detectCapabilities);
  const [started, setStarted] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  async function startAudio() {
    if (ctxRef.current !== null) {
      setStarted(true);
      return;
    }
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (Ctor === undefined) return;
    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    ctxRef.current = ctx;
    setStarted(true);
  }

  function stopAudio() {
    void ctxRef.current?.close();
    ctxRef.current = null;
    setStarted(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Lab · Dexed / WAM</h1>
          <Badge variant="mock">spike</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Intégration expérimentale isolée. N'impacte pas les flux performer /
          listener. Aucun asset Dexed/WASM n'est committé (GPL-3.0 à vérifier —
          voir NOTICE.md).
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Diagnostic navigateur</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <CapabilityRow ok={caps.hasAudioContext} label="AudioContext" />
          <CapabilityRow ok={caps.hasAudioWorklet} label="AudioWorklet" />
          <CapabilityRow ok={caps.hasWebAssembly} label="WebAssembly" />
          <CapabilityRow ok={caps.hasWebMidi} label="Web MIDI" />
        </CardContent>
      </Card>

      {!caps.hasAudioContext ? (
        <Alert variant="danger">
          <DangerIcon />
          <AlertTitle>AudioContext indisponible</AlertTitle>
          <AlertDescription>
            Ce navigateur ne supporte pas l'AudioContext Web Audio. Le spike ne
            peut pas démarrer.
          </AlertDescription>
        </Alert>
      ) : null}

      {!caps.hasWebMidi && caps.isSafari ? (
        <Alert variant="late">
          <DangerIcon />
          <AlertTitle>MIDI non supporté</AlertTitle>
          <AlertDescription>
            Safari ne supporte pas le Web MIDI API. Un contrôleur MIDI USB ne
            pourra pas être utilisé. Utilisez Chrome ou Edge pour tester l'entrée
            MIDI (le clavier virtuel reste disponible).
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2">
        {!started ? (
          <Button
            type="button"
            onClick={() => {
              void startAudio();
            }}
            disabled={!caps.hasAudioContext}
            data-testid="dexed-start-audio"
          >
            Start Audio
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={stopAudio}>
              Stop Audio
            </Button>
            <Badge variant="connected">audio actif</Badge>
          </>
        )}
      </div>

      {started && ctxRef.current !== null ? (
        <DexedHost audioContext={ctxRef.current} />
      ) : null}
    </div>
  );
}

function CapabilityRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckIcon className="text-connected" />
      ) : (
        <DangerIcon className="text-danger" />
      )}
      <span className={ok ? "" : "text-danger"}>{label}</span>
      <Badge variant={ok ? "connected" : "error"}>
        {ok ? "disponible" : "absent"}
      </Badge>
    </div>
  );
}