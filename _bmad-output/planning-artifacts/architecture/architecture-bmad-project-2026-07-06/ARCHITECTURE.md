---
title: "FM Live Wire — Architecture Technique (MVP)"
status: final
created: 2026-07-06
updated: 2026-07-06
project: FM Live Wire
language: fr
altitude: feature
paradigm: monolithe modulaire en couches + couche Socket dédiée
spine: ARCHITECTURE-SPINE.md
sources:
  - ../../prds/prd-bmad-project-2026-07-06/prd.md
  - ../../prds/prd-bmad-project-2026-07-06/addendum.md
  - ../../ux-designs/ux-bmad-project-2026-07-06/DESIGN.md
  - ../../ux-designs/ux-bmad-project-2026-07-06/EXPERIENCE.md
  - ../../research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md
---

# FM Live Wire — Architecture Technique (MVP)

> **Radio live de contrôle MIDI, pas une radio de son.** Un performer/admin unique diffuse des événements MIDI en direct ; les listeners reçoivent le flux dans leur navigateur, le routent vers leur sortie MIDI locale, et **leur propre synthé FM** génère le son. Aucun audio n'est streamé.
>
> Ce document est la version humaine, lisible, de l'architecture. Le contrat opérationnel terse (build substrate pour Claude Code) est dans `ARCHITECTURE-SPINE.md` ; les décisions figées sont tracées dans `adr/ADR-0001..ADR-0008`. Le rationnel vit dans `.memlog.md`.

## 1. Vue d'ensemble

FM Live Wire est un **monolithe modulaire mono-process** : un seul process Node.js porte à la fois Express (servir le build Vite statique + endpoint `/health`) et Socket.IO (le cœur temps réel), sur **un seul origin HTTPS**. Ce choix élimine le CORS, uniformise le secure context Web MIDI, et reste largement au-delà du besoin MVP (5–20 listeners ; mono-process ~10k+ connexions théoriques).

Le flux de données est **strictement one-way** :

```
Performer → Serveur → Listeners → sortie MIDI locale → synthé FM
```

Aucun chemin retour pour le MIDI. Les seuls événements listener→serveur autorisés sont de **contrôle** : `room:join`, `room:leave`, `midi:test`. Le **Panic est purement local** côté listener — il fonctionne même serveur déconnecté.

### Caractéristiques structurelles

- **Paradigme** : monolithe modulaire en couches (HTTP / Socket / Services / Shared contract) + feature-based côté frontend.
- **Stack** : React + Vite + TypeScript (front) / Node + Express + Socket.IO (back) / Web MIDI API native / monorepo pnpm avec `@fmlw/shared` (Zod) pour le contrat wire.
- **État** : en mémoire volatile, pas de DB, pas de Redis. Isolé derrière une interface d'adapter pour un swap futur vers Redis Streams sans rewrite.
- **Sécurité** : owner unique via shared secret `OWNER_SECRET` (serveur only, jamais `VITE_*`), rôle épinglé, gate per-event, rate limiting per-socket, origin allowlist, double défense SysEx.
- **Timing** : scheduler natif `MIDIOutput.send(data, timestamp)` + lookahead 40 ms + buffer borné 256 + fallback immédiat. Pas de compensation avancée MVP.

### Frontières du MVP (non-objectifs)

Pas de streaming audio (jamais), pas de SysEx, pas de replay, pas de rooms multiples, pas d'auth JWT/RBAC, pas de multi-performers, pas de jam, pas de chat MIDI bidirectionnel, pas de scale-out, pas de DB, pas de mobile, pas de polyfill Safari, pas de mode clair. La **post-traction prioritaire** est rooms multiples (avant SysEx/replay/multi-performer).

## 2. Diagrammes textuels des flux

### 2.1 Flux de relay one-way (happy path)

```
┌──────────┐   socket.auth.token    ┌──────────┐   midi:event (ack)    ┌──────────┐
│ Performer│ ─────────────────────► │  Serveur  │ ◄──────────────────► │ Performer│
│ (Chrome) │   MIDIInput.onmessage  │ Socket.IO │   ack {ok, error?}    │ (monitor)│
└──────────┘   → encode → emit      └─────┬─────┘                       └──────────┘
                                          │ io.to(room).emit("midi:event", data)
                                          ▼
                                   ┌──────────┐
                                   │ Listeners│ (room fm-live-wire:main)
                                   └─────┬────┘
                                         │ réception → toMidiBytes → remap canal
                                         ▼
                                  MIDIOutput.send(data, performance.now()+LOOKAHEAD)
                                         │
                                         ▼
                                   Synthé FM local (Dexed / Volca FM / DX7)
```

### 2.2 Pipeline de validation serveur (3 couches)

```
Connexion ──io.use──► stamp socket.data.role + performerId=socket.id
                       (+ OWNER_SECRET timing-safe si role=performer)
                       (+ PerformerRegistry: 2e performer → performer:busy)
                              │
                              ▼
Événement ──socket.use──► gate rôle: role=performer && performerId=owner? sinon forbidden
                           (+ rate limit token bucket 200/100/s → rate:limited)
                           (+ compteur forbidden → 3 = disconnect)
                              │
                              ▼
Handler ──MidiEventSchema.safeParse(.strict)──► ok? RelayService.broadcast(room, data+srvTs)
                           sinon ack {ok:false, error:"invalid", issues}
```

