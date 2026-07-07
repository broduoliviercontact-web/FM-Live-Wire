---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories", "step-04-final-validation"]
inputDocuments:
  - _bmad-output/planning-artifacts/architecture/architecture-bmad-project-2026-07-06/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/prds/prd-bmad-project-2026-07-06/prd.md
  - _bmad-output/planning-artifacts/ux-designs/ux-bmad-project-2026-07-06/EXPERIENCE.md
secondaryDocumentsAvailable:
  - _bmad-output/planning-artifacts/architecture/architecture-bmad-project-2026-07-06/ARCHITECTURE.md
  - _bmad-output/planning-artifacts/architecture/architecture-bmad-project-2026-07-06/adr/ADR-0001..ADR-0008.md
  - _bmad-output/planning-artifacts/ux-designs/ux-bmad-project-2026-07-06/DESIGN.md
  - _bmad-output/planning-artifacts/prds/prd-bmad-project-2026-07-06/addendum.md
  - _bmad-output/planning-artifacts/research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md
---

# FM Live Wire - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for **FM Live Wire** (MVP), decomposing the requirements from the PRD, the UX Experience contract, and the Architecture Spine (AD-1..AD-20) into implementable stories. The MVP is a one-way live MIDI broadcast radio: a single performer/admin streams MIDI events; listeners receive the stream in their browser, choose a local MIDI output and an output channel, and their own FM synth generates the sound. No audio is streamed.

Epic order follows the user-confirmed sequence: (1) monorepo foundation + tooling + shared contract; (2) Socket.IO server + one-way security + unique owner; (3) performer Web MIDI capture & emission; (4) listener + MIDI output + scheduler + channel remap; (5) local Panic + Force Panic + Mock Output + backpressure; (6) final UX + integration tests + manual validation IAC → Dexed → MIDI Monitor + MVP deployment.

## Requirements Inventory

### Functional Requirements

**Roles & access**
- **FR-1** Two roles only: Performer (unique owner) and Listener (read-only). No other role in MVP.
- **FR-2** Performer authenticates via a shared secret (`OWNER_SECRET`) entered manually each session on `/performer`. The secret is never in the frontend build (no `VITE_*` variable for the secret).
- **FR-3** Listener joins with no token (`auth: { role: "listener" }`). No account, no install.
- **FR-4** Only one Performer at a time. A second valid performer is refused with code `performer:busy` (clear client message). No silent replacement.
- **FR-5** On Performer disconnect, the server releases the owner slot and notifies listeners ("Performer déconnecté").

**Performer capture & relay**
- **FR-6** Performer selects a MIDI input among available Web MIDI ports.
- **FR-7** Performer relays exactly 5 event types: `noteOn`, `noteOff`, `controlChange`, `programChange`, `pitchBend`. Never audio.
- **FR-8** SysEx rejected in double defense: performer filter (`0xF0` never sent) + server schema exposing no SysEx type (auto-reject).
- **FR-9** `/performer` shows live monitoring of sent events (type, channel, main value).
- **FR-10** Each event carries: `v=1`, `type`, `channel` (0–15), `roomId="fm-live-wire:main"`, `seq` (uint32 monotone per performer), `ts` (DOMHighResTimeStamp). `performerId` is forbidden/ignored in the payload — the server attaches it (`socket.id`).

**Listener reception & rendering**
- **FR-11** Listener joins room `fm-live-wire:main` and receives the live `midi:event` stream.
- **FR-12** Listener chooses a local MIDI output among Web MIDI ports, OR Mock / Debug mode (on-screen byte visualization, no device).
- **FR-13** Listener chooses a channel (1–16 UI; 0–15 data). Forced remap: every received event is rerouted to the listener's chosen channel before send. The performer's original channel is replaced.
- **FR-14** Listener has a "Note de test" button that emits a note on the chosen output/channel to validate the local chain.
- **FR-15** Wire → MIDI bytes mapping is deterministic 1:1 (noteOn `0x90|ch`, noteOff `0x80|ch`, controlChange `0xB0|ch`, programChange `0xC0|ch` 2 bytes, pitchBend `0xE0|ch` lsb/msb). velocity 0 = noteOff convention respected.
- **FR-16** Local Panic: button sends CC 64 → 120 → 121 → 123 × 16 channels (64 messages). Must work even disconnected from the server, as long as a local MIDI output is available.
- **FR-17** Force Panic (opt-in): secondary button with UI warning "Panic étendu : ~1–2 s", sends a noteOff sweep (128×16 = 2048 messages). Opt-in, not default.
- **FR-18** The only listener→server events allowed are `room:join`, `room:leave`, `midi:test`. No `midi:event` handler on the listener side — Panic has no server handler (purely local).

**Security / one-way model**
- **FR-19** Strict one-way: no return path for MIDI. A Listener attempting `socket.emit('midi:event', …)` is rejected (`forbidden`), logged, and disconnected after N attempts.
- **FR-20** Role is declared at connection (`auth.role`) and pinned in `socket.data.role` (non-modifiable afterward). `performerId` comes from the server (`socket.id`), never the client.
- **FR-21** Strict validation via shared schema `@fmlw/shared` (Zod `.strict()`): reject unknown fields, out-of-range, and `v !== 1`. Identical schema front+back (zero drift).
- **FR-22** Per-socket rate limit (token bucket): burst capacity 200, refill 100/s per performer. Exceed → `rate:limited` + sampled log.
- **FR-23** Origin allowlist at HTTP upgrade level (anti-CSWSH), single-domain HTTPS (zero CORS).
- **FR-24** Musical fail-safe: on listener disconnect, the scheduler stops sending (no orphan notes); on reconnect, live stream resumes without re-logging the past.

