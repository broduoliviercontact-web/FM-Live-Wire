---
title: "FM Live Wire — PRD Addendum"
status: draft
created: 2026-07-06
updated: 2026-07-06
parent: prd.md
language: fr
---

# FM Live Wire — PRD Addendum

Profondeur qui appartient à des documents aval (architecture, UX spec) ou qui ne tient pas dans le narrative du PRD lui-même. Le PRD reste la source pour les exigences ; cet addendum fournit le « pourquoi » et le « comment » de référence.

## A.1 — Invariants techniques non-négociables (10)

Gelés par la recherche technique 2026-07-06. Le PRD les respecte tous (NFR-20).

1. **One-way broadcast** — flux strict `Performer → Serveur → Listeners` ; aucun chemin retour pour le MIDI.
2. **Owner unique** — un seul performer ; 2ᵉ refusé `performer:busy`.
3. **Pas de SysEx** — double défense (filtre performer + schéma serveur).
4. **Panic local** — fonctionne même déconnecté du serveur.
5. **HTTPS obligatoire** — Web MIDI `[SecureContext]`.
6. **Chrome/Edge desktop** — cible MVP ; Safari non supporté (feature detection).
7. **Web MIDI API native** — pas de wrapper sauf si le coût de verbosité devient réel.
8. **État en mémoire, mono-process** — pas de DB, pas de Redis ; isolation pour swap futur.
9. **Validation stricte** — Zod `.strict()` partagé front+back via `@fmlw/shared`.
10. **Secret owner côté serveur uniquement** — jamais dans le build Vite ; `crypto.timingSafeEqual`.

## A.2 — Décisions de mécanisme / transport (pour Architecture)

### Transport : Socket.IO v4 vs raw `ws`
Socket.IO v4.8.3 retenu malgré un léger overhead (p99 RTT ~6 ms vs ~3 ms pour `ws` ; ~120 MB/1k connexions vs ~75 MB). Bénéfices gratuits : rooms, reconnexion, buffering paquets pendant déconnexion, connection state recovery (v4.6+), acknowledgements, middlewares `io.use`/`socket.use`. Pin `transports: ["websocket"]` en prod (évite long-polling + sticky sessions). **Gotcha** : Socket.IO n'est pas du WebSocket brut (framing propriétaire) — incompatible avec clients WS non-Socket.IO ; OK pour MVP (client contrôlé).

### Wire format : JSON compact `v:1`
JSON préféré au binaire (MessagePack) à l'échelle humaine (quelques centaines d'events/s max) : overhead ~80–120 B vs ~3 B négligeable ; apporte debuggability + Zod + logs lisibles. Binaire justifié seulement à plusieurs milliers d'events/s — hors MVP.

### Mapping wire → bytes (déterministe 1:1)
- `noteOn` : `0x90|ch` `[status, note, velocity]` (velocity 0 = noteOff)
- `noteOff` : `0x80|ch`
- `controlChange` : `0xB0|ch` `[status, controller, value]`
- `programChange` : `0xC0|ch` `[status, program]` (2 bytes, pas de data2)
- `pitchBend` : `0xE0|ch` `[status, lsb, msb]` avec `lsb = pitchBend & 0x7F`, `msb = (pitchBend >> 7) & 0x7F` (14-bit, 8192 = centre)

`channel` : couche DATA 0–15 ; UI affiche 1–16 ; conversion −1 à l'edge.

### Pipeline de validation serveur (3 couches)
1. **Connexion** `io.use` : stamp rôle + `performerId = socket.id`.
2. **Événement** `socket.use` : role gate + rate limit (token bucket per-socket).
3. **Handler** : `MidiEventSchema.safeParse` (`.strict()`) → `ack` erreur ou `relayService.broadcast(room, data)`. `srvTs` ajouté pour télémétrie ; **pas de re-log** des messages.

## A.3 — Authentification owner (détail)