### 2.3 Flux Panic local (indépendant du serveur)

```
Listener clique Panic
      │
      ▼
features/listener/lib/panic.ts   (NE dépend PAS de Socket.IO)
      │
      ▼
MIDIOutput locale sélectionnée
      │
      ▼  CC 64 → 120 → 121 → 123 × 16 canaux = 64 messages
      │   send([0xB0|ch, cc, 0x00], performance.now())
      ▼
Synthé FM local : son coupé

[si insuffisant] Force Panic (Dialog confirmation) → noteOff 128×16 = 2048 messages
```

### 2.4 Flux de timing listener (scheduler + backpressure)

```
midi:event reçu (ts, srvTs)
      │
      ▼
toMidiBytes(event) → remap canal listener
      │
      ▼
target = performance.now() + LOOKAHEAD_MS (40)
      │
┌───────┴────────┐
│ srvTs-ts>200?  │──oui──► fallback immédiat (noteOn/noteOff) / drop (CC HF) + warning
└───────┬────────┘        si target déjà passé, send() envoie ASAP (natif)
       non
        │
        ▼
buffer.length > 256? ──oui──► drop oldest + warning local
        │ non
        ▼
MIDIOutput.send(bytes, target)   (scheduling driver-level, anti-jitter)
```

### 2.5 Flux de connexion rôles

```
Landing /  ──polling GET /health (ownerActive)──► StatusPill on-air/hors-antenne
   │
   ├─ "Je diffuse" ──► /performer ──socket.auth {role:"performer", token}──►
   │                    io.use: timingSafeEqual(token, OWNER_SECRET)
   │                    PerformerRegistry: ownerPerformerId=socket.id (ou performer:busy)
   │
   └─ "J'écoute"  ──► /listener ──socket.auth {role:"listener"}──►
                        io.use: socket.data.role="listener", isOwner=false
                        room:join fm-live-wire:main → reçoit midi:event broadcast
```

## 3. Structure de dossiers (monorepo pnpm)

```text
fm-live-wire/
  pnpm-workspace.yaml          # packages: apps/*, packages/*
  package.json                 # scripts root: dev, build, test, lint, format
  tsconfig.base.json           # TS strict partagé (strict, noUncheckedIndexedAccess)
  .env.example                 # OWNER_SECRET=, PUBLIC_ORIGIN=, PORT=, LOG_MIDI=  (sans valeurs)
  .gitignore                   # .env, .env.*.local, dist, node_modules
  apps/
    web/                       # React + Vite + TS — landing + listener + performer
      vite.config.ts           # envPrefix contrôlé (JAMAIS OWNER_SECRET)
      tsconfig.json            # extends base
      src/
        app/                   # wiring global
          providers/           # SocketProvider, MidiAccessProvider
          router.tsx           # routes /, /listener, /performer
          layouts/             # layout commun (header tag rôle + retour)
        features/
          performer/           # self-contained
            components/        # AdminTokenInput, MidiInputPicker, MonitoringPanel, PerformerBusyAlert
            hooks/             # useMidiInput, useMidiSender, usePerformerSocket
            lib/               # encode (MidiEvent wire), sysex-filter
            api/               # socket emit/ack
            types.ts
            index.ts           # barrel public
          listener/            # self-contained
            components/        # MidiPortPicker, ChannelSelector, TestNoteButton, JoinButton,
                             # # PanicButton, ForcePanicButton+Dialog, MockByteStream, LateAlert, StatusPill
            hooks/             # useMidiOutput, useMidiReceiver, useScheduler, usePanic, useListenerSocket
            lib/               # scheduler.ts, panic.ts, encode.ts (wire→bytes), mock-output.ts, midi-access.ts
            types.ts
            index.ts
        entities/              # MidiEvent (re-export @fmlw/shared), Channel, Role
        shared/                # primitives shadcn (Button, Card, Alert, Dialog...), constantes MIDI
        lib/                   # socket client Socket.IO, midi-access wrapper natif
        config/                # LOOKAHEAD_MS, BUFFER_CAP, MAX_LATE_MS defaults UI
      tests/                   # unitaires + intégration (Vitest + jsdom + web-midi-test)
    server/                    # Node + Express + Socket.IO
      src/
        config/                # env.ts (PORT, OWNER_SECRET, PUBLIC_ORIGIN, LOG_MIDI, MAX_LISTENERS, lookahead defaults)
        app/                   # createApp() Express + http server + Socket.IO attach + graceful shutdown
        http/
          routes/              # health.ts (GET /health), static.ts (serve build Vite)
        socket/
          index.ts             # io.on("connection") + wiring middlewares + handlers
          middlewares/
            roleAuth.ts        # io.use : stamp role + performerId, OWNER_SECRET timing-safe
            eventGate.ts       # socket.use : gate role+owner sur midi:event → forbidden
            rateLimit.ts       # socket.use : token bucket per-socket
          handlers/
            performerEvents.ts # midi:event → ValidationService → RelayService.broadcast
            roomEvents.ts      # room:join, room:leave
            controlEvents.ts   # midi:test — PAS de handler panic
          services/
            PerformerRegistry.ts  # ownerPerformerId single-slot, performer:busy, libération
            RelayService.ts       # interface adapter { broadcast(room, event) } — in-memory impl
            RoomService.ts        # join/leave fm-live-wire:main
            ValidationService.ts  # MidiEventSchema.safeParse
        shared/                # re-export @fmlw/shared, constantes, types erreur
        utils/
          tokenBucket.ts       # token bucket 200/100
          logger.ts            # logger structuré échantillonné
      tests/                   # intégration Socket.IO in-process
  packages/
    shared/                    # CONTRAT — pas de logique métier
      src/
        midi-event.ts          # MidiEventSchema (Zod .strict) + type MidiEvent = z.infer
        constants.ts           # CC 120/121/123/64, status bytes, ROOM="fm-live-wire:main", LIMITS
        index.ts
      package.json             # "name":"@fmlw/shared", "exports": { ".": "./src/index.ts" }
      tsconfig.json
  docs/
    adr/                       # ADR-0001..ADR-0008 (Nygard léger, immuables)
    manual-test-plan.md        # IAC → Dexed → MIDI Monitor (11 étapes)
```