**Listener backpressure**
- **FR-25** Listener buffer bounded to 256 events (`BUFFER_CAP`). Beyond: drop oldest + warning. No infinite queue.
- **FR-26** If an event is too late (`MAX_LATE_MS = 200`, default adjustable): immediate fallback for noteOn/noteOff (don't lose the note); drop acceptable for high-frequency CC. Local UI warning. (Default policy frozen; threshold tuning remains a parameter.)
- **FR-27** `listener:overload` is a pure local UI warning, not a server event.

**Operations**
- **FR-28** Healthcheck `GET /health` → `{ ok, uptime, ownerActive: boolean, listeners: number }` (`ownerActive` feeds the landing on-air polling).
- **FR-29** Graceful shutdown: notify clients, drain connections, clean Socket.IO close.
- **FR-30** Structured, sampled logs for the MIDI flow (no per-event log); `LOG_MIDI=1` for dev debug; log connections, room changes, validation errors (sampled 1/N with `seq` + reason), rate-limit hits (aggregated counter + periodic flush), Panic triggered.

### NonFunctional Requirements

**Performance**
- **NFR-1** Perceived latency performer→listener < ~80 ms (LAN) / < ~150 ms (typical internet), measured via `srvTs - ts`.
- **NFR-2** < ~5% immediate fallbacks in stable conditions.
- **NFR-3** Sustain 100 `midi:event`/s continuously, short burst 200/s (rate limit aligned).
- **NFR-4** Target 5–20 simultaneous listeners (mono-process ample; ~10k+ theoretical connections).
- **NFR-5** Listener scheduler via `MIDIOutput.send(data, performance.now() + lookahead)`, lookahead ~40 ms (configurable 30–50), driver-level scheduling (anti-jitter).

**Browser compatibility**
- **NFR-6** MVP target: Chrome/Edge desktop over HTTPS (native Web MIDI). Firefox v108+ accepted as secondary.
- **NFR-7** Safari unsupported: feature detection (`'requestMIDIAccess' in navigator`) + clear "Chrome/Edge requis" message. No polyfill investment in MVP.
- **NFR-8** HTTPS mandatory (Web MIDI `[SecureContext]`); dev on localhost, prod TLS (Caddy auto-TLS or managed host).

**Security**
- **NFR-9** Zero secret in the frontend bundle, verified by build `grep`. `OWNER_SECRET` server-side only, timing-safe comparison (`crypto.timingSafeEqual`), generic error messages (anti-enumeration).
- **NFR-10** No `localStorage` for the token in MVP (re-entered each session); token never in the URL; `.env` gitignored; `.env.example` without values.
- **NFR-11** Role control 100% effective: a listener can never emit an accepted `midi:event`.

**Architecture / stack**
- **NFR-12** Fixed stack: React + Vite + TypeScript / Node + Express + Socket.IO / native Web MIDI API / pnpm monorepo with shared package `@fmlw/shared` (Zod) for the MIDI contract.
- **NFR-13** Mono-process, single-domain HTTPS, in-memory state, no DB, no Redis. Architecture isolated to allow a future swap to a Redis Streams adapter without rewrite.
- **NFR-14** Pin `transports: ["websocket"]` in prod (no long-polling fallback).
- **NFR-15** Wire format compact JSON `v:1` (debuggable + Zod + readable logs; negligible overhead at human scale).

**Quality / test**
- **NFR-16** 100% unit tests on: wire→bytes mapping, Panic, scheduler, schema, owner registry, rate limit.
- **NFR-17** Socket.IO in-process integration tests; mock Web MIDI via `web-midi-test` (Vitest + jsdom).
- **NFR-18** Priority manual test executed without blocker: macOS IAC Driver → Dexed standalone → MIDI Monitor (detailed plan in addendum).
- **NFR-19** Mock MIDI Output mode to validate the pipeline (socket → scheduler → encode) without IAC or Dexed (CI + demos).

**Product compliance**
- **NFR-20** The 10 non-negotiable technical invariants from research (one-way, unique owner, no SysEx, local Panic, HTTPS, Chrome/Edge, etc.) are respected.

### Additional Requirements

**From Architecture Spine — design paradigm & layering**
- Single Node process carries Express (static Vite + `GET /health`) and Socket.IO on one HTTPS origin. Four directional layers: HTTP (thin) / Socket (middlewares + handlers) / Services (`PerformerRegistry`, `RelayService`, `RoomService`, `ValidationService` — framework-independent, testable without Socket.IO) / Shared contract (`@fmlw/shared`).
- Frontend feature-based with directional deps `app → features → entities → shared → lib`; `performer` and `listener` features do not depend on each other. **Enforced via ESLint plugin (e.g. `eslint-plugin-bound-modules`), not just review.**
- Backend: `http` and `socket` separated; `handlers → services → shared`. `RelayService` behind an adapter interface. **Enforced via ESLint plugin.**

**From Architecture Spine — invariants (AD-1..AD-20) that shape stories**
- **AD-1** Mono-process modular mono-domain HTTPS. No Redis/MQ. Modules isolated for future swap.
- **AD-2** One-way broadcast, unique owner. `io.use` pins `socket.data.role` + `socket.data.performerId = socket.id`. `socket.use` per-event gate. `PerformerRegistry` single-slot; 2nd performer → `performer:busy` (refusal, no replacement). Listener→server events limited to `room:join`, `room:leave`, `midi:test`. No `midi:event` handler listener-side, no `panic` handler server-side.
- **AD-3** Native Web MIDI API (no WEBMIDI.js). `requestMIDIAccess({ sysex: false })`. Capture via `MIDIInput.onmessage` (`event.data`, `event.timeStamp`). Render via `MIDIOutput.send(data, timestamp)`. Feature-detection before any prompt; incompatible → terminal screen "Chrome/Edge requis".
- **AD-4** Socket.IO v4. Pin `socket.io` + `socket.io-client` `^4.8.3` (same major). `transports: ["websocket"]` in prod. Rooms for `fm-live-wire:main`.
- **AD-5** Shared Zod MIDI contract in `@fmlw/shared`. `MidiEventSchema` (`.strict()`): rejects unknown fields, out-of-range, `v !== 1` (`unsupported-version`). `channel` 0–15 (data) / 1–16 (UI, −1 conversion at edge). `pitchBend` 14-bit 0–16383 (8192 = center). `performerId` forbidden in payload. No SysEx type. Zod 3 `^3.23` (via `zod/v3`).
- **AD-6** In-memory state, no DB. `ownerPerformerId`, `listeners: Map`, `rateLimitBuckets: Map` volatile. `RelayService` behind adapter interface for future Redis Streams swap. Client state via Zustand (no TanStack Query — no business REST API).
- **AD-7** Local Panic on listener side. `features/listener/lib/panic.ts` does NOT depend on Socket.IO connection state — only on the selected local `MIDIOutput`. Panic = CC 64→120→121→123 × 16 = 64 messages, `send(data, performance.now())`. Force Panic (opt-in, confirm Dialog) = noteOff sweep 128×16 = 2048 messages. No server panic handler; works server-down. `PanicButton` sticky viewport, never disabled.
- **AD-8** SysEx exclusion (double defense): performer filters `0xF0` (never sent); `MidiEventSchema` exposes no SysEx type → auto server reject. `requestMIDIAccess({ sysex: false })`. SysEx silently filtered, never displayed or relayed.
- **AD-9** Compact JSON wire format `v:1`.
- **AD-10** Owner auth by shared secret `OWNER_SECRET` (vs JWT). Server env only, never `VITE_*`. Performer = public static page; manual token entry each session → `socket.auth.token`. `io.use` compares via `crypto.timingSafeEqual`; generic errors. No `localStorage` MVP; token never in URL; `.env` gitignored, `.env.example` without values. Build `grep` = zero secret.
- **AD-11** Listener scheduler `send(data, ts)` + simple lookahead. `target = performance.now() + LOOKAHEAD_MS` (40 ms default, configurable 30–50). `MIDIOutput.send(data, target)` driver-level. If `srvTs - ts > MAX_LATE_MS` (200 ms default) → immediate fallback for noteOn/noteOff; drop acceptable for HF CC. `BUFFER_CAP = 256`: beyond, drop oldest + local UI warning. No re-logging MVP; `srvTs` added for telemetry only.
- **AD-12** Forced listener channel remap. Every received event rerouted to the listener's chosen channel (0–15 data) before `send`. Original performer channel replaced. UI 1–16 ↔ data 0–15 at edge.
- **AD-13** Per-socket token bucket rate limit. `socket.use` bucket: burst capacity 200, refill 100/s per performer. Exceed → `rate:limited` + sampled log. A listener never emits `midi:event` (AD-2 gate).
- **AD-14** Mock MIDI Output hot. `MockMidiOutput` implements `{ send(bytes, ts) }` → visualizes bytes on screen. Selectable in output dropdown = `Mock / Debug`. Hot switch to Mock allowed even after a real port was selected. Pipeline socket→scheduler→encode testable in CI + demo without device.
- **AD-15** Origin allowlist + mono-domain (anti-CSWSH). `origin: process.env.PUBLIC_ORIGIN` at HTTP upgrade. Zero CORS. HTTPS mandatory.
- **AD-16** Listener disconnect after 3 `forbidden` (no persistent ban). 3 `forbidden` attempts → server disconnects the listener. UI: "Connexion interrompue : action non autorisée."
- **AD-17** Musical fail-safe disconnect. Scheduler stops sending on disconnect or port loss (no in-flight bytes). On reconnect (Socket.IO connection state recovery), live stream resumes without re-logging the past (no replay).
- **AD-18** Structured sampled logs. No per-event log. Log connections/disconnections, room changes, validation errors (sampled 1/N with `seq` + reason), rate-limit hits (aggregated counter + periodic flush), Panic triggered. `LOG_MIDI=1` for dev debug.
- **AD-19** Tests: 100% unit + in-process integration + manual validation. Vitest + jsdom + `web-midi-test` (mock `requestMIDIAccess`). Socket.IO in-process for integration. `MockMidiOutput` for CI. Manual plan IAC→Dexed→MIDI Monitor (11 steps). Build `grep` = zero secret.
- **AD-20** HTTPS mono-domain deployment. Mono-process Express serves static Vite + Socket.IO on same origin. Caddy auto-TLS or managed host (Render/Fly.io). `GET /health` → `{ ok, uptime, ownerActive: boolean, listeners: n }`. Graceful shutdown: notify, drain, `io.close()`. Env: `PORT`, `OWNER_SECRET`, `PUBLIC_ORIGIN`, `LOG_MIDI`, `MAX_LISTENERS` (optional guard).

**Starter template / scaffolding (affects Epic 1 Story 1)**
- Greenfield pnpm monorepo. Structural seed: `apps/web` (React + Vite + TS), `apps/server` (Node + Express + Socket.IO), `packages/shared` (contract, no business logic). `pnpm-workspace.yaml`, root scripts (`dev`, `build`, `test`, `lint`), `tsconfig.base.json` (strict shared), `.env.example`, `.gitignore`.
- `@fmlw/shared` built with `tsc` (MVP) — consumed ESM both sides. No `tsup` initially.
- `apps/web/src`: `app/` (providers: SocketProvider, MidiAccessProvider; router; layouts), `features/{performer,listener}` (self-contained, isolated), `entities/` (MidiEvent re-export, Channel, Role), `shared/` (shadcn UI primitives, constants), `lib/` (Socket.IO client, midi-access wrapper), `config/` (runtime config).
- `apps/server/src`: `config/`, `app/` (Express + http + Socket.IO attach), `http/routes/` (health, static), `socket/{index,middlewares,handlers,services}`, `shared/`, `utils/` (token bucket, sampled logger).
- `packages/shared/src`: `midi-event.ts` (`MidiEventSchema` + `z.infer`), `constants.ts` (CC 120/121/123, status bytes, `ROOM = "fm-live-wire:main"`), `index.ts`.

**Scaffolding decisions (user-confirmed 2026-07-06)**
- Zod 3 `^3.23`; Express 5.2.1; `LOOKAHEAD_MS=40`; `MAX_LATE_MS=200`; `BUFFER_CAP=256`; rate limit 100 midi:event/s sustained, burst 200; `@fmlw/shared` built with `tsc`; directional dependencies enforced by ESLint; test MIDI note 60, velocity 100, duration 300 ms; default channel = 1.

**Consistency conventions (wire/protocol)**
- Event names: `midi:event`, `room:join`, `room:leave`, `midi:test` (listener→server); `performer:busy`, `forbidden`, `rate:limited`, `unsupported-version`, `invalid` (errors). Room MVP: `fm-live-wire:main` (constant, server-imposed).
- Wire: JSON `v:1`; `channel` 0–15 on wire, 1–16 in UI; `seq` uint32 monotone per performer; `ts` DOMHighResTimeStamp; `performerId` never in payload; `srvTs` added server-side (telemetry).
- Ack: `{ ok: boolean, error?: code, issues?: ZodIssue[] }`. Stable codes: `invalid`, `forbidden`, `rate:limited`, `performer:busy`, `unsupported-version`. Generic UI messages on auth (anti-enumeration).
- Validation: Zod `.strict()` everywhere. Server 3-layer: connection (`io.use`) → event (`socket.use` gate+rate) → handler (`safeParse`). Listener: range checks before `send`.
- State mutation: server state mutated only by services. Client state via Zustand.
- Mapping wire→bytes: deterministic 1:1 (see FR-15). velocity 0 = noteOff.

### UX Design Requirements

Extracted from `EXPERIENCE.md` (spine owning IA, behavior, states, interactions, accessibility, journeys). Visual tokens live in `DESIGN.md` and will be pulled for Epic 6 visual-polish stories if needed.

**Information architecture & surfaces**
- **UX-DR1** Three surfaces: `/` (landing role-picker — UX addition, overrides PRD), `/listener`, `/performer`. No cross-nav between listener and performer; only a discreet "← Retour" link back to `/` that triggers a clean disconnect (`room:leave` for listener, owner slot release for performer) before navigation (resolves Q-UX10, prevents ghost owner slot).
- **UX-DR2** Each route displays a role tag in the header (`LISTENER` / `PERFORMER`) and a panel intro reminding the role + the MIDI-not-audio model (symmetric reminders: performer "Seul le MIDI est diffusé, jamais l'audio"; listener "vous recevez le MIDI, votre synthé fait le son").
- **UX-DR3** Landing `/`: project name + tagline ("Radio live de contrôle MIDI. Le son naît chez vous, sur votre synthé."), On-air indicator via light polling `GET /health` (`ownerActive: boolean`) — no realtime on landing, two buttons "Je diffuse (performer)" / "J'écoute (listener)", "● On air" / "○ Hors antenne". No marketing hero.

**Listener onboarding (6 canonical steps, no dead-ends)**
- **UX-DR4** Listener guided vertical single-column flow, state-before-action: (1) browser compat → (2) connect MIDI → (3) choose output → (4) choose channel → (5) test note → (6) join → receive → Panic. Dependent selection: `Rejoindre` disabled until an output is chosen; `Note de test` disabled until output + channel chosen (with hints).
- **UX-DR5** `BrowserCompatGate`: feature-detect Web MIDI + HTTPS before any prompt; terminal screen on E1 (UNSUPPORTED_BROWSER → "Chrome/Edge requis") / E2 (SECURE_CONTEXT_REQUIRED → "Web MIDI nécessite HTTPS"). No MIDI prompt on incompatible browsers.
- **UX-DR6** `MidiPermissionButton` ("Connecter MIDI"): triggers `requestMIDIAccess({ sysex: false })` on user gesture (never auto on load); handles E3 permission denied with Alert + "Réessayer".
- **UX-DR7** `MidiPortPicker` (output): lists `MIDIOutputMap` + "Mock / Debug" option; refresh live via `onstatechange` (hot-plug, no polling); hot switch to Mock allowed even after a real port was selected (Q-UX9); empty state Alert info "Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester."
- **UX-DR8** `ChannelSelector`: 1–16 (UI) → 0–15 (edge); 16-slot grid; tooltip explaining forced remap ("Le canal ici = la sortie vers votre synthé. Le flux d'origine est ignoré : tout passe sur ce canal."); default channel = 1 (Q-UX7).
- **UX-DR9** `TestNoteButton` ("Note de test"): emits `midi:test`; plays `[0x90|ch, 60, 100]` + noteOff after 300 ms (standard Q-UX6: note 60, vel 100, 300 ms); disabled until output+channel with hint; in Mock shows bytes in `MockByteStream`; toast "Note de test envoyée."; if nothing sounds, non-blocking hint "Vérifiez que votre synthé écoute sur le canal choisi."
- **UX-DR10** `JoinButton` ("Rejoindre le flux", 44px, on_air color): `room:join` `fm-live-wire:main`; transitions to waiting/active; disabled until output chosen with hint "Choisissez une sortie MIDI pour rejoindre."; after join becomes "Quitter le flux" (`room:leave`).
- **UX-DR11** `StatusPill` variants: on-air / connected / waiting / mock / error; colored dot + text label (not color alone). Maps socket states connecting/reconnecting→waiting, connected→connected+business label, disconnected→waiting, connect_error `performer:busy`/`forbidden`→error.
- **UX-DR12** `MidiActivityIndicator`: pulses `connected` on incoming noteOn; primary activity indicator. `NoteVisualizer` (bars ∝ pitch, no playable mini-piano — Q-UX3) is secondary/collapsible to avoid indicator overload. `LatencyStat` (`{ms} ms`, threshold color) appears only on late alert (> `MAX_LATE_MS`), not by default in calm reception.

**Listener states (empty + error)**
- **UX-DR13** Empty states (never errors): landing no performer → "○ Hors antenne" (buttons stay active); listener no device → Alert info + Mock highlighted; listener waiting for performer → pill `waiting` "En attente du performer…" + activity off + hint "Dès que le performer démarre, le flux arrive."; Mock active no flux → `MockByteStream` empty + "— en attente d'événements —"; active 0 events → "● Réception active — 0 event reçu"; performer no input → Alert info + refresh; performer 0 events/0 listeners → counters at 0, flow line "— en attente de jeu —"; performer 0 listeners → "listeners : 0" + hint "Aucun listener pour l'instant. Le flux part quand même."
- **UX-DR14** Error states E1–E13 each with detection code + microcopy + proposed action (see EXPERIENCE table). Notably: E5 output lost → Alert + fail-safe (scheduler stops); E6 server down → pill `waiting` + auto-reconnect + Panic stays active (S-2 climax); E10 late → local `LateAlert` only, never a server event; E11 forbidden → after 3 attempts disconnect "Connexion interrompue : action non autorisée." (no persistent ban); E12 rate-limited → Alert performer; E13 unsupported-version → "Version de protocole incompatible. Rafraîchissez la page."

**Panic UX**
- **UX-DR15** `PanicButton`: 44px red, sticky bottom of viewport (never hidden by dialog or scroll), always active even server-down, 64 messages; hint "Coupe toutes les notes sur votre sortie locale. Fonctionne même si le serveur est injoignable."
- **UX-DR16** `ForcePanicButton` + `ForcePanicDialog`: secondary button → confirmation Dialog "Panic étendu : ~1–2 s. Confirmer ?" before sending 2048 messages; toast "Force Panic envoyé."; intro copy explaining the sweep.

**Performer UX**
- **UX-DR17** Performer guided vertical flow: browser compat → admin token → connect MIDI input → choose input → live monitoring. `AdminTokenInput` ("admin token", no localStorage, never in URL) → `socket.auth.token`; token invalid → Alert "Admin token invalide."; `performer:busy` → terminal Alert "Un performer est déjà connecté. Attendez la fin de sa session." (no retry, link back to `/`).
- **UX-DR18** `MidiPortPicker` (input): lists `MIDIInputMap` (USB keyboard or IAC `FMLW → Dexed`); refresh `onstatechange`; empty state Alert info "Aucune entrée MIDI détectée. Branchez un clavier ou un bus IAC." + refresh.
- **UX-DR19** `MonitoringPanel`: connection state pill "Diffusion active"; last MIDI event line `TYPE · CH · VAL` (all 5 types); footer counters `events envoyés` / `listeners` / `erreurs récentes`; permanent reminder "Seul le MIDI est diffusé, jamais l'audio."; note "SysEx silencieusement filtré, jamais affiché ni relayé" (FR-8); `RateLimitAlert` on `rate:limited`. Minimal monitoring confirmed (Q-UX2): no aggregated listener latency.

**Microcopy & i18n**
- **UX-DR20** Verbatim labels (non-modifiable without PM accord): `admin token`, `Rejoindre le flux` (documented UX override of PRD "Rejoindre"), `Note de test`, `Panic` / `Panic local`, `Force Panic`, `Panic étendu : ~1–2 s`, `Performer déconnecté`, `Chrome/Edge requis`, `Mock / Debug`. Sober DIY/hacker tone, vouvoiement, short phrases.
- **UX-DR21** All displayed counters pluralized via `Intl.PluralRules('fr-FR')` ("1 event reçu" / "7 events reçus"; `{events} envoyés`; `{listeners}`; `{erreurs}`).
- **UX-DR22** Monospace `JetBrains Mono` for data (bytes, channel, value, latency); Inter for labels/descriptions. Color = semantic only (green=sane, amber=on air/late, red=danger/panic, cyan=info/mock).

**Interaction primitives**
- **UX-DR23** User gesture required for `requestMIDIAccess` (click, never auto on load); feature-detection before prompt. Hot-plug via `onstatechange` (no polling). Modal confirmation only for Force Panic. Toasts for transient feedback (test note, force panic, reconnect success); no toasts for persistent states (use Alert/StatusPill). No localStorage for token; no value in URL. Auto-reconnect with visible indicator, no blocking dialog.

**Accessibility floor**
- **UX-DR24** Contrast: actionable text ≥ 4.5:1 (WCAG AA); `danger_fill` token for Panic fills carrying white text (3.27:1 → 4.6:1, AA); `ink.muted` lightened to pass AA on surface_2. Muted/secondary reserved for non-critical info only.
- **UX-DR25** Full keyboard operability; tab order = guided flow order; visible focus ring (`on_air` color); Panic is an actionable control, not decorative. `ChannelSelector` implemented as a `radiogroup` (arrow keys + `aria-checked` + icon, not color alone).
- **UX-DR26** `prefers-reduced-motion`: disable on-air pulse and `MidiActivityIndicator` pulse; replace with static opacity change; late warning stays visible (static). No light mode MVP (app is dark by design — scene/low-light).
- **UX-DR27** Every Select/Input has an associated `<label>`; tooltips for Force Panic and channel remap. StatusPill = dot + text label; Alert = icon + text + color (don't depend on color alone).
- **UX-DR28** `aria-live="polite"` on state-change regions (`StatusPill` / `LateAlert` / `Alert`) for connection/disconnect/error/late/panic announcements; raw MIDI flux (`MockByteStream`, `NoteVisualizer`, `MonitoringPanel`) excluded from aria-live (too verbose). VoiceOver (macOS) test required in acceptance (AC-U20): navigate `/listener` by keyboard with VoiceOver, trigger server disconnect then Panic, verify spoken state announcement.

**UX acceptance criteria (AC-U1..AC-U21) — bind to stories**
- AC-U1 ≤6 explicit steps to join an active flow from `/` without external docs. AC-U2 On-air reflects real performer via light `/health` polling. AC-U3 `Rejoindre` disabled until output chosen. AC-U4 `Note de test` visible feedback on chosen channel. AC-U5 forced remap explicit (tooltip + behavior). AC-U6/U7/U8 incompatible/HTTPS-denied/permission-denied screens. AC-U9 output-lost → Alert + fail-safe. AC-U10 server-down → pill + auto-reconnect + Panic active (S-2). AC-U11 late → local `LateAlert` only. AC-U12 token invalid / 2nd performer terminal. AC-U13 Panic always active even server-down. AC-U14 Force Panic modal confirmation before send. AC-U15 monitoring shows connection + listeners + events + errors. AC-U16/AC-U16b permanent MIDI-not-audio reminders both sides. AC-U17 `rate:limited` Alert. AC-U18 keyboard nav + visible focus + logical order. AC-U19 reduced-motion disables pulses. AC-U20 VoiceOver speaks critical states. AC-U21 at least one full live session by Zub before a small real audience without blocking incident (PRD S-10).

### FR Coverage Map

Primary epic in **bold**; secondary epic in *italics* when a FR is delivered across two epics (split responsibility is documented in the story).

- **FR-1** → Epic 2 — two roles (Performer unique owner / Listener read-only)
- **FR-2** → **Epic 2** + *Epic 3* — OWNER_SECRET auth (server timing-safe) + performer token entry UI
- **FR-3** → **Epic 2** + *Epic 4* — listener joins with no token (server) + listener join flow (UI)
- **FR-4** → **Epic 2** + *Epic 3* — performer:busy refusal (server) + client terminal message
- **FR-5** → Epic 2 — owner slot release + listener notification on performer disconnect
- **FR-6** → Epic 3 — performer selects MIDI input
- **FR-7** → Epic 3 — relay exactly 5 event types
- **FR-8** → **Epic 3** + *Epic 1* — SysEx double defense: performer filter (0xF0) + shared schema no SysEx type
- **FR-9** → Epic 3 — live monitoring of sent events
- **FR-10** → **Epic 1** + *Epic 2* + *Epic 3* — contract fields (shared) + server attaches performerId/srvTs + performer builds payload
- **FR-11** → **Epic 4** + *Epic 2* — listener joins room + receives (UI) + server room handler + broadcast
- **FR-12** → **Epic 4** + *Epic 5* — choose real MIDI output (Epic 4) + Mock/Debug output (Epic 5)
- **FR-13** → Epic 4 — forced channel remap
- **FR-14** → Epic 4 — Note de test button
- **FR-15** → **Epic 1** + *Epic 4* — wire→bytes mapping function (shared) + applied at listener send
- **FR-16** → Epic 5 — local Panic (CC ×16), works server-down
- **FR-17** → Epic 5 — Force Panic opt-in (noteOff sweep 128×16)
- **FR-18** → **Epic 2** + *Epic 4* — server enforces allowed listener→server events + listener emits only join/leave/test
- **FR-19** → Epic 2 — one-way forbidden gate + disconnect after 3 attempts
- **FR-20** → Epic 2 — role pinned in socket.data, performerId = socket.id
- **FR-21** → **Epic 1** + *Epic 2* — shared Zod strict schema + server 3-layer validation
- **FR-22** → Epic 2 — per-socket token bucket rate limit
- **FR-23** → Epic 2 — origin allowlist at HTTP upgrade (anti-CSWSH)
- **FR-24** → **Epic 5** + *Epic 2* — scheduler fail-safe + reconnect resume (listener) + server notify/release on disconnect
- **FR-25** → Epic 5 — buffer bounded to 256 (BUFFER_CAP)
- **FR-26** → Epic 5 — fallback/drop by type (MAX_LATE_MS=200)
- **FR-27** → Epic 5 — listener:overload local UI warning (no server event)
- **FR-28** → **Epic 2** + *Epic 1* — full /health {ok,uptime,owner,listeners} + Express route stub
- **FR-29** → **Epic 2** + *Epic 6* — graceful shutdown (server) + deploy verification
- **FR-30** → Epic 2 — structured sampled logs

**NFR coverage:** NFR-1/5 (Epic 4), NFR-2 (Epic 5), NFR-3 (Epic 2), NFR-4 (Epic 2/6), NFR-6/7 (Epic 3/4), NFR-8 (Epic 1/6), NFR-9/10/11 (Epic 2/3), NFR-12/13/14/15 (Epic 1/2), NFR-16/17/18/19 (Epic 1/5/6), NFR-20 (Epic 6).
**UX-DR coverage:** UX-DR1/3 (Epic 6), UX-DR2/20/21/22/23 (Epic 3/4/6), UX-DR4–14 (Epic 4/5), UX-DR15–19 (Epic 3/5), UX-DR24–28 (Epic 6 + a11y woven through 3/4/5).
**AD coverage:** AD-1/9/12 (Epic 1), AD-2/4/6/10/13/15/16/18/20 (Epic 2), AD-3/8 (Epic 3/4), AD-5/19 (Epic 1/6), AD-7/11/14/17 (Epic 5).

## Epic List

> Vue globale compacte — validation en attente avant détail des stories (Epic 1 en premier).
> Chaque epic est autonome et livrable indépendamment (il s'appuie uniquement sur les epics précédents).

### Epic 1: Fondation monorepo, tooling & contrat partagé
- **Objectif:** Poser le substrat de build — monorepo pnpm, tooling strict, contrat MIDI Zod partagé `@fmlw/shared`, mapping wire→bytes, et les coques Express + Vite mono-domaine HTTPS.
- **Périmètre:** `pnpm-workspace.yaml`, `apps/web`, `apps/server`, `packages/shared` ; `tsconfig.base.json` strict ; ESLint + dépendances directionnelles enforced ; `MidiEventSchema` (`.strict()`, 5 types, pas SysEx) ; `toMidiBytes` (déterministe 1:1) ; Express 5.2.1 + static Vite + `/health` stub ; `.env.example` sans valeurs.
- **Références:** FR-8 (schema half), FR-10, FR-15, FR-21, FR-28 (route stub) · NFR-12, NFR-15 · AD-1, AD-5, AD-9, AD-12, AD-19 (infra tests) · décisions scaffolding (Zod 3, Express 5.2.1, `tsc`, ESLint bound-modules).
- **Dépendances:** Aucune (fondation).
- **Story titles provisoires:**
  1.1 Scaffold monorepo pnpm + tooling strict + dépendances directionnelles ESLint
  1.2 Package `@fmlw/shared` + schéma Zod `MidiEvent` + constantes (ROOM, CC, status bytes)
  1.3 Mapping wire → bytes MIDI (fonction pure, 5 types, velocity 0 = noteOff, pitchBend lsb/msb)
  1.4 App web Vite + React + TS + shadcn/Tailwind + squelette feature-based
  1.5 App server Express mono-domaine HTTPS + static Vite + `/health` stub + config env

### Epic 2: Serveur Socket.IO, sécurité one-way & owner unique
- **Objectif:** Cœur temps réel sécurisé — `io.use` (rôle + performerId), `socket.use` (gate + rate limit), `PerformerRegistry` (owner unique, `performer:busy`), validation 3 couches, `OWNER_SECRET` timing-safe, origin allowlist, `/health` complet, graceful shutdown, logs échantillonnés.
- **Périmètre:** `apps/server/src/socket/{middlewares,handlers,services}` ; `PerformerRegistry`, `RoomService`, `RelayService` (interface adapter), `ValidationService` ; token bucket ; logger échantillonné ; handlers `midi:event` / `room:join` / `room:leave` / `midi:test` (aucun handler `panic`).
- **Références:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-10 (server half), FR-11 (server half), FR-18, FR-19, FR-20, FR-21 (validation), FR-22, FR-23, FR-24 (server half), FR-28 (full), FR-29, FR-30 · NFR-3, NFR-9, NFR-10, NFR-11, NFR-13, NFR-14 · AD-2, AD-4, AD-6, AD-10, AD-13, AD-15, AD-16, AD-18, AD-20 (shutdown).
- **Dépendances:** Epic 1 (`@fmlw/shared`, Express coque).
- **Story titles provisoires:**
  2.1 Socket.IO attach + origin allowlist + `io.use` rôle/performerId
  2.2 `OWNER_SECRET` timing-safe + anti-énumération + env hardening
  2.3 `PerformerRegistry` + `performer:busy` + libération slot owner
  2.4 Event gate `socket.use` (`forbidden`) + déconnexion après 3 tentatives
  2.5 Rate limit token bucket per-socket (`rate:limited`)
  2.6 `ValidationService` 3 couches + codes d'erreur stables (`safeParse`)
  2.7 `RoomService` + `RelayService` adapter + handlers (`room:join/leave`, `midi:test`, `midi:event` broadcast + `srvTs`)
  2.8 Graceful shutdown + `/health` complet + logger structuré échantillonné

### Epic 3: Web MIDI performer — capture & émission
- **Objectif:** Page `/performer` publique et statique — saisie token, sélection entrée MIDI, capture Web MIDI native des 5 types, filtre SysEx performer, relay avec ack, monitoring minimal, gestion `performer:busy` et libération de slot.
- **Périmètre:** `apps/web/src/features/performer/{components,hooks,lib,api}` ; `MidiAccessProvider` ; `MidiPortPicker` (input) ; `AdminTokenInput` ; `MonitoringPanel` ; `BrowserCompatGate` (performer) ; capture `MIDIInput.onmessage` → `MidiEvent`.
- **Références:** FR-2 (UI), FR-4 (UI), FR-6, FR-7, FR-8 (performer filter), FR-9, FR-10 (payload) · NFR-6, NFR-7, NFR-9 · AD-3, AD-8, AD-10 · UX-DR2, UX-DR17, UX-DR18, UX-DR19, UX-DR22, UX-DR23, UX-DR24–28 (woven).
- **Dépendances:** Epic 1 (web coque, `@fmlw/shared`) + Epic 2 (auth `io.use`, `performer:busy`).
- **Story titles provisoires:**
  3.1 Page `/performer` (publique/statique) + `AdminTokenInput` + connect Socket.IO + `performer:busy` + `BrowserCompatGate`
  3.2 `MidiAccessProvider` + sélection entrée MIDI (`MidiPortPicker` input) + hot-plug `onstatechange`
  3.3 Capture Web MIDI → payload `MidiEvent` (5 types) + filtre SysEx (`0xF0`) + `seq` monotone + `ts`
  3.4 Relay performer : `socket.emit("midi:event")` + ack (`invalid`/`rate:limited`) + `MonitoringPanel`
  3.5 Déconnexion / libération slot + reconnect + `BackToHome` propre

### Epic 4: Listener — sortie MIDI, scheduler & remappage canal
- **Objectif:** Page `/listener` — compat navigateur, autorisation MIDI, sélection sortie MIDI réelle, sélection canal avec remappage forcé, `room:join`, réception `midi:event`, scheduler `send(data, performance.now()+lookahead)`, note de test, états (vides + erreurs). Sorties réelles uniquement (Mock en Epic 5).
- **Périmètre:** `apps/web/src/features/listener/{components,hooks,lib}` ; `BrowserCompatGate` ; `MidiPermissionButton` ; `MidiPortPicker` (output, ports réels) ; `ChannelSelector` ; `JoinButton` ; `TestNoteButton` ; `StatusPill` ; `MidiActivityIndicator` ; `lib/scheduler` (version minimale : lookahead seulement) ; `lib/encode` (applique `toMidiBytes` + remap).
- **Références:** FR-3 (UI), FR-11 (listener half), FR-12 (real output half), FR-13, FR-14, FR-15 (applied), FR-18 (listener half) · NFR-1, NFR-5, NFR-6, NFR-7, NFR-8 · AD-3, AD-11 (lookahead), AD-12 · UX-DR2, UX-DR4–14 (réception/erreurs hors backpressure), UX-DR22, UX-DR23, UX-DR24–28 (woven).
- **Dépendances:** Epic 1 + Epic 2 (room handler, broadcast, `midi:test`).
- **Note:** Le scheduler (`lib/scheduler.ts`) sera étendu en Epic 5 (BUFFER_CAP, fallback/drop, fail-safe) — churn justifié par une frontière de risque/feedback (audio live d'abord, résilience ensuite).
- **Story titles provisoires:**
  4.1 Page `/listener` + `BrowserCompatGate` (feature detection + HTTPS) + `MidiPermissionButton`
  4.2 `MidiPortPicker` sortie (ports réels) + `ChannelSelector` (1–16 → 0–15, défaut 1, tooltip remap)
  4.3 `room:join` + réception `midi:event` + remappage forcé + `toMidiBytes` + `send(data, performance.now()+LOOKAHEAD_MS)`
  4.4 `TestNoteButton` (`midi:test`, note 60 / vel 100 / 300 ms) + `StatusPill` + `MidiActivityIndicator` + `Quitter le flux`
  4.5 États listener (vides + E1/E2/E3/E7/E13) + server-down pill + reconnexion auto

### Epic 5: Panic local, Force Panic, Mock Output & backpressure
- **Objectif:** Résilience et sécurité musicale — Panic local (serveur-déconnecté-proof), Force Panic opt-in confirmé, Mock Output à chaud, backpressure borné (BUFFER_CAP, fallback/drop par type), fail-safe musical déconnexion/perte port.
- **Périmètre:** `features/listener/lib/{panic,mock-output,scheduler (extension)}` ; `PanicButton` (sticky) ; `ForcePanicButton` + `ForcePanicDialog` ; `MockMidiOutput` + `MockByteStream` ; option Mock/Debug dans `MidiPortPicker` + switch à chaud ; `LateAlert` (warning local pur).
- **Références:** FR-12 (Mock half), FR-16, FR-17, FR-24 (listener half), FR-25, FR-26, FR-27 · NFR-2, NFR-19 · AD-7, AD-11 (backpressure), AD-14, AD-17 · UX-DR7 (Mock hot switch + `MockByteStream`), UX-DR12 (`MockByteStream`, `LatencyStat`), UX-DR13 (Mock empty), UX-DR14 (E5/E6/E10), UX-DR15, UX-DR16.
- **Dépendances:** Epic 4 (listener, scheduler minimal, picker sortie).
- **Story titles provisoires:**
  5.1 `MockMidiOutput` + `MockByteStream` + option Mock/Debug dans le picker + switch à chaud
  5.2 Panic local (CC 64→120→121→123 ×16) + `PanicButton` sticky + indépendance Socket.IO
  5.3 Force Panic opt-in + `ForcePanicDialog` confirmation + noteOff sweep 128×16 (2048)
  5.4 Backpressure : buffer borné 256 + drop oldest + fallback/drop par type (MAX_LATE_MS=200) + `LateAlert` local
  5.5 Fail-safe musical : arrêt scheduler sur déconnexion/perte port + reprise live sans replay

### Epic 6: UX finale, tests d'intégration, validation manuelle & déploiement MVP
- **Objectif:** Assembler les 3 surfaces + polish UX (landing, microcopy, a11y), passer la suite de tests complète (unitaires 100% + intégration in-process + `web-midi-test`), exécuter la validation manuelle IAC → Dexed → MIDI Monitor, vérifier zéro-secret + ADRs + 10 invariants, et déployer le MVP HTTPS mono-domaine.
- **Périmètre:** Landing `/` (role-picker + on-air polling `/health`) ; audit microcopy + pluralization + tokens visuels (DESIGN.md consulté ici) ; audit a11y complet (contraste, clavier, radiogroup, aria-live, reduced-motion, VoiceOver) ; suite Vitest + jsdom + `web-midi-test` ; plan manuel 11 étapes ; `grep` build zéro-secret ; ADRs 0001–0008 ; déploiement Caddy/managed + env prod + graceful shutdown verify.
- **Références:** FR-28 (on-air), FR-29 (deploy verify), FR-30 (logs verify) · NFR-8, NFR-9, NFR-16, NFR-17, NFR-18, NFR-20 · AD-18, AD-19, AD-20 · UX-DR1, UX-DR3, UX-DR20, UX-DR21, UX-DR22, UX-DR24–28 · AC-U1–AC-U21 · S-1–S-10.
- **Dépendances:** Epics 1–5 (toutes les fonctionnalités en place).
- **Story titles provisoires:**
  6.1 Landing `/` (role-picker + on-air polling `ownerActive`) + assemblage 3 surfaces + `BackToHome` propre
  6.2 Polish UX : audit microcopy verbatim + pluralization `Intl.PluralRules` + mono/Inter + couleurs sémantiques + role tags + intros panel
  6.3 Audit accessibilité complet : contraste (`danger_fill`, `ink.muted`), clavier + focus, `ChannelSelector` radiogroup, `aria-live`, `prefers-reduced-motion`, VoiceOver
  6.4 Tests unitaires 100 % (mapping, panic, scheduler, schéma, registry, rate limit) + couverture CI
  6.5 Tests intégration Socket.IO in-process + `web-midi-test` (join/relay/forbidden/busy)
  6.6 Plan + exécution test manuel IAC → Dexed → MIDI Monitor (11 étapes) + sign-off
  6.7 Validation zéro-secret (`grep` build) + ADRs 0001–0008 versionnés + 10 invariants respectés
  6.8 Déploiement MVP HTTPS mono-domaine (Caddy/managed) + env prod + graceful shutdown verify + `/health` prod

---

## Epic 1: Fondation monorepo, tooling & contrat partagé

**Goal:** Poser le substrat de build du MVP — monorepo pnpm, tooling strict, contrat MIDI Zod partagé `@fmlw/shared`, mapping wire→bytes déterministe, et les coques Express + Vite mono-domaine HTTPS. À l'issue de cet epic, un développeur peut lancer `pnpm dev` (web + server), `pnpm build`, `pnpm test`, `pnpm lint`, le schéma MIDI est importable front+back, et `GET /health` répond sur le même origin HTTPS.
**FRs covered:** FR-8 (schema half), FR-10, FR-15, FR-21, FR-28 (route stub)
**NFRs:** NFR-12, NFR-15 · **ADs:** AD-1, AD-5, AD-9, AD-12, AD-19 (infra) · **Scaffolding:** Zod 3 `^3.23`, Express 5.2.1, `tsc` build, ESLint bound-modules

### Story 1.1: Scaffold monorepo pnpm + tooling strict + dépendances directionnelles ESLint

As a developer,
I want a pnpm monorepo with strict shared TypeScript config and enforced directional dependencies,
So that all later work builds on a coherent, lint-protected substrate with zero drift between packages.

**Objectif:** Créer la racine du monorepo, les workspaces, la config TS stricte partagée, les scripts root, et l'ESLint qui empêche les dépendances inter-couches interdites (`app → features → entities → shared → lib` ; `performer` ↔ `listener` interdits ; back `handlers → services → shared`).

**Contexte:** Greenfield — aucun code applicatif n'existe. C'est la story fondation ; elle ne crée aucune logique métier, seulement le squelette + tooling. Décisions scaffolding confirmées 2026-07-06.

**Fichiers/modules concernés:** `pnpm-workspace.yaml`, `package.json` (root, scripts `dev`/`build`/`test`/`lint`), `tsconfig.base.json` (strict), `.gitignore` (`.env`, `.env.*.local`, `dist`, `node_modules`), `.env.example` (sans valeurs), `eslint.config.js` + plugin `eslint-plugin-bound-modules` (ou équivalent), `apps/web/`, `apps/server/`, `packages/shared/` (dossiers vides avec `package.json` minimaux).

**Références:** PRD NFR-12 (stack fixe monorepo pnpm + `@fmlw/shared`) · Arch AD-1 (mono-process modulaire), Structural Seed · Scaffolding decisions (directional deps enforced by ESLint).

**Acceptance Criteria:**
**Given** le repo est vide
**When** j'exécute `pnpm install` à la racine
**Then** les 3 workspaces (`apps/web`, `apps/server`, `packages/shared`) sont reconnus et installés sans erreur
**And** `pnpm -r ls` liste les 3 packages.

**Given** deux couches dont l'une ne doit pas dépendre de l'autre (ex. `features/performer` → `features/listener`)
**When** j'ajoute un import interdit
**Then** `pnpm lint` échoue avec une erreur explicite citant la règle de dépendance directionnelle
**And** les dépendances autorisées (`app → features → entities → shared → lib`) passent.

**Given** `tsconfig.base.json`
**When** un package hérite de la base
**Then** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (ou équivalent strict confirmé) sont actifs
**And** `pnpm -r build` compile sans erreur (placeholder `index.ts` vide par package).

**Tests attendus:** Aucun test unitaire (pas de logique). Vérification par `pnpm lint` (règle bound-modules testée positivement + négativement) et `pnpm -r build` (compile). Un test lint dédié vérifie qu'un import `performer → listener` est rejeté.

**Dépendances:** Aucune (story fondation).

**Définition de terminé:** `pnpm install`, `pnpm lint`, `pnpm -r build` passent ; workspaces reconnus ; ESLint rejette les imports inter-couches interdits et accepte les autorisés ; `.gitignore` et `.env.example` (sans valeurs) en place ; tsconfig strict partagé.

### Story 1.2: Package `@fmlw/shared` + schéma Zod `MidiEvent` + constantes

As a developer,
I want a single strict Zod MIDI contract importable by both frontend and backend,
So that the wire format never drifts between client and server and invalid events are rejected identically on both sides.

**Objectif:** Définir `MidiEventSchema` (`.strict()`), les types inférés, et les constantes partagées (room, CC panic, status bytes). Aucune logique métier — seulement le contrat.

**Contexte:** Source unique du wire (AD-5). Doit rejeter champs inconnus, hors-plages, `v !== 1`, et tout type SysEx. `performerId` interdit dans le payload. `channel` 0–15 sur le wire. `pitchBend` 14-bit 0–16383 (8192 = centre). `seq` uint32 monotone. Construit avec `tsc` (pas `tsup`). Zod 3 `^3.23` via `zod/v3`.

**Fichiers/modules concernés:** `packages/shared/src/midi-event.ts` (`MidiEventSchema` + `z.infer` type `MidiEvent`), `packages/shared/src/constants.ts` (`ROOM = "fm-live-wire:main"`, CC 120/121/123, status bytes `0x80/0x90/0xB0/0xC0/0xE0`, `PROTOCOL_VERSION = 1`), `packages/shared/src/index.ts` (re-exports), `packages/shared/package.json` (`"name": "@fmlw/shared"`, `"exports"`, `"main"`/`"types"` ESM, `tsc` build script).

**Références:** PRD FR-10 (champs event), FR-21 (validation stricte), FR-8 (pas de type SysEx) · Arch AD-5 (contrat partagé Zod), AD-9 (JSON v:1) · Scaffolding (Zod 3 `^3.23`, `tsc` build).

**Acceptance Criteria:**
**Given** un événement valide `noteOn` (`{v:1,type:"noteOn",channel:0,roomId:"fm-live-wire:main",seq:1,ts:123.4,note:60,velocity:100}`)
**When** `MidiEventSchema.safeParse(event)`
**Then** le parse réussit et retourne les données typées
**And** le type `MidiEvent` est inféré correctement.

**Given** un événement avec un champ inconnu, `v !== 1`, `channel` hors 0–15, `note` hors 0–127, ou `pitchBend` hors 0–16383
**When** `safeParse`
**Then** le parse échoue avec des `ZodIssue` précises
**And** le code d'erreur `unsupported-version` est associable au cas `v !== 1`.

**Given** un payload contenant un champ `performerId`
**When** `safeParse`
**Then** le parse échoue (`.strict()` rejette le champ inconnu)
**And** aucune variante du schéma n'expose de type `sysex`.

**Given** `packages/shared` buildé
**When** `apps/server` et `apps/web` importent `@fmlw/shared`
**Then** l'import résout via `workspace:*` et les types sont disponibles des deux côtés
**And** `pnpm --filter @fmlw/shared build` produit le output `tsc` ESM.

**Tests attendus:** Tests unitaires Vitest couvrant : chaque type valide (noteOn/noteOff/controlChange/programChange/pitchBend) ; rejet champs inconnus ; rejet hors-plages (channel 16, note 128, velocity 128, pitchBend 16384, programChange value 128, cc value 128) ; rejet `v !== 1` ; rejet `performerId` présent ; rejet `roomId` ≠ constante ; absence de type SysEx (test négatif). Cible 100 % sur ce module (NFR-16).

**Dépendances:** Story 1.1 (monorepo + workspace).

**Définition de terminé:** `MidiEventSchema` `.strict()` couvre les 5 types + champs communs ; constantes exportées ; `@fmlw/shared` buildé par `tsc` et importable front+back ; tests unitaires passent à 100 % sur le module ; `performerId` rejeté ; aucun type SysEx.

### Story 1.3: Mapping wire → bytes MIDI (déterministe 1:1)

As a developer,
I want a pure function that converts a validated `MidiEvent` into raw MIDI bytes,
So that the listener can render events via `MIDIOutput.send(data, ts)` with a deterministic, testable encoding.

**Objectif:** Fonction pure `toMidiBytes(event: MidiEvent): Uint8Array` pour les 5 types, avec convention velocity 0 = noteOff et pitchBend lsb/msb. Cette fonction est la source unique de l'encodage, réutilisable côté listener (et testable sans périphérique).

**Contexte:** Mapping déterministe 1:1 (FR-15, AD-12 table). Le canal d'entrée est 0–15 (wire). Le remappage du canal par le listener (AD-12) se fait en amont (Epic 4) avant `toMidiBytes` — cette story encode le canal fourni tel quel. `programChange` = 2 bytes (status + program). `pitchBend` = status + lsb + msb (14-bit).

**Fichiers/modules concernés:** `packages/shared/src/encode.ts` (`toMidiBytes`), export dans `index.ts`, tests `packages/shared/src/__tests__/encode.test.ts`.

**Références:** PRD FR-15 (mapping 1:1), FR-7 (5 types) · Arch AD-12 (mapping wire→bytes table) · Scaffolding (convention velocity 0 = noteOff).

**Acceptance Criteria:**
**Given** un `noteOn` channel 0, note 60, velocity 100
**When** `toMidiBytes(event)`
**Then** le résultat est `Uint8Array [0x90, 60, 100]`.

**Given** un `noteOff` channel 0, note 60, velocity 0
**When** `toMidiBytes(event)`
**Then** le résultat est `[0x80, 60, 0]`
**And** un `noteOn` velocity 0 produit `[0x90, note, 0]` (convention velocity 0 = noteOff préservée côté wire, le listener décide).

**Given** un `controlChange` channel 3, controller 74, value 91
**When** `toMidiBytes`
**Then** le résultat est `[0xB3, 74, 91]`.

**Given** un `programChange` channel 0, program 42
**When** `toMidiBytes`
**Then** le résultat est `[0xC0, 42]` (2 bytes).

**Given** un `pitchBend` channel 0, value 8192 (centre)
**When** `toMidiBytes`
**Then** le résultat est `[0xE0, 0x00, 0x40]` (lsb=0, msb=64)
**And** value 16383 → `[0xE0, 0x7F, 0x7F]`, value 0 → `[0xE0, 0x00, 0x00]`.

**Given** un event avec channel 15 (borne supérieure wire)
**When** `toMidiBytes`
**Then** le status byte utilise `0x?F` (canal 15) correctement.

**Tests attendus:** Tests unitaires Vitest : chaque type sur canaux 0 et 15 ; bornes (note 0/127, velocity 0/127, cc value 0/127, program 0/127, pitchBend 0/8192/16383) ; convention velocity 0 ; déterminisme (même entrée → même sortie) ; pureté (pas d'effet de bord). Cible 100 % (NFR-16).

**Dépendances:** Story 1.2 (type `MidiEvent`).

**Définition de terminé:** `toMidiBytes` couvre les 5 types de manière déterministe 1:1 ; conventions velocity 0 = noteOff et pitchBend lsb/msb respectées ; tests unitaires passent à 100 % ; fonction pure exportée depuis `@fmlw/shared`.

### Story 1.4: App web Vite + React + TS + shadcn/Tailwind + squelette feature-based

As a developer,
I want the frontend app scaffolded with Vite, React 19, TypeScript, shadcn/ui + Tailwind, and a feature-based skeleton with isolated `performer` and `listener` features,
So that Epics 3–6 can build UI on a consistent substrate without cross-feature coupling.

**Objectif:** Coque de l'app web : Vite 6 + React 19 + TS strict, shadcn/ui + Tailwind, providers vides (`SocketProvider`, `MidiAccessProvider`), router avec routes `/`, `/listener`, `/performer` (pages placeholder), structure `app/features/entities/shared/lib/config`. Zustand installé pour le state client. Aucune logique métier.

**Contexte:** Frontend feature-based (AD-1, Structural Seed). Les features `performer` et `listener` ne dépendent pas entre elles (enforced par ESLint en 1.1). shadcn fournit Button, Select, Input, Card, Badge, Alert, Dialog, Tooltip, Separator, Sonner (cf. UX-DR). Sombre par design (DESIGN.md consulté en Epic 6 pour les tokens ; ici defaults shadcn/Tailwind suffisent).

**Fichiers/modules concernés:** `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/tsconfig.json` (hérite base), `apps/web/src/app/{providers,router,layouts}`, `apps/web/src/features/{performer,listener}/index.ts` (placeholders), `apps/web/src/entities/{MidiEvent,Channel,Role}.ts` (re-exports `@fmlw/shared`), `apps/web/src/shared/` (primitives shadcn), `apps/web/src/lib/{socket,midi-access}.ts` (wrappers placeholder), `apps/web/src/config/runtime.ts` (`LOOKAHEAD_MS=40`, `BUFFER_CAP=256`, `MAX_LATE_MS=200` defaults UI), `tailwind.config`, `index.html`.

**Références:** PRD NFR-12 (stack React+Vite+TS) · Arch AD-1 (feature-based, deps directionnelles), AD-6 (Zustand, pas de TanStack Query) · UX-DR4 (squelette à une colonne), UX-DR22 (mono Inter / JetBrains Mono, couleurs sémantiques — defaults ici) · Scaffolding (LOOKAHEAD_MS=40, BUFFER_CAP=256, MAX_LATE_MS=200).

**Acceptance Criteria:**
**Given** `apps/web` scaffoldé
**When** `pnpm --filter web dev`
**Then** Vite démarre et sert une page sur `https://localhost` (ou localhost dev) sans erreur
**And** les routes `/`, `/listener`, `/performer` retournent des pages placeholder.

**Given** les features `performer` et `listener`
**When** `pnpm lint`
**Then** aucun import croisé `performer ↔ listener` n'est présent (et la règle le rejetterait)
**And** les dépendances suivent `app → features → entities → shared → lib`.

**Given** `@fmlw/shared`
**When** `apps/web` importe `MidiEvent` et `toMidiBytes`
**Then** les types résolvent à la compilation
**And** le build `pnpm --filter web build` produit le bundle statique sans erreur.

**Given** le state client
**When** un store Zustand minimal est créé
**Then** Zustand 5.x est installé et utilisable (pas de TanStack Query ajouté).

**Tests attendus:** Pas de tests unitaires (pas de logique). Vérification : `pnpm --filter web build` passe ; `pnpm lint` passe ; `entities/MidiEvent` re-exporte bien `@fmlw/shared` (test de résolution d'import).

**Dépendances:** Stories 1.1, 1.2 (monorepo + `@fmlw/shared`).

**Définition de terminé:** App web démarre en dev, build en statique, lint passe ; squelette feature-based en place avec `performer`/`listener` isolés ; providers + router + 3 routes placeholder ; Zustand installé ; `config/runtime.ts` porte les defaults (`LOOKAHEAD_MS=40`, `BUFFER_CAP=256`, `MAX_LATE_MS=200`) ; `@fmlw/shared` consommé.

### Story 1.5: App server Express mono-domaine HTTPS + static Vite + `/health` stub + config env

As a developer,
I want the server app scaffolded with Express 5.2.1 serving the static Vite build and a `/health` route on a single HTTPS origin, with env config,
So that Epic 2 can attach Socket.IO on the same origin and the deployment substrate (AD-1/AD-20) is in place.

**Objectif:** Coque du serveur : Express 5.2.1 + serveur HTTP(S) Node, sert le build statique Vite + `GET /health` (stub : `ownerActive: false`, `listeners: 0` — les vraies valeurs viennent en Epic 2 avec `PerformerRegistry`), config env (`PORT`, `PUBLIC_ORIGIN`, `OWNER_SECRET`, `LOG_MIDI`, `MAX_LISTENERS`), logger minimal. Pas de Socket.IO ici (Epic 2).

**Contexte:** Mono-process mono-domaine HTTPS (AD-1, AD-15, AD-20). Express est mince : static + `/health`, pas de logique métier. `/health` stub retourne `{ ok: true, uptime, ownerActive: false, listeners: 0 }` — la forme est définitive (FR-28, champ `ownerActive` validé AD-20 alimentant le polling landing), les valeurs seront branchées en Epic 2. Dev sur localhost (HTTPS local ou localhost secure context), prod TLS en Epic 6.

**Fichiers/modules concernés:** `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/config/env.ts` (lit `PORT`/`PUBLIC_ORIGIN`/`OWNER_SECRET`/`LOG_MIDI`/`MAX_LISTENERS` avec defaults sûrs), `apps/server/src/app/index.ts` (Express wiring + `http.createServer`), `apps/server/src/http/routes/health.ts`, `apps/server/src/http/routes/static.ts` (sert `apps/web/dist`), `apps/server/src/shared/logger.ts` (minimal), `.env.example` (complété côté server).

**Références:** PRD FR-28 (`/health` forme), NFR-8 (HTTPS), NFR-13 (mono-process mono-domaine) · Arch AD-1 (Express mince), AD-15 (mono-domaine), AD-20 (env `PORT`/`OWNER_SECRET`/`PUBLIC_ORIGIN`/`LOG_MIDI`/`MAX_LISTENERS`, `/health` forme) · Scaffolding (Express 5.2.1).

**Acceptance Criteria:**
**Given** le server scaffoldé et `apps/web` buildé
**When** `pnpm --filter server dev`
**Then** Express démarre sur `PORT` (default sûr) et sert le build Vite statique à la racine sur le même origin.

**Given** une requête `GET /health`
**When** le serveur tourne
**Then** la réponse est `200` JSON `{ ok: true, uptime: <number>, ownerActive: false, listeners: 0 }`
**And** la forme correspond à FR-28 (champ `ownerActive` booléen, `listeners` nombre — nom `ownerActive` validé AD-20).

**Given** la config env
**When** aucune variable n'est définie
**Then** des defaults sûrs s'appliquent (sauf `OWNER_SECRET` qui reste vide/non requis en dev) et le serveur démarre
**And** `.env.example` liste toutes les variables sans valeurs.

**Given** le server et le build web
**When** `pnpm --filter server build` puis lancement
**Then** la static + `/health` sont servis sur un seul origin (zéro CORS)
**And** `OWNER_SECRET` n'est jamais exposé au bundle frontend (vérification `grep` différée à Epic 6, mais aucun `VITE_*` introduit ici).

**Tests attendus:** Test d'intégration minimal (supertest ou http in-process) : `GET /health` → 200 + JSON de la bonne forme ; static sert `index.html` à `/`. Pas de test de Socket.IO (Epic 2). Test que la config env applique des defaults sûrs.

**Dépendances:** Stories 1.1, 1.4 (monorepo + build web pour la static).

**Définition de terminé:** Express 5.2.1 sert static Vite + `GET /health` (forme FR-28, valeurs stub) sur un seul origin ; config env avec defaults sûrs + `.env.example` sans valeurs ; server buildé et démarrable ; zéro CORS ; `OWNER_SECRET` serveur-only (aucun `VITE_*`) ; test d'intégration `/health` + static passe.

---

**Epic 1 summary:** 5 stories, all forward-dependency-free (1.1 → 1.2 → 1.3 ; 1.4 depends on 1.1+1.2 ; 1.5 depends on 1.1+1.4). Aucune logique métier — substrat de build + contrat + coques. Story suivante recommandée pour implémentation : **Story 1.1**.

---

## Epic 2: Serveur Socket.IO, sécurité one-way & owner unique

**Goal:** Cœur temps réel sécurisé du MVP. Brancher Socket.IO v4 sur le même origin Express ; épingler rôles et `performerId` ; authentifier le performer par `OWNER_SECRET` timing-safe ; garantir un owner unique (`performer:busy`) ; appliquer le gate one-way per-event (`forbidden` + déconnexion après 3 tentatives) et le rate limit per-socket ; valider strictement (3 couches, `safeParse`) ; broadcaster vers la room ; servir `/health` complet ; shutdown graceful ; logs échantillonnés. À l'issue, le modèle one-way est enforce côté serveur et testable in-process.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-10 (server half), FR-11 (server half), FR-18, FR-19, FR-20, FR-21 (validation), FR-22, FR-23, FR-24 (server half), FR-28 (full), FR-29, FR-30
**NFRs:** NFR-3, NFR-9, NFR-10, NFR-11, NFR-13, NFR-14 · **ADs:** AD-2, AD-4, AD-6, AD-10, AD-13, AD-15, AD-16, AD-18, AD-20 (shutdown) · **UX (codes d'erreur consommés par l'UI):** E8 `invalid`, E9 `performer:busy`, E11 `forbidden`, E12 `rate:limited`, E13 `unsupported-version`

### Story 2.1: Socket.IO attach + origin allowlist + `io.use` rôle/performerId

As a server developer,
I want Socket.IO attached to the Express HTTP server with origin allowlist and a connection middleware that pins role and performerId,
So that every socket carries a non-modifiable server-side identity before any event is processed.

**Objectif:** Attacher Socket.IO v4 (`^4.8.3`) au serveur HTTP existant ; `origin: process.env.PUBLIC_ORIGIN` au upgrade (anti-CSWSH, zéro CORS) ; `io.use` épingle `socket.data.role` (depuis `auth.role`) et `socket.data.performerId = socket.id` pour les performers. `transports: ["websocket"]` en prod.

**Contexte:** AD-2 (rôle épinglé, performerId = socket.id jamais client), AD-4 (Socket.IO v4, même major), AD-15 (origin allowlist mono-domaine). La validation du token performer vient en 2.2 — ici on épingle seulement le rôle déclaré. Aucun handler d'événement ici (2.7).

**Fichiers/modules concernés:** `apps/server/src/app/index.ts` (attach `io` au `http.createServer`), `apps/server/src/socket/index.ts` (`io.on("connection")` + wiring middlewares), `apps/server/src/socket/middlewares/roleAuth.ts` (`io.use`), `apps/server/src/config/env.ts` (`PUBLIC_ORIGIN`).

**Références:** PRD FR-1, FR-20, FR-23 · Arch AD-2, AD-4, AD-15 · NFR-13, NFR-14.

**Acceptance Criteria:**
**Given** un client qui se connecte avec `auth: { role: "listener" }`
**When** la connexion s'établit
**Then** `socket.data.role === "listener"` et `socket.data.performerId` est indéfini/non requis
**And** `socket.data.role` n'est plus modifiable côté client après épingle.

**Given** un client qui se connecte avec `auth: { role: "performer", token }`
**When** la connexion s'établit
**Then** `socket.data.role === "performer"` et `socket.data.performerId === socket.id` (jamais une valeur client).

**Given** une requête d'upgrade depuis une origin non allowlistée (≠ `PUBLIC_ORIGIN`)
**When** l'upgrade arrive
**Then** la connexion est rejetée (zéro CORS, anti-CSWSH).

**Given** `transports` en prod
**When** un client tente long-polling
**Then** seul `websocket` est accepté (pas de fallback polling en prod).

**Tests attendus:** Tests d'intégration in-process (Socket.IO client + server) : listener connecté → role piné ; performer connecté → role + performerId piné ; origin non allowlistée → rejet ; tentative de modification de `socket.data.role` côté client sans effet. Pas de port matériel requis.

**Dépendances:** Story 1.5 (serveur Express + HTTP server).

**Définition de terminé:** Socket.IO v4 attaché au même origin ; `io.use` épingle role + performerId ; origin allowlist effective (rejet hors `PUBLIC_ORIGIN`) ; `transports: ["websocket"]` en prod ; tests d'intégration passent.

### Story 2.2: `OWNER_SECRET` timing-safe + anti-énumération + env hardening

As a server developer,
I want performer authentication via `OWNER_SECRET` compared timing-safely with generic errors and no frontend exposure,
So that the owner secret cannot be enumerated via timing or error messages and never leaks into the Vite bundle.

**Objectif:** Dans `io.use` (après 2.1), si `role === "performer"`, comparer `auth.token` à `process.env.OWNER_SECRET` via `crypto.timingSafeEqual` (avec garde longueur égale) ; token manquant/invalide → `next(Error("invalid"))` avec message générique (anti-énumération) ; listener n'a pas besoin de token. Vérifier qu'aucune variable `VITE_*` ne porte le secret ; `.env` gitignored, `.env.example` sans valeurs.

**Contexte:** AD-10 (auth shared secret vs JWT, serveur-only, timing-safe, erreurs génériques, pas de `localStorage`, jamais dans l'URL). Le token est saisi manuellement à chaque session côté performer (Epic 3). Erreur `invalid` (E8) consommée par l'UI performer. La vérification `grep` build zéro-secret est formalisée en Epic 6, mais cette story garantit qu'aucun `VITE_*` n'expose le secret.

**Fichiers/modules concernés:** `apps/server/src/socket/middlewares/roleAuth.ts` (extension : validation token performer), `apps/server/src/config/env.ts` (`OWNER_SECRET`), `.env.example`, `.gitignore`.

**Références:** PRD FR-2, NFR-9, NFR-10 · Arch AD-10 · UX E8 (`invalid`).

**Acceptance Criteria:**
**Given** un performer avec le bon `OWNER_SECRET`
**When** connexion
**Then** l'auth réussit (le flux continue vers 2.3 pour le check owner).

**Given** un performer avec un token faux ou manquant
**When** connexion
**Then** `next(Error("invalid"))` est appelé avec un message générique identique (pas de distinction "manquant" vs "incorrect")
**And** le client reçoit `connect_error` avec le code `invalid`.

**Given** deux tokens de longueurs différentes
**When** comparaison
**Then** `crypto.timingSafeEqual` est protégé contre l'erreur longueur (branche sécurisée, pas de leak).

**Given** le build frontend
**When** recherche de `OWNER_SECRET` ou de toute variable `VITE_*` portant le secret
**Then** zéro occurrence (le secret n'existe que côté serveur)
**And** `.env` est gitignored et `.env.example` ne contient aucune valeur.

**Tests attendus:** Tests d'intégration : token valide → succès ; token invalide → `invalid` ; token manquant → `invalid` (même réponse) ; pas de différence mesurable de timing entre token faux de longueurs différentes (test déterministe sur la garde longueur). Test que `process.env.OWNER_SECRET` n'est jamais référencé dans `apps/web`.

**Dépendances:** Story 2.1 (`io.use` roleAuth).

**Définition de terminé:** Auth performer timing-safe via `crypto.timingSafeEqual` ; erreurs génériques `invalid` (anti-énumération) ; `OWNER_SECRET` serveur-only, aucun `VITE_*` ; `.env` gitignored + `.env.example` sans valeurs ; tests passent.

### Story 2.3: `PerformerRegistry` + `performer:busy` + libération slot owner

As a server developer,
I want an in-memory single-slot performer registry that refuses a second performer and releases the slot on disconnect,
So that the unique-owner invariant is enforced and the slot is freed cleanly when the performer leaves.

**Objectif:** Service `PerformerRegistry` (état in-memory `ownerPerformerId: string | null`) ; à la connexion d'un performer valide (après 2.2), si le slot est libre → prend la main ; si occupé → `next(Error("performer:busy"))` (refus, pas de remplacement) ; à la déconnexion → libère le slot et notifie les listeners (`performer:disconnected`). Expose `isOwnerActive()` / `getOwnerPerformerId()` pour `/health` et le gate.

**Contexte:** AD-2 (single-slot, `performer:busy` pas de remplacement silencieux), AD-6 (état in-memory volatile, muté uniquement par les services). FR-4 (2ᵉ performer refusé), FR-5 (libération + notification). Erreur `performer:busy` (E9) consommée par l'UI performer (Epic 3). La notification `performer:disconnected` est émise vers la room (consommée par le listener Epic 4).

**Fichiers/modules concernés:** `apps/server/src/socket/services/PerformeRegistry.ts`, intégration dans `roleAuth.ts` (après validation token) et dans `io.on("connection")`/`socket.on("disconnect")`.

**Références:** PRD FR-4, FR-5, FR-20 · Arch AD-2, AD-6 · UX E9 (`performer:busy`).

**Acceptance Criteria:**
**Given** aucun performer connecté
**When** un premier performer valide se connecte
**Then** `ownerPerformerId` devient son `socket.id` et `isOwnerActive() === true`.

**Given** un performer déjà owner actif
**When** un deuxième performer valide tente de se connecter
**Then** `next(Error("performer:busy"))` est appelé (refus, pas de remplacement)
**And** le premier performer reste owner.

**Given** un owner actif
**When** il se déconnecte (fermeture onglet / `disconnect`)
**Then** le slot est libéré (`ownerPerformerId = null`, `isOwnerActive() === false`)
**And** un event `performer:disconnected` est émis vers la room `fm-live-wire:main`.

**Given** le slot libéré
**When** un nouveau performer se connecte
**Then** il peut prendre le slot (réutilisation possible après libération).

**Tests attendus:** Tests unitaires `PerformerRegistry` (take/release/busy) + tests d'intégration in-process : 1er ok, 2ᵉ `performer:busy`, déconnexion libère, reconnexion possible après libération, notification `performer:disconnected` reçue par un listener join. Cible 100 % sur le registry (NFR-16).

**Dépendances:** Stories 2.1, 2.2.

**Définition de terminé:** `PerformerRegistry` in-memory single-slot ; 2ᵉ performer → `performer:busy` (pas de remplacement) ; déconnexion libère + notifie `performer:disconnected` ; `isOwnerActive()`/`getOwnerPerformerId()` exposés pour `/health` et le gate ; tests unitaires + intégration passent.

### Story 2.4: Event gate `socket.use` (`forbidden`) + déconnexion après 3 tentatives

As a server developer,
I want a per-event middleware that rejects any `midi:event` from a non-owner and disconnects a listener after 3 forbidden attempts,
So that the one-way model is enforced per-event and a flooding listener is cut off without a persistent ban.

**Objectif:** `socket.use` gate per-event : sur `midi:event`, si `socket.data.role !== "performer"` ou `socket.data.performerId !== ownerPerformerId` → `next(new Error("forbidden"))` (le client reçoit `forbidden`). Compteur `forbidden` par socket listener ; au 3ᵉ → `socket.disconnect(true)` (pas de ban persistant). Listener→server events autorisés : `room:join`, `room:leave`, `midi:test` uniquement (les autres émis par un listener sont aussi bloqués).

**Contexte:** AD-2 (gate per-event), AD-16 (déconnexion après 3 `forbidden`, pas de ban persistant). FR-19 (one-way strict), FR-18 (events listener autorisés limités). Erreur `forbidden` (E11) ; après déconnexion l'UI affiche « Connexion interrompue : action non autorisée. » (Epic 4/5). Un listener n'a aucun contrôle d'envoi dans l'UI — ce gate est testé via console `socket.emit('midi:event')` (test manuel étape 9, S-4).

**Fichiers/modules concernés:** `apps/server/src/socket/middlewares/eventGate.ts` (`socket.use`), compteur par socket, intégration dans `socket/index.ts`.

**Références:** PRD FR-18, FR-19, NFR-11 · Arch AD-2, AD-16 · UX E11 (`forbidden`).

**Acceptance Criteria:**
**Given** un listener connecté
**When** il émet `socket.emit('midi:event', {...})`
**Then** le gate renvoie `forbidden` (ack/error) et l'event n'est jamais relayé
**And** un compteur `forbidden` est incrémenté pour ce socket.

**Given** un listener qui a déjà 2 `forbidden`
**When** il émet une 3ᵉ tentative `midi:event`
**Then** le serveur déconnecte le socket (`socket.disconnect(true)`)
**And** aucun ban persistant n'est enregistré (le listener peut se reconnecter).

**Given** un performer non-owner (un 2ᵉ performer serait déjà refusé en 2.3, mais si `performerId !== ownerPerformerId`)
**When** il émet `midi:event`
**Then** `forbidden` (le gate vérifie rôle ET `performerId === ownerPerformerId`).

**Given** un listener émettant `room:join`, `room:leave` ou `midi:test`
**When** le gate s'exécute
**Then** ces events passent (non bloqués) — ils seront traités en 2.7.

**Tests attendus:** Tests d'intégration in-process : listener `midi:event` → `forbidden` (non relayé) ; 3 tentatives → déconnexion ; events autorisés passent ; performer non-owner → `forbidden`. Cible 100 % sur le gate (NFR-16).

**Dépendances:** Stories 2.1, 2.3 (rôle + `ownerPerformerId`).

**Définition de terminé:** Gate `socket.use` bloque `midi:event` non-owner avec `forbidden` ; compteur 3 → déconnexion (pas de ban persistant) ; events listener autorisés (`room:join/leave`, `midi:test`) passent ; tests passent.

### Story 2.5: Rate limit token bucket per-socket (`rate:limited`)

As a server developer,
I want a per-socket token bucket rate limiter on `midi:event` (burst 200, refill 100/s),
So that a performer cannot flood the relay and bypass HTTP limiters via WebSocket frames.

**Objectif:** `socket.use` token bucket per-socket (par performer) : capacité burst 200, refill 100/s. Sur `midi:event`, si le bucket est épuisé → `next(new Error("rate:limited"))` (le client reçoit `rate:limited`) + log échantillonné. Les listeners n'émettent jamais `midi:event` (déjà bloqué par 2.4) — le rate limit s'applique donc aux performers.

**Contexte:** AD-13 (token bucket per-socket, burst 200, refill 100/s), FR-22, NFR-3 (soutenir 100 ev/s, burst 200). Erreur `rate:limited` (E12) consommée par l'UI performer (Epic 3). Scaffolding : rate limit 100 midi:event/s soutenus, burst 200.

**Fichiers/modules concernés:** `apps/server/src/utils/tokenBucket.ts` (pure, testable), `apps/server/src/socket/middlewares/rateLimit.ts` (`socket.use`), intégration dans `socket/index.ts`.

**Références:** PRD FR-22, NFR-3 · Arch AD-13 · UX E12 (`rate:limited`) · Scaffolding (100/s sustained, burst 200).

**Acceptance Criteria:**
**Given** un performer owner émettant ≤ 100 `midi:event`/s en continu
**When** le flux est soutenu
**Then** aucun `rate:limited` n'est émis (le bucket se replenish à 100/s).

**Given** un performer émettant un burst court de 200 events
**When** le burst arrive
**Then** les 200 passent (capacité burst) ; le 201ᵉ → `rate:limited`.

**Given** un performer au-delà du burst
**When** il continue d'émettre
**Then** les events excédentaires reçoivent `rate:limited` et ne sont pas relayés
**And** un log échantillonné (compteur agrégé) est produit (pas un log par event).

**Given** le token bucket
**When** testé en isolation
**Then** il est déterministe (time-tick injecté) et pur (pas d'effet de bord).

**Tests attendus:** Tests unitaires `tokenBucket` (capacity, refill, exhaustion, recovery — avec temps injecté) 100 % ; test d'intégration : 200 burst passent, 201ᵉ → `rate:limited`, 100/s soutenus sans rejet.

**Dépendances:** Story 2.4 (gate — le rate limit s'ajoute après le gate dans la chaîne `socket.use`).

**Définition de terminé:** Token bucket per-socket (burst 200, refill 100/s) ; dépassement → `rate:limited` + log échantillonné ; 100/s soutenus ; tests unitaires + intégration passent.

### Story 2.6: `ValidationService` 3 couches + codes d'erreur stables (`safeParse`)

As a server developer,
I want strict 3-layer event validation using the shared Zod schema with stable error codes,
So that malformed events are rejected identically with actionable `issues` and zero schema drift.

**Objectif:** `ValidationService` encapsulant `MidiEventSchema.safeParse` ; le handler `midi:event` (2.7) appelle `validate(event)` → soit données validées, soit `{ ok:false, error, issues }`. Codes stables : `invalid` (champs/hors-plages), `unsupported-version` (`v !== 1`). Validation 3 couches : connexion (`io.use`, 2.1/2.2) → event (`socket.use` gate+rate, 2.4/2.5) → handler (`safeParse`, ici). Validation stricte `.strict()` (rejette champs inconnus, `performerId` interdit).

**Contexte:** AD-5 (contrat partagé), FR-21 (validation stricte 3 couches), AD-9. Le ack renvoie `{ ok:boolean, error?:code, issues?:ZodIssue[] }` (convention). `unsupported-version` (E13) et `invalid` (E8) consommés par l'UI. `performerId` est interdit dans le payload — le serveur l'attache (`socket.id`) en 2.7.

**Fichiers/modules concernés:** `apps/server/src/socket/services/ValidationService.ts`, mapping `ZodIssue` → codes stables, tests.

**Références:** PRD FR-10, FR-21 · Arch AD-5, AD-9 · UX E8 (`invalid`), E13 (`unsupported-version`).

**Acceptance Criteria:**
**Given** un `midi:event` valide
**When** `ValidationService.validate(event)`
**Then** retourne `{ ok:true, data: <MidiEvent validé> }`.

**Given** un event avec champ inconnu, hors-plage, ou `performerId` présent
**When** `validate`
**Then** retourne `{ ok:false, error:"invalid", issues:[...] }`.

**Given** un event avec `v !== 1`
**When** `validate`
**Then** retourne `{ ok:false, error:"unsupported-version", issues:[...] }`.

**Given** le schéma partagé
**When** importé côté serveur
**Then** il est identique au front (zéro dérive, source unique `@fmlw/shared`).

**Tests attendus:** Tests unitaires `ValidationService` : chaque type valide ; rejets (`invalid`, `unsupported-version`) avec `issues` ; `performerId` rejeté ; codes stables. Cible 100 % (NFR-16).

**Dépendances:** Story 1.2 (`MidiEventSchema`), Stories 2.4/2.5 (les 2 premières couches en place).

**Définition de terminé:** `ValidationService` 3 couches avec `safeParse` ; codes stables `invalid`/`unsupported-version` + `issues` ; schéma partagé identique front/back ; tests 100 %.

### Story 2.7: `RoomService` + `RelayService` adapter + handlers (`room:join/leave`, `midi:test`, `midi:event` broadcast + `srvTs`)

As a server developer,
I want the socket handlers for allowed events plus a RelayService adapter that broadcasts validated events to the room,
So that listeners receive the live MIDI stream and the relay is abstracted for a future Redis Streams swap.

**Objectif:** Handlers : `room:join` (join `fm-live-wire:main`, room imposée par le serveur — constante `@fmlw/shared`), `room:leave`, `midi:test` (echo/ack, joué localement côté listener), et `midi:event` (performer) : `validate` (2.6) → attache `performerId = socket.id` (jamais du payload) + `srvTs` (télémétrie) → `RelayService.broadcast(ROOM, event)` → ack `{ok:true}`. `RelayService` derrière une interface d'adapter (`broadcast(room, event)`) pour swap futur Redis Streams sans rewrite. `RoomService` gère le compteur de listeners (pour `/health`). Aucun handler `panic` côté serveur (AD-7).

**Contexte:** AD-2 (events listener autorisés limités), AD-6 (`RelayService` adapter), FR-10 (serveur attache `performerId`/`srvTs`), FR-11 (broadcast room), FR-18 (pas d'handler `midi:event` listener ni `panic`). `srvTs` ajouté pour télémétrie uniquement (pas de re-loging MVP). Pas de replay (AD-17).

**Fichiers/modules concernés:** `apps/server/src/socket/handlers/{roomEvents,controlEvents,performerEvents}.ts`, `apps/server/src/socket/services/{RoomService,RelayService}.ts` (interface adapter + impl in-memory `io.to(room).emit`).

**Références:** PRD FR-10, FR-11, FR-18, FR-24 (server half) · Arch AD-2, AD-6, AD-17.

**Acceptance Criteria:**
**Given** un listener émettant `room:join`
**When** le handler s'exécute
**Then** le socket rejoint `fm-live-wire:main` (room constante, imposée par le serveur) et `RoomService` incrémente le compteur listeners
**And** l'ack est `{ ok:true }`.

**Given** un performer owner émettant un `midi:event` valide
**When** le handler s'exécute
**Then** `ValidationService.validate` réussit, `performerId = socket.id` est attaché (pas lu du payload), `srvTs` est ajouté, l'event est broadcasté à `fm-live-wire:main`
**And** l'ack est `{ ok:true }`.

**Given** un `midi:event` invalide
**When** le handler s'exécute
**Then** l'ack est `{ ok:false, error, issues }` (de 2.6) et rien n'est broadcasté.

**Given** `RelayService`
**When** on swap l'implémentation (mock Redis adapter en test)
**Then** les handlers n'ont pas besoin de rewrite (interface `broadcast(room, event)` stable).

**Given** un listener émettant `midi:test`
**When** le handler s'exécute
**Then** l'ack `{ ok:true }` est renvoyé (le son est joué localement côté listener — Epic 4).

**Tests attendus:** Tests d'intégration in-process : listener `room:join` reçoit ensuite un `midi:event` broadcasté par un performer ; event invalide → ack d'erreur + non broadcasté ; `performerId`/`srvTs` attachés serveur ; `RoomService` compteur cohérent ; swap adapter mock passe sans rewrite des handlers.

**Dépendances:** Stories 2.3 (owner), 2.4 (gate), 2.5 (rate), 2.6 (validation).

**Définition de terminé:** Handlers `room:join/leave`, `midi:test`, `midi:event` en place ; `performerId`/`srvTs` attachés serveur ; broadcast vers `fm-live-wire:main` ; `RelayService` interface adapter (swap sans rewrite) ; `RoomService` compteur listeners ; aucun handler `panic` ; tests d'intégration passent.

### Story 2.8: Graceful shutdown + `/health` complet + logger structuré échantillonné

As a server developer,
I want a complete `/health` (real owner/listeners), graceful shutdown, and structured sampled logging,
So that the server is operable, drains cleanly, and logs without flooding on the MIDI flow.

**Objectif:** `/health` branche les vraies valeurs depuis `PerformerRegistry.isOwnerActive()` et `RoomService.getListenerCount()` → `{ ok:true, uptime, ownerActive: boolean, listeners: number }`. Graceful shutdown : sur signal (SIGTERM/SIGINT) → notify clients (`server:shutdown`), drain connexions, `io.close()` puis `http.close()`. Logger structuré JSON échantillonné : connexions/déconnexions, changements de room, erreurs de validation (échantillonnées 1/N avec `seq` + raison), rate-limit hits (compteur agrégé + flush périodique), Panic déclenché (note : Panic est local listener, le log Panic est côté listener — ici on loggue les events serveur pertinents), `LOG_MIDI=1` active le flux complet en dev.

**Contexte:** FR-28 (full `/health` `ownerActive`), FR-29 (graceful shutdown), FR-30 (logs échantillonnés), AD-18 (pas de log par event), AD-20 (shutdown + `/health` + env). `ownerActive` alimente le polling landing (Epic 6, UX-DR3/AC-U2). Pas de log par `midi:event` (AD-18).

**Fichiers/modules concernés:** `apps/server/src/http/routes/health.ts` (branche registry + roomService), `apps/server/src/app/shutdown.ts`, `apps/server/src/utils/logger.ts` (échantillonnage, `LOG_MIDI`), `apps/server/src/config/env.ts`.

**Références:** PRD FR-28, FR-29, FR-30 · Arch AD-18, AD-20 · UX AC-U2 (on-air polling).

**Acceptance Criteria:**
**Given** un owner actif et 3 listeners
**When** `GET /health`
**Then** la réponse est `{ ok:true, uptime, ownerActive:true, listeners:3 }`
**And** sans owner → `ownerActive:false`, `listeners:n`.

**Given** un signal `SIGTERM`
**When** le shutdown se déclenche
**Then** les clients sont notifiés, les connexions drainées, `io.close()` puis `http.close()` terminent proprement
**And** le process sort sans connexion orpheline.

**Given** un flux de 200 `midi:event`/s
**When** les events sont relayés
**Then** aucun log par event n'est produit (échantillonnage) ; seules connexions, room changes, erreurs validation (1/N), rate-limit hits (compteur agrégé) sont loggés
**And** `LOG_MIDI=1` active le flux complet en dev.

**Given** le logger
**When** une erreur de validation survient
**Then** un log structuré JSON échantillonné est produit avec `seq` + raison (pas un log par event).

**Tests attendus:** Test d'intégration `/health` avec registry+roomService (owner actif/inactif, compteur listeners) ; test de shutdown (notify + drain + close ordonné, timeout) ; test du logger échantillonné (pas de log par event, flush périodique, `LOG_MIDI=1` active le flux).

**Dépendances:** Stories 2.3 (`PerformerRegistry`), 2.7 (`RoomService`, handlers).

**Définition de terminé:** `/health` complet `{ ok, uptime, ownerActive, listeners }` branché sur registry + roomService ; graceful shutdown (notify + drain + `io.close`/`http.close`) ; logger structuré échantillonné (pas de log par event, `LOG_MIDI=1`) ; tests d'intégration passent.

---

**Epic 2 summary:** 8 stories, sequence 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 (each builds only on previous). Le modèle one-way est enforce côté serveur : rôle épinglé, owner unique (`performer:busy`), gate `forbidden` (+ déconnexion 3 tentatives), rate limit, validation 3 couches, broadcast via adapter. `/health` complet + shutdown + logs échantillonnés. Aucun handler `panic` (Panic est local listener, Epic 5).

---

## Epic 3: Web MIDI performer — capture & émission

**Goal:** Page `/performer` publique et statique (aucun secret dans le build) — saisie du token owner, compat navigateur, autorisation MIDI, sélection de l'entrée MIDI, capture native Web MIDI des 5 types d'événements, filtre SysEx performer, relay via Socket.IO avec ack, monitoring minimal en direct, gestion `performer:busy` et libération propre du slot. À l'issue, un performer peut diffuser en live vers la room et voit ses events partir.
**FRs covered:** FR-2 (UI), FR-4 (UI), FR-6, FR-7, FR-8 (performer filter), FR-9, FR-10 (payload)
**NFRs:** NFR-6, NFR-7, NFR-9 · **ADs:** AD-3, AD-8, AD-10 · **UX:** UX-DR2, UX-DR17, UX-DR18, UX-DR19, UX-DR22, UX-DR23, UX-DR24–28 (woven)

### Story 3.1: Page `/performer` (publique/statique) + `AdminTokenInput` + connect Socket.IO + `performer:busy` + `BrowserCompatGate`

As a performer (owner),
I want a public performer page that asks for my admin token, checks browser compatibility, and connects securely,
So that I can start a session without any secret baked into the build and see a clear error if a performer is already on air.

**Objectif:** Route `/performer` (page publique statique) ; `BrowserCompatGate` (feature-detection Web MIDI + HTTPS avant tout prompt ; écran terminal E1/E2 sinon) ; `AdminTokenInput` (« admin token », pas de `localStorage`, jamais dans l'URL) → connexion Socket.IO avec `auth: { role:"performer", token }` ; gestion `connect_error` : `performer:busy` → Alert terminal E9 (« Un performer est déjà connecté. Attendez la fin de sa session. », pas de retry, lien retour `/`) ; `invalid` → Alert E8 (« Admin token invalide. »). Rôle tag en-tête `PERFORMER` + intro panel.

**Contexte:** AD-10 (token serveur-only, saisie manuelle, jamais `VITE_*`, jamais `localStorage`, jamais dans l'URL). FR-2 (UI), FR-4 (UI `performer:busy`). UX-DR2 (role tag + intro), UX-DR5 (BrowserCompatGate), UX-DR17 (performer flow), UX-DR20 (verbatim `admin token`). Aucune capture MIDI ici (3.2/3.3).

**Fichiers/modules concernés:** `apps/web/src/features/performer/components/{BrowserCompatGate,AdminTokenInput,PerformerBusyAlert}.tsx`, `apps/web/src/features/performer/api/socket.ts` (Socket.IO client, `auth`), `apps/web/src/features/performer/index.ts`, `apps/web/src/app/router.tsx` (route `/performer`).

**Références:** PRD FR-2, FR-4, NFR-7, NFR-9 · Arch AD-3 (feature detection), AD-10 · UX UX-DR2, UX-DR5, UX-DR17, UX-DR20 (E8/E9).

**Acceptance Criteria:**
**Given** un navigateur sans Web MIDI (Safari) ou sans HTTPS
**When** j'ouvre `/performer`
**Then** un écran terminal s'affiche (« Chrome/Edge requis » / « Web MIDI nécessite HTTPS ») sans prompt MIDI
**And** aucun `requestMIDIAccess` n'est appelé.

**Given** un navigateur compatible
**When** je saisis un token et clique « Se connecter »
**Then** le client se connecte avec `auth: { role:"performer", token }` et le token n'est ni stocké en `localStorage` ni présent dans l'URL.

**Given** un token invalide
**When** connexion
**Then** une Alert « Admin token invalide. » s'affiche (E8) sans distinction de raison.

**Given** un owner déjà actif
**When** connexion avec un token valide
**Then** une Alert terminal « Un performer est déjà connecté. Attendez la fin de sa session. » s'affiche (E9, `performer:busy`), sans retry automatique, avec lien retour `/`.

**Given** le build frontend
**When** recherche de `OWNER_SECRET` ou de `VITE_*`
**Then** zéro occurrence (la page ne contient aucun secret).

**Tests attendus:** Tests (Vitest + jsdom) : `BrowserCompatGate` affiche l'écran terminal sur navigateur incompatible (mock `navigator.requestMIDIAccess` absent) ; `AdminTokenInput` ne persiste pas le token ; `connect_error` `performer:busy` → Alert terminal ; `invalid` → Alert. Pas de port matériel requis.

**Dépendances:** Stories 1.4 (web coque), 2.1/2.2/2.3 (serveur auth + `performer:busy`).

**Définition de terminé:** Route `/performer` publique statique ; `BrowserCompatGate` bloque avant prompt ; `AdminTokenInput` sans `localStorage`/URL ; connexion `auth` performer ; `performer:busy` (E9 terminal, pas de retry) et `invalid` (E8) gérés ; zéro secret dans le build ; tests passent.

### Story 3.2: `MidiAccessProvider` + sélection entrée MIDI (`MidiPortPicker` input) + hot-plug `onstatechange`

As a performer,
I want to grant MIDI access and pick my MIDI input from available ports with live hot-plug,
So that I can choose my keyboard or IAC bus and see ports appear/disappear without reloading.

**Objectif:** `MidiAccessProvider` (wrapper `requestMIDIAccess({ sysex:false })` au geste utilisateur — bouton « Connecter MIDI Input ») ; `MidiPortPicker` (input) listant `MIDIInputMap` (clavier USB ou IAC `FMLW → Dexed`) ; refresh live via `onstatechange` (pas de polling) ; permission refusée → Alert E3 + « Réessayer » ; état vide E4 (« Aucune entrée MIDI détectée. Branchez un clavier ou un bus IAC. » + refresh). Aucune capture/relay ici (3.3/3.4).

**Contexte:** AD-3 (native Web MIDI, `requestMIDIAccess({ sysex:false })`, feature-detection avant prompt déjà en 3.1). UX-DR6 (MidiPermissionButton), UX-DR18 (MidiPortPicker input), UX-DR23 (geste utilisateur requis, hot-plug `onstatechange`), UX-DR13 (empty state performer).

**Fichiers/modules concernés:** `apps/web/src/lib/midi-access.ts` (provider/wrapper), `apps/web/src/app/providers/MidiAccessProvider.tsx`, `apps/web/src/features/performer/components/{MidiPermissionButton,MidiPortPicker}.tsx`, hook `useMidiInputs`.

**Références:** PRD FR-6, NFR-6 · Arch AD-3 · UX UX-DR6, UX-DR18, UX-DR13 (E4), UX-DR23, UX-DR14 (E3).

**Acceptance Criteria:**
**Given** un navigateur compatible et MIDI non encore autorisé
**When** je clique « Connecter MIDI Input »
**Then** `requestMIDIAccess({ sysex:false })` est appelé au geste (jamais auto au load)
**And** `sysex` est `false`.

**Given** la permission MIDI refusée
**When** `NotAllowedError`
**Then** une Alert « Autorisation MIDI refusée. » + bouton « Réessayer » s'affichent (E3).

**Given** des ports d'entrée disponibles
**When** la liste se charge
**Then** `MidiPortPicker` liste les `MIDIInputMap` et permet la sélection.

**Given** un port branché/débranché en cours de session
**When** `onstatechange` se déclenche
**Then** la liste se rafraîchit en temps réel sans polling ni reload.

**Given** aucune entrée MIDI
**When** la `MIDIInputMap` est vide
**Then** une Alert info « Aucune entrée MIDI détectée. Branchez un clavier ou un bus IAC. » + bouton refresh s'affichent (E4, état vide, pas une erreur).

**Tests attendus:** Tests avec `web-midi-test` (mock `requestMIDIAccess`) : permission accordée → inputs listés ; permission refusée → E3 + retry ; hot-plug (`onstatechange`) ajoute/retire un port ; empty state E4. Pas de port matériel requis.

**Dépendances:** Story 3.1 (page + compat gate).

**Définition de terminé:** `MidiAccessProvider` + `MidiPortPicker` (input) ; `requestMIDIAccess({ sysex:false })` au geste ; hot-plug `onstatechange` ; E3 (permission refusée) et E4 (empty) gérés ; tests `web-midi-test` passent.

### Story 3.3: Capture Web MIDI → payload `MidiEvent` (5 types) + filtre SysEx (`0xF0`) + `seq` monotone + `ts`

As a performer,
I want my MIDI input captured into the shared `MidiEvent` contract for the 5 allowed types with SysEx filtered out,
So that only valid channel-voice events are relayed and SysEx never leaves my browser.

**Objectif:** Hook `useMidiInput` : `MIDIInput.onmessage` → décode `event.data` + `event.timeStamp` en `MidiEvent` pour les 5 types (`noteOn`, `noteOff`, `controlChange`, `programChange`, `pitchBend`) ; filtre SysEx (tout message `event.data[0] === 0xF0` n'est jamais envoyé — double défense, AD-8) ; `seq` uint32 monotone par performer ; `ts` = `event.timeStamp` (DOMHighResTimeStamp) ; `channel` 0–15 sur le wire (conversion UI 1–16 ↔ data 0–15 à l'edge si pertinent) ; `performerId` **absent** du payload (le serveur l'attache). `velocity 0` → `noteOff` (convention). Aucun emit réseau ici (3.4).

**Contexte:** AD-3 (capture `MIDIInput.onmessage` `event.data`/`event.timeStamp`), AD-5 (champs `MidiEvent`, `performerId` interdit), AD-8 (filtre SysEx performer, jamais affiché ni relayé), AD-12 (channel 0–15 wire). FR-7 (5 types), FR-8 (filtre performer), FR-10 (payload). La note « SysEx silencieusement filtré, jamais affiché ni relayé » apparaît dans le MonitoringPanel (3.4).

**Fichiers/modules concernés:** `apps/web/src/features/performer/hooks/useMidiInput.ts`, `apps/web/src/features/performer/lib/decode.ts` (bytes → `MidiEvent`), `apps/web/src/features/performer/lib/seq.ts` (compteur monotone).

**Références:** PRD FR-7, FR-8, FR-10, FR-15 (convention velocity 0) · Arch AD-3, AD-5, AD-8, AD-12.

**Acceptance Criteria:**
**Given** un `noteOn` reçu sur l'input (status `0x90|ch`, note, velocity)
**When** `useMidiInput` capture
**Then** un `MidiEvent` `{ v:1, type:"noteOn", channel:ch(0–15), roomId:"fm-live-wire:main", seq:<n>, ts:<timeStamp>, note, velocity }` est produit
**And** `performerId` n'est pas présent dans le payload.

**Given** un `noteOn` avec velocity 0
**When** capture
**Then** il est produit comme `noteOff` (convention velocity 0 = noteOff).

**Given** un message SysEx (`event.data[0] === 0xF0`)
**When** capture
**Then** il est silencieusement filtré : aucun `MidiEvent` produit, jamais envoyé, jamais affiché.

**Given** une séquence d'events
**When** capture
**Then** `seq` est uint32 monotone croissant par performer (et wrap uint32 défini).

**Given** un type hors des 5 (ex. polyphonicKeyPressure, ou un status inconnu)
**When** capture
**Then** il est ignoré (seuls les 5 types sont relayés).

**Tests attendus:** Tests unitaires `decode.ts` : chaque type (noteOn/noteOff/cc/programChange/pitchBend) depuis bytes ; velocity 0 → noteOff ; pitchBend lsb/msb → valeur 14-bit ; rejet SysEx ; rejet types hors 5 ; `seq` monotone + wrap uint32 ; `performerId` absent. Cible 100 % (NFR-16).

**Dépendances:** Stories 1.2 (`MidiEvent`), 3.2 (sélection input).

**Définition de terminé:** `useMidiInput` capture les 5 types en `MidiEvent` ; SysEx filtré (jamais envoyé/affiché) ; `seq` monotone uint32 ; `ts` = `event.timeStamp` ; `performerId` absent du payload ; types hors 5 ignorés ; tests unitaires 100 %.

### Story 3.4: Relay performer : `socket.emit("midi:event")` + ack + `MonitoringPanel`

As a performer,
I want my captured events relayed to the server with ack feedback and a live monitoring panel,
So that I see my events leave in real time and know if some are rejected or rate-limited.

**Objectif:** `socket.emit("midi:event", payload, ack)` pour chaque `MidiEvent` capturé ; gestion ack : `{ok:true}` → incrémente compteur `events envoyés` ; `{ok:false, error:"invalid"}` → incrémente `erreurs récentes` (Alert implicite, pas bloquant) ; `rate:limited` → `RateLimitAlert` (E12, « Limite de débit atteinte — certains events ont été ignorés par le serveur. »). `MonitoringPanel` : StatusPill « Diffusion active » ; dernier événement MIDI ligne mono `TYPE · CH · VAL` (5 types) ; compteurs en pied `events envoyés` / `listeners` (nb reçu du serveur) / `erreurs récentes` ; rappel permanent « Seul le MIDI est diffusé, jamais l'audio. » ; note « SysEx silencieusement filtré, jamais affiché ni relayé » (FR-8). Compteurs pluralisés `Intl.PluralRules('fr-FR')`.

**Contexte:** FR-9 (monitoring minimal), UX-DR19 (MonitoringPanel minimal confirmé Q-UX2 : pas de latence agrégée listeners), UX-DR17 (étape 5), UX-DR21 (pluralization), UX-DR22 (mono data `JetBrains Mono`). `listeners` count vient du serveur (broadcast d'état ou lu via un event serveur — minimally, le compteur listeners est maintenu côté performer via un event serveur type `listeners:update` ou déduit ; ici on consomme la valeur fournie par le serveur). AD-18 (côté serveur logs échantillonnés ; côté client on affiche les compteurs).

**Fichiers/modules concernés:** `apps/web/src/features/performer/api/relay.ts` (emit + ack), `apps/web/src/features/performer/components/{MonitoringPanel,RateLimitAlert}.tsx`, store Zustand `performerStore` (compteurs, dernier event, listeners).

**Références:** PRD FR-9, FR-22 (UI rate:limited) · Arch AD-18 · UX UX-DR17, UX-DR19, UX-DR21, UX-DR22, UX-DR14 (E12).

**Acceptance Criteria:**
**Given** un performer owner avec une entrée sélectionnée et des events capturés
**When** un event est émis via `socket.emit("midi:event", payload, ack)`
**Then** l'ack `{ok:true}` incrémente `events envoyés` et la ligne « dernier événement » affiche `TYPE · CH · VAL`.

**Given** un ack `{ok:false, error:"invalid"}`
**When** reçu
**Then** `erreurs récentes` est incrémenté (feedback non bloquant).

**Given** un ack `rate:limited` (ou event serveur `rate:limited`)
**When** reçu
**Then** une `RateLimitAlert` « Limite de débit atteinte — certains events ont été ignorés par le serveur. » s'affiche (E12).

**Given** le MonitoringPanel
**When** affiché
**Then** il montre StatusPill « Diffusion active », le dernier event, les compteurs `events envoyés` / `listeners` / `erreurs récentes`, et le rappel permanent « Seul le MIDI est diffusé, jamais l'audio. » + note SysEx filtré
**And** les compteurs sont pluralisés (`Intl.PluralRules('fr-FR')`).

**Given** les 5 types d'events
**When** ils passent
**Then** la ligne « dernier événement » sait afficher chacun (noteOn/noteOff/cc/programChange/pitchBend).

**Tests attendus:** Tests (Vitest + jsdom + mock socket) : emit + ack `{ok:true}` incrémente ; `invalid` incrémente erreurs ; `rate:limited` affiche l'Alert ; MonitoringPanel rendu avec compteurs pluralisés ; ligne dernier event pour les 5 types.

**Dépendances:** Stories 3.3 (capture), 2.7 (handler `midi:event` + ack), 2.5 (rate limit serveur).

**Définition de terminé:** `socket.emit("midi:event")` avec ack ; ack `ok`/`invalid`/`rate:limited` gérés ; `MonitoringPanel` minimal (dernier event + compteurs + rappel MIDI-pas-audio + note SysEx) ; compteurs pluralisés ; tests passent.

### Story 3.5: Déconnexion / libération slot + reconnect + `BackToHome` propre

As a performer,
I want my disconnect to cleanly release the owner slot and the page to handle reconnection and a clean return home,
So that no ghost owner slot remains and listeners are notified correctly.

**Objectif:** À la fermeture d'onglet / déconnexion explicite, le serveur libère le slot owner (déjà en 2.3) et notifie les listeners ; l'UI performer gère la reconnexion Socket.IO (backoff, indicateur visible, pas de dialogue bloquant) ; `BackToHome` (« ← Retour ») déclenche une déconnexion propre (libération slot owner) **avant** navigation vers `/` (résout Q-UX10, évite tout slot owner fantôme). Message de fin « Déconnexion : slot owner libéré. Les listeners voient « Performer déconnecté ». ». Pas de dialogue de confirmation au départ (déconnexion = fin naturelle).

**Contexte:** FR-5 (libération + notification), UX-DR1 (BackToHome déconnexion propre), UX-DR23 (reconnexion auto backoff, indicateur visible, pas de dialogue bloquant), Q-UX10. AD-2/AD-17 (slot libéré, pas de replay). La libération serveur est en 2.3 ; cette story garantit le **déclenchement propre côté client** + gestion reconnect + retour.

**Fichiers/modules concernés:** `apps/web/src/features/performer/components/{BackToHome,ConnectionStatus}.tsx`, `apps/web/src/features/performer/api/socket.ts` (handlers `disconnect`/`reconnect`, `disconnect` propre avant navigation), `performerStore`.

**Références:** PRD FR-5, FR-24 (server half) · Arch AD-2, AD-17 · UX UX-DR1, UX-DR23, Q-UX10.

**Acceptance Criteria:**
**Given** un performer owner actif
**When** il ferme l'onglet ou se déconnecte
**Then** le serveur libère le slot owner (2.3) et notifie les listeners `performer:disconnected`
**And** l'UI performer affiche le message de fin « slot owner libéré… ».

**Given** une perte de connexion réseau
**When** Socket.IO se déconnecte puis revient
**Then** une reconnexion auto (backoff) avec indicateur visible s'opère, sans dialogue bloquant
**And** à la reconnexion, le flux live reprend sans rejouer le passé.

**Given** un clic sur « ← Retour »
**When** navigation vers `/`
**Then** une déconnexion propre (libération slot owner) est déclenchée **avant** la navigation
**And** aucun slot owner fantôme ne subsiste (un nouveau performer peut prendre le slot).

**Given** le slot libéré
**When** un nouveau performer tente de se connecter
**Then** il peut prendre le slot (pas de `performer:busy` fantôme).

**Tests attendus:** Tests (mock socket) : déconnexion déclenche la libération (vérifié via état serveur mock / event `performer:disconnected`) ; reconnect backoff avec indicateur ; `BackToHome` déconnecte avant navigation (assertion d'ordre) ; pas de slot fantôme après retour.

**Dépendances:** Stories 3.1 (page), 2.3 (libération serveur).

**Définition de terminé:** Déconnexion fermeture onglet → slot libéré + notification ; reconnexion auto backoff + indicateur + reprise sans replay ; `BackToHome` déconnecte proprement avant navigation (pas de slot fantôme) ; tests passent.

---

**Epic 3 summary:** 5 stories, sequence 3.1 → 3.2 → 3.3 → 3.4 → 3.5 (each builds only on previous). Le performer peut diffuser en live : page publique sans secret, compat gate, sélection entrée + hot-plug, capture 5 types avec filtre SysEx, relay + ack, monitoring minimal, gestion `performer:busy` et libération propre du slot. Aucune logique serveur (consomme Epic 2).

---

## Epic 4: Listener — sortie MIDI, scheduler & remappage canal

**Goal:** Page `/listener` — compat navigateur, autorisation MIDI, sélection d'une **sortie MIDI réelle**, sélection du canal de sortie avec **remappage forcé**, `room:join`/`room:leave`, réception `midi:event`, mapping wire→bytes, scheduler minimal `send(data, performance.now()+LOOKAHEAD_MS)`, note de test standardisée, et les états listener principaux. À l'issue, un listener peut rejoindre un flux live et entendre la performance sur son synthé via sa sortie réelle. **Pas de Mock Output, pas de Panic, pas de Force Panic, pas de backpressure avancée dans cet epic** (Epic 5).
**FRs covered:** FR-3 (UI), FR-11 (listener half), FR-12 (real output half), FR-13, FR-14, FR-15 (applied), FR-18 (listener half)
**NFRs:** NFR-1, NFR-5, NFR-6, NFR-7, NFR-8 · **ADs:** AD-3, AD-11 (lookahead only), AD-12 · **UX:** UX-DR2, UX-DR4–14 (réception/erreurs hors backpressure), UX-DR22, UX-DR23, UX-DR24–28 (woven)

### Story 4.1: Page `/listener` + `BrowserCompatGate` (feature detection + HTTPS) + `MidiPermissionButton`

As a listener,
I want a public listener page that checks browser compatibility and asks for MIDI access on my click,
So that I never hit a MIDI prompt on an unsupported browser and I control when MIDI access is requested.

**Objectif:** Route `/listener` (page publique, pas de compte) ; `BrowserCompatGate` (feature-detection Web MIDI + HTTPS **avant** tout prompt ; écran terminal E1 « Chrome/Edge requis » / E2 « Web MIDI nécessite HTTPS » sinon) ; `MidiPermissionButton` (« Connecter MIDI ») déclenche `requestMIDIAccess({ sysex:false })` au geste utilisateur (jamais auto au load) ; permission refusée → Alert E3 + « Réessayer » ; StatusPill `connected` « MIDI autorisé » après succès. Rôle tag en-tête `LISTENER` + intro panel (« Vous recevez des événements MIDI en direct. Votre synthé FM génère le son. »).

**Contexte:** AD-3 (native Web MIDI, feature-detection avant prompt), UX-DR2 (role tag + intro symétrique AC-U16b), UX-DR4 (6-step onboarding, état avant action), UX-DR5 (BrowserCompatGate), UX-DR6 (MidiPermissionButton), UX-DR23 (geste requis). Pas de sélection sortie/canal ici (4.2), pas de join (4.3).

**Fichiers/modules concernés:** `apps/web/src/features/listener/components/{BrowserCompatGate,MidiPermissionButton}.tsx`, `apps/web/src/app/providers/MidiAccessProvider.tsx` (réutilisé), `apps/web/src/app/router.tsx` (route `/listener`), `listenerStore`.

**Références:** PRD FR-3, NFR-6, NFR-7, NFR-8 · Arch AD-3 · UX UX-DR2, UX-DR4, UX-DR5, UX-DR6, UX-DR14 (E1/E2/E3), UX-DR23.

**Acceptance Criteria:**
**Given** un navigateur sans Web MIDI (Safari) ou sans HTTPS
**When** j'ouvre `/listener`
**Then** un écran terminal s'affiche (« Chrome/Edge requis » / « Web MIDI nécessite HTTPS ») sans prompt MIDI
**And** `requestMIDIAccess` n'est pas appelé.

**Given** un navigateur compatible
**When** je clique « Connecter MIDI »
**Then** `requestMIDIAccess({ sysex:false })` est appelé au geste (jamais au load).

**Given** la permission refusée (`NotAllowedError`)
**When** déclenchée
**Then** une Alert « Autorisation MIDI refusée. » + bouton « Réessayer » s'affichent (E3).

**Given** la permission accordée
**When** succès
**Then** un StatusPill `connected` « MIDI autorisé » s'affiche et l'état passe à l'étape suivante.

**Given** la page `/listener`
**When** affichée
**Then** le tag `LISTENER` et l'intro panel « Vous recevez des événements MIDI en direct. Votre synthé FM génère le son. » sont présents.

**Tests attendus:** Tests (Vitest + jsdom + `web-midi-test`) : écran terminal sur navigateur incompatible (E1/E2) ; `requestMIDIAccess` au geste seulement ; permission refusée → E3 + retry ; succès → StatusPill `connected`.

**Dépendances:** Stories 1.4 (web coque), 2.7 (handlers `room:*`/`midi:test` disponibles côté serveur — non requis pour 4.1 mais présents).

**Définition de terminé:** Route `/listener` publique ; `BrowserCompatGate` bloque avant prompt (E1/E2) ; `MidiPermissionButton` au geste `requestMIDIAccess({ sysex:false })` ; E3 géré ; StatusPill `connected` ; role tag + intro ; tests passent.

### Story 4.2: `MidiPortPicker` sortie (ports réels) + `ChannelSelector` + logique de remappage

As a listener,
I want to pick my real MIDI output and choose my synth's output channel,
So that all received events are forced onto my chosen output and channel (my single-timbral synth hears everything on one channel).

**Objectif:** `MidiPortPicker` (output) listant `MIDIOutputMap` — **ports réels uniquement** (l'option « Mock / Debug » est ajoutée en Epic 5) ; refresh live via `onstatechange` (hot-plug) ; état vide E4 (« Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester. » — ici le hint Mock mentionne la disponibilité Epic 5, mais l'option n'est pas sélectionnable). `ChannelSelector` 1–16 (UI) → 0–15 (edge), grille 16 créneaux, **défaut canal 1** (Q-UX7), tooltip expliquant le remappage forcé. Logique pure `remapChannel(event, channel)` : remplace le canal de l'event par celui choisi (0–15 data) avant encodage. Sélection dépendante : `Rejoindre` sera désactivé tant qu'aucune sortie n'est choisie (4.3).

**Contexte:** AD-12 (remappage forcé, canal d'origine remplacé, conversion UI 1–16 ↔ data 0–15 à l'edge), FR-12 (real output half), FR-13 (remap), UX-DR7 (MidiPortPicker output — Mock en Epic 5), UX-DR8 (ChannelSelector, défaut 1, tooltip), UX-DR23 (hot-plug `onstatechange`), UX-DR13 (empty state), AC-U5 (remap explicite via tooltip).

**Fichiers/modules concernés:** `apps/web/src/features/listener/components/{MidiPortPicker,ChannelSelector}.tsx`, `apps/web/src/features/listener/lib/remap.ts` (`remapChannel`), `apps/web/src/features/listener/hooks/useMidiOutputs.ts`, `listenerStore` (output sélectionné, canal).

**Références:** PRD FR-12, FR-13 · Arch AD-12 · UX UX-DR7, UX-DR8, UX-DR13 (E4), UX-DR23, AC-U5.

**Acceptance Criteria:**
**Given** des ports de sortie disponibles
**When** la liste se charge
**Then** `MidiPortPicker` liste les `MIDIOutputMap` réels (pas d'option Mock sélectionnable ici).

**Given** un port branché/débranché en session
**When** `onstatechange`
**Then** la liste se rafraîchit en temps réel (pas de polling).

**Given** aucune sortie MIDI
**When** la `MIDIOutputMap` est vide
**Then** une Alert info « Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester. » s'affiche (E4, état vide).

**Given** le `ChannelSelector`
**When** affiché
**Then** il propose 1–16 (UI), défaut **canal 1** sélectionné, conversion 0–15 à l'edge, tooltip « Le canal ici = la sortie vers votre synthé. Le flux d'origine est ignoré : tout passe sur ce canal. ».

**Given** un `MidiEvent` entrant sur canal 5 et un listener sur canal 1
**When** `remapChannel(event, 0)` (canal 1 data)
**Then** l'event retourné a `channel === 0` (canal d'origine remplacé).

**Tests attendus:** Tests unitaires `remap.ts` : remap remplace le canal (0–15) sur les 5 types ; conversion UI 1–16 ↔ data 0–15 ; bornes (canal 1 → 0, canal 16 → 15) ; pureté. Tests composant (`web-midi-test`) : `MidiPortPicker` liste les outputs ; hot-plug ; empty state E4 ; `ChannelSelector` défaut 1 + tooltip. Cible 100 % sur `remap.ts` (NFR-16).

**Dépendances:** Story 4.1 (page + autorisation MIDI).

**Définition de terminé:** `MidiPortPicker` (output, ports réels, hot-plug, E4) ; `ChannelSelector` 1–16 → 0–15, défaut 1, tooltip remap ; `remapChannel` pure (canal d'origine remplacé) ; tests unitaires 100 % + composant passent.

### Story 4.3: `room:join` + réception `midi:event` + remappage + `toMidiBytes` + `send(data, performance.now()+LOOKAHEAD_MS)` (scheduler minimal)

As a listener,
I want to join the room, receive the live MIDI stream, remap it to my channel, and schedule it to my output with a lookahead,
So that I hear the performance on my synth with driver-level anti-jitter timing.

**Objectif:** `JoinButton` (« Rejoindre le flux ») → `socket.emit("room:join")` `fm-live-wire:main` (room constante) ; réception `midi:event` → `remapChannel(event, chosenChannel)` → `toMidiBytes(remapped)` → `MIDIOutput.send(data, performance.now() + LOOKAHEAD_MS)` (scheduler **minimal** : lookahead seulement, **pas de buffer cap, pas de fallback/drop** — Epic 5). `LOOKAHEAD_MS = 40` (default `config/runtime.ts`). `JoinButton` désactivé tant qu'aucune sortie choisie (hint « Choisissez une sortie MIDI pour rejoindre. » — AC-U3). Après join, le bouton devient « Quitter le flux » (`room:leave`). `srvTs - ts` disponible (télémétrie) — affichage latence reporté (Epic 5 `LatencyStat` n'apparaît qu'en alerte).

**Contexte:** AD-11 (scheduler `send(data, performance.now()+LOOKAHEAD_MS)`, lookahead 40 ms, driver-level — **version minimale**, backpressure en Epic 5), AD-12 (remap avant send), FR-11 (listener join + receive), FR-15 (mapping appliqué), UX-DR10 (JoinButton), UX-DR4 (étape 6). `toMidiBytes` vient de `@fmlw/shared` (Story 1.3). Le scheduler ne dépend pas de Mock (utilise la `MIDIOutput` réelle sélectionnée).

**Fichiers/modules concernés:** `apps/web/src/features/listener/components/JoinButton.tsx`, `apps/web/src/features/listener/api/socket.ts` (handlers `midi:event`, `room:join/leave`), `apps/web/src/features/listener/lib/scheduler.ts` (**minimal** : `schedule(data)` → `output.send(data, performance.now()+LOOKAHEAD_MS)`), `apps/web/src/features/listener/lib/encode.ts` (applique `remapChannel` + `toMidiBytes`), `listenerStore`.

**Références:** PRD FR-11, FR-13, FR-15, NFR-1, NFR-5 · Arch AD-3 (`MIDIOutput.send(data, ts)`), AD-11 (lookahead minimal), AD-12 · UX UX-DR4, UX-DR10, AC-U3.

**Acceptance Criteria:**
**Given** un listener avec sortie + canal choisis
**When** il clique « Rejoindre le flux »
**Then** `room:join` `fm-live-wire:main` est émis et le socket rejoint la room
**And** le bouton devient « Quitter le flux ».

**Given** aucune sortie choisie
**When** le bouton est affiché
**Then** « Rejoindre le flux » est désactivé avec le hint « Choisissez une sortie MIDI pour rejoindre. » (AC-U3).

**Given** un `midi:event` reçu (ex. noteOn canal 5) et un listener sur canal 1
**When** l'event est reçu
**Then** il est remappé sur canal 0 (1 data), encodé via `toMidiBytes`, et `MIDIOutput.send(bytes, performance.now()+LOOKAHEAD_MS)` est appelé
**And** le status byte est `0x90` (canal 0, noteOn).

**Given** le scheduler minimal
**When** un event arrive
**Then** `target = performance.now() + 40` (LOOKAHEAD_MS) est utilisé comme timestamp `send`
**And** aucun buffer cap / fallback / drop n'est appliqué (Epic 5).

**Given** un clic sur « Quitter le flux »
**When** déclenché
**Then** `room:leave` est émis et le socket quitte la room.

**Tests attendus:** Tests unitaires `scheduler.ts` (minimal) : `schedule(data)` calcule `target = performance.now()+LOOKAHEAD_MS` et appelle `output.send(data, target)` (avec un mock `MIDIOutput` stub — pas le Mock UI, un stub de test) ; `encode.ts` : remap + `toMidiBytes` chaîne correcte. Tests d'intégration (mock socket) : `room:join` → réception `midi:event` → `send` appelé sur l'output mock avec le bon canal remappé. Pas de port matériel requis (stub).

**Dépendances:** Stories 1.3 (`toMidiBytes`), 4.2 (output + canal + remap), 2.7 (handler serveur `room:join`/broadcast).

**Définition de terminé:** `room:join`/`room:leave` ; réception `midi:event` → remap → `toMidiBytes` → `send(data, performance.now()+LOOKAHEAD_MS)` ; scheduler minimal (lookahead only, pas de cap/fallback) ; `JoinButton` désactivé sans sortie (AC-U3) ; bouton « Quitter le flux » ; tests unitaires + intégration passent.

### Story 4.4: `TestNoteButton` + `StatusPill` + `MidiActivityIndicator` + `Quitter le flux`

As a listener,
I want a test note, a connection/flow status pill, an activity indicator, and a leave control,
So that I can validate my local chain, see the stream state at a glance, and leave cleanly.

**Objectif:** `TestNoteButton` (« Note de test ») : émet `midi:test` (listener→serveur autorisé) et joue localement `[0x90|ch, 60, 100]` puis noteOff après **300 ms** (**standard Q-UX6 : note 60, velocity 100, durée 300 ms**) sur la sortie/canal choisis ; désactivé tant qu'aucune sortie + canal (hint « Choisissez une sortie et un canal pour tester. ») ; toast « Note de test envoyée. » ; en Mock (Epic 5) les bytes s'affichent — ici port réel. `StatusPill` (variantes waiting/connected/error) reflète l'état du flux (idle / waiting performer / réception active). `MidiActivityIndicator` pulse `connected` sur noteOn entrant (respecte `prefers-reduced-motion`). « Quitter le flux » (`room:leave`) déjà en 4.3, ici confirmé avec retour à l'état idle.

**Contexte:** FR-14 (Note de test), UX-DR9 (TestNoteButton standard 60/100/300ms, désactivé sans sortie+canal), UX-DR11 (StatusPill), UX-DR12 (MidiActivityIndicator primaire, pulse sur noteOn, reduced-motion), UX-DR23 (toast transient), AD-3. `midi:test` est un event listener→serveur autorisé (FR-18, 2.7). `NoteVisualizer` (secondaire) et `LatencyStat` (alerte-only) sont Epic 5/6 — non requis ici.

**Fichiers/modules concernés:** `apps/web/src/features/listener/components/{TestNoteButton,StatusPill,MidiActivityIndicator}.tsx`, `apps/web/src/features/listener/lib/test-note.ts` (note 60/vel 100/300ms), `listenerStore`.

**Références:** PRD FR-14, FR-18 · Arch AD-3 · UX UX-DR9, UX-DR11, UX-DR12, UX-DR23, AC-U4, UX-DR26 (reduced-motion).

**Acceptance Criteria:**
**Given** une sortie + un canal choisis
**When** je clique « Note de test »
**Then** `[0x90|ch, 60, 100]` est envoyé sur la sortie/canal choisis, suivi d'un noteOff (60, vel 0) après **300 ms**
**And** `midi:test` est émis vers le serveur (event autorisé) et un toast « Note de test envoyée. » s'affiche (AC-U4).

**Given** aucune sortie ou aucun canal
**When** le bouton est affiché
**Then** « Note de test » est désactivé avec le hint « Choisissez une sortie et un canal pour tester. ».

**Given** le flux en réception active
**When** des noteOn arrivent
**Then** `StatusPill` affiche `connected` « ● Réception active — {n} events reçus » et `MidiActivityIndicator` pulse sur chaque noteOn.

**Given** `prefers-reduced-motion` actif
**When** l'activité pulse
**Then** la pulse est désactivée (changement d'opacité statique) (AC-U19).

**Given** le flux en attente (rejoint, pas de performer)
**When** affiché
**Then** `StatusPill` `waiting` « En attente du performer… » + `MidiActivityIndicator` éteint.

**Given** un clic sur « Quitter le flux »
**When** déclenché
**Then** `room:leave` est émis et l'UI revient à l'état idle.

**Tests attendus:** Tests `test-note.ts` (note 60, vel 100, noteOff après 300ms — avec timer fake) ; Tests composant : `TestNoteButton` désactivé sans sortie/canal ; `StatusPill` waiting/connected ; `MidiActivityIndicator` pulse sur noteOn + reduced-motion ; toast affiché.

**Dépendances:** Stories 4.2, 4.3 (output/canal/join/scheduler).

**Définition de terminé:** `TestNoteButton` (60/100/300ms, désactivé sans sortie+canal, toast) ; `StatusPill` waiting/connected ; `MidiActivityIndicator` pulse + reduced-motion ; « Quitter le flux » → idle ; tests passent.

### Story 4.5: États listener (vides + E7/E13) + server-down pill + reconnexion auto

As a listener,
I want the main listener states (empty, waiting for performer, unsupported version) and a clear server-disconnect/reconnect indicator,
So that I always know what state I'm in and never mistake a missing performer or a server drop for a broken app.

**Objectif:** États vides (UX-DR13) : landing côté listener — « En attente du performer… » (E7, `ownerActive:false` ou état socket), réception active 0 event « ● Réception active — 0 event reçu », Mock vide (Epic 5). États d'erreur gérés ici : E7 (performer absent / `performer:disconnected` → « Performer déconnecté »), E13 (`unsupported-version` → « Version de protocole incompatible. Rafraîchissez la page. »). Server-down : `socket.disconnect`/`connect_error` → StatusPill `waiting` « Serveur déconnecté. Reconnexion automatique en cours… » + reconnexion auto (backoff Socket.IO, indicateur visible, pas de dialogue bloquant). **E5 (sortie perdue), E6 (Panic reste actif serveur down), E10 (late alert) sont Epic 5** — non requis ici (le server-down pill est posé, la mention « Panic reste actif » vient avec Panic en Epic 5).

**Contexte:** UX-DR13 (empty states), UX-DR14 (E7, E13, E6 server-down — pill posée ici), UX-DR23 (reconnexion auto backoff, indicateur visible, pas de dialogue bloquant), UX-DR11 (StatusPill mapping). `performer:disconnected` vient du serveur (Epic 2.3). `unsupported-version` (E13) vient de la validation (Epic 2.6).

**Fichiers/modules concernés:** `apps/web/src/features/listener/components/{EmptyState,ServerDownAlert}.tsx`, `apps/web/src/features/listener/api/socket.ts` (handlers `performer:disconnected`, `disconnect`, `connect_error`, `unsupported-version`), `listenerStore` (état flux : idle/waiting/active/server-down).

**Références:** PRD FR-5 (notification), FR-24 (reconnect, server half) · Arch AD-17 (reprise sans replay) · UX UX-DR11, UX-DR13, UX-DR14 (E7/E13/E6 pill), UX-DR23, AC-U10 (server-down pill — sans la clause Panic active, Epic 5).

**Acceptance Criteria:**
**Given** un listener rejoint sans performer
**When** l'état est waiting
**Then** StatusPill `waiting` « En attente du performer… » + `MidiActivityIndicator` éteint + hint « Dès que le performer démarre, le flux arrive. » (état vide, pas une erreur).

**Given** un performer qui déconnecte
**When** `performer:disconnected` reçu
**Then** StatusPill `waiting` « Performer déconnecté » s'affiche (E7).

**Given** une version de protocole incompatible (`unsupported-version`)
**When** reçue
**Then** une Alert « Version de protocole incompatible. Rafraîchissez la page. » s'affiche (E13).

**Given** une réception active avec 0 event
**When** l'état est actif
**Then** « ● Réception active — 0 event reçu » s'affiche (l'état connecté suffit, pas d'erreur).

**Given** une perte de connexion serveur
**When** `disconnect`/`connect_error`
**Then** StatusPill `waiting` « Serveur déconnecté. Reconnexion automatique en cours… » + reconnexion auto backoff, indicateur visible, pas de dialogue bloquant
**And** à la reconnexion, le flux live reprend sans rejouer le passé (pas de replay).

**Tests attendus:** Tests (mock socket) : état waiting (pas de performer) ; `performer:disconnected` → E7 ; `unsupported-version` → E13 ; réception active 0 event ; server-down → pill + reconnect backoff ; reprise sans replay.

**Dépendances:** Stories 4.3, 4.4 (join + StatusPill), 2.3 (`performer:disconnected`), 2.6 (`unsupported-version`).

**Définition de terminé:** États vides (waiting, active 0 event) + E7 (`performer:disconnected`) + E13 (`unsupported-version`) gérés ; server-down StatusPill + reconnexion auto backoff (indicateur visible, pas de dialogue) + reprise sans replay ; tests passent. (E5/E6-Panic/E10 restent Epic 5.)

---

**Epic 4 summary:** 5 stories, sequence 4.1 → 4.2 → 4.3 → 4.4 → 4.5 (each builds only on previous). Le listener peut rejoindre un flux live et entendre la performance sur sa sortie MIDI réelle : compat gate, autorisation MIDI, sortie réelle + canal remappé forcé, `room:join`/`leave`, réception `midi:event` → remap → `toMidiBytes` → `send(data, performance.now()+LOOKAHEAD_MS)` (scheduler minimal lookahead), note de test 60/100/300ms, états principaux + server-down/reconnect. **Pas de Mock/Panic/Force Panic/backpressure** (Epic 5). Le scheduler `lib/scheduler.ts` sera étendu en Epic 5 (BUFFER_CAP, fallback/drop, fail-safe) — churn justifié (audio live d'abord, résilience ensuite).

---

## Epic 5: Panic local, Force Panic, Mock Output & backpressure

**Goal:** Résilience et sécurité musicale du listener. Mock Output à chaud (pipeline testable sans périphérique), Panic local **indépendant de Socket.IO** (fonctionne serveur down), Force Panic opt-in confirmé, backpressure borné (BUFFER_CAP + fallback/drop par type), et fail-safe musical (arrêt scheduler sur déconnexion/perte port, reprise live sans replay). À l'issue, une note coincée ou un serveur down ne laissent jamais le listener sans issue, et le pipeline est testable en CI.
**FRs covered:** FR-12 (Mock half), FR-16, FR-17, FR-24 (listener half), FR-25, FR-26, FR-27
**NFRs:** NFR-2, NFR-19 · **ADs:** AD-7, AD-11 (backpressure), AD-14, AD-17 · **UX:** UX-DR7 (Mock hot switch + MockByteStream), UX-DR12, UX-DR13 (Mock empty), UX-DR14 (E5/E6/E10), UX-DR15, UX-DR16

### Story 5.1: `MockMidiOutput` + `MockByteStream` + option Mock/Debug dans le picker + switch à chaud

As a listener (and as a CI pipeline),
I want a Mock / Debug output that visualizes bytes on screen and is selectable at any time,
So that I can test the socket→scheduler→encode chain without any MIDI device and switch to Mock even after selecting a real port.

**Objectif:** `MockMidiOutput` implémente `{ send(bytes, ts) }` → visualise les bytes à l'écran (aucun son). Ajouter l'option « Mock / Debug » dans `MidiPortPicker` (output) à côté des ports réels ; **switch Mock à chaud autorisé même après sélection d'un port réel** (Q-UX9). `MockByteStream` : liste monospace scrollante, lignes colorées par type (`noteOn`/`noteOff`/cc/program/pitchBend). États : Mock actif → badge `mock` « Sortie Mock / Debug — les bytes s'affichent à l'écran, aucun son n'est produit. » ; Mock actif sans flux → `MockByteStream` vide + placeholder mono « — en attente d'événements — ». Le scheduler (4.3) envoie vers le `MockMidiOutput` sélectionné comme vers tout output — pipeline socket→scheduler→encode testable en CI.

**Contexte:** AD-14 (Mock Output hot, `{ send(bytes, ts) }`, switch à chaud après port réel), FR-12 (Mock half), NFR-19 (pipeline CI/demos sans IAC/Dexed). UX-DR7 (Mock option + hot switch Q-UX9), UX-DR12 (`MockByteStream`), UX-DR13 (Mock empty state). Le Mock est une alternative d'output interchangeable avec un `MIDIOutput` réel — le scheduler ne fait pas la différence.

**Fichiers/modules concernés:** `apps/web/src/features/listener/lib/mock-output.ts` (`MockMidiOutput`), `apps/web/src/features/listener/components/{MockByteStream,MockBadge}.tsx`, extension de `MidiPortPicker` (4.2) pour l'option Mock, `listenerStore` (output = réel | mock).

**Références:** PRD FR-12, NFR-19 · Arch AD-14 · UX UX-DR7, UX-DR12, UX-DR13, UX-DR22 (mono bytes).

**Acceptance Criteria:**
**Given** le picker output
**When** affiché
**Then** l'option « Mock / Debug » est disponible à côté des ports réels.

**Given** un port réel sélectionné et actif
**When** je switch vers « Mock / Debug » à chaud
**Then** la sortie devient `MockMidiOutput` sans reload et les prochains events s'affichent en bytes (Q-UX9).

**Given** Mock sélectionné et un event reçu (ex. noteOn ch1 60 100)
**When** `MockMidiOutput.send(bytes, ts)`
**Then** `MockByteStream` ajoute une ligne mono colorée « noteOn · ch1 · 60 · 100 » et aucun son n'est produit
**And** un badge `mock` « Sortie Mock / Debug — les bytes s'affichent à l'écran, aucun son n'est produit. » est visible.

**Given** Mock sélectionné, aucun event
**When** en attente
**Then** `MockByteStream` affiche le placeholder « — en attente d'événements — ».

**Given** le pipeline en CI (jsdom + mock socket)
**When** un `midi:event` est reçu
**Then** le chemin socket → scheduler → encode → `MockMidiOutput.send` est exercé sans périphérique (NFR-19).

**Tests attendus:** Tests `MockMidiOutput` (capture les `send(bytes,ts)`) ; tests composant `MockByteStream` (rendu lignes par type, placeholder vide) ; test d'intégration : switch à chaud réel→Mock ; test pipeline socket→scheduler→encode→Mock sans port matériel (NFR-19, base CI pour Epic 6).

**Dépendances:** Stories 4.2 (picker output), 4.3 (scheduler/encode).

**Définition de terminé:** `MockMidiOutput` (`{send(bytes,ts)}`) + `MockByteStream` (lignes colorées par type, placeholder vide) ; option « Mock / Debug » dans le picker ; switch à chaud après port réel (Q-UX9) ; badge Mock ; pipeline testable sans périphérique ; tests passent.

### Story 5.2: Panic local (CC 64→120→121→123 ×16) + `PanicButton` sticky + indépendance Socket.IO

As a listener,
I want a local Panic button that cuts all stuck notes on my output and works even when the server is down,
So that I am never left without a musical escape hatch (the product's safety promise, S-2).

**Objectif:** `features/listener/lib/panic.ts` **ne dépend pas de l'état de connexion Socket.IO** — uniquement de la `MIDIOutput` locale sélectionnée (réelle ou Mock). Panic = CC 64 → 120 → 121 → 123 × 16 canaux = 64 messages, `send(data, performance.now())` (immédiat, pas de lookahead). `PanicButton` : 44px rouge, **sticky en bas du viewport** (jamais masqué par un dialogue ou le scroll), **toujours actif** (jamais désactivé), même serveur down. Hint « Coupe toutes les notes sur votre sortie locale. Fonctionne même si le serveur est injoignable. ». Utilise la sortie/canal sélectionnés (panic sur la sortie locale ; le sweep CC couvre les 16 canaux).

**Contexte:** AD-7 (Panic local, `panic.ts` indépendant Socket.IO, CC 64→120→121→123 ×16 = 64 messages, `send(data, performance.now())`, aucun handler panic serveur, fonctionne serveur down), FR-16, FR-18 (pas de handler panic serveur). UX-DR15 (PanicButton sticky, toujours actif). AC-U13. S-2 (climax : kill backend → Panic coupe le son). E6 (server-down → Panic reste actif, déjà pillé en 4.5, ici confirmé fonctionnel).

**Fichiers/modules concernés:** `apps/web/src/features/listener/lib/panic.ts` (séquence CC ×16, indépendante Socket.IO), `apps/web/src/features/listener/components/PanicButton.tsx`, `listenerStore` (output sélectionné).

**Références:** PRD FR-16, FR-18, S-2 · Arch AD-7 · UX UX-DR15, UX-DR14 (E6), AC-U13.

**Acceptance Criteria:**
**Given** une sortie MIDI locale sélectionnée (réelle ou Mock) et une note coincée
**When** je clique `Panic`
**Then** la séquence CC 64 → 120 → 121 → 123 est envoyée sur les 16 canaux (64 messages) via `send(data, performance.now())` et le son s'arrête.

**Given** le serveur déconnecté (kill backend)
**When** je clique `Panic`
**Then** le Panic fonctionne (coupe le son) — `panic.ts` n'utilise aucune API Socket.IO (S-2, AC-U13).

**Given** le `PanicButton`
**When** affiché dans n'importe quel état (idle, active, server-down, dialog Force Panic ouvert)
**Then** il est sticky en bas du viewport, visible, et **jamais désactivé**.

**Given** `panic.ts`
**When** testé en isolation
**Then** il ne référence aucune dépendance Socket.IO (import-check) et produit exactement 64 messages dans l'ordre CC 64/120/121/123 ×16.

**Tests attendus:** Tests unitaires `panic.ts` : 64 messages, ordre CC 64→120→121→123 ×16, `send(data, performance.now())`, indépendance Socket.IO (aucun import socket) ; test composant : `PanicButton` sticky + toujours actif ; test manuel (Epic 6, étape 7) : kill backend → Panic coupe le son (S-2).

**Dépendances:** Story 4.2 (output sélectionné ; Panic utilise la sortie locale).

**Définition de terminé:** `panic.ts` indépendant Socket.IO (CC ×16 = 64 messages, `send(data, performance.now())`) ; `PanicButton` sticky viewport + toujours actif (même serveur down) ; fonctionne serveur déconnecté (S-2/AC-U13) ; tests unitaires 100 % sur `panic.ts`.

### Story 5.3: Force Panic opt-in + `ForcePanicDialog` confirmation + noteOff sweep 128×16 (2048)

As a listener,
I want an opt-in Force Panic that requires confirmation before sending a large noteOff sweep,
So that I can clear a stubborn stuck note after a normal Panic without accidentally firing 2048 messages.

**Objectif:** `ForcePanicButton` (bouton secondaire, opt-in) → ouvre `ForcePanicDialog` de confirmation affichant « Panic étendu : ~1–2 s. Confirmer ? » **avant** tout envoi (FR-17, AC-U14). Sur confirmation → noteOff sweep 128 notes × 16 canaux = 2048 messages sur la sortie locale sélectionnée. Toast « Force Panic envoyé. ». Intro copy « Force Panic envoie un noteOff sur les 128 notes × 16 canaux (2048 messages). Utile si une note reste coincée après un Panic normal. ». Indépendant Socket.IO comme Panic (5.2). Annuler → aucun envoi.

**Contexte:** AD-7 (Force Panic opt-in, confirmation Dialog, noteOff sweep 128×16 = 2048 messages), FR-17. UX-DR16 (ForcePanicButton + ForcePanicDialog, intro + confirm + toast), UX-DR23 (confirmation modale uniquement pour Force Panic). AC-U14 (confirmation avant envoi). `panic.ts` étendu (ou `force-panic.ts`) — même indépendance Socket.IO.

**Fichiers/modules concernés:** `apps/web/src/features/listener/lib/force-panic.ts` (sweep 128×16), `apps/web/src/features/listener/components/{ForcePanicButton,ForcePanicDialog}.tsx`, `listenerStore`.

**Références:** PRD FR-17 · Arch AD-7 · UX UX-DR16, UX-DR23, AC-U14, UX-DR20 (verbatim « Panic étendu : ~1–2 s »).

**Acceptance Criteria:**
**Given** une sortie locale sélectionnée
**When** je clique `ForcePanicButton`
**Then** le `ForcePanicDialog` s'ouvre avec « Panic étendu : ~1–2 s. Confirmer ? » et **aucun** message n'est envoyé avant confirmation (AC-U14).

**Given** le dialog ouvert
**When** je clique « Annuler »
**Then** le dialog se ferme et aucun noteOff n'est envoyé.

**Given** le dialog ouvert
**When** je clique « Confirmer »
**Then** un noteOff sweep 128 notes × 16 canaux = 2048 messages est envoyé sur la sortie locale et un toast « Force Panic envoyé. » s'affiche.

**Given** le serveur déconnecté
**When** Force Panic confirmé
**Then** le sweep fonctionne (indépendance Socket.IO, comme 5.2).

**Given** `force-panic.ts`
**When** testé en isolation
**Then** il produit exactement 2048 noteOff (128×16) et ne référence aucune dépendance Socket.IO.

**Tests attendus:** Tests unitaires `force-panic.ts` (2048 noteOff, 128×16, indépendance Socket.IO) ; tests composant : dialog ouvert avant envoi, Annuler → aucun envoi, Confirmer → sweep + toast.

**Dépendances:** Story 5.2 (Panic local, indépendance Socket.IO, sortie locale).

**Définition de terminé:** `ForcePanicButton` + `ForcePanicDialog` (confirmation « Panic étendu : ~1–2 s » avant envoi, AC-U14) ; sweep 128×16 = 2048 noteOff ; toast ; Annuler → aucun envoi ; indépendant Socket.IO ; tests unitaires + composant passent.

### Story 5.4: Backpressure — buffer borné 256 + drop oldest + fallback/drop par type (MAX_LATE_MS=200) + `LateAlert` local

As a listener,
I want a bounded buffer with per-type fallback/drop and a local late warning,
So that a slow connection never builds an infinite queue or loses critical notes silently.

**Objectif:** Étendre `lib/scheduler.ts` (4.3 minimal) : buffer borné `BUFFER_CAP = 256` ; au-delà → **drop oldest** + warning UI local. Latence : si `srvTs - ts > MAX_LATE_MS` (200) → **fallback immédiat** pour noteOn/noteOff (`send(data, performance.now())`, ne pas perdre la note) ; **drop acceptable** pour CC haute-fréquence. `LateAlert` : warning **local pur** (jamais d'event serveur `listener:overload`, FR-27) « ⚠ Flux en retard / connexion instable — latence {ms} ms » (E10) ; `LatencyStat` n'apparaît qu'en alerte (> MAX_LATE_MS), pas par défaut. Compteur de fallbacks (télémétrie locale). Politique par type figée (FR-26) ; `LOOKAHEAD_MS`/`MAX_LATE_MS` tunables (constantes configurables).

**Contexte:** AD-11 (BUFFER_CAP=256 drop oldest + warning, MAX_LATE_MS=200 fallback noteOn/noteOff / drop CC HF, pas de re-loging, srvTs télémétrie), FR-25 (buffer borné 256), FR-26 (fallback/drop par type), FR-27 (`listener:overload` local pur). UX-DR12 (`LatencyStat` alerte-only), UX-DR14 (E10 `LateAlert` local). NFR-2 (< ~5 % fallbacks). Scaffolding (BUFFER_CAP=256, MAX_LATE_MS=200, LOOKAHEAD_MS=40).

**Fichiers/modules concernés:** `apps/web/src/features/listener/lib/scheduler.ts` (extension : buffer cap, late detection, fallback/drop), `apps/web/src/features/listener/components/{LateAlert,LatencyStat}.tsx`, `listenerStore` (fallback counter, overload flag).

**Références:** PRD FR-25, FR-26, FR-27, NFR-2 · Arch AD-11 · UX UX-DR12, UX-DR14 (E10), AC-U11.

**Acceptance Criteria:**
**Given** un flux de > 256 events en attente
**When** le buffer dépasse `BUFFER_CAP`
**Then** les events les plus anciens sont droppés (drop oldest) et un warning UI local s'affiche (pas de queue infinie, FR-25).

**Given** un noteOn/noteOff avec `srvTs - ts > 200` (MAX_LATE_MS)
**When** traité
**Then** **fallback immédiat** : `send(data, performance.now())` (la note n'est pas perdue, FR-26)
**And** le compteur de fallbacks est incrémenté.

**Given** un CC haute-fréquence avec `srvTs - ts > 200`
**When** traité
**Then** le drop est acceptable (event droppé, pas de fallback).

**Given** une latence > MAX_LATE_MS ou buffer > BUFFER_CAP
**When** la condition se présente
**Then** une `LateAlert` « ⚠ Flux en retard / connexion instable — latence {ms} ms » s'affiche (E10), **local pur**, et aucun event serveur `listener:overload` n'est émis (FR-27, AC-U11).

**Given** une réception calme (latence < MAX_LATE_MS)
**When** affichée
**Then** aucune `LatencyStat` n'est visible par défaut (n'apparaît qu'en alerte).

**Given** les constantes
**When** configuration
**Then** `LOOKAHEAD_MS`/`MAX_LATE_MS`/`BUFFER_CAP` sont tunables (constantes configurables) et la politique fallback/drop par type est figée.

**Tests attendus:** Tests unitaires `scheduler.ts` (extension) : cap 256 → drop oldest + warning ; late noteOn/noteOff → fallback immédiat ; late CC HF → drop ; `LateAlert` local pur (aucun emit serveur) ; compteur fallback ; Bornes (ts exactement à MAX_LATE_MS). Cible 100 % (NFR-16).

**Dépendances:** Story 4.3 (scheduler minimal à étendre), 4.5 (server-down/reconnect).

**Définition de terminé:** Scheduler étendu (BUFFER_CAP=256 drop oldest + warning, MAX_LATE_MS=200 fallback noteOn/noteOff / drop CC HF) ; `LateAlert` local pur (FR-27, aucun event serveur) ; `LatencyStat` alerte-only ; compteur fallback ; constantes tunables ; tests unitaires 100 %.

### Story 5.5: Fail-safe musical — arrêt scheduler sur déconnexion/perte port + reprise live sans replay

As a listener,
I want the scheduler to stop cleanly on disconnect or output loss and resume the live stream on reconnect without replaying the past,
So that no orphan notes hang and I never get a stale backlog replayed after a drop.

**Objectif:** À la déconnexion listener (Socket.IO `disconnect`) ou à la perte de la sortie MIDI (`onstatechange` port `connection:"closed"` ou `send()` lève `InvalidStateError`), le scheduler **arrête d'envoyer** (pas de bytes en vol, pas de notes orphelines). À la reconnexion (Socket.IO connection state recovery), **reprise du flux live sans re-loger le passé** (pas de replay — AD-17). E5 (sortie déconnectée en session) → Alert `late` « Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie. » + fail-safe (scheduler arrêté) + `MidiPortPicker` ré-ouvert. E6 (server-down) → Panic reste actif (déjà 5.2, ici confirmé avec le scheduler arrêté). Pas de compensation/re-loging avancé (hors MVP).

**Contexte:** AD-17 (fail-safe musical : scheduler arrête sur déconnexion/perte port, pas de bytes en vol ; reconnexion = reprise live sans replay), FR-24 (listener half). UX-DR14 (E5 sortie perdue → Alert + fail-safe ; E6 server-down → Panic actif), AC-U9 (output-lost → Alert + fail-safe), AC-U10 (server-down → pill + Panic actif). Pas de re-loging MVP (AD-11).

**Fichiers/modules concernés:** `apps/web/src/features/listener/lib/scheduler.ts` (stop/drain, no in-flight bytes), `apps/web/src/features/listener/hooks/useOutputState.ts` (`onstatechange` port lost, `InvalidStateError`), `apps/web/src/features/listener/components/OutputLostAlert.tsx`, `apps/web/src/features/listener/api/socket.ts` (reconnect → resume live, pas de replay), `listenerStore`.

**Références:** PRD FR-24, NFR-19 · Arch AD-11 (pas de re-loging), AD-17 · UX UX-DR14 (E5/E6), AC-U9, AC-U10.

**Acceptance Criteria:**
**Given** un listener en réception active
**When** il se déconnecte (Socket.IO `disconnect`)
**Then** le scheduler arrête d'envoyer (pas de bytes en vol, pas de notes orphelines).

**Given** une sortie MIDI perdue en session (`onstatechange` closed ou `InvalidStateError`)
**When** détectée
**Then** le scheduler arrête d'envoyer (fail-safe) et une Alert « Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie. » s'affiche (E5, AC-U9) + `MidiPortPicker` ré-ouvert.

**Given** une reconnexion Socket.IO
**When** le flux reprend
**Then** la reprise est **live** sans rejouer les events manqués (pas de replay, AD-17).

**Given** le serveur down
**When** l'état server-down
**Then** le scheduler est arrêté (pas de bytes en vol) et le Panic reste actif (E6, AC-U10).

**Given** le fail-safe
**When** testé
**Then** aucun byte n'est envoyé après l'événement d'arrêt (drain propre, pas de note orpheline).

**Tests attendus:** Tests unitaires/intégration `scheduler.ts` : stop sur disconnect → aucun `send` ultérieur ; port lost → stop + Alert E5 ; reconnect → reprise live, pas de replay (vérifier qu'aucun event antérieur n'est rejoué) ; server-down → scheduler arrêté + Panic actif.

**Dépendances:** Stories 4.3 (scheduler), 4.5 (server-down/reconnect), 5.2 (Panic actif serveur down), 5.4 (buffer scheduler).

**Définition de terminé:** Scheduler arrête sur disconnect/perte port (pas de bytes en vol/orphelins) ; E5 (sortie perdue) → Alert + fail-safe + picker ré-ouvert (AC-U9) ; reconnect → reprise live sans replay (AD-17) ; E6 server-down → scheduler arrêté + Panic actif (AC-U10) ; tests passent.

---

**Epic 5 summary:** 5 stories, sequence 5.1 → 5.2 → 5.3 → 5.4 → 5.5 (each builds only on previous ; 5.5 depends on 5.4). Résilience et sécurité musicale : Mock Output à chaud (pipeline CI-ready), Panic local indépendant Socket.IO (S-2), Force Panic opt-in confirmé, backpressure borné (BUFFER_CAP=256 + fallback/drop par type, LateAlert local pur), fail-safe musical (arrêt scheduler + reprise sans replay). `lib/scheduler.ts` étendu depuis la version minimale d'Epic 4 — churn justifié (livrer l'audio live d'abord, durcir ensuite). Aucune logique serveur ajoutée (Panic est 100 % local listener, conforme AD-7).

---

## Epic 6: UX finale, tests, validation manuelle & déploiement MVP

**Goal:** Assembler les 3 surfaces + polish UX final (landing, microcopy, tokens visuels DESIGN.md), passer la suite de tests complète (unitaires 100 % + intégration in-process + `web-midi-test`), exécuter la validation manuelle IAC → Dexed → MIDI Monitor, vérifier zéro-secret + ADRs + 10 invariants, produire le build final, déployer le MVP HTTPS mono-domaine, et valider la checklist MVP avant la première session live. À l'issue, le MVP est déployé, testé, et prêt pour une session live réelle (S-10).
**FRs covered:** FR-28 (on-air), FR-29 (deploy verify), FR-30 (logs verify)
**NFRs:** NFR-8, NFR-9, NFR-16, NFR-17, NFR-18, NFR-20 · **ADs:** AD-18, AD-19, AD-20 · **UX:** UX-DR1, UX-DR3, UX-DR20, UX-DR21, UX-DR22, UX-DR24–28 · AC-U1–AC-U21 · S-1–S-10

### Story 6.1: Landing `/` (role-picker + on-air polling `ownerActive`) + assemblage 3 surfaces + `BackToHome` propre

As a visitor,
I want a simple landing page that tells me what the product is, shows whether someone is on air, and lets me pick a role,
So that I understand the MIDI-not-audio model in seconds and reach the right surface without confusion.

**Objectif:** Landing `/` : nom du projet + tagline (« Radio live de contrôle MIDI. Le son naît chez vous, sur votre synthé. »), indicateur *On air* via **polling léger** `GET /health` (`ownerActive: boolean`) — pas de temps réel sur la landing (Q-UX5, AC-U2) — « ● On air » (pill amber pulse) / « ○ Hors antenne » (pill muted), deux boutons « Je diffuse (performer) » / « J'écoute (listener) ». Pas de hero marketing. Assemblage final des 3 surfaces (`/`, `/listener`, `/performer`) ; `BackToHome` (« ← Retour ») disponible des deux côtés avec **déconnexion propre avant navigation** (listener `room:leave`, performer libération slot owner — Q-UX10, déjà en 3.5/4.x, ici unifié et vérifié sur les 3 surfaces). Footer « Chrome/Edge · HTTPS · Web MIDI ».

**Contexte:** UX-DR1 (3 surfaces, pas de nav transverse, retour propre), UX-DR3 (landing role-picker + on-air polling), AC-U2 (on-air reflète l'état réel via polling `/health` `ownerActive`). AD-20 (`/health` `ownerActive`). DESIGN.md : landing centrée max 720px, boutons `control_height_lg` 44px, `on_air` amber `#F2A93B`, `pulse_on_air 1.6s` (respecte reduced-motion).

**Fichiers/modules concernés:** `apps/web/src/features/landing/{components/{RolePicker,OnAirIndicator,BackToHome}.tsx,api/health.ts}` (polling léger), `apps/web/src/app/router.tsx` (route `/`), `apps/web/src/app/layouts`.

**Références:** PRD FR-28 (on-air) · Arch AD-20 · UX UX-DR1, UX-DR3, UX-DR13 (landing empty « Hors antenne »), AC-U2 · DESIGN.md (landing layout, on_air token, pulse).

**Acceptance Criteria:**
**Given** la landing `/`
**When** un performer est actif
**Then** l'indicateur affiche « ● On air » (pill amber) via polling `GET /health` `ownerActive:true` (AC-U2).

**Given** la landing `/`
**When** aucun performer
**Then** l'indicateur affiche « ○ Hors antenne » (pill muted) et les boutons restent actifs (le listener peut rejoindre et attendre).

**Given** un clic sur « Je diffuse (performer) » / « J'écoute (listener) »
**When** navigation
**Then** l'utilisateur arrive sur `/performer` / `/listener` respectivement.

**Given** un `BackToHome` depuis `/listener` ou `/performer`
**When** clic
**Then** une déconnexion propre (`room:leave` / libération slot owner) est déclenchée **avant** la navigation vers `/` (pas de slot fantôme, Q-UX10).

**Given** `prefers-reduced-motion`
**When** on-air pulse
**Then** la pulse est désactivée (changement d'opacité statique).

**Tests attendus:** Tests composant : `OnAirIndicator` reflète `ownerActive:true/false` (mock `fetch /health`) ; `RolePicker` navigue vers les bonnes routes ; `BackToHome` déclenche la déconnexion avant navigation (assertion d'ordre) ; reduced-motion désactive la pulse.

**Dépendances:** Stories 1.4 (router), 2.8 (`/health` `ownerActive`), 3.5/4.3 (`BackToHome`/`room:leave`/libération slot).

**Définition de terminé:** Landing `/` (role-picker + on-air polling `ownerActive` + tagline + footer) ; 3 surfaces assemblées ; `BackToHome` propre des deux côtés (déconnexion avant navigation) ; reduced-motion respecté ; tests passent.

### Story 6.2: Polish UX visuel + microcopy verbatim + pluralization + role tags + intros (tokens DESIGN.md)

As a user,
I want the final visual polish and faithful microcopy across all surfaces,
So that the app feels like a coherent "live studio" console and every label matches the PRD verbatim.

**Objectif:** Appliquer les tokens DESIGN.md (`live studio` sombre) : palette sémantique (`bg #0A0B0D`, `surface`, `on_air #F2A93B`, `connected #3DD68C`, `danger_fill #E11D2E` pour Panic, `info #36BFFA` pour Mock), typo Inter / `JetBrains Mono` (mono réservé aux données MIDI/techniques), boutons 44px Panic/Rejoindre, pills `rounded.pill`, alertes bordure gauche 3px. Microcopy verbatim audit (UX-DR20) : `admin token`, `Rejoindre le flux`, `Note de test`, `Panic`/`Panic local`, `Force Panic`, `Panic étendu : ~1–2 s`, `Performer déconnecté`, `Chrome/Edge requis`, `Mock / Debug`. Pluralization `Intl.PluralRules('fr-FR')` sur tous les compteurs. Role tags en-tête (`LISTENER`/`PERFORMER`) + intros panel symétriques (MIDI-pas-audio, AC-U16/AC-U16b). Pas de hero marketing, pas de dégradés/glassmorphism.

**Contexte:** UX-DR2 (role tags + intros), UX-DR20 (verbatim), UX-DR21 (pluralization), UX-DR22 (mono/Inter + couleurs sémantiques). DESIGN.md (tous tokens, Do/Don'ts). Cette story consolide le polish visuel qui était en defaults shadcn pendant les epics 3–5.

**Fichiers/modules concernés:** `apps/web/tailwind.config` (tokens → CSS variables), `apps/web/src/shared/tokens.css` (design tokens), `apps/web/src/shared/i18n.ts` (`Intl.PluralRules('fr-FR')`), composants globaux (Button/Alert/Badge/StatusPill/Card), `features/{listener,performer,landing}` (application des tokens + microcopy audit).

**Références:** UX UX-DR2, UX-DR20, UX-DR21, UX-DR22, AC-U16, AC-U16b · DESIGN.md (Colors, Typography, Components, Do/Don'ts).

**Acceptance Criteria:**
**Given** les 3 surfaces
**When** affichées
**Then** la palette `live studio` sombre est appliquée (bg/surface/on_air/connected/danger_fill/info) et le mono `JetBrains Mono` est réservé aux données MIDI/techniques (bytes, canal, valeur, latence, compteurs).

**Given** le `PanicButton`
**When** affiché
**Then** il utilise `danger_fill #E11D2E` + texte blanc (AA 4.6:1), 44px, icône stop.

**Given** les compteurs (`events reçus`, `events envoyés`, `listeners`, `erreurs`)
**When** affichés
**Then** ils sont pluralisés via `Intl.PluralRules('fr-FR')` (« 1 event reçu » / « 7 events reçus »).

**Given** les labels verbatim du PRD
**When** audit
**Then** chaque label correspond exactement (pas de reformulation) — `admin token`, `Rejoindre le flux`, `Note de test`, `Panic`, `Force Panic`, `Panic étendu : ~1–2 s`, `Performer déconnecté`, `Chrome/Edge requis`, `Mock / Debug`.

**Given** `/listener` et `/performer`
**When** affichés
**Then** le tag de rôle (`LISTENER`/`PERFORMER`) et l'intro panel (MIDI-pas-audio, symétrique) sont présents (AC-U16/AC-U16b).

**Given** les alertes
**When** affichées
**Then** elles ont une bordure gauche 3px colorée (info cyan / late amber / danger red) + icône + texte.

**Tests attendus:** Tests (Vitest + jsdom) : pluralization `Intl.PluralRules` (singulier/pluriel sur 0/1/7) ; audit microcopy (snapshot ou assertions sur les libellés verbatim) ; tokens appliqués (classe/CSS var présentes). Pas de regression visuelle majeure (review manuel).

**Dépendances:** Epics 3–5 (UI existe), 6.1 (landing).

**Définition de terminé:** Tokens DESIGN.md appliqués (palette sombre, mono réservé données, 44px Panic/Rejoindre, alertes bordure gauche) ; microcopy verbatim audit (zéro reformulation) ; pluralization `Intl.PluralRules('fr-FR')` ; role tags + intros symétriques (AC-U16/AC-U16b) ; tests passent.

### Story 6.3: Audit accessibilité complet — contraste, clavier + focus, `ChannelSelector` radiogroup, `aria-live`, reduced-motion, VoiceOver

As a user (including keyboard and screen-reader users),
I want full keyboard operability, visible focus, semantic patterns, aria-live state announcements, and reduced-motion support,
So that I can use the app without a mouse and hear critical state changes via screen reader.

**Objectif:** A11y complet (UX-DR24–28, AC-U18–AC-U20) : contraste ≥ 4.5:1 (`danger_fill #E11D2E` AA 4.6:1 pour Panic texte blanc, `ink.muted #898F98` AA sur surface_2) ; clavier complet, ordre de tab = flux guidé, focus ring visible (`on_air`) ; `ChannelSelector` en `radiogroup` (flèches + `aria-checked` + icône check, pas couleur seule) ; `aria-live="polite"` sur `StatusPill` / `LateAlert` / `Alert` (changements d'état connecté/déconnecté/erreur/retard/panic) ; flux MIDI brut (`MockByteStream`, `NoteVisualizer`, `MonitoringPanel`) **exclu** d'aria-live (trop verbeux) ; `prefers-reduced-motion` désactive pulses ; VoiceOver (macOS) testé sur états critiques.

**Contexte:** UX-DR24 (contraste, `danger_fill`, `ink.muted`), UX-DR25 (clavier + focus + radiogroup), UX-DR26 (reduced-motion), UX-DR27 (labels + aria-live), UX-DR28 (aria-live régions + VoiceOver). AC-U18/AC-U19/AC-U20. DESIGN.md `danger_fill #E11D2E`, `ink.muted #898F98`. Le `ChannelSelector` a été posé en 4.2 — ici on s'assure qu'il est un `radiogroup` accessible.

**Fichiers/modules concernés:** `apps/web/src/features/listener/components/ChannelSelector.tsx` (radiogroup a11y), `StatusPill.tsx`/`LateAlert.tsx`/`Alert` (aria-live), focus rings globaux, tests a11y (`@axe-core/react` ou équivalent), doc `docs/a11y-voiceover-checklist.md`.

**Références:** UX UX-DR24–28, AC-U18, AC-U19, AC-U20 · DESIGN.md (danger_fill, ink.muted) · Wcag AA.

**Acceptance Criteria:**
**Given** tout texte actionnable
**When** mesure de contraste
**Then** ≥ 4.5:1 (AA) ; Panic `danger_fill #E11D2E` + texte blanc = 4.6:1 ; `ink.muted` sur surface_2 = AA.

**Given** la navigation clavier
**When** tab à travers `/listener`
**Then** tous les contrôles sont atteignables et opérables, ordre de tab = flux guidé, focus ring visible (`on_air`) (AC-U18).

**Given** le `ChannelSelector`
**When** navigation clavier
**Then** il se comporte comme un `radiogroup` (flèches haut/bas/gauche/droite, `aria-checked` sur l'actif, icône check — pas couleur seule) (UX-DR25).

**Given** un changement d'état (connecté/déconnecté/erreur/retard/panic)
**When** il survient
**Then** `aria-live="polite"` annonce le changement sur `StatusPill`/`LateAlert`/`Alert` (AC-U20)
**And** le flux MIDI brut (`MockByteStream`/`NoteVisualizer`/`MonitoringPanel`) n'est **pas** en aria-live.

**Given** `prefers-reduced-motion`
**When** pulses on-air/MIDI
**Then** elles sont désactivées (opacité statique), warning retard reste visible (AC-U19).

**Given** VoiceOver (macOS) activé sur `/listener`
**When** navigation clavier + déconnexion serveur + Panic
**Then** les états critiques sont annoncés vocalement (procédure de test documentée, AC-U20).

**Tests attendus:** Tests automatisés a11y (`@axe-core/react`) sur les 3 surfaces (zéro violation critique) ; test `ChannelSelector` radiogroup (keyboard nav, `aria-checked`) ; test `aria-live` présent sur régions d'état + absent sur flux MIDI ; test reduced-motion ; checklist VoiceOver (manuel, sign-off).

**Dépendances:** Stories 6.1, 6.2 (UI + polish en place), 4.x/5.x (composants concernés).

**Définition de terminé:** Contraste AA partout (`danger_fill`/`ink.muted`) ; clavier complet + focus visible + ordre logique ; `ChannelSelector` radiogroup accessible ; `aria-live` sur régions d'état (pas sur flux MIDI) ; reduced-motion ; VoiceOver checklist signée (AC-U20) ; tests a11x automatisés passent.

### Story 6.4: Tests unitaires 100 % (mapping, panic, scheduler, schéma, registry, rate limit) + couverture CI

As a developer,
I want 100 % unit test coverage on the critical modules with CI enforcement,
So that regressions on mapping/panic/scheduler/schema/registry/rate-limit are caught automatically.

**Objectif:** Consolidater/ compléter les tests unitaires (déjà amorcés au fil des epics) pour atteindre **100 %** sur : wire→bytes mapping (`toMidiBytes`), Panic (`panic.ts`/`force-panic.ts`), scheduler (`scheduler.ts` minimal + backpressure), schéma (`MidiEventSchema`/`ValidationService`), owner registry (`PerformerRegistry`), rate limit (`tokenBucket`). Vitest + jsdom. Couverture CI (seuil 100 % sur ces modules). `MockMidiOutput`/`web-midi-test` pour les tests sans périphérique.

**Contexte:** NFR-16 (100 % unit sur ces modules), AD-19 (Vitest + jsdom + `web-midi-test`). Les tests ont été écrits story par story ; cette story consolide, comble les trous, et met en place le seuil CI.

**Fichiers/modules concernés:** `apps/*/src/**/__tests__/*.test.ts`, `vitest.config.ts` (coverage thresholds), CI workflow (`.github/workflows/` ou équivalent) coverage 100 % sur les modules listés.

**Références:** PRD NFR-16, S-8 · Arch AD-19.

**Acceptance Criteria:**
**Given** les modules critiques (mapping, panic, scheduler, schéma, registry, rate limit)
**When** `pnpm test --coverage`
**Then** la couverture est **100 %** sur ces modules
**And** le seuil CI échoue en dessous.

**Given** la CI
**When** un push/PR
**Then** les tests unitaires tournent et bloquent le merge si coverage < 100 % sur les modules listés ou si un test échoue.

**Given** les tests
**When** exécutés
**Then** aucun port matériel n'est requis (`MockMidiOutput`/`web-midi-test`).

**Tests attendus:** Suite unitaire complète verte ; coverage 100 % sur les 6 modules ; CI green.

**Dépendances:** Epics 1–5 (modules existent avec tests amorcés).

**Définition de terminé:** Coverage 100 % sur mapping/panic/scheduler/schéma/registry/rate-limit ; seuil CI en place ; suite verte sans périphérique ; CI green (S-8).

### Story 6.5: Tests d'intégration Socket.IO in-process + `web-midi-test` (join/relay/forbidden/busy)

As a developer,
I want in-process Socket.IO integration tests covering the one-way model end-to-end,
So that the relay, role enforcement, owner-unique, and validation behave correctly without a real server.

**Objectif:** Tests d'intégration Socket.IO **in-process** (server + client dans le même process Vitest) couvrant : listener `room:join` reçoit un `midi:event` broadcasté par un performer ; event invalide → ack d'erreur + non broadcasté ; listener émet `midi:event` → `forbidden` + déconnexion après 3 ; 2ᵉ performer → `performer:busy` ; `performer:disconnected` notifié aux listeners ; origin non allowlistée rejetée ; `rate:limited` au-delà du burst. Mock Web MIDI via `web-midi-test`. Scénarios `join/relay/forbidden/busy`.

**Contexte:** NFR-17 (Socket.IO in-process + `web-midi-test`), AD-19. Valide le modèle one-way (S-4 : listeners read-only 100 %).

**Fichiers/modules concernés:** `apps/server/src/__tests__/integration/*.test.ts` (in-process), `apps/web/src/__tests__/integration/*.test.ts` (client + `web-midi-test`), helpers de test in-process.

**Références:** PRD NFR-17, S-3, S-4, S-5 · Arch AD-2, AD-19.

**Acceptance Criteria:**
**Given** un performer + un listener in-process
**When** le performer émet un `midi:event` valide
**Then** le listener (après `room:join`) reçoit l'event broadcasté avec `performerId`/`srvTs` attachés serveur.

**Given** un listener émettant `midi:event`
**When** 1ʳᵉ tentative
**Then** `forbidden` ; après 3 → déconnexion (S-4).

**Given** un owner actif + un 2ᵉ performer valide
**When** connexion
**Then** `performer:busy` (S-3).

**Given** un `midi:event` invalide (champ inconnu / `v !== 1` / SysEx)
**When** envoyé
**Then** ack d'erreur + non broadcasté (S-5 pour SysEx).

**Given** un performer au-delà du burst (200)
**When** émission
**Then** `rate:limited`.

**Given** les tests d'intégration
**When** exécutés
**Then** aucun port matériel n'est requis (in-process + `web-midi-test`).

**Tests attendus:** Suite d'intégration in-process verte couvrant les scénarios ci-dessus (S-3/S-4/S-5).

**Dépendances:** Epics 2–5 (server + client complets).

**Définition de terminé:** Tests d'intégration Socket.IO in-process + `web-midi-test` couvrent join/relay/forbidden/busy/rate/origin ; scénarios S-3/S-4/S-5 passent ; aucun port matériel requis.

### Story 6.6: Plan + exécution test manuel IAC → Dexed → MIDI Monitor (11 étapes) + sign-off

As the owner (Zub),
I want to execute the manual validation plan on real macOS IAC → Dexed → MIDI Monitor,
So that I prove the full live chain works on real hardware before going live (S-1, S-9).

**Objectif:** Documenter et exécuter le plan de test manuel (11 étapes de la recherche) : macOS IAC Driver → Dexed standalone → MIDI Monitor. Couvre : 5 types relayés correctement (S-1), Panic local coupe les notes coincées **même serveur down** (S-2), 2ᵉ performer refusé (S-3), listeners read-only (S-4), SysEx rejeté (S-5), latence mesurée (< ~80 ms LAN / < ~150 ms internet, < ~5 % fallbacks, S-6), zéro secret (S-7), tests unitaires 100 % (S-8, déjà 6.4), plan exécuté sans bloqueur (S-9). Checklist signée.

**Contexte:** NFR-18 (test manuel prioritaire sans bloqueur), AD-19 (plan manuel 11 étapes). S-1–S-9. Le plan détaillé vit dans l'addendum/recherche (disponible si besoin — non rechargé ici).

**Fichiers/modules concernés:** `docs/manual-test-plan.md` (checklist 11 étapes + résultats + latence mesurée + sign-off), preuves (captures MIDI Monitor, logs).

**Références:** PRD NFR-18, S-1, S-2, S-3, S-4, S-5, S-6, S-9 · Arch AD-19.

**Acceptance Criteria:**
**Given** macOS IAC Driver `FMLW → Dexed` + Dexed standalone + MIDI Monitor
**When** exécution du plan
**Then** les 5 types MIDI sont relayés correctement et visibles dans MIDI Monitor (S-1).

**Given** une note coincée + serveur tué (kill backend)
**When** Panic local
**Then** le son s'arrête (S-2).

**Given** un 2ᵉ performer
**When** tentative
**Then** `performer:busy` (S-3).

**Given** un listener émettant `midi:event` via console
**When** tentative
**Then** `forbidden` (S-4).

**Given** un SysEx
**When** envoyé
**Then** rejeté/filtré (S-5).

**Given** le flux live
**When** mesure
**Then** latence perçue < ~80 ms LAN / < ~150 ms internet ; < ~5 % fallbacks (S-6).

**Given** le plan
**When** exécution
**Then** toutes les étapes passent sans point bloquant et la checklist est signée (S-9).

**Tests attendus:** Exécution manuelle (pas de test automatisé) ; checklist signée avec latences mesurées et captures.

**Dépendances:** Epics 1–5 (app complète), 6.4/6.5 (tests automatisés passent).

**Définition de terminé:** Plan manuel 11 étapes documenté + exécuté sur IAC → Dexed → MIDI Monitor ; S-1–S-6 + S-9 passent ; checklist signée avec latences mesurées.

### Story 6.7: Validation zéro-secret (`grep` build) + ADRs 0001–0008 versionnés + 10 invariants respectés + build final

As a developer/owner,
I want the final build verified secret-free, ADRs versioned, and all 10 invariants confirmed,
So that the MVP is provably secure and architecturally sound before deployment.

**Objectif:** **Build final** `pnpm -r build` (web `dist` + server + `@fmlw/shared`) ; `grep` du bundle frontend pour `OWNER_SECRET` / toute variable `VITE_*` portant un secret → **zéro occurrence** (S-7, NFR-9). ADRs 0001–0008 versionnés dans `docs/adr/` (mono-process, one-way owner unique, Web MIDI native, Socket.IO relay, contrat Zod partagé, in-memory pas de DB, Panic local, exclusion SysEx). Vérification des 10 invariants non-négociables (NFR-20) respectés.

**Contexte:** NFR-9 (zéro secret, grep build), NFR-20 (10 invariants), AD-10 (OWNER_SECRET serveur-only), AD-19 (ADRs). S-7. Les ADRs existent déjà dans `_bmad-output` ; cette story les versionne dans le repo applicatif `docs/adr/` (Nygard léger, immuables, supersede-only).

**Fichiers/modules concernés:** `docs/adr/ADR-0001..ADR-0008.md`, script/CI `grep` zéro-secret sur `apps/web/dist`, build final.

**Références:** PRD NFR-9, NFR-20, S-7 · Arch AD-1..AD-8 (ADRs correspondants), AD-10, AD-19.

**Acceptance Criteria:**
**Given** le build final (`pnpm -r build`)
**When** `grep -r OWNER_SECRET apps/web/dist` + recherche `VITE_*` secrets
**Then** zéro occurrence (S-7).

**Given** les ADRs
**When** versionnage
**Then** `docs/adr/ADR-0001..ADR-0008.md` sont présents, immuables (Nygard), supersede-only.

**Given** les 10 invariants non-négociables (one-way, owner unique, no SysEx, Panic local, HTTPS, Chrome/Edge, etc.)
**When** audit
**Then** tous sont respectés par le code livré (NFR-20).

**Given** le build final
**When** produit
**Then** `apps/web/dist` + server build + `@fmlw/shared` build sont générés sans erreur.

**Tests attendus:** Vérification `grep` automatisée (CI) → négatif sur le bundle ; audit ADRs (présence + immuabilité) ; audit invariants (checklist 10 items).

**Dépendances:** Epics 1–5 (app complète), 6.4 (tests verts).

**Définition de terminé:** Build final produit sans erreur ; `grep` bundle = zéro secret (S-7) ; ADRs 0001–0008 versionnés `docs/adr/` ; 10 invariants respectés (NFR-20) ; vérification `grep` en CI.

### Story 6.8: Déploiement MVP HTTPS mono-domaine + env prod + graceful shutdown verify + `/health` prod

As the owner,
I want the MVP deployed on a single HTTPS domain with hardened env and verified graceful shutdown,
So that Web MIDI works in a secure context and the server is operable in production.

**Objectif:** Déploiement mono-process mono-domaine HTTPS (Caddy auto-TLS ou host managé Render/Fly.io) servant static Vite + Socket.IO sur le même origin (zéro CORS). Env prod : `PORT`, `OWNER_SECRET` (secret managé, jamais dans le bundle), `PUBLIC_ORIGIN`, `LOG_MIDI=0`, `MAX_LISTENERS` (garde-fou optionnel). Vérifier graceful shutdown en prod (SIGTERM → notify + drain + `io.close`/`http.close`). `/health` prod répond `{ ok, uptime, ownerActive, listeners }`. `transports: ["websocket"]` en prod.

**Contexte:** AD-20 (déploiement HTTPS mono-domaine, Caddy/managed, env, graceful shutdown, `/health`), AD-1 (mono-process), AD-15 (mono-domaine), NFR-8 (HTTPS prod), NFR-13 (mono-process), NFR-14 (websocket only).

**Fichiers/modules concernés:** `Caddyfile` (ou config host managé), `apps/server/src/config/env.ts` (env prod), `docs/deploy.md`, CI/CD de déploiement (optionnel).

**Références:** PRD NFR-8, NFR-13, NFR-14, FR-29 · Arch AD-1, AD-15, AD-20.

**Acceptance Criteria:**
**Given** le build final (6.7)
**When** déploiement
**Then** le mono-process sert static Vite + Socket.IO sur un seul origin HTTPS (zéro CORS).

**Given** l'env prod
**When** lancement
**Then** `OWNER_SECRET` est managé côté serveur (jamais dans le bundle), `PUBLIC_ORIGIN` est l'origin prod, `LOG_MIDI=0`, `transports: ["websocket"]`.

**Given** `GET /health` en prod
**When** requête
**Then** réponse `{ ok:true, uptime, ownerActive:<bool>, listeners:<n> }`.

**Given** un `SIGTERM` en prod
**When** shutdown
**Then** clients notifiés, connexions drainées, `io.close()`/`http.close()` propres (FR-29).

**Given** Web MIDI en prod
**When` accès
**Then** le secure context HTTPS est actif (Web MIDI disponible).

**Tests attendus:** Vérification manuelle/automatisée : `/health` prod répond ; origin unique (pas de CORS) ; `SIGTERM` → shutdown propre (vérifié en staging) ; Web MIDI disponible (secure context).

**Dépendances:** Story 6.7 (build final), 2.8 (graceful shutdown + `/health`).

**Définition de terminé:** MVP déployé mono-domaine HTTPS (Caddy/managed) ; env prod durci (`OWNER_SECRET` serveur-only, `PUBLIC_ORIGIN`, `LOG_MIDI=0`, `MAX_LISTENERS`) ; graceful shutdown vérifié ; `/health` prod répond ; `transports: ["websocket"]` ; zéro CORS.

### Story 6.9: Checklist MVP + répétition générale avant première session live (S-10)

As the owner (Zub),
I want a pre-launch MVP checklist and a full dress rehearsal before the first real live session,
So that I deliver at least one complete live session before a small real audience without any blocking incident (S-10).

**Objectif:** Checklist MVP pré-session : build final vert (6.7), tests unitaires 100 % (6.4) + intégration (6.5) verts, test manuel IAC/Dexed signé (6.6), déploiement prod sain (6.8), `/health` prod OK, panic testé serveur down (S-2), 2ᵉ performer refusé (S-3), zéro secret (S-7). **Répétition générale** : une session live complète de bout en bout (performer diffuse → 1–3 listeners rejoignent sur leurs synthés → vérification audio + latence + Panic) **avant** la première session devant audience réelle. Compte-rendu de session (S-10).

**Contexte:** S-10 (au moins une session live complète par Zub devant une petite audience réelle, sans incident bloquant — preuve que le format « radio instrumentale FM » fonctionne). AC-U21. La rehearsal interne précède la session audience.

**Fichiers/modules concernés:** `docs/mvp-launch-checklist.md`, `docs/session-report-template.md`, compte-rendu de rehearsal.

**Références:** PRD S-10, AC-U21, S-1–S-9 (prérequis).

**Acceptance Criteria:**
**Given** la checklist MVP
**When** review pré-session
**Then** tous les items sont validés (build, tests, manuel, déploiement, /health, panic, busy, zéro-secret).

**Given** une répétition générale (performer + 1–3 listeners sur leurs synthés)
**When** session de bout en bout
**Then** l'audio est entendu sur les synthés listeners, la latence est acceptable, le Panic fonctionne, sans incident bloquant
**And** un compte-rendu est rédigé.

**Given** la première session devant une petite audience réelle
**When** session live
**Then** elle se déroule sans incident bloquant (S-10, AC-U21) — preuve du format.

**Tests attendus:** Pas de test automatisé ; checklist signée + compte-rendu de rehearsal + compte-rendu de session audience (S-10).

**Dépendances:** Stories 6.4, 6.5, 6.6, 6.7, 6.8 (tout validé et déployé).

**Définition de terminé:** Checklist MVP pré-session signée ; répétition générale exécutée sans incident bloquant (compte-rendu) ; première session live devant petite audience réelle réussie (S-10/AC-U21) avec compte-rendu.

---

**Epic 6 summary:** 9 stories, sequence 6.1 → 6.9 (each builds only on previous ; 6.9 depends on 6.4–6.8). Assemblage final + polish UX (DESIGN.md), a11y complet (VoiceOver), tests unitaires 100 % + intégration in-process, validation manuelle IAC/Dexed/MIDI Monitor, zéro-secret + ADRs + 10 invariants + build final, déploiement HTTPS mono-domaine, et checklist MVP + répétition générale avant la première session live (S-10). `DESIGN.md` consommé ici (tokens `live studio` sombre, `danger_fill` AA, mono données).