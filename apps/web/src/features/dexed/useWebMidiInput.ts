// Dexed/WAM spike — Web MIDI input hook (isolated in features/dexed/).
//
// Requests `navigator.requestMIDIAccess` ON DEMAND (the page calls `request()`
// after a user gesture), subscribes to `onmidimessage` on every input, parses
// note on/off, and forwards parsed events to a swappable handler. Feature
// detection only until `request()` is called — mirrors the listener's
// `BrowserCompatGate` discipline (never call `requestMIDIAccess` at module load).
//
// Safari note: Safari has no `navigator.requestMIDIAccess` -> `request()`
// resolves to `status: "unsupported"` with a French "MIDI non supporté"
// message; the page surfaces it as a dedicated Alert (not a generic error).
//
// Lot 2 additions:
//   - Live input list (`inputs`: id/name/manufacturer/state/connection),
//     refreshed on `onstatechange`.
//   - Selectable input (`selectedInputId`): `null` = "Tous les inputs" (every
//     detected input fires); a specific id narrows to that input only.
//     Persisted to `localStorage["dexed-midi-input-id"]`; if the saved input
//     is gone on the next state sync, we revert to "Tous les inputs".
//   - Note events carry a `source` (the input's name, or its id) so the MIDI
//     monitor can show where a message came from.

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
  /** Name (or id) of the MIDIInput that produced the event — for the monitor. */
  readonly source: string;
}

export interface MidiInputInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: string;
  readonly connection: string;
}

export interface UseWebMidiInputApi {
  readonly status: WebMidiInputStatus;
  readonly errorMessage: string | null;
  readonly inputs: MidiInputInfo[];
  /** `null` = "Tous les inputs" (every detected input fires). */
  readonly selectedInputId: string | null;
  readonly request: () => Promise<void>;
  readonly setSelectedInputId: (id: string | null) => void;
  readonly setNoteHandler: (handler: ((e: MidiNoteEvent) => void) | null) => void;
}

const STORAGE_KEY = "dexed-midi-input-id";

/** Safari (incl. iOS Safari): Apple vendor string and NOT a Chromium shell. */
function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const vendor =
    typeof navigator.vendor === "string" ? navigator.vendor : "";
  return vendor.includes("Apple") && !/CriOS|Chrome|Edi|Fxi/i.test(ua);
}

function readSavedInputId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSavedInputId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable / blocked — non-fatal */
  }
}

/** Parse a 3-byte channel-voice message into a note event (without source). */
function parseNote(
  data: Uint8Array,
): Omit<MidiNoteEvent, "source"> | null {
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

function collectInputs(access: MIDIAccess): MidiInputInfo[] {
  const out: MidiInputInfo[] = [];
  access.inputs.forEach((input) => {
    out.push({
      id: input.id,
      name: input.name ?? "",
      manufacturer: input.manufacturer ?? "",
      state: input.state,
      connection: input.connection,
    });
  });
  return out;
}

export function useWebMidiInput(): UseWebMidiInputApi {
  const [status, setStatus] = useState<WebMidiInputStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MidiInputInfo[]>([]);
  const [selectedInputId, setSelectedInputIdState] = useState<string | null>(
    () => readSavedInputId(),
  );

  const accessRef = useRef<MIDIAccess | null>(null);
  const noteHandlerRef = useRef<((e: MidiNoteEvent) => void) | null>(null);
  // Mirror of `selectedInputId` for use inside the stable `onMessage` closure
  // (avoids re-subscribing on every selection change).
  const selectedInputIdRef = useRef<string | null>(selectedInputId);

  useEffect(() => {
    selectedInputIdRef.current = selectedInputId;
  }, [selectedInputId]);

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
    if (!note) return;
    const input = event.target as MIDIInput | null;
    const inputId = input?.id ?? null;
    // null = "Tous les inputs"; otherwise only the selected input fires.
    const sel = selectedInputIdRef.current;
    if (sel !== null && inputId !== sel) return;
    const source =
      input !== null && input.name !== null && input.name.length > 0
        ? input.name
        : (inputId ?? "unknown");
    noteHandlerRef.current?.({ ...note, source });
  }, []);

  const attach = useCallback(
    (access: MIDIAccess) => {
      access.inputs.forEach((input) => {
        input.onmidimessage = onMessage;
      });
    },
    [onMessage],
  );

  const setSelectedInputId = useCallback((id: string | null) => {
    setSelectedInputIdState(id);
    writeSavedInputId(id);
  }, []);

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
      const list = collectInputs(access);
      setInputs(list);
      attach(access);
      access.onstatechange = () => {
        const fresh = collectInputs(access);
        setInputs(fresh);
        // Reconcile: if the selected input is gone (unplugged), revert to all.
        const sel = selectedInputIdRef.current;
        if (sel !== null && !fresh.some((i) => i.id === sel)) {
          setSelectedInputIdState(null);
          writeSavedInputId(null);
        }
      };
      setStatus("connected");
      // Reconcile once on connect too (the saved id may be stale).
      const sel = selectedInputIdRef.current;
      if (sel !== null && !list.some((i) => i.id === sel)) {
        setSelectedInputIdState(null);
        writeSavedInputId(null);
      }
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

  return {
    status,
    errorMessage,
    inputs,
    selectedInputId,
    request,
    setSelectedInputId,
    setNoteHandler,
  };
}