**Règles de dépendance (enforced via plugin ESLint adapté, ex. `eslint-plugin-bound-modules` — pas seulement revue humaine)** :
- Frontend : `app → features → entities → shared → lib`. Les features `performer` et `listener` **ne dépendent pas entre elles**. `entities/MidiEvent` = source unique du contrat wire.
- Backend : `http` et `socket` sont des couches séparées ; `handlers → services → shared`. `RelayService` derrière une interface d'adapter.
- Build `@fmlw/shared` : `tsc` (MVP, consommé ESM des deux côtés). Pas de `tsup` au départ.

## 4. Modules frontend

### 4.1 `features/performer` — diffusion

| Module | Responsabilité |
|---|---|
| `AdminTokenInput` | saisie manuelle du token (pas de localStorage) → `socket.auth.token` |
| `MidiInputPicker` | liste `MIDIInputMap`, refresh `onstatechange`, sélection entrée |
| `useMidiInput` | `MIDIInput.onmessage` → payload `MidiEvent` (5 types), `seq` monotone, `ts=event.timeStamp` |
| `lib/sysex-filter` | rejette `event.data[0]===0xF0` (jamais envoyé) — défense 1 SysEx |
| `lib/encode` | construit le payload wire (sans `performerId`) |
| `useMidiSender` | `socket.emit("midi:event", payload, ack)` ; gère `invalid`/`rate:limited`/`forbidden` |
| `MonitoringPanel` | dernier event `TYPE·CH·VAL` + compteurs (events, listeners, erreurs) ; note « SysEx silencieusement filtré » |
| `PerformerBusyAlert` | `connect_error performer:busy` → écran terminal, pas de retry |

### 4.2 `features/listener` — réception + rendu local

