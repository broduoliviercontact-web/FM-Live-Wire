// Dexed/WAM spike — Web MIDI input hook (isolated in features/dexed/).
//
// Requests `navigator.requestMIDIAccess` ON DEMAND (the page calls `request()`
// after a user gesture), subscribes to `onmidimessage` on every input, parses
// note on/off, and forwards parsed events to a swappable handler. Feature
// detection only until `request()` is called — mirrors the listener's
// `BrowserCompatGate` discipline (never call `requestMIDIAccess` at module load).
//
// Safari note: Safari has no `navigator.requestMIDIAccess` → `request()`
// resolves to `status: "unsupported"` with a French "MIDI non supporté"
// message; the page surfaces it as a dedicated Alert (not a generic error).

import { useCallback, useEffect, useRef, useState } from "react";

export type WebMidiInputStatus =
  | "idle"
  | "requesting"
  | "connected"
  | "unsupported"
  | "denied"
  | "error";

export interface MidiNoteEvent {
  readonly kind: "noteOn" | "noteOff";
  /** Wire/data channel 0–15. */
  readonly channel: number;
  /** Note number 0–127. */
  readonly note: number;
  /** Velocity 0–127 (noteOff may carry 0). */
  readonly velocity: number;
}

export interface UseWebMidiInputApi {
  readonly status: WebMidiInputStatus;
  readonly errorMessage: string | null;
  readonly inputCount: number;
  readonly request: () => Promise<void>;
  readonly setNoteHandler: (handler: ((e: MidiNoteEvent) => void) | null) => void;
}

/** Safari (incl. iOS Safari): Apple vendor string and NOT a Chromium shell. */
function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const vendor =
    typeof navigator.vendor === "string" ? navigator.vendor : "";
  return vendor.includes("Apple") && !/CriOS|Chrome|Edi|Fxi/i.test(ua);
}

/** Parse a 3-byte channel-voice message into a note event, or null if not note on/off. */
function parseNote(data: Uint8Array): MidiNoteEvent | null {
  if (data.length < 3) return null;
  const s0 = data[0];
  const d1 = data[1];
  const d2 = data[2];
  if (s0 === undefined || d1 === undefined || d2 === undefined) return null;
  const status = s0 & 0xf0;
  const channel = s0 & 0x0f;
  if (status === 0x90 && d2 > 0) {
    return { kind: "noteOn", channel, note: d1, velocity: d2 };
  }
  if (status === 0x80 || (status === 0x90 && d2 === 0)) {
    return { kind: "noteOff", channel, note: d1, velocity: d2 };
  }
  return null;
}

export function useWebMidiInput(): UseWebMidiInputApi {
  const [status, setStatus] = useState<WebMidiInputStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputCount, setInputCount] = useState(0);

  const accessRef = useRef<MIDIAccess | null>(null);
  const noteHandlerRef = useRef<((e: MidiNoteEvent) => void) | null>(null);

  const setNoteHandler = useCallback(
    (handler: ((e: MidiNoteEvent) => void) | null) => {
      noteHandlerRef.current = handler;
    },
    [],
  );

  const onMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data) return;
    const note = parseNote(data);
    if (note) noteHandlerRef.current?.(note);
  }, []);

  const attach = useCallback(
    (access: MIDIAccess) => {
      access.inputs.forEach((input) => {
        input.onmidimessage = onMessage;
      });
    },
    [onMessage],
  );

  const request = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.requestMIDIAccess !== "function"
    ) {
      setStatus("unsupported");
      setErrorMessage(
        isSafari()
          ? "MIDI non supporté. Safari ne supporte pas le Web MIDI API. Utilisez Chrome ou Edge."
          : "Web MIDI non disponible dans ce navigateur.",
      );
      return;
    }
    setStatus("requesting");
    setErrorMessage(null);
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      accessRef.current = access;
      setInputCount(access.inputs.size);
      attach(access);
      access.onstatechange = () => setInputCount(access.inputs.size);
      setStatus("connected");
    } catch (err) {
      const name = (err as DOMException | undefined)?.name;
      if (name === "SecurityError" || name === "NotAllowedError") {
        setStatus("denied");
        setErrorMessage("Accès MIDI refusé par l'utilisateur.");
      } else {
        setStatus("error");
        setErrorMessage(String((err as Error | undefined)?.message ?? err));
      }
    }
  }, [attach]);

  // Release MIDI access + handlers on unmount.
  useEffect(() => {
    return () => {
      const access = accessRef.current;
      if (access) {
        access.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
        access.onstatechange = null;
      }
      accessRef.current = null;
      noteHandlerRef.current = null;
    };
  }, []);

  return { status, errorMessage, inputCount, request, setNoteHandler };
}