- `OWNER_SECRET` env serveur uniquement. Client performer envoie `auth: { role:"performer", token }` au handshake Socket.IO.
- `io.use` compare via `crypto.timingSafeEqual` ; messages génériques (anti-énumération).
- **Aucune variable `VITE_*`** pour le secret (toute var `VITE_*` est inlinée statiquement dans le bundle, visible DevTools dev+prod — Vite issues #14412, #21592, #3176).
- Page `/performer` = page statique publique ; saisie manuelle du token à chaque session ; pas de `localStorage` en MVP ; token jamais dans l'URL ; `.env` gitignored ; `.env.example` sans valeurs.

## A.4 — Backpressure listener (détail)

- Scheduler : `MIDIOutput.send(data, performance.now() + lookahead)`, `LOOKAHEAD_MS = 40` (configurable 30–50) — scheduling niveau driver, anti-jitter.
- `target = recvPerfNow + LOOKAHEAD_MS` ; si futur → schedule ; si trop vieux (`MAX_LATE_MS = 200`) → fallback immédiat (noteOn/noteOff) ou drop (CC HF) + warning.
- `BUFFER_CAP = 256` (queue bornée, pas infinie) ; au-delà → drop oldest + warning.
- `listener:overload` = **warning UI local pur** (corrigé : pas un event serveur).
- Compensation avancée (alignement d'horloges, RTT, predictive scheduling, re-loging) → hors MVP.

## A.5 — Panic local (détail)

- **Panic** : CC 64 (sustain off) → CC 120 (all sound off) → CC 121 (reset controllers) → CC 123 (all notes off) × 16 canaux = 64 messages.
- **Force Panic** (opt-in) : noteOff sweep 128 notes × 16 canaux = 2048 messages ; bouton secondaire avec avertissement UI « ~1–2 s ».
- **Doit fonctionner serveur déconnecté** tant qu'une sortie MIDI locale est disponible (Correction 1 de la recherche : pas de handler Panic côté serveur).

## A.6 — Sécurité : défense en profondeur

- Rôle épinglé `socket.data.role` (non modifiable) ; `performerId = socket.id` (jamais valeur client).
- Per-event gate `socket.use` : `if (role !== "performer" || performerId !== owner) → forbidden`.
- Événements listener→serveur autorisés : `room:join`, `room:leave`, `midi:test` uniquement.
- Origin allowlist au upgrade HTTP (anti-CSWSH), mono-domaine HTTPS (zéro CORS).
- Listener : range checks avant `send` ; fail-safe musical (déconnexion → arrêt, pas de notes orphelines ; reconnexion → reprise live sans replay).

## A.7 — Plan de test manuel prioritaire (macOS IAC → Dexed → MIDI Monitor)

1. **Audio MIDI Setup** → Window > Show MIDI Studio → double-click IAC Driver → cocher « Device is online » → **+** ajouter port (ex. `FMLW → Dexed`) → Apply.
2. Relancer Dexed standalone + DAW pour détection du port. Dexed standalone : input MIDI = port IAC.
3. Backend : `OWNER_SECRET=devsecret pnpm --filter server dev`. Vérifier `/health`.
4. **Performer** : ouvrir `/performer` (Chrome/Edge), saisir `devsecret`, sélectionner entrée MIDI, jouer → monitoring affiche les 5 types.
5. **Listener** : ouvrir `/listener` (autre onglet/fenêtre), autoriser MIDI, sélectionner sortie = port IAC `FMLW → Dexed`, canal 1, note de test → Dexed sonne + MIDI Monitor affiche les bytes.
6. **Relay live** : performer joue → listener entend sur Dexed ; mesurer latence perçue.
7. **Panic** : coincer une note → Panic → son coupé. **Kill backend → Panic fonctionne encore** (valide Correction 1).
8. **2ᵉ performer refusé** : `performer:busy`.
9. **Sécurité** : listener tente `socket.emit('midi:event', …)` en console → `forbidden`.
10. **SysEx** : injecter `0xF0…` côté performer → filtré, jamais relayé.
11. **Backpressure** : simuler burst CC → warning UI si retard, pas de blocage.

Notes : latence IAC < 1 ms ; jusqu'à 16 ports virtuels par IAC device ; noms ASCII ; attention aux feedback loops (ports send/return séparés). Préférer Dexed standalone (chaîne courte, reproductible) au plugin Dexed en DAW (chaîne + longue + latence buffer audio).

## A.8 — ADRs à formaliser (Nygard/MADR lightweight, immutable, supersede-only)

- **ADR-0001** Mono-process Express + Socket.IO, mono-domaine HTTPS.
- **ADR-0002** One-way broadcast, owner unique (`performer:busy`).
- **ADR-0003** Web MIDI API native (pas de wrapper MVP).
- **ADR-0004** État in-memory isolé pour swap futur vers Redis Streams adapter.
- **ADR-0005** Wire format JSON compact `v:1`.
- **ADR-0006** `OWNER_SECRET` shared secret vs JWT (MVP).
- **ADR-0007** Scheduler `send(data, ts)` lookahead.
- **ADR-0008** Exclusion SysEx (double défense).

## A.9 — Alternatives rejetées (rationnel)

| Alternative | Raison du rejet |
|-------------|-----------------|
| RTP-MIDI / Apple Network MIDI (RFC 4695) | Point-à-point/mesh petit ; apps natives OS ; pas de listeners navigateur ; pas un produit « tune in to broadcaster ». |
| rtpMIDI (Tobias Erichsen) | Driver P2P Windows ; pas de listeners navigateur ; pas de broadcast. |
| Bome Network / Pro | One-to-many partiel mais pensé LAN/pro ; app native ; payant. |
| loopMIDI | Loopback virtuel local Windows-only ; pas de réseau/broadcast. |
| JZZ-midi-WS / JZZ-midi-RTC | Mécanisme proche mais librairies/expériences dev, pas produits orientés audience ; ne cible pas les synthés FM ni le modèle performer→audience. |
| fa-m/midi-websocket, 0la0/jWsMidi, vine77/midisocket | Démos techniques OSS, pas produits audience, pas de framing FM. |
| dimamik/live_piano | Le plus proche en esprit mais collaboratif P2P, pas broadcast one-way. |
| Phoenixai36/midi2-hub | Multi-producer MIDI 2.0 collab, plugin DAW, pas de listeners navigateur. |
| TwitchMIDI / TwitchToMIDI / TPTS | Inversent la direction (audience→streamer) + streament l'audio retour. |
| Ableton Link | Sync tempo uniquement, pas de broadcast d'événements MIDI (notes/CC). |
| TouchOSC / OSC bridges | Surface de contrôle point-à-point, payant, pas de broadcast. |
| Twitch/YouTube/OBS synth streams | Broadcast audio/vidéo, pas MIDI ; l'auditeur entend l'audio du performer. |
| musaic / Strudel generative radio | One→many navigateur mais audio rendu côté serveur/navigateur, pas MIDI routé listener vers son synthé. |

## A.10 — Personas approfondis (pour UX)

### Performer / Owner — Zub
- Joue Dexed / Volca FM / DX7 ; source = clavier USB, séquenceur, ou Ableton via IAC.
- Veut broadcaster live à une communauté qui possède un synthé FM compatible, plutôt que streamer un mix audio passif.
- Détient le secret owner, anime la session, observe son monitoring.

### Listener — communauté FM
- Possède un synthé FM (Dexed / Volca FM / DX7) + une sortie MIDI accessible navigateur (USB-MIDI matériel ou bus virtuel IAC → Dexed standalone).
- Veut entendre la performance **sur son propre synthé**, observer gestes / CC / events en direct, couper le son en cas de besoin (Panic local).
- Communities cibles : utilisateurs Dexed (3 300+ ★, v1.0 nov 2025), communautés Korg Volca FM/FM2, live synth streamers Twitch/YouTube, live-coders/generative radio (Strudel, TidalCycles, musaic).
- Ton : DIY/hacker/enthousiaste FM — pas mainstream streaming. Métaphore produit : **« tune in »** (radio broadcaster/listener).

## A.11 — Caveat versions de paquets

Les versions recommandées par la recherche (Dec 2025) sont **temporaires**. À reverifier au scaffolding via `pnpm outdated` + matrice de compatibilité :
- Socket.IO client/serveur **même major**.
- **Zod 3 vs 4** : breaking.
- **Express 4 vs 5** : breaking.

## A.12 — Open technique (W3C Issue #187)

Pas de borne supérieure garantie sur la latence `MIDIInput` → la précision d'enregistrement est hors MVP. Le MVP **relaye**, n'enregistre pas.