| Module | Responsabilité |
|---|---|
| `BrowserCompatGate` | feature-detection Web MIDI + HTTPS **avant** tout prompt ; écran terminal sinon |
| `MidiPortPicker` | liste `MIDIOutputMap` + option `Mock / Debug` ; refresh `onstatechange` ; switch Mock à chaud |
| `ChannelSelector` | 1–16 (UI) → 0–15 (edge) ; tooltip remappage forcé ; défaut canal 1 |
| `useMidiReceiver` | réception `midi:event` → `toMidiBytes` → remap canal → scheduler |
| `lib/encode` (`toMidiBytes`) | mapping déterministe 1:1 wire→bytes (5 types) |
| `lib/scheduler` | `send(data, performance.now()+LOOKAHEAD)` ; `MAX_LATE_MS` fallback/drop ; `BUFFER_CAP` drop oldest |
| `lib/panic` | CC 64→120→121→123 ×16 ; **indépendant de Socket.IO** |
| `lib/mock-output` | `MockMidiOutput.send` → visualisation bytes |
| `usePanic` | déclenche `panic`/`forcePanic` sur la sortie sélectionnée (réelle ou Mock) |
| `TestNoteButton` | `midi:test` listener→serveur + joue localement `[0x90\|ch,60,100]` + noteOff 300 ms |
| `PanicButton` / `ForcePanicButton+Dialog` | sticky viewport, toujours actif ; Force Panic = confirmation |
| `LateAlert` | warning **local pur** (jamais d'event serveur `listener:overload`) |
| `StatusPill` / `MidiActivityIndicator` / `MockByteStream` | états + activité + visualisation Mock |

### 4.3 `app`, `entities`, `shared`, `lib`, `config`

- `app/providers` : `SocketProvider` (client Socket.IO, reconnexion auto), `MidiAccessProvider` (`requestMIDIAccess`).
- `entities` : `MidiEvent` (re-export de `@fmlw/shared`), `Channel`, `Role`.
- `shared` : primitives shadcn/ui + constantes MIDI (CC, status bytes).
- `lib` : client Socket.IO, wrapper midi-access natif.
- `config` : defaults UI `LOOKAHEAD_MS=40`, `BUFFER_CAP=256`, `MAX_LATE_MS=200`.
- État client : **Zustand** (~1 KB, pas de Provider). Pas de TanStack Query (pas d'API REST métier).

## 5. Modules backend

### 5.1 Couche HTTP (Express, mince)

- `http/routes/health.ts` : `GET /health` → `{ ok, uptime, ownerActive: boolean, listeners: n }`. `ownerActive` alimente le polling de la landing.
- `http/routes/static.ts` : sert le build Vite (mono-domaine → pas de CORS).
- `app/` : `createApp()` + http server + attach Socket.IO + **graceful shutdown** (notify clients, drain, `io.close()`).

### 5.2 Couche Socket (Socket.IO)

- `socket/index.ts` : `io.on("connection")` + wiring middlewares + handlers.
- `middlewares/roleAuth.ts` (`io.use`) : stamp `socket.data.role` + `socket.data.performerId = socket.id` ; si `role==="performer"`, compare `auth.token` vs `OWNER_SECRET` via `crypto.timingSafeEqual` (erreurs génériques) ; interroge `PerformerRegistry` → 2ᵉ performer = `next(Error("performer:busy"))`.
- `middlewares/eventGate.ts` (`socket.use`) : sur `midi:event`, si `role!=="performer" || performerId!==ownerPerformerId` → `next(Error("forbidden"))` ; compte les `forbidden` → 3 = disconnect.
- `middlewares/rateLimit.ts` (`socket.use`) : token bucket per-socket (capacité 200, refill 100/s) → `rate:limited`.
- `handlers/performerEvents.ts` : `midi:event` → `ValidationService.safeParse` → `ack` ou `RelayService.broadcast(room, data+srvTs)` (pas de re-log).
- `handlers/roomEvents.ts` : `room:join`/`room:leave` `fm-live-wire:main`.
- `handlers/controlEvents.ts` : `midi:test` — **pas de handler panic**.

### 5.3 Services (framework-indépendants)

| Service | Responsabilité |
|---|---|
| `PerformerRegistry` | `ownerPerformerId: string\|null` single-slot ; `acquire(socketId)` → ok ou `performer:busy` ; `release(socketId)` à la déconnexion. |
| `RelayService` | interface `{ broadcast(room, event): void }` ; impl in-memory `io.to(room).emit("midi:event", event)`. Swap futur : Redis Streams adapter, sans toucher les handlers. |
| `RoomService` | join/leave `fm-live-wire:main` (constante MVP, imposée par le serveur). |
| `ValidationService` | `MidiEventSchema.safeParse` (`.strict()`) → renvoie `{ok, data}` ou `{ok:false, issues}`. |

### 5.4 `utils`

- `tokenBucket.ts` : token bucket (capacité 200, refill 100/s).
- `logger.ts` : logger structuré JSON, **échantillonné** pour le flux MIDI (pas de log par event) ; `LOG_MIDI=1` active le flux complet en dev.

## 6. Contrat partagé (`@fmlw/shared`)

**Source unique du wire**, importée front **et** back → zéro dérive. Un seul schéma Zod `MidiEventSchema`.

### 6.1 Schéma `midi:event` (JSON compact, `v:1`)

```jsonc
{
  "v": 1,                       // number === 1 (sinon unsupported-version)
  "type": "noteOn",             // noteOn | noteOff | controlChange | programChange | pitchBend
  "channel": 0,                 // 0–15 (DATA). UI affiche 1–16, conversion -1 à l'edge.
  "roomId": "fm-live-wire:main",// imposée par le serveur (MVP : constante)
  "seq": 42,                    // uint32 monotone par performer (détection replay/flood)
  "ts": 1720260000000,          // DOMHighResTimeStamp performer (ms relatif à timeOrigin)
  "note": 60,                   // 0–127 (noteOn/noteOff)
  "velocity": 100,              // 0–127 (noteOn/noteOff ; 0 = noteOff par convention)
  "controller": 74,             // 0–127 (controlChange)
  "value": 0,                   // 0–127 (controlChange) ou program 0–127 (programChange)
  "pitchBend": 8192             // 0–16383, 14-bit, 8192 = centre (pitchBend)
}
```

- **Champs communs requis** : `v`, `type`, `channel`, `roomId`, `seq`, `ts`.
- **Champs conditionnels** selon `type` : noteOn/noteOff → `note`, `velocity` ; controlChange → `controller`, `value` ; programChange → `value` (program, 2 bytes MIDI) ; pitchBend → `pitchBend`.
- **`performerId` interdit/ignoré** dans le payload — le serveur attache `socket.id` (anti-spoofing).
- **`srvTs`** ajouté par le serveur au broadcast (télémétrie `srvTs - ts`), sans re-loger.
- **Pas de type SysEx** dans le schéma → rejet automatique (défense 2 SysEx).

### 6.2 Validation Zod stricte

- `.strict()` (Zod 3 — **ADOPTED MVP**, pin `^3.23` via `zod/v3`) → rejette les champs smugglés. (Zod 4 utiliserait `z.strictObject()` ; migration post-traction.)
- `z.enum(["noteOn","noteOff","controlChange","programChange","pitchBend"])`.
- Ranges : `z.number().int().min().max()` — channel 0–15, note/velocity/controller/value 0–127, pitchBend 0–16383, seq uint32.
- `v !== 1` → `unsupported-version` (prépare l'évolution du protocole).

### 6.3 Mapping wire → bytes MIDI (déterministe 1:1)

| `type` | Status byte | Octets envoyés |
|---|---|---|
| noteOn | `0x90 \| ch` | `[status, note, velocity]` (velocity 0 = noteOff) |
| noteOff | `0x80 \| ch` | `[status, note, velocity]` |
| controlChange | `0xB0 \| ch` | `[status, controller, value]` |
| programChange | `0xC0 \| ch` | `[status, program]` (2 bytes) |
| pitchBend | `0xE0 \| ch` | `[status, lsb, msb]`, `lsb = pb & 0x7F`, `msb = (pb >> 7) & 0x7F` |

Fonction pure `toMidiBytes(event) → number[]`, côté `features/listener/lib/encode`. Conversion canal UI 1–16 ↔ data 0–15 à l'edge.

## 7. Modèle de sécurité (owner unique)

### 7.1 Authentification owner — shared secret

- `OWNER_SECRET` : variable d'environnement **serveur uniquement**. **Jamais** de variable `VITE_*` (toute `VITE_*` est inlinée statiquement dans le bundle Vite, lisible DevTools dev+prod — Vite issues #14412, #21592, #3176).
- Performer = **page statique publique** (aucun secret dans le build) ; saisie manuelle du token à chaque session → `socket.auth.token` au handshake Socket.IO (body, **pas** de query string — fuite logs).
- `io.use` compare via `crypto.timingSafeEqual` ; messages d'erreur **génériques** (anti-énumération).
- Pas de `localStorage` MVP ; token jamais dans l'URL ; `.env` gitignored ; `.env.example` sans valeurs.
- Vérification : `grep` du build pour `OWNER_SECRET` = négatif.

### 7.2 Owner unique — `PerformerRegistry`

- `ownerPerformerId: string | null`. À la connexion d'un performer validé :
  - `null` → `ownerPerformerId = socket.id` (owner).
  - déjà occupé et `!== socket.id` → `next(Error("performer:busy"))` (refus, **pas** de remplacement silencieux).
- Déconnexion owner → `release()` → `ownerPerformerId = null` (libération, slot reprendre par un nouveau performer).

### 7.3 Rôles épinglés + gate per-event

- Rôle **déclaré à la connexion** (`auth.role`) et **épinglé** dans `socket.data.role` via `io.use` — **non modifiable** ensuite.
- `performerId = socket.id` (jamais une valeur client).
- `socket.use` sur **chaque** packet entrant : `midi:event` n'est accepté que si `role === "performer" && performerId === ownerPerformerId`. Sinon → `forbidden` + log ; **3 `forbidden` → disconnect** (pas de ban persistant MVP).

### 7.4 Rate limiting per-socket

- Token bucket via `socket.use` (les limiteurs HTTP ne voient pas les frames WebSocket) : capacité 200 burst, refill 100/s par performer.
- Dépassement → `rate:limited` + log échantillonné. Un listener n'émet jamais `midi:event` (gate §7.3).

### 7.5 Origin allowlist + mono-domaine (anti-CSWSH)

- `origin: process.env.PUBLIC_ORIGIN` au upgrade HTTP. Zéro CORS (single origin mono-process) → pas de préflight, secure context uniforme.

### 7.6 Défense en profondeur SysEx

- Défense 1 (performer) : filtre `event.data[0] === 0xF0` jamais envoyé au serveur.
- Défense 2 (serveur) : `MidiEventSchema` n'expose aucun type SysEx → rejet automatique.
- `requestMIDIAccess({ sysex: false })` côté navigateur.

### 7.7 Fail-safe musical

- Déconnexion listener ou perte de sortie MIDI → le scheduler **arrête d'envoyer** (pas de notes orphelines, pas de bytes en vol).
- Reconnexion (Socket.IO connection state recovery) → reprise du flux live **sans re-loger** le passé (pas de replay).

## 8. Stratégie Web MIDI

- **API native**, pas WEBMIDI.js (MVP). Couvre 100 % du périmètre (5 types channel-voice). Reconsidérer WEBMIDI.js si NRPN/RPN multi-CC ou SysEx deviennent nécessaires (hors MVP).
- **Feature-detection avant prompt** : `'requestMIDIAccess' in navigator`. Safari/non-compatible → écran terminal `Chrome/Edge requis`. HTTPS absent → écran terminal `Web MIDI nécessite HTTPS`.
- **Geste utilisateur requis** : `requestMIDIAccess` lancé au clic « Connecter MIDI » (jamais auto au load).
- **Capture performer** : `MIDIInput.onmessage` → `event.data` (`Uint8Array`) + `event.timeStamp` (`DOMHighResTimeStamp`) → payload `MidiEvent` (5 types) + `seq` monotone.
- **Rendu listener** : `MIDIOutput.send(data, timestamp)` — scheduling **driver/OS-level** (anti-jitter vs timers JS). `0`/passé = envoi immédiat.
- **Hot-plug** : `onstatechange` rafraîchit `MidiPortPicker` (pas de polling).
- **Compatibilité** : Chrome/Edge desktop (cible prioritaire), Firefox v108+ (secondaire), Safari non supporté (feature-detection).
- **Cible de validation** : Dexed standalone + IAC Driver macOS (chaîne la plus courte, reproductible) + MIDI Monitor pour inspecter les bytes.

## 9. Stratégie Socket.IO

- **Socket.IO v4** (`^4.8.3` client + serveur, même major). Apporte gratuitement : rooms, reconnexion auto, buffering paquets pendant déconnexion, connection state recovery (v4.6+), acknowledgements, middlewares `io.use`/`socket.use`.
- Surcoût vs `ws` nu (p99 RTT ~6 ms vs ~3 ms, ~120 MB/1k connexions vs ~75 MB) : **acceptable** pour les bénéfices gratuits, à l'échelle humaine (100–200 ev/s, 5–20 listeners).
- **Prod** : `transports: ["websocket"]` (pas de long-polling fallback, pas de sticky sessions).
- **Framing propriétaire** Socket.IO (pas du WS brut) → incompatible avec clients WS non-Socket.IO. OK MVP (client contrôlé).
- **Room MVP** : `fm-live-wire:main` (constante, imposée par le serveur ; le client ne peut pas créer de room).
- **Middlewares** : `io.use` (connexion : rôle + owner + token timing-safe) ; `socket.use` (event : gate + rate limit).
- **Acks** : `socket.emit("midi:event", payload, ack)` → `ack({ ok, error?, issues? })`. Codes stables : `invalid`, `forbidden`, `rate:limited`, `performer:busy`, `unsupported-version`.
- **Reconnexion** : backoff auto Socket.IO ; au reconnect, reprise du live sans replay (AD-17).
- **Évolution** : swap vers Redis Streams adapter multi-instance via l'interface `RelayService` (hors MVP).

## 10. Stratégie de timing

- **Scheduler natif** : `MIDIOutput.send(data, performance.now() + LOOKAHEAD_MS)` — scheduling driver-level, anti-jitter (la cause principale de jitter est l'exécution JS des callbacks, pas le réseau).
- **`LOOKAHEAD_MS = 40`** (par défaut, configurable 30–50) : `target = recvPerfNow + lookahead`.
- **`MAX_LATE_MS = 200`** : si `srvTs - ts > 200` (ou target déjà passé) → **fallback immédiat** pour noteOn/noteOff (ne pas perdre la note), **drop acceptable** pour CC haute-fréquence + warning UI local. `send()` natif envoie ASAP si target passé.
- **`BUFFER_CAP = 256`** : queue bornée (pas de queue infinie). Au-delà → drop oldest + warning.
- **Pas de re-loging** : on ne retarde pas pour aligner sur une horloge serveur ; on joue « au plus tôt dans L ms ». Compensation avancée (RTT, alignement d'horloges, predictive scheduling, re-loging) → hors MVP.
- **`listener:overload`** = **warning UI local pur**, jamais un event serveur.
- **Monitoring** : latence perçue `srvTs - ts` + compteur de fallbacks immédiats = métriques de santé du lien, pas de correction automatique MVP.
- **W3C Issue #187** : pas de borne supérieure garantie sur la latence `MIDIInput` → la précision d'enregistrement est hors MVP. Le MVP **relaye**, n'enregistre pas.
- **Cible** : latence perçue < ~80 ms (LAN) / < ~150 ms (internet typique) ; < ~5 % de fallbacks en conditions stables.

## 11. Stratégie Panic

- **100 % local** côté listener. `features/listener/lib/panic.ts` ne dépend **pas** de l'état de connexion Socket.IO — uniquement de la `MIDIOutput` locale sélectionnée (réelle ou Mock). **Fonctionne serveur déconnecté** (validé par S-2 : kill backend → Panic coupe le son).
- **Panic standard** : CC 64 (sustain off) → CC 120 (all sound off) → CC 121 (reset controllers) → CC 123 (all notes off), `value 0`, × 16 canaux = **64 messages**, `send([0xB0|ch, cc, 0x00], performance.now())`. Action directe (geste fréquent, critique).
- **Force Panic** (opt-in) : noteOff sweep 128 notes × 16 canaux = **2048 messages**. Bouton secondaire + **Dialog de confirmation** « Panic étendu : ~1–2 s ». Dernier recours si le synthé ignore les channel mode messages (certains synthés FM minimalistes).
- **`PanicButton`** : sticky en bas du viewport, **jamais désactivé**, jamais masqué par un dialogue.
- **Pas de handler panic côté serveur** ; pas de télémétrie Panic agrégée MVP.

## 12. Stratégie Mock Output

- `MockMidiOutput` implémente l'interface `{ send(bytes, ts) }` → visualise les bytes à l'écran (`MockByteStream`) au lieu d'appeler `MIDIOutput` réel.
- Sélectionnable dans le dropdown sortie = `Mock / Debug` (suffixé badge `info`).
- **Switch Mock à chaud autorisé** même après sélection d'un port réel (Q-UX9).
- Permet de tester le pipeline complet (socket → scheduler → encode) **sans IAC ni Dexed** — utile CI + démos.
- Le Panic et la Note de test fonctionnent aussi en Mock (visualisation des bytes).

## 13. Stratégie de tests

### 13.1 Tests unitaires (Vitest + jsdom + `web-midi-test`) — cible 100 %

Modules couverts :
- `toMidiBytes` (mapping wire→bytes, 5 types + limites 0/127/16383/8192, velocity 0 = noteOff).
- `panic` (64 messages) + `forcePanic` (2048 messages).
- `scheduler` (futur/past/cap, fallback/drop par type, drop oldest).
- `MidiEventSchema` (rejets : SysEx, ranges, champs smugglés, `v≠1`, `performerId` ignoré).
- `PerformerRegistry` (1er ok, 2ᵉ `performer:busy`, déconnexion libère).
- `tokenBucket` (burst 200, refill 100/s).
- `sysex-filter` performer.

`web-midi-test` (jazz-soft) fournit un faux `requestMIDIAccess` + ports virtuels (`WMT.MidiSrc`, `WMT.MidiDst`). jsdom n'expose pas `requestMIDIAccess` nativement → mock obligatoire.

### 13.2 Tests d'intégration (Socket.IO in-process, sans jsdom)

- Server + client Socket.IO in-process : `performer:busy` (2ᵉ performer refusé), gate listener (`midi:event` → `forbidden`), 3 `forbidden` → disconnect, broadcast room, validation rejets, `rate:limited`.
- Pas de port matériel requis.

### 13.3 Validation manuelle IAC → Dexed → MIDI Monitor (11 étapes)

1. Audio MIDI Setup → IAC Driver online → port `FMLW → Dexed`.
2. Relancer Dexed standalone (input = port IAC).
3. Backend : `OWNER_SECRET=devsecret pnpm --filter server dev`. Vérifier `/health`.
4. Performer : `/performer` (Chrome/Edge), saisir `devsecret`, sélectionner entrée, jouer → monitoring 5 types.
5. Listener : `/listener`, autoriser MIDI, sortie = port IAC, canal 1, note de test → Dexed sonne + MIDI Monitor affiche les bytes.
6. Relay live : performer joue → listener entend sur Dexed. Mesurer latence perçue.
7. Panic : coincer une note → Panic → son coupé. **Kill backend → Panic fonctionne encore** (S-2).
8. 2ᵉ performer → `performer:busy`.
9. Sécurité : listener `socket.emit('midi:event', …)` console → `forbidden`.
10. SysEx : injecter `0xF0…` côté performer → filtré, jamais relayé.
11. Backpressure : burst CC → warning UI si retard, pas de blocage.

### 13.4 Vérification zéro-secret

`grep` du build pour `OWNER_SECRET` = négatif. ADRs versionnés.

## 14. Stratégie de déploiement

- **HTTPS mono-domaine** : mono-process Express sert le build Vite statique **et** Socket.IO sur le même origin. Pas de CORS, secure context uniforme.
- **TLS** : Caddy auto-TLS (le plus simple pour un MVP mono-process) ou host managé (Render/Fly.io) avec TLS terminé en amont. Dev : `localhost` (secure context OK).
- **Env** : `PORT`, `OWNER_SECRET`, `PUBLIC_ORIGIN` (origin allowlist), `LOG_MIDI` (debug), `MAX_LISTENERS` (garde-fou optionnel).
- **Healthcheck** : `GET /health` → `{ ok, uptime, ownerActive: boolean, listeners: n }`. `ownerActive` alimente le polling landing (pas de temps réel sur la landing).
- **Graceful shutdown** : notify clients, drain connexions, `io.close()` propre.
- **Logs structurés** JSON, échantillonnés pour le flux MIDI (cf. AD-18). Pas de log par event.
- **CI** : lint + `tsc` + `vitest` par story (test-first). Vérification `grep` zéro-secret.
- **Pas de scale-out MVP** : mono-process, état en mémoire. Swap futur Redis Streams adapter via interface `RelayService`.

## 15. Risques techniques

| ID | Risque | Prob. | Impact | Mitigation MVP |
|---|---|---|---|---|
| RT-1 | Safari non supporté | Certain | Moyen | Feature-detection + message `Chrome/Edge requis` (pas de polyfill) |
| RT-2 | HTTPS absent en prod (Web MIDI bloqué) | Certain si non géré | Bloquant | TLS obligatoire (Caddy/managé), dev localhost |
| RT-3 | Latence/jitter réseau | Moyen | Moyen | Scheduler `send(data,ts)` + lookahead + warning backpressure |
| RT-4 | 2ᵉ performer tente la main | Moyen | Moyen | `PerformerRegistry` + `performer:busy` |
| RT-5 | noteOff perdu → note coincée | Moyen | Moyen | Panic local + Force Panic |
| RT-6 | Rate limit contourné via WS | Moyen | Moyen | Token bucket per-socket `socket.use` |
| RT-7 | Injection SysEx | Faible | Élevé | Double défense (filtre performer + schéma serveur) |
| RT-8 | Owner déconnecte en performance | Moyen | Moyen | UI listener « Performer déconnecté » + Panic local dispo |
| RT-9 | Fuite secret owner via build | Éliminé par design | Élevé | Pas de `VITE_*`, saisie manuelle, `socket.auth`, `grep` build |
| RT-10 | Versions paquets périmées au scaffolding | Faible | Faible–Moyen | Résolu 2026-07-06 : Zod 3 `^3.23` ADOPTED, Express 5.2.1 ADOPTED, Socket.IO `^4.8.3` même major. `pnpm outdated` au scaffolding pour les patchs. |
| RT-11 | Pas de borne supérieure garantie latence `MIDIInput` (W3C #187) | Certain | Faible | MVP relaye, n'enregistre pas — précision recording hors scope |
| RT-12 | Slot owner fantôme au changement de rôle | Faible | Moyen | « ← Retour » déclenche déconnexion propre (libération slot) avant navigation (Q-UX10) |

## 16. Décisions techniques (résumé)

Les 8 décisions figées dans les ADR (voir `adr/`) :

1. **ADR-0001** — Monolithe modulaire mono-process, mono-domaine HTTPS.
2. **ADR-0002** — One-way broadcast, owner unique (`performer:busy`).
3. **ADR-0003** — Web MIDI API native (pas WEBMIDI.js MVP).
4. **ADR-0004** — Socket.IO v4 pour le relay temps réel.
5. **ADR-0005** — Contrat MIDI partagé Zod dans `@fmlw/shared`.
6. **ADR-0006** — État en mémoire, pas de DB (isolation pour swap Redis futur).
7. **ADR-0007** — Panic local côté listener (indépendant du serveur).
8. **ADR-0008** — Exclusion SysEx du MVP (double défense).

Décisions secondaires (dans le spine, AD-9..AD-20) : wire JSON `v:1` ; auth `OWNER_SECRET` vs JWT ; scheduler lookahead ; remappage forcé canal ; rate limit per-socket ; Mock Output à chaud ; origin allowlist ; déconnexion après 3 `forbidden` ; fail-safe musical ; logs échantillonnés ; tests 3 niveaux ; déploiement HTTPS mono-domaine.

## 17. ADRs

Les 8 ADR sont dans `adr/` (format Nygard léger, immuables, supersede-only) :

- `adr/ADR-0001-monolithe-modulaire-mono-process.md`
- `adr/ADR-0002-one-way-broadcast-owner-unique.md`
- `adr/ADR-0003-web-midi-api-native.md`
- `adr/ADR-0004-socket-io-relay-temps-reel.md`
- `adr/ADR-0005-contrat-midi-partage-zod.md`
- `adr/ADR-0006-etat-memoire-pas-de-db.md`
- `adr/ADR-0007-panic-local-cote-listener.md`
- `adr/ADR-0008-exclusion-sysex-mvp.md`

## 18. Décisions adoptées (questions fermées)

Les 5 questions ouvertes à l'architecture ont été **résolues par Zub le 2026-07-06** et intégrées au spine (AD-5, AD-11, conventions, Stack) et au memlog :

- **Q-ARCH-1 ✅** : **Zod 3 `^3.23`** (via `zod/v3`, `.strict()` stable) pour le MVP. Migration Zod 4 (`z.strictObject()`) éventuelle post-traction.
- **Q-ARCH-2 ✅** : **Express 5.2.1** pour le MVP (Node 18+, mature, breaking mineurs pour static+/health).
- **Q-ARCH-3 ✅** : **`LOOKAHEAD_MS=40` et `MAX_LATE_MS=200`** conservés par défaut. Valeurs tunables après tests réels (politique fallback/drop par type figée).
- **Q-ARCH-4 ✅** : **Enforce des dépendances directionnelles via un plugin ESLint adapté** (ex. `eslint-plugin-bound-modules`), pas seulement par revue humaine.
- **Q-ARCH-5 ✅** : **Build `@fmlw/shared` avec `tsc`** pour le MVP (consommé ESM des deux côtés). Pas de `tsup` au départ.

Restent en suivi post-traction (Deferred du spine) : rooms multiples (prioritaire), SysEx/patches DX7, replay/radio générative, multi-performers, auth JWT+RBAC, scale-out Redis Streams adapter, compensation latence avancée, polyfill Safari.

## 19. Prochaine étape BMAD recommandée

`bmad-create-epics-and-stories` (ou `bmad-spec` pour adopter ce spine comme compagnon de spec avec `AD` IDs stables citables par les stories), puis implémentation test-first. **Ne pas coder ni lancer les stories automatiquement** après l'architecture (instruction explicite).