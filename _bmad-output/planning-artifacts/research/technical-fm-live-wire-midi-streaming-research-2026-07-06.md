---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'FM Live Wire - streaming MIDI temps réel (Web MIDI API + Socket.IO)'
research_goals: "Valider la faisabilité d'une architecture MVP React + Vite + TS / Node + Express + Socket.IO / Web MIDI API pour diffuser des événements MIDI (pas d'audio) d'un performer vers des listeners qui génèrent le son sur leur propre synthé FM local. Identifier risques, limites, décisions techniques recommandées et prochaines étapes BMAD."
user_name: 'Zub'
date: '2026-07-06'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-07-06
**Author:** Zub
**Research Type:** technical
**Project:** FM Live Wire (greenfield)

---

## Research Overview

Cette note de recherche technique valide la faisabilité d'un MVP **FM Live Wire** : un site web qui **diffuse en temps réel des événements MIDI** (pas d'audio) d'un **performer/admin unique** vers une audience de **listeners**, chaque listener générant le son sur **son propre synthé FM local** (Dexed, Volca FM, DX7…) via une sortie MIDI navigateur. La stack visée — React + Vite + TypeScript (frontend), Node.js + Express + Socket.IO (backend), Web MIDI API native, pas de DB — a été vérifiée contre des sources actuelles (MDN, W3C, Can I Use, docs Socket.IO, npm Déc 2025).

La recherche confirme que l'architecture est **réalisable avec la stack choisie**, identifie un invariant structurel fort (**one-way broadcast, single owner performer**), et produit des décisions techniques recommandées + un plan de test IAC/Dexed. Les claims critiques (support navigateur, secure context HTTPS, API `send()`, CC 120/121/123, middlewares Socket.IO, piège `VITE_*`) sont vérifiés multi-source. Les versions de packages sont des **recommandations temporaires de recherche** à revérifier au moment du scaffolding.

→ Le détail exécutif (invariants, 4 catégories de décisions, roadmap, risques, KPIs) figure en **§« Synthèse finale »** à la fin du document.

---

<!-- Content will be appended sequentially through research workflow steps -->

## Technical Research Scope Confirmation

**Research Topic:** FM Live Wire - streaming MIDI temps réel (Web MIDI API + Socket.IO)
**Research Goals:** Valider la faisabilité d'une architecture MVP React + Vite + TS / Node + Express + Socket.IO / Web MIDI API pour diffuser des événements MIDI (pas d'audio) d'un performer vers des listeners qui génèrent le son sur leur propre synthé FM local. Identifier risques, limites, décisions techniques recommandées et prochaines étapes BMAD.

**Technical Research Scope (10 axes + 2 points d'attention) :**

- Web MIDI API : permission, capture entrée (performer), envoi sortie (listener)
- Compatibilité navigateurs : Chrome / Edge / Safari / Firefox + fallbacks (jazz-midi, polyfill WebMIDI.js)
- HTTPS / secure context : implications déploiement
- Capture entrée performer : noteOn / noteOff / CC / programChange / pitchBend
- Envoi sortie listener : routage vers synthé externe/virtuel, gestion canal
- Socket.IO relay : transport WS, rooms, modèle `midi:event`, validation, pas d'auth
- Latence / buffer / lookahead : ordre de grandeur, jitter, pertes, compensation simple (MVP) vs avancée (hors MVP)
- Format message sur le wire : JSON compact vs binaire, champs minimaux
- Panic / All Notes Off : CC 123 / par canal côté listener
- Exclusion SysEx : filtrage explicite, raisons sécurité/taille

**Points d'attention ajoutés (validation utilisateur) :**

1. **Cas synthé virtuel local** : Dexed en standalone ou plugin via DAW ; routage MIDI virtuel sur macOS avec IAC Driver ; différence entre synthé hardware USB/MIDI et synthé virtuel.
2. **Timing MVP** : accepter une latence simple et stable ; ne pas promettre une précision type live audio ; prévoir un buffer/lookahead simple côté listener ; garder la compensation avancée hors MVP.

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-07-06

---

## Technology Stack Analysis

> Niveau de confiance global : **élevé**. Les claims critiques (support navigateur, secure context, API `send()`, CC 123) sont vérifiés multi-source (MDN, W3C, Can I Use, sources communautaires). Les claims de performance (latence p99 Socket.IO) proviennent d'un benchmark 2025/2026 unique — niveau **moyen**.

### Langages & runtimes

- **TypeScript (frontend + backend)** — choix cohérent : typage partagé du contrat `midi:event` entre client et serveur, écosystème mature. Partagé via un package de types commun (monorepo léger ou workspace).
- **Node.js (LTS, ≥ 22/24)** — runtime backend ; Socket.IO 4.7.x benchmarké sur Node 24 LTS. Support ESM natif.
- Navigateur : JS standard via Web MIDI API (pas de runtime custom).

_Sources : [MDN Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API), [Socket.IO docs v4](https://socket.io/docs/v4/)_

### Frameworks & bibliothèques frontend

- **React + Vite + TypeScript** — stack confirmée par l'utilisateur. Vite pour dev server rapide + build optimisé. React pour les deux pages (Listener / Performer) et la gestion d'état MIDI (ports, canal, monitoring).
- **Web MIDI API native** — API navigateur standard (W3C Working Draft Jan 2025). Pas de framework requis pour accéder au MIDI.
- **WEBMIDI.js (v3.1.16, mars 2025)** — wrapper optionnel au-dessus de l'API native. Fournit `playNote()`, `sendPitchBend()`, `sendControlChange()` et listeners typés (`noteon`, `programchange`…). ~12,7K dl/semaine, définitions TypeScript incluses, licence Apache-2.0.
  - **Recommandation MVP** : commencer par l'**API native** (dépendances minimales, contrôle total du format wire), n'adopter WEBMIDI.js que si la verbosité de l'API native devient un coût réel. L'API native reste obligatoire de toute façon sous le capot.
_Sources : [WEBMIDI.js](https://webmidijs.org/), [djipco/webmidi releases](https://github.com/djipco/webmidi/releases), [npm webmidi](https://www.npmjs.com/package/webmidi)_

### Frameworks & bibliothèques backend

- **Express** — serveur HTTP minimal (sert le build Vite + endpoint santé). Le cœur temps réel n'est **pas** Express mais Socket.IO.
- **Socket.IO v4 (4.7.x)** — transport temps réel. Apporte pour le MVP : **rooms** (room principale `fm-live-wire:main`), reconnexion auto, buffering de packets pendant déconnexion, **connection state recovery** (v4.6+, replay des événements manqués), acknowledgements.
  - Surcoût vs `ws` nu : p99 RTT ~6 ms (vs ~3 ms pour `ws`), ~120 MB/1k connexions (vs ~75 MB). **Acceptable pour le MVP** : on paie ce surcoût pour obtenir rooms + reconnexion + recovery gratuitement.
  - **Important** : Socket.IO n'est **pas** un WebSocket brut (framing propriétaire) — incompatible avec clients WS non-Socket.IO. OK pour MVP (client contrôlé).
  - Production : pinner `transports: ["websocket"]` pour éviter le fallback long-polling (latence + sticky sessions).
_Sources : [Socket.IO docs v4](https://socket.io/docs/v4/), [Socket.IO protocol v5](https://github.com/socketio/socket.io/blob/main/docs/socket.io-protocol/v5-current.md), [Redis Streams adapter](https://socket.io/docs/v4/redis-streams-adapter/)_

### Stockage / persistance (MVP)

- **Aucune base de données pour le MVP** (décision utilisateur). Pas de Redis, pas de SQL.
- État serveur : **en mémoire** (room principale, sockets connectés, registre performer↔listeners). Implique : perte de l'état au redémarrage, pas de scale-out multi-instance (pas de besoin pour le MVP).
- **Hors MVP** (à reviser) : Redis adapter pour scale-out, persistance des séquences enregistrées, presets par synthé.

### API MIDI navigateur — pièce centrale de la stack

Vérifié multi-source (MDN, W3C, Can I Use) :

- **`navigator.requestMIDIAccess({ sysex: false })`** — demande de permission. **Secure context obligatoire** (HTTPS ou `localhost`), attribut `[SecureContext]` dans la spec. Permission utilisateur explicite (`NotAllowedError` si refusée). Queryable via `navigator.permissions.query({ name: "midi", sysex: false })`.
- **Côté performer (entrée)** : `MIDIInput.onmessage` → `MIDIMessageEvent` avec `event.data` (`Uint8Array`) et `event.timeStamp` (`DOMHighResTimeStamp`).
- **Côté listener (sortie)** : `MIDIOutput.send(data, timestamp?)` — `data` = tableau d'octets (`[0x90, 60, 0x7f]`), `timestamp` optionnel en ms relatif à `Performance.timeOrigin`. `0`/passé = envoi immédiat. Ordonnancement **au niveau driver/OS** (réduit le jitter vs timers JS). `send()` lève `TypeError` si message invalide, `NotAllowedError` si SysEx sans flag, `InvalidStateError` si port déconnecté.
- **Format des octets MIDI** (spec W3C) :
  | Status haut | Type | Longueur |
  |---|---|---|
  | 0x8 | Note Off | 3 |
  | 0x9 | Note On | 3 |
  | 0xB | Control Change | 3 |
  | 0xC | Program Change | 2 |
  | 0xE | Pitch Bend | 3 |
  | 0xF0 | SysEx | variable → **exclu du MVP** |
_Sources : [MDN requestMIDIAccess](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess), [MDN MIDIOutput.send()](https://developer.mozilla.org/en-US/docs/Web/API/MIDIOutput/send), [W3C Web MIDI Jan 2025](https://www.w3.org/TR/webmidi/Overview.html), [Can I use Web MIDI](https://caniuse.com/midi)_

### Compatibilité navigateurs (point critique #2)

| Navigateur | Web MIDI | Détail |
|---|---|---|
| **Chrome desktop** | ✅ | Depuis v43. **Cible prioritaire MVP.** |
| **Edge desktop** | ✅ | Depuis v79 (Chromium). **Cible prioritaire MVP.** |
| **Firefox desktop** | ✅ | Depuis v108 (déc. 2022). |
| **Safari desktop/iOS** | ❌ | Non supporté (WebKit bug 107250 ouvert). MDN : "Limited availability". |
| Chrome Android / Samsung | ✅ | (hors scope MVP desktop) |

**Implications :**
- La cible Chrome/Edge desktop de l'utilisateur est **pleinement couverte nativement**.
- **Fallback Safari** : `JZZ.js` (jazz-soft, MIT, 583★) agit comme polyfill — expose `navigator.requestMIDIAccess` via Jazz-Plugin quand l'API native est absente. Nécessite une extension/app Jazz-MIDI côté utilisateur. **Recommandation MVP** : ne pas investir dans le polyfill Safari pour le MVP (cible = Chrome/Edge), mais prévoir une **détection de feature** (`'requestMIDIAccess' in navigator`) avec message clair "Navigateur non supporté, utilisez Chrome/Edge" + mention du polyfill JZZ en note future.
_Sources : [Can I use Web MIDI](https://caniuse.com/midi), [jazz-soft/JZZ](https://github.com/jazz-soft/JZZ), [jazz-soft Web MIDI](https://jazz-soft.net/download/web-midi/)_

### Déploiement & infrastructure (MVP)

- **HTTPS obligatoire** pour Web MIDI. En dev : `localhost` est un secure context (OK). En prod : certificat TLS obligatoire (Let's Encrypt / reverse proxy Nginx / Caddy auto-TLS / hébergement managé type Render/Fly.io/Heroku).
- **Aucune infra cloud complexe pour le MVP** : un seul process Node (Express + Socket.IO) suffit. Pas de Redis, pas de K8s.
- Build frontend Vite servi soit par Express (mono-process) soit par un CDN/static host + backend séparé. **Recommandation MVP** : mono-process Express sert le static + Socket.IO (plus simple, un seul domaine → pas de CORS).
- **Hors MVP** : Redis Streams adapter pour multi-instance, CDN pour le static, WebTransport (HTTP/3) si latence critique.

### Outils de développement & validation MIDI (point d'attention #1)

Pour tester le MVP sans synthé hardware — **routage MIDI virtuel macOS via IAC Driver** :
1. **Audio MIDI Setup** → Window > Show MIDI Studio → double-clic **IAC Driver** → cocher "Device is online" → bouton **+** pour ajouter un port (ex. `DAW → Dexed`) → Apply.
2. Redémarrer DAW + Dexed standalone pour qu'ils détectent le port.
3. DAW : output d'une piste MIDI → port IAC. Dexed standalone : input MIDI → même port IAC.
4. **Latence IAC < 1 ms** ; jusqu'à 16 ports virtuels par device IAC. Noms en **ASCII** uniquement. Attention aux **boucles de feedback** (utiliser ports séparés send/return).

**Différence synthé hardware vs virtuel (impact MVP) :**
- **Hardware USB/MIDI** (Volca FM, DX7 via interface) : apparaît comme port MIDI physique dans `MIDIOutput.outputs` du navigateur. Routing direct, latence interface USB typique 1–10 ms.
- **Synthé virtuel standalone** (Dexed standalone) : n'expose un port MIDI que via un bus virtuel OS (IAC sur macOS, loopMIDI sur Windows). Le navigateur voit le port IAC, pas Dexed directement.
- **Synthé virtuel en plugin dans DAW** : le DAW héberge le plugin ; le navigateur envoie au port IAC, le DAW route vers la piste du plugin. Chaîne plus longue, latence DAW + buffer audio à consider.

**Recommandation MVP (validation) :** privilégier le test avec **Dexed standalone + IAC** (chaîne courte, reproductible) + un **MIDI Monitor** (macOS) pour inspecter les octets. Prévoir un mode "Mock MIDI output" dans le listener (console / on-screen visualization) pour tester sans aucun périphérique.
_Sources : [Apple – Transfer MIDI between apps](https://support.apple.com/en-gb/guide/audio-midi-setup/ams1013/mac), [Midilize IAC guide](https://midilize.com/guides/iac-driver-mac), [musicrigs virtual MIDI](https://musicrigs.com/mac-virtual-midi)_

### Timing & latence (point d'attention #2) — vue d'ensemble stack

- **Latence réseau typique WebSocket** : p99 ~6 ms (Socket.IO) à ~3 ms (`ws`) sur LAN/bonnes conditions ; à ajouter le RTT internet (10–100+ ms selon géographie).
- **Jitter** : la cause principale côté listener est l'**exécution JS des callbacks** (`setTimeout`/`rAF`), pas le réseau. **Mitigation native** : utiliser le paramètre `timestamp` de `MIDIOutput.send()` pour scheduler au niveau driver.
- **Issue ouverte W3C #187** : pas de borne supérieure garantie sur la latence d'input (`MIDIInput.onmessage`). Impact : enregistrement précis difficile — **hors périmètre MVP** (le MVP relaie, n'enregistre pas).
- **Position MVP** (confirmée par l'utilisateur) : accepter une **latence simple et stable**, ne pas viser la précision type live audio. Buffer/lookahead simple côté listener (scheduler les messages `X ms` dans le futur via `send(data, performance.now() + offset)`). Compensation avancée (NTP-like, alignement d'horloges, predictive scheduling) → **hors MVP**.
_Sources : [MDN MIDIOutput.send()](https://developer.mozilla.org/en-US/docs/Web/API/MIDIOutput/send), [web-midi-api Issue #187](https://github.com/WebAudio/web-midi-api/issues/187), [Socket.IO docs v4](https://socket.io/docs/v4/)_

### Sécurité musicale (Panic / SysEx) — vue d'ensemble stack

- **Panic / All Notes Off** : `CC 123 (0x7B)` value 0 — arrête les notes pendantes (respecte la sustain pedal). Pour silence immédiat : `CC 120 (0x78)` All Sound Off. Pour reset complet : `CC 121 (0x79)` Reset All Controllers. Ces messages sont des **channel mode messages** : doivent être envoyés **individuellement sur chaque canal** (pas de broadcast omni). Implémentation MVP : boucler sur les 16 canaux et envoyer `CC 120 + 121 + 123` (ou au minimum 123) sur chaque canal vers la sortie sélectionnée.
- **Exclusion SysEx MVP** : `requestMIDIAccess({ sysex: false })` côté navigateur ; filtrage explicite côté performer (jeter `0xF0…0xF7`) **et** côté serveur (validation). Raisons : risque de mise à jour firmware malveillante (spec W3C), taille non bornée (DoS), non-pertinence pour le MVP (pas de patch DX7 SysEx — explicitement hors MVP).
_Sources : [CCARH Controller 123](https://www.ccarh.org/courses/253/handout/controllers/123.html), [IU Channel Mode Messages](https://cmtext.indiana.edu/MIDI/chapter3_channel_mode_messages.php), [W3C Web MIDI security](https://www.w3.org/TR/webmidi/Overview.html)_

### Tendances & adoption

- Web MIDI API : stable sur Chromium/Firefox, **stagnant sur Safari** (pas de mouvement WebKit). Tendance : dépendance aux cibles Chromium pour des apps MIDI web sérieuses.
- Socket.IO : mature, ajout de **WebTransport** (HTTP/3) et **connection state recovery** récents — pertinents pour un futur "mode radio générative" (hors MVP).
- WEBMIDI.js : maintenance active (v3.1.16 mars 2025), pas de rewrite majeur — choix sûr si wrapper souhaité.
- Pas de mouvement vers MIDI 2.0 UMP côté navigateur natif à court terme (JZZ.js supporte UMP côté polyfill) — **hors MVP**.

---

## Integration Patterns Analysis

> Niveau de confiance : **élevé** sur l'API Socket.IO (middlewares, rooms, `socket.use`) et le format MIDI (pitch bend 14-bit) — vérifié multi-source (docs officielles, spec MMA, discussions mainteneurs). **Moyen** sur le choix Zod vs AJV (recommandation d'écosystème, pas un fait normatif).

Cette section définit les **contrats** entre les trois acteurs (Performer, Serveur, Listener) et le **protocole wire** du MVP. C'est le cœur intégratif de FM Live Wire.

### 1. Schéma du message `midi:event`

**Décision MVP : JSON compact (pas binaire).** Rationale : un événement MIDI channel-voice tient en ~6 champs ; le surcoût JSON (~80–120 octets vs ~3 octets binaires) est négligeable à l'échelle d'un perf humain (quelques centaines d'événements/sec max), et apporte debuggabilité + validation Zod + logs lisibles. Le binaire (MessagePack/Uint8Array) serait justifié à plusieurs milliers d'événements/sec (densité SysEx, séquences massives) — **hors MVP**.

```jsonc
// Performer → Serveur  (event "midi:event", ack requis)
{
  "v": 1,                       // version du protocole (number, requis, === 1 pour le MVP)
  "type": "noteOn",             // "noteOn" | "noteOff" | "controlChange" | "programChange" | "pitchBend"
  "channel": 0,                 // 0–15 (DATA layer). L'UI affiche 1–16, conversion -1 à l'edge.
  "roomId": "fm-live-wire:main",// room cible (MVP : valeur unique imposée par le serveur)
  "seq": 42,                    // sequenceId monotone par performer (number, uint32). Garantit l'ordre.
  "ts": 1720260000000,          // timestamp source (DOMHighResTimeStamp du performer, ms relatif à timeOrigin)
  "note": 60,                   // 0–127 (noteOn / noteOff uniquement)
  "velocity": 100,              // 0–127 (noteOn / noteOff uniquement)
  "controller": 74,             // 0–127 (controlChange uniquement)
  "value": 0,                   // 0–127 (controlChange) ou 0–127 MSB (programChange: c'est "program" 0–127)
  "pitchBend": 8192             // 0–16383, 14-bit, 8192 = centre (pitchBend uniquement)
}
```

**Règles de forme (validation Zod, `.strict()` pour rejeter les champs smugglés) :**
- Champs **communs requis** : `v`, `type`, `channel`, `roomId`, `seq`, `ts`.
- Champs **conditionnels** selon `type` :
  - `noteOn` / `noteOff` → `note` (0–127), `velocity` (0–127).
  - `controlChange` → `controller` (0–127), `value` (0–127).
  - `programChange` → `value` réinterprété comme `program` (0–127). *(Note : programChange = 2 octets MIDI, pas de `data2`.)*
  - `pitchBend` → `pitchBend` (0–16383, 14-bit, 8192 = centre).
- `performerId` : **optionnel côté wire** ; le serveur **n'utilise jamais** un `performerId` fourni par le client — il attache `socket.data.performerId = socket.id` côté serveur (anti-spoofing, pattern confirmé par les docs Socket.IO). Inclure `performerId` dans le payload est **interdit / ignoré**.
- `seq` : monotone par performer, uint32. Le serveur **ne reloge pas** les messages (pas de compensation avancée MVP) mais vérifie que `seq` avance (détection de replay/flood).

**Mapping vers bytes MIDI côté listener** (contrat de compatibilité, voir §6) :
| `type` | Status byte | Octets envoyés |
|---|---|---|
| noteOn | `0x90 \| channel` | `[status, note, velocity]` (velocity 0 → traité comme noteOff par convention) |
| noteOff | `0x80 \| channel` | `[status, note, velocity]` |
| controlChange | `0xB0 \| channel` | `[status, controller, value]` |
| programChange | `0xC0 \| channel` | `[status, program]` (2 octets) |
| pitchBend | `0xE0 \| channel` | `[status, lsb, msb]` où `lsb = pitchBend & 0x7F`, `msb = (pitchBend >> 7) & 0x7F` |

_Sources : [MDN MIDIOutput.send()](https://developer.mozilla.org/en-US/docs/Web/API/MIDIOutput/send), [MIDI 1.0 Spec](https://www.freqsound.com/SIRA/MIDI%20Specification.pdf), [François Georgy pitch bend](https://www.francoisgeorgy.ch/midi/midi-pitch-bend/)_

### 2. Validation stricte & protection

**Pipeline serveur en 3 couches** (toutes vérifiées par recherche) :

1. **Connection-level (`io.use`)** — exécuté une fois par connexion : stamp `socket.data.role` (`performer` | `listener`), `socket.data.performerId = socket.id`. Pas d'auth JWT pour le MVP (l'utilisateur l'a exclu), mais le **rôle** est déclaré par le client à la connexion via `auth: { role }` et **validé/épinglé serveur-side**.
2. **Event-level (`socket.use`)** — exécuté pour **chaque** packet entrant : gate de rôle + rate limiting (token bucket). C'est le point d'entrée unique pour toute la sécurité par-événement.
3. **Handler-level (Zod `safeParse`)** — validation du payload `midi:event` dans le handler.

**Rejets explicites :**
- **SysEx** : côté performer, filtrer tout message dont le 1er octet `event.data[0] === 0xF0` (ne jamais l'envoyer au serveur). Côté serveur, le schéma Zod n'expose **aucun** type SysEx → rejet automatique. Double défense.
- **Messages invalides** : Zod `.strict()` rejette champs inconnus ; ranges `0–127` / `0–16383` / `channel 0–15` via `z.number().int().min().max()`. `type` via `z.enum([...])`.
- **`v !== 1`** → rejet avec erreur `unsupported-version` (prépare l'évolution du protocole).

**Rate limiting MIDI (token bucket par socket, via `socket.use`) :**
- HTTP rate limiters (Express, nginx) **ne voient pas** les frames WebSocket — un client connecté peut émettre des milliers de msg/sec sans toucher aux limites HTTP. La limitation **doit** être per-socket via `socket.use()`.
- Seuil MVP : `capacity = 200` événements burst, `refill = 100/sec` par performer (un clavier humain dépasse rarement ~50–100 notes/sec ; CC continu peut monter mais reste sous la barre). Listener : pas d'émission `midi:event` autorisée du tout (voir §5).
- Dépassement → `next(new Error("rate-limit"))` → émission `rate:limited` au client + log warn **échantillonné** (pas un log par message, voir ci-dessous).
- **Hors MVP** : Redis sorted-set pour shared state multi-instance.

**Logs lisibles sans spam :**
- Ne **pas** logger chaque `midi:event` (flood). Logger : connexions/déconnexions, changements de room, **erreurs** de validation (avec `seq` + raison, échantillonnés 1/N), hits de rate-limit (compteur agrégé + flush périodique), panic déclenché.
- Niveau debug activable (var d'env `LOG_MIDI=1`) pour inspécter le flux complet en dev.

_Sources : [Socket.IO Middlewares](https://socket.io/docs/v4/middlewares/), [GitHub Discussion #3899](https://github.com/socketio/socket.io/discussions/3899), [nodewire token bucket](https://nodewire.net/websockets-nodejs-socketio/), [Jsonic JSON WS guide](https://jsonic.io/guides/json-websocket), [SkillAudit WS security](https://skillaudit.dev/seo/mcp-server-websocket-transport-security)_

### 3. Timing listener (buffer / lookahead simple)

**Stratégie MVP** (confirme la position utilisateur : latence simple et stable, pas de précision audio-live) :

- Le listener reçoit `midi:event` avec `ts` (timestamp source). Le serveur **ajoute** `srvTs` (timestamp serveur à la réception) pour télémétrie/monitoring, **sans reloger** le message.
- **Scheduler via `MIDIOutput.send(data, performance.now() + lookahead)`** — l'outil natif anti-jitter : les messages sont mis en file au niveau driver/OS, pas pilotés par timers JS.
- **Lookahead simple MVP** : buffer de `L` ms (configurable, défaut ~30–50 ms). À la réception d'un événement, calculer `delta = (ts_relatif_listener) + L`. Si `delta` est dans le futur → `send(data, performance.now() + delta)`. Si `delta` est trop ancien (déjà passé) → **fallback immédiat** `send(data)` (envoi ASAP ; accepter un mini-glitch plutôt qu'accumuler du retard).
- **Pas de re-loging avancé** : on ne retarde pas pour aligner sur une horlope serveur ; on joue "au plus tôt dans L ms". Compensation avancée (estimation RTT, alignement d'horloges, predictive scheduling) → **hors MVP**.
- **Réception en avance quand possible** : si le réseau livre un événement en avance (rare sur WebSocket, possible avec bursts), le buffer l'absorbe ; si en retard, le fallback immédiat évite l'avalanche.
- **Monitoring** : afficher latence perçue (`srvTs - ts`) et nombre de fallbacks immédiats — métrique de santé du lien, pas de correction automatique MVP.

_Sources : [MDN MIDIOutput.send() timestamp](https://developer.mozilla.org/en-US/docs/Web/API/MIDIOutput/send), [web-midi-api Issue #187 (input latency unbounded)](https://github.com/WebAudio/web-midi-api/issues/187), [Haszari Web Audio + Web MIDI sync](https://haszari.cartoonbeats.com/2020/04/how-to-sync-web-audio-api-and-web-midi/)_

### 4. Panic robuste

Séquence envoyée vers la **sortie MIDI sélectionnée** quand l'utilisateur appuie sur Panic (vérifié multi-source) :

1. **CC 64 (Sustain Pedal) Off** — `value 0` — libère le hold qui sinon maintient les notes même après CC 123.
2. **CC 120 (All Sound Off)** — `value 0` — silence **immédiat**, ignore la sustain pedal (coupe les oscillateurs).
3. **CC 121 (Reset All Controllers)** — `value 0` — remet pitch bend, modulation, expression à leur défaut (pitch bend → centre 8192).
4. **CC 123 (All Notes Off)** — `value 0` — libère les notes pendantes (respecte sustain, mais déjà levé par CC 64).

**Important** : ces Control Change sont des **channel mode messages** → à envayer **individuellement sur chaque canal 0–15** (pas de broadcast omni en MIDI). Implémentation : boucler `for (ch = 0; ch < 16; ch++)` sur la sortie sélectionnée et émettre les 4 CC × 16 canaux = 64 messages, **scheduler via `send(data, timestamp)`** avec un micro-décalage pour éviter la congestion.

**Fallback ultime (si synthé ne répond pas aux CC 120/121/123 — certains synthes FM minimalistes ignorent les channel mode messages) :** `noteOff sweep` — envoyer `noteOff` (velocity 0) pour les **128 notes × 16 canaux = 2048 messages**, **uniquement** déclenché par action explicite Panic (jamais automatique). Préfixer d'un avertissement UI ("Panic étendu : peut prendre ~1–2 s"). Le `noteOff sweep` est l'option de dernier recours confirmée par la pratique MIDI-OX/Logic.

**Décision MVP :** Panic standard = CC 64+120+121+123 sur 16 canaux (rapide, ~64 messages). Panic étendu (noteOff sweep 2048) = bouton secondaire "Force Panic" opt-in.

_Sources : [CCARH Controller 123](https://www.ccarh.org/courses/253/handout/controllers/123.html), [IU Channel Mode Messages](https://cmtext.indiana.edu/MIDI/chapter3_channel_mode_messages.php), [python-rtmidi constants](https://github.com/SpotlightKid/python-rtmidi/blob/master/rtmidi/midiconstants.py)_

### 5. Rooms & rôles

**Room principale MVP : `fm-live-wire:main`** (imposée par le serveur ; le client ne peut pas en créer d'autres).

**Rôles (`socket.data.role`) :**
- **`performer`** — peut émettre `midi:event`, reçoit un `ack` (succès/rejet/validation), ne reçoit **pas** le flux retour (pas de boucle).
- **`listener`** — rejoint la room, **reçoit** `midi:event` broadcasté, **ne peut pas émettre** `midi:event`. Events de contrôle listener→serveur autorisés : `room:join`, `room:leave` (et `midi:test` note de test, voir §6). **Panic = purement local côté listener** (aucun event serveur — voir bloc « Corrections verrouillées »).

**Anti-élévation de privilège sans vraie auth** (le point critique soulevé par l'utilisateur) :
- Le rôle est **déclaré à la connexion** (`auth: { role: "performer" | "listener" }`) et **épinglé** dans `socket.data.role` via `io.use`. **Non modifiable** après coup.
- **Gate par-événement via `socket.use`** : tout événement `midi:event` entrant est vérifié — `if (socket.data.role !== "performer") return next(new Error("forbidden"))`. Un listener qui tente d'émettre `midi:event` est rejeté (log warn, possible disconnect après N tentatives).
- **Performers distincts** : le serveur garde un registre `performers: Set<socketId>`. MVP : **un seul performer actif** à la fois dans la room principale — **décision produit verrouillée** (voir §« Décision produit verrouillée — One-way broadcast ») : un 2ᵉ performer est **refusé**. Les `seq` sont suivis par `socket.data.performerId`.
- **Aucune confiance dans les IDs client** : `performerId` = `socket.id` (serveur), jamais une valeur client.

**Évolution future (hors MVP, mais prévue dans le schéma) :**
- Rooms multiples : `roomId` arbitraire, `room:create` / `room:join` auth-gated.
- Auth légère : JWT au handshake (`io.use` vérifie `socket.handshake.auth.token`), `socket.data.user = { id, role }`. Le schéma `midi:event` est déjà prêt (champ `v` + `performerId` serveur-side).
- Multi-performers par room, mixage/summing → hors MVP.

_Sources : [Socket.IO Middlewares](https://socket.io/docs/v4/middlewares/), [Socket.IO Rooms](https://socket.io/docs/v4/rooms/), [GitHub Discussion #3899 (role patterns)](https://github.com/socketio/socket.io/discussions/3899)_

### 6. Contrat de compatibilité MIDI

**Format interne (wire) → bytes MIDI (sortie listener) :** mapping déterministe un-à-un (tableau §1). Le listener reconstruit le tableau d'octets et appelle `output.send(bytes, scheduledTimestamp)`.

**Cible Dexed (standalone, macOS) — point d'attention #1 :**
- Dexed standalone **n'expose pas** de port MIDI au navigateur directement. Il faut un bus virtuel OS : **IAC Driver** (macOS). Le listener sélectionne le port IAC (ex. `DAW → Dexed`) comme `MIDIOutput` ; le navigateur envoie les bytes à l'IAC, qui les route vers Dexed.
- Chaîne : `Listener (browser) → Web MIDI → IAC port → Dexed standalone → audio`. Latence ajoutée par IAC : < 1 ms.
- **Validation** : utiliser **MIDI Monitor** (macOS) sur le port IAC pour inspecter les bytes reçus, indépendamment de Dexed.
- Noms de ports IAC en **ASCII** uniquement.

**Cible Dexed en plugin (dans DAW) :**
- Chaîne plus longue : `Listener → IAC → DAW (piste MIDI) → plugin Dexed → audio`. Le DAW ajoute sa latence de buffer audio. Pour le MVP de validation, **préférer Dexed standalone** (chaîne courte, reproductible).

**Cible hardware FM (Volca FM, DX7, interfaces MIDI USB) :**
- **Volca FM** : apparaît via USB (si micro-USB MIDI) **ou** via une interface MIDI USB (DIN-5). Le navigateur liste l'interface comme `MIDIOutput`. Latence USB-MIDI typique 1–10 ms. **Note Volca FM** : polyphonie limitée (3 voix), pas de réponse à certains CC mode → le Panic étendu (noteOff sweep) peut être nécessaire.
- **DX7 (1983)** : DIN-MIDI uniquement → interface MIDI USB obligatoire. Le DX7 répond aux CC 120/121/123. Pitch bend ±2 semitons par défaut (RPN 00 00).
- **Interface MIDI USB générique** (ex. Roland UM-ONE, Mio) : exposée comme port `MIDIOutput` dans le navigateur, transparente.

**Décision MVP (validation/cible de test prioritaire) :** Dexed standalone + IAC (chaîne la plus courte, reproductible, multiplateforme macOS). Prévoir un **mode Mock Output** dans le listener (visualisation on-screen + console.log des bytes) pour tester le pipeline complet sans aucun périphérique.

_Sources : [Apple IAC Driver](https://support.apple.com/en-gb/guide/audio-midi-setup/ams1013/mac), [Midilize IAC guide](https://midilize.com/guides/iac-driver-mac), [MIDI 1.0 Spec](https://www.freqsound.com/SIRA/MIDI%20Specification.pdf)_

### 7. Décisions MVP vs hors MVP (synthèse intégration)

| Domaine | **MVP** | **Hors MVP (futur)** |
|---|---|---|
| Wire format | JSON compact, `v:1` | MessagePack/binaire pour densité |
| Événements | noteOn, noteOff, controlChange, programChange, pitchBend | SysEx, patches DX7, MIDI clock/transport |
| Relay | live relay performer → listeners (room unique) | Enregistrement/replay de séquences, mode radio générative |
| Rooms | `fm-live-wire:main` unique | Rooms multiples, création auth-gated |
| Rôles | performer / listener, rôle épinglé sans auth | Auth JWT légère, multi-performers, summing |
| Timing | lookahead simple via `send(data, ts)`, fallback immédiat | Compensation latence avancée (RTT, alignement d'horloges, predictive) |
| Panic | CC 64+120+121+123 × 16 canaux + Force Panic (noteOff sweep) | — (déjà complet) |
| Validation | Zod `.strict()` + rate limit token bucket per-socket | Redis shared rate-limit, AJV précompilé si volume |
| Scale | mono-process, état en mémoire | Redis Streams adapter multi-instance, CDN static |
| Stockage | aucun | Persistance presets/séquences |

---

## Décision produit verrouillée — One-way broadcast (single performer)

> **Verrouillé le 2026-07-06 par Zub (owner).** Cette décision est **contraignante** pour le Technical Research, le Product Brief, le PRD et l'Architecture. Toute contradiction ultérieure doit passer par un explicit correct-course.

**Modèle :** FM Live Wire est un système **à sens unique (one-way broadcast)**.

- **Un seul performer autorisé** à envoyer du MIDI : l'admin / owner / créateur de la performance (= Zub).
- **Tous les autres utilisateurs sont des listeners read-only.**
- Les listeners peuvent : rejoindre la room ; connecter leur sortie MIDI locale ; choisir leur périphérique MIDI ; choisir éventuellement leur canal de sortie ; recevoir les événements MIDI ; déclencher **Panic localement** sur leur propre synthé.
- Les listeners **ne peuvent jamais** envoyer d'événements MIDI vers la performance.

**Règles système dérivées (à implémenter) :**
- Le serveur **rejette** tout `midi:event` qui ne vient pas du performer autorisé (`socket.data.role !== "performer"` OU `socket.data.performerId !== ownerPerformerId`).
- **Un seul performer actif à la fois.** Un 2ᵉ performer qui tente de se connecter est **refusé** (MVP : refus, pas de remplacement silencieux). Le remplacement ne peut se faire que par **action admin explicite** (hors MVP).
- **Identification du performer (MVP)** : variable d'environnement / token secret simple / mode admin local. **Pas d'auth JWT complète** pour le MVP, mais un secret partagé minimal qui prouve le rôle owner.
- **Hors MVP (explicitement exclu) :** collaboration multi-performer ; listeners émettant du MIDI ; jam session collaborative ; chat MIDI bidirectionnel.

**Impact sur les artefacts en aval :**
- *Product Brief* : positionner le produit comme "broadcast live MIDI du créateur vers une audience de synthés FM" — pas comme un outil collaboratif.
- *PRD* : epic "Sécurité & rôles" avec story "refus 2ᵉ performer" + story "gate performer par secret owner".
- *Architecture* : pattern autorisation owner unique, registre `ownerPerformerId` server-side, event `performer:busy` renvoyé au 2ᵉ candidat.

---

## Architectural Patterns and Design

> Niveau de confiance : **élevé** sur les patterns de structure (feature-based React, Controller→Service→Repository Node, ADR Nygard/MADR) — vérifié multi-source (GitHub starters 2025, ThoughtWorks Tech Radar vol.31 Avril 2025). **Moyen** sur le pattern d'auth owner-unique (analogies de projets minimaux, pas un standard normatif).

### System Architecture Patterns

**Décision : architecture monolithique modulaire mono-process (MVP).**

- **Un seul process Node.js** qui porte à la fois : (a) Express — sert le build statique Vite + endpoint `/health`, (b) Socket.IO — le cœur temps réel. Pas de séparation frontend/backend en deux déploiements pour le MVP → **un seul domaine HTTPS, zéro CORS**, ce qui simplifie le secure context Web MIDI.
- **Monolithe modulaire, pas microservices** : un projet greenfield à un seul performer et une audience de listeners n'a aucun besoin de distribution. La tendance 2025 confirme : Controller → Service → (Repository) avec une **couche Socket dédiée** pour le temps réel, le tout dans un seul repo.
- **Pas de Redis, pas de message queue** pour le MVP (état en mémoire). L'architecture **doit rester isolable** pour pouvoir ajouter un Redis Streams adapter plus tard sans rewrite (voir ADR-004).
- **One-way broadcast comme invariant architectural** (décision verrouillée) : le flux de données est strictement `Performer → Serveur → Listeners`. Aucun chemin `Listener → Serveur → Performer` pour du MIDI. Les events listener→serveur autorisés sont uniquement de **contrôle** (`room:join`, `room:leave`, `midi:test`). **Panic = purement local** (aucun event serveur).

_Sources : [Med-Ri/react-vite-ts-boilerplate](https://github.com/Med-Ri/react-vite-ts-boilerplate), [ka-tasin/convo.ai](https://github.com/ka-tasin/convo.ai), [Vidiflow backend (DEV.to)](https://dev.to/hkarimi/building-vidiflow-a-production-grade-video-downloader-backend-in-typescript-38gn)_

### Structure des modules — Frontend (React + Vite + TS)

**Pattern : feature-based, dépendances directionnelles.** Tendance 2025 confirmée (5 starters de référence). Adapté à FM Live Wire (2 features métier principales) :

```
src/
  app/                  # wiring global : providers, router, layouts, styles
    providers/          # SocketProvider, MidiAccessProvider
    router.tsx          # routes /listener, /performer
  features/
    performer/          # feature self-contained
      components/        # MidiInputPicker, EventMonitor, PerformerDashboard
      hooks/             # useMidiInput, useMidiSender
      lib/               # midiEvent encoder (wire → socket)
      api/               # socket emit/ack
      types.ts
      index.ts           # barrel public
    listener/           # feature self-contained
      components/        # MidiOutputPicker, ChannelSelector, TestNoteButton, PanicButton
      hooks/             # useMidiOutput, useMidiReceiver, usePanic, useScheduler
      lib/               # midiEvent decoder (wire → bytes), lookahead scheduler
      types.ts
      index.ts
  entities/             # modèles domaine partagés : MidiEvent (Zod), Channel, Role
  shared/               # UI primitives, hooks utils, constants (CC 120/121/123, status bytes)
  lib/                  # infra bas niveau : socket client (Socket.IO), midi-access wrapper
  config/               # runtime config (lookahead par défaut, rate limits UI)
```

**Règles de dépendance (enforced) :** `app → features → entities → shared → lib`. Les features **ne dépendent pas entre elles** (performer et listener sont isolés). `entities/MidiEvent` est la **source unique** du contrat wire (Zod schema + type inféré), partagé front **et** back via un package `packages/shared` ou un workspace.

_Sources : [masaud155/react-folder-architecture](https://github.com/masaud155/react-folder-architecture), [Medium — Modern React+Vite folder structure](https://sandeshrathnayake.medium.com/mastering-modern-react-vite-folder-structure-a-production-ready-guide-for-scalable-applications-9ad8e233f8b9), [naserrasoulii/feature-based-react](https://github.com/naserrasoulii/feature-based-react)_

### Structure des modules — Backend (Node + Express + Socket.IO)

**Pattern : Controller → Service + couche Socket dédiée.** Tendance 2025 dominante.

```
server/
  src/
    config/             # env (PORT, OWNER_SECRET, CORS origin, lookahead defaults)
    app/                # Express app wiring + http server + Socket.IO attach
    http/
      routes/           # health.ts, (static serving)
      controllers/      # thin
    socket/
      index.ts          # io.on("connection") + middleware wiring
      middlewares/      # roleAuth (io.use), eventGate (socket.use), rateLimit (socket.use)
      handlers/         # performerEvents.ts (midi:event), roomEvents.ts (room:join/leave), controlEvents.ts (midi:test) — PAS de handler panic (Panic = côté listener uniquement)
      services/
        PerformerRegistry.ts   # ownerPerformerId, single-performer enforcement
        RelayService.ts        # midi:event → io.to(room).emit (validation + broadcast)
        RoomService.ts         # join/leave fm-live-wire:main
        ValidationService.ts   # Zod midi:event
    shared/             # MidiEvent schema (même source que front), constants, logger
    utils/              # token bucket, logger (échantillonné)
  tests/
```

**Couche Socket séparée de la couche HTTP** (pattern 2025) : les handlers socket ne mélangent pas avec les controllers REST. Le `RelayService` est framework-indépendant (testable sans Socket.IO).

_Sources : [SriramDivi1/real-time-chat-app](https://github.com/SriramDivi1/real-time-chat-app), [ka-tasin/convo.ai](https://github.com/ka-tasin/convo.ai), [fomongole/Full-Stack-Chat-Application](https://github.com/fomongole/Full-Stack-Chat-Application)_

### Design Principles & Best Practices

- **Séparation des préoccupations** : UI (React) / logique métier (services) / infra (socket, midi-access). Les hooks React (`useMidiReceiver`) orchestrent, les `lib/` font le travail pur.
- **Source unique du contrat wire** : un seul schéma Zod `MidiEvent` partagé front+back → zero drift (pattern TypeBox/Zod confirmé par recherche). `.strict()` partout pour rejeter les champs smugglés.
- **Défense en profondeur** : validation performer (filtre SysEx) + validation serveur (Zod + rate limit + gate rôle) + validation listener (ranges avant `send`). Chaque couche suppose la précédente hostile.
- **Fail-safe musical** : en cas de déconnexion listener, le scheduler **arrête d'envoyer** (pas de notes orphelines) ; au reconnect (Socket.IO connection state recovery), re-synchroniser l'état sans rejouer le passé (MVP : pas de replay, juste reprise du flux live).
- **Boring technology** (principe de l'agent architect Winston) : React, Express, Socket.IO, Web MIDI natif — tous matures, pas de tech bleeding-edge pour le MVP.
- **Immutabilité des ADRs** : les décisions archi sont tracées via ADRs (supersede, jamais éditer un ADR accepté).

_Sources : [Jsonic JSON WS guide](https://jsonic.io/guides/json-websocket), [MADR](https://adr.github.io/madr/)_

### Scalability & Performance Patterns

**MVP : pas de scalabilité horizontale.** Un seul process, état en mémoire. C'est **délibéré** et adapté (un performer, audience modérée).

- **Limites identifiées du mono-process** : ~10k–50k connexions concurrentes par node (Socket.IO ~120 MB/1k connexions) — largement au-delà du besoin MVP.
- **Pattern d'extension prévu (hors MVP)** : Redis Streams adapter pour multi-instance + sticky sessions / WebTransport. L'architecture modulaire isole `RelayService` → swap d'adapter sans toucher les handlers.
- **Performance temps réel MVP** : pinner `transports: ["websocket"]` (évite long-polling), lookahead ~30–50 ms, scheduler driver-level. Mesurer `srvTs - ts` (latence perçue) et `fallbacks immédiats` comme métriques.
- **Backpressure listener** : si le listener accumule du retard (beaucoup de fallbacks immédiats), émettre un event `listener:overload` (UI warn) plutôt que de saturer la sortie MIDI — **à trancher au PRD** (peut être hors MVP).

_Sources : [Socket.IO docs v4](https://socket.io/docs/v4/), [Redis Streams adapter](https://socket.io/docs/v4/redis-streams-adapter/)_

### Security Architecture Patterns (owner-unique)

**Le cœur sécurité MVP = appliquer la décision one-way broadcast.** Pattern dérivé de la recherche (auth single shared secret, gate rôle par event) :

1. **Identification du performer (owner) — MVP minimal** : un **secret partagé** via variable d'environnement `OWNER_SECRET`. Le client performer envoie `auth: { role: "performer", token: OWNER_SECRET }` au handshake Socket.IO. Le `io.use` middleware vérifie le token en **comparaison timing-safe** (`crypto.timingSafeEqual`) contre `process.env.OWNER_SECRET`. Si OK → `socket.data.role = "performer"`, `socket.data.isOwner = true`. Si non → refus connexion (`connect_error`).
   - **Pas de token dans l'URL** (fuitent dans les logs) — passé dans `auth` du handshake (body, pas query string). Confirmé par recherche.
   - **Listners** : `auth: { role: "listener" }` (pas de token requis). `socket.data.role = "listener"`, `socket.data.isOwner = false`.
2. **Registre owner unique** : `PerformerRegistry` garde `ownerPerformerId: string | null`. À la connexion d'un performer validé :
   - Si `ownerPerformerId === null` → `ownerPerformerId = socket.id`. Log "owner connected".
   - Si `ownerPerformerId !== null && ownerPerformerId !== socket.id` → **refus** : `next(new Error("performer:busy"))` → client reçoit `connect_error` "Un performer est déjà connecté". (Décision MVP : refus, pas de remplacement.)
   - À la déconnexion de l'owner → `ownerPerformerId = null` (libération).
3. **Gate par-event (`socket.use`)** : tout `midi:event` entrant → `if (socket.data.role !== "performer" || socket.data.performerId !== ownerPerformerId) return next(new Error("forbidden"))`. Double-check rôle + identité owner.
4. **Messages d'erreur génériques** + checks timing-safe (anti-énumération de token) — pattern confirmé par RustySocks.
5. **Origin allowlist** au niveau upgrade HTTP (anti-CSWSH) — single domain (mono-process) → `origin: process.env.PUBLIC_ORIGIN`.
6. **Évolution (hors MVP)** : JWT signé + RBAC (Owner/Admin/Listener), ticket exchange (HTTP auth → ticket court-livé → WS), multi-performers par room.

_Sources : [tests.ws WebSocket auth](https://tests.ws/learn/websocket-authentication), [4xmen/xchat single TOKEN](https://github.com/4xmen/xchat), [RustySocks auth](https://rustysocks.io/docs/guide/authentication), [academe/reverb-pusher shared secret](https://github.com/academe/reverb-pusher)_

### Data Architecture Patterns

**MVP : état en mémoire volatile, pas de persistance.**

- **État serveur (in-memory)** :
  - `ownerPerformerId: string | null` — slot owner unique.
  - `room` = `fm-live-wire:main` (constante MVP).
  - `listeners: Map<socketId, { joinedAt, channel, outputName? }>` — télémétrie/monitoring.
  - `rateLimitBuckets: Map<socketId, TokenBucketState>` — per-socket.
- **Pas de source of truth persistente** → un redémarrage serveur = perte de l'owner (reconnexion requise) et des listeners (reconnexion auto Socket.IO). **Accepté pour le MVP.**
- **État client listener** : sélection de sortie MIDI, canal, lookahead — en `Zustand` (client state, ~1KB, pas de Provider). Pas de server state à cacher (pas de TanStack Query nécessaire pour le MVP — pas d'API REST métier, seulement `/health`).
- **Contrat wire `MidiEvent`** = la seule "data contract" partagée. Versionnée via `v:1`.
- **Hors MVP** : persistance des séquences enregistrées (DB), presets par synthé (DB/JSON), Redis pour le scale-out.

### Deployment & Operations Architecture

- **HTTPS obligatoire** (Web MIDI secure context). Dev : `localhost` (secure context OK). Prod : reverse proxy TLS (Caddy auto-TLS = le plus simple pour un MVP mono-process) ou hébergement managé (Render/Fly.io) avec TLS terminé en amont.
- **Mono-domaine** : `https://fmlivewire.<tld>` sert le static (build Vite) **et** le endpoint Socket.IO sur le même origin → pas de CORS, pas de preflight, secure context uniforme.
- **Variables d'env (MVP)** : `PORT`, `OWNER_SECRET`, `PUBLIC_ORIGIN` (pour Origin allowlist + CORS), `LOG_MIDI` (debug), `MAX_LISTENERS` (garde-fou optionnel).
- **Healthcheck** : `GET /health` → `{ ok, uptime, owner: bool, listeners: n }`. Pour orchestrateur / uptime monitor.
- **Logs structurés** (JSON, échantillonnés pour le flux MIDI) : connexion owner, connexions/déconnexions listeners, refus `performer:busy`, hits rate-limit (compteur agrégé), validations échouées (échantillonné), panic déclenchés.
- **Graceful shutdown** : notifier clients, drainer connexions, fermer Socket.IO proprement.
- **CI (hors scope recherche, mais à prévoir)** : lint + tsc + vitest par story (agent dev Amelia = test-first).

### Architectural Decision Records (ADRs) proposés

Format **Nygard léger** (ThoughtWorks Tech Radar vol.31, Avril 2025 — ring "Adopt") : `docs/adr/ADR-00XX-titre.md`, immuables, supersede-only. À formaliser pendant l'étape Architecture (CA) :

| ADR | Décision | Statut |
|---|---|---|
| ADR-0001 | Mono-process Express + Socket.IO, mono-domaine HTTPS | À formaliser |
| ADR-0002 | One-way broadcast, single owner performer (décision produit verrouillée) | À formaliser |
| ADR-0003 | Web MIDI API native (vs WEBMIDI.js) pour le MVP | À formaliser |
| ADR-0004 | État en mémoire, isolation pour swap Redis Streams (hors MVP) | À formaliser |
| ADR-0005 | Wire format JSON compact `v:1` (vs binaire) | À formaliser |
| ADR-0006 | Auth owner par shared secret `OWNER_SECRET` (vs JWT) pour le MVP | À formaliser |
| ADR-0007 | Scheduler listener via `send(data, ts)` + lookahead simple (vs compensation avancée) | À formaliser |
| ADR-0008 | Exclusion SysEx du MVP (filtre performer + schéma serveur) | À formaliser |

_Sources : [MADR](https://adr.github.io/madr/), [Docsio ADR guide 2026](https://docsio.co/blog/architecture-decision-record), [m7y.me ADR field guide Dec 2025](https://m7y.me/post/2025-12-23-architecture-decision-records/)_

---

## Corrections & précisions verrouillées (2026-07-06)

> Trois corrections apportées par Zub après l'étape 4. **Elles priment sur toute mention antérieure** dans ce document et doivent se propager au Product Brief, PRD et Architecture.

### Correction 1 — Panic purement local (côté listener)

- Le bouton Panic côté listener est **100 % local** : `listener clique Panic → navigateur listener → MIDIOutput locale → synthé FM local`.
- **Aucun event serveur requis** pour le Panic MVP (`panic:trigger` retiré des events listener→serveur). Télémétrie Panic agrégée → **hors MVP**.
- **Le Panic doit fonctionner même si le listener est déconnecté du serveur**, tant que la sortie MIDI locale est disponible. Conséquence archi : la logique Panic vit dans `features/listener/lib/panic.ts` et ne dépend **pas** de l'état de connexion Socket.IO — uniquement de l'accès MIDI local (`MIDIOutput` sélectionnée).
- Backend : **pas de handler `panic`** (retiré de `controlEvents.ts`).

### Correction 2 — `OWNER_SECRET` jamais exposé côté frontend

- **Aucune variable `VITE_OWNER_SECRET`** dans le build Vite (toute variable `VITE_*` est inlinée dans le bundle client → fuite).
- Le secret **reste côté serveur uniquement** (`process.env.OWNER_SECRET`).
- **Côté performer (UI)** : un champ de saisie **« admin token » / « performer token »** ; l'admin le saisit **manuellement** à chaque session.
- Flux : token saisi → envoyé dans **`socket.auth.token`** au handshake Socket.IO → serveur compare avec `OWNER_SECRET` via **`crypto.timingSafeEqual`**.
- **Interdictions** : pas dans l'URL (fuite logs), pas committé (`.env` gitignored), **pas de localStorage pour le MVP** (sauf décision explicite ultérieure — par défaut le token n'est pas persisté, re-saisie à chaque session).
- Conséquence : `.env.example` documente `OWNER_SECRET` sans valeur ; le performer est une page **publique** (pas de secret dans le build) qui requiert la saisie manuelle du token.

### Correction 3 — Backpressure simple (MVP)

- **Pas d'architecture complexe de backpressure.** Version MVP :
  - Si le listener détecte que les timestamps reçus sont **trop anciens** ou que le buffer accumule **trop de retard** → afficher un **warning local** UI : « Flux MIDI en retard / connexion instable ».
  - **Pas de queue infinie** : le buffer listener est **borné** (ex. max N événements en attente ; au-delà, drop des plus anciens).
  - Si un événement est **trop ancien** (au-delà d'un seuil) → **fallback immédiat** (envoi ASAP) **ou drop** (décision technique à finaliser à l'implémentation — recommandation MVP : fallback immédiat pour les noteOn/noteOff afin de ne pas perdre la note, drop possible pour les CC haute-fréquence).
  - Compensation avancée (alignement d'horloges, predictive scheduling, re-loging) → **hors MVP**.
- L'event `listener:overload` évoqué §Scalability devient un **warning UI local pur**, pas un event serveur.

---

## Implementation Approaches and Technology Adoption

> Niveau de confiance : **élevé** sur les versions de packages et les pièges Vite (vérifié npm/GitHub Déc 2025 + docs officielles Vite). **Élevé** sur le pattern monorepo Zod partagé (5 références 2025). **Moyen** sur les seuils chiffrés (lookahead, rate limit) — recommandations d'ingénierie à caler à l'implémentation.

### Packages concrets & versions recommandées (Déc 2025)

| Couche | Package | Version (Déc 2025) | Rôle MVP |
|---|---|---|---|
| Frontend core | `react` / `react-dom` | 19.x | UI |
| Frontend build | `vite` | 6.x | dev server + build |
| Frontend lang | `typescript` | 5.6+ | typage |
| Frontend state | `zustand` | 5.x | client state (~1KB, pas de Provider) |
| Realtime client | `socket.io-client` | **4.8.3** (23 Déc 2025) | WS client + ack + reconnexion |
| Realtime server | `socket.io` | **4.8.3** | serveur WS + rooms + middlewares |
| HTTP server | `express` | 4.21+ (ou 5.x) | static + /health |
| Validation partagée | `zod` | 3.23+ (ou 4.x) | schéma `MidiEvent` (front+back) |
| MIDI test mock | `web-midi-test` | latest (jazz-soft) | mock `requestMIDIAccess` en Vitest |
| Tests | `vitest` | 2.x | unitaires (jsdom) |
| Lint | `eslint` + `@typescript-eslint` | 9.x (flat config) | qualité |
| MIDI wrapper (optionnel) | `webmidi` | 3.1.16 | **seulement si API native trop verbeuse** (défaut : non) |

**Compatibilité Socket.IO** : client et serveur **4.x ↔ 4.x** (compatibilité pleine). Pinner `^4.8.3` les deux côtés. **Pas de 5.x annoncé** (Déc 2025).

_Sources : [npm socket.io 4.8.3](https://www.npmjs.com/package/socket.io), [npm socket.io-client 4.8.3](https://www.npmjs.com/package/socket.io-client), [WEBMIDI.js 3.1.16](https://github.com/djipco/webmidi/releases)_

### Web MIDI natif vs WEBMIDI.js — décision implémentation

**Recommandation MVP : API native, sans WEBMIDI.js.**

- L'API native couvre 100 % du périmètre MVP (input → `onmidimessage`, output → `send(data, ts)`). Le wrapper apporte surtout du sucre (`playNote()`, listeners typés) — utile pour une app complexe, surcoût de dépendance pour un MVP à 5 types d'événements.
- Le mapping wire→bytes (§« Mapping vers bytes MIDI ») est trivial à coder nativement (~30 lignes) et reste auditable.
- **Revoir si** : la gestion des NRPN/RPN multi-CC ou le sysex deviennent nécessaires (hors MVP) → alors WEBMIDI.js (ou JZZ) justifié.

### Piège Vite `VITE_*` — critical pour la correction 2

Vérifié docs officielles + issues Vite #14412, #21592, #3176 :
- **Toute variable préfixée `VITE_` est inlinée statiquement dans le bundle client au build** → lisible dans DevTools par quiconque. **Dev ET prod.**
- Variables **sans** préfix `VITE_` → **non exposées** côté client (`import.meta.env.X` = `undefined`).
- **Donc : `OWNER_SECRET` ne doit JAMAIS être préfixée `VITE_`.** Elle vit uniquement côté serveur (`process.env.OWNER_SECRET` dans le process Node, jamais importée par le bundle Vite).
- Côté performer : champ de saisie manuel → `socket.auth.token` → comparaison serveur. Le performer est une **page statique publique** (aucun secret dans le build).
- `.env` et `.env.*.local` dans `.gitignore`. `.env.example` documente les clés **sans valeurs**.
- Option : `envPrefix` personnalisable dans `vite.config.ts` si on veut exposer autre chose que `VITE_` (pas nécessaire MVP).

_Sources : [Vite env-and-mode docs](https://github.com/vitejs/vite/blob/main/docs/guide/env-and-mode.md), [Vite issue #14412 (Supabase keys leaked)](https://github.com/vitejs/vite/issues/14412), [Vite issue #21592](https://github.com/vitejs/vite/issues/21592)_

### Monorepo pnpm + Zod partagé (source unique du contrat wire)

**Recommandation MVP : monorepo pnpm workspaces léger** (pas de Turborepo pour le MVP — overkill, on l'ajoute si la friction de build apparaît).

```
fm-live-wire/                     # racine monorepo
  pnpm-workspace.yaml             # packages: apps/*, packages/*
  package.json                    # scripts root (dev, build, test, lint)
  tsconfig.base.json              # config TS partagée (strict)
  apps/
    web/                          # React + Vite (listener + performer pages)
      vite.config.ts
      src/...
    server/                       # Node + Express + Socket.IO
      src/...
  packages/
    shared/                       # CONTRAT — pas de logique métier
      src/
        midi-event.ts             # Zod schema MidiEvent + z.infer type
        constants.ts              # CC 120/121/123, status bytes, room name
        index.ts
      package.json                # "name": "@fmlw/shared", "exports": ...
  .env.example
  .gitignore
```

- **`@fmlw/shared` = source unique** : `MidiEventSchema` (Zod) → `export type MidiEvent = z.infer<typeof MidiEventSchema>`. Front et back importent le **même** schema → zero drift, validation runtime les deux côtés.
- Dépendance : `"@fmlw/shared": "workspace:*"` dans `apps/web` et `apps/server`.
- Build du shared : `tsup` (dual ESM/CJS) ou simple `tsc` (MVP : `tsc` suffit, consommé en ESM des deux côtés).
- **Alternative sans monorepo** (MVP minimal-minimal) : un dossier `shared/` copié/symlinké ou un package local `file:` — **déconseillé**, le workspace pnpm est à peine plus long à mettre en place et évite la dérive.

_Sources : [Full-stack TS monorepo guide](https://gist.github.com/realcc/c08ff57de93274ec3e0d5809bd5a54ef), [truongsoftware monorepo setup](https://truongsoftware.com/blog/typescript-monorepo-setup/), [Refract monorepo](https://docs.userefract.io/architecture/monorepo)_

### Patterns de code clés

#### `requestMIDIAccess({ sysex: false })` — feature detection + permission
```ts
// features/listener/lib/midi-access.ts (et features/performer)
async function requestMidi(): Promise<MIDIAccess> {
  if (!('requestMIDIAccess' in navigator)) {
    throw new Error('UNSUPPORTED_BROWSER'); // → UI "Utilisez Chrome/Edge"
  }
  try {
    return await navigator.requestMIDIAccess({ sysex: false }); // MVP: jamais sysex
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError')
      throw new Error('SECURE_CONTEXT_REQUIRED'); // HTTPS obligatoire
    if (err instanceof DOMException && err.name === 'NotAllowedError')
      throw new Error('PERMISSION_DENIED');
    throw err;
  }
}
```

#### Mapping wire event → bytes MIDI (côté listener, `features/listener/lib/encode.ts`)
```ts
import type { MidiEvent } from '@fmlw/shared';

function toBytes(e: MidiEvent): number[] {
  const ch = e.channel & 0x0f;            // 0–15
  switch (e.type) {
    case 'noteOn':  return [0x90 | ch, e.note & 0x7f, e.velocity & 0x7f];
    case 'noteOff': return [0x80 | ch, e.note & 0x7f, e.velocity & 0x7f];
    case 'controlChange': return [0xB0 | ch, e.controller & 0x7f, e.value & 0x7f];
    case 'programChange': return [0xC0 | ch, e.value & 0x7f];          // 2 octets
    case 'pitchBend': {
      const v = e.pitchBend & 0x3fff;      // 14-bit 0–16383
      return [0xE0 | ch, v & 0x7f, (v >> 7) & 0x7f];                    // lsb, msb
    }
  }
}
```

#### Scheduler `MIDIOutput.send(data, timestamp)` + lookahead + backpressure simple
```ts
// features/listener/lib/scheduler.ts
const LOOKAHEAD_MS = 40;          // buffer MVP (calibrable)
const MAX_LATE_MS = 200;          // seuil "trop ancien" → warning + fallback/drop
const BUFFER_CAP = 256;          // queue bornée (pas de queue infinie)

function schedule(out: MIDIOutput, e: MidiEvent, recvPerfNow: number) {
  const bytes = toBytes(e);
  const target = recvPerfNow + LOOKAHEAD_MS;
  // si l'évent est "trop en retard" (srvTs - ts >> seuil) → warning UI local
  out.send(bytes, target);        // scheduler driver-level (anti-jitter)
  // fallback: si target déjà passé, send() envoie ASAP (comportement natif)
}
// backpressure: si buffer.length > BUFFER_CAP → drop le plus ancien + warning
```

#### Panic local (pur client, fonctionne hors-ligne serveur)
```ts
// features/listener/lib/panic.ts — ne dépend PAS de Socket.IO
const PANIC_CCS = [64, 120, 121, 123]; // sustain off, all sound, reset ctrl, all notes off
function panic(out: MIDIOutput) {
  for (let ch = 0; ch < 16; ch++) {
    for (const cc of PANIC_CCS) {
      out.send([0xB0 | ch, cc, 0x00], performance.now()); // scheduler natif
    }
  }
}
// Force Panic (noteOff sweep) : bouton opt-in séparé
function forcePanic(out: MIDIOutput) {
  for (let ch = 0; ch < 16; ch++)
    for (let note = 0; note < 128; note++)
      out.send([0x80 | ch, note, 0x00], performance.now());
}
```

#### Validation serveur (Zod `safeParse` + gate + rate limit)
```ts
// server/src/socket/services/ValidationService.ts
import { MidiEventSchema } from '@fmlw/shared';
const result = MidiEventSchema.safeParse(payload); // .strict() rejette champs inconnus
if (!result.success) return ack({ ok: false, error: 'invalid', issues: result.error.issues });
// gate rôle déjà fait dans socket.use ; rate limit déjà fait dans socket.use
relayService.broadcast(room, result.data);         // io.to(room).emit('midi:event', data)
```

_Sources : [MDN requestMIDIAccess](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess), [MDN MIDIOutput.send()](https://developer.mozilla.org/en-US/docs/Web/API/MIDIOutput/send), [Socket.IO middlewares](https://socket.io/docs/v4/middlewares/)_

### Tests & QA

**Unitaires (Vitest + jsdom + `web-midi-test`) :**
- `web-midi-test` (jazz-soft) fournit un faux `requestMIDIAccess` + ports virtuels (`WMT.MidiSrc`, `WMT.MidiDst`) → test du pipeline sans matériel.
- `vi.stubGlobal('navigator', { requestMIDIAccess: WMT.requestMIDIAccess })` dans `beforeEach`.
- Couvrir : `toBytes()` (mapping wire→bytes pour les 5 types), `panic()` (vérifier les 64 messages), scheduler (lookahead + fallback + backpressure/drop), `MidiEventSchema` (rejets : SysEx, ranges, champs smugglés, `v≠1`), `PerformerRegistry` (refus 2ᵉ owner), rate limit (token bucket).
- **jsdom n'expose pas `requestMIDIAccess` nativement** → mock obligatoire (confirmé).

**Tests d'intégration backend (Vitest, sans jsdom) :**
- Socket.IO server in-process + client de test (`socket.io-client` mem ou `io.connect` vers `http://localhost:port`) : valider `performer:busy` (2ᵉ performer refusé), gate listener (`midi:event` rejeté), broadcast room, validation rejets.

**Tests manuels MVP (plan) — Dexed + IAC + MIDI Monitor :**
1. **Préparer macOS** : Audio MIDI Setup → IAC Driver online → port `FMLW → Dexed`. Redémarrer Dexed standalone (input = port IAC). Lancer **MIDI Monitor** sur le port IAC.
2. **Backend** : `OWNER_SECRET=devsecret pnpm --filter server dev`. Vérifier `/health`.
3. **Performer** : ouvrir `/performer` (Chrome/Edge), saisir `devsecret`, sélectionner entrée MIDI (clavier ou IAC port source), jouer → monitoring affiche noteOn/noteOff/CC/programChange/pitchBend.
4. **Listener** : ouvrir `/listener` (Chrome/Edge, **autre onglet/window**), autoriser MIDI, sélectionner sortie = port IAC `FMLW → Dexed`, canal 1, note de test → Dexed sonne + MIDI Monitor montre les bytes.
5. **Relay live** : performer joue → listener entend en direct sur Dexed. Mesurer latence perçue (monitoring UI).
6. **Panic** : coller une note (noteOn sans noteOff) → bouton Panic → son s'arrête. **Couper le serveur** (kill backend) → Panic fonctionne toujours (validation correction 1).
7. **Refus 2ᵉ performer** : 2ᵉ onglet `/performer` avec token → `performer:busy`.
8. **Sécurité** : listener tente `socket.emit('midi:event', …)` (console) → rejet `forbidden`.
9. **SysEx** : injecter un message `0xF0…` côté performer → filtré, jamais relayé.
10. **Backpressure** : simuler burst CC → warning UI si retard ; pas de blocage.

**Mode Mock MIDI output** (validation sans périphérique) :
- Dans `features/listener`, un `MockMidiOutput` implémentant `{ send(bytes, ts) }` qui log/visualise les bytes on-screen (au lieu d'appeler `MIDIOutput` réel). Sélectionnable dans l'UI (dropdown sortie = "Mock / Debug"). Permet de tester le pipeline complet (socket → scheduler → encode) sans IAC ni Dexed — utile CI et démo.

_Sources : [jazz-soft/web-midi-test](https://github.com/jazz-soft/web-midi-test), [Vitest mocking](https://github.com/vitest-dev/vitest/blob/1a4705da/docs/guide/mocking.md), [Apple IAC Driver](https://support.apple.com/en-gb/guide/audio-midi-setup/ams1013/mac)_

### Roadmap d'implémentation (aligné BMAD)

1. **Scaffold monorepo** pnpm workspaces + `@fmlw/shared` (Zod `MidiEvent`) + tsconfig strict. *(Story 1)*
2. **Backend skeleton** : Express + `/health` + Socket.IO attach + middlewares (`roleAuth`, `eventGate`, `rateLimit`) + `PerformerRegistry` + `RelayService`. *(Stories backend)*
3. **Shared validation** : `MidiEventSchema` intégré front+back. *(Story)*
4. **Performer page** : saisie token, `requestMIDIAccess`, input picker, `onmidimessage` → encode → `socket.emit('midi:event')` + monitoring. *(Stories performer)*
5. **Listener page** : `requestMIDIAccess`, output picker, channel, test note, `room:join`, réception → scheduler → `send` + Panic local + Mock output. *(Stories listener)*
6. **Tests** : Vitest + `web-midi-test` (unitaires) + plan manuel IAC/Dexed. *(Stories transverses)*
7. **Déploiement HTTPS** (Caddy ou managé) + `.env.example` + README. *(Story finale)*

### Risk Assessment & Mitigation

| Risque | Impact | Probabilité | Mitigation MVP |
|---|---|---|---|
| Safari non supporté | moyen | certain (Safari) | Détection feature + message "Chrome/Edge requis" |
| Web MIDI nécessite HTTPS | bloquant | certain | Dev sur localhost (OK) ; prod TLS (Caddy/managé) |
| Latence/jitter réseau | moyen | moyen | Scheduler `send(data, ts)` + lookahead ; warning backpressure |
| Token owner leaked via build | critique | **éliminé** | Pas de `VITE_OWNER_SECRET` ; saisie manuelle ; `socket.auth` |
| 2ᵉ performer prend la main | critique | moyen | `PerformerRegistry` + refus `performer:busy` |
| Stuck notes (noteOff perdu) | moyen | moyen | Panic local (CC 120/121/123) + Force Panic |
| Rate limit contourné via WS | élevé | moyen | `socket.use` token bucket per-socket (pas HTTP limiter) |
| SysEx injecté | élevé (firmware/DoS) | faible | Filtre performer + schéma serveur (double défense) |
| Déconnexion owner en perf | moyen | moyen | UI listener "Performer déconnecté" + Panic local dispo |

### Success Metrics & KPIs (MVP)

- **Fonctionnels** : 5 types d'événements relayés (noteOn/noteOff/CC/programChange/pitchBend) ; Panic local coupe les stuck notes ; 2ᵉ performer refusé ; listener read-only enforced ; SysEx rejeté.
- **Performance** : latence perçue performer→listener < ~80 ms (LAN) / < ~150 ms (internet typique) — mesurée via `srvTs - ts` ; < 5 % de fallbacks immédiats en conditions stables.
- **Qualité** : 100 % tests unitaires pass (mapping, panic, scheduler, schema, registry, rate limit) ; plan manuel IAC/Dexed exécuté sans blocant.
- **Sécurité** : 0 secret dans le bundle frontend (vérifié `grep` du build) ; token timing-safe comparé ; gate rôle 100 % effectif.

### Skill / Team (aligné agents BMAD)

- **Analyste (Mary)** : brief produit.
- **PM (John)** : PRD, epics/stories.
- **Architecte (Winston)** : architecture + ADRs (formaliser ADR-0001→0008).
- **UX (Sally)** : UX pages Listener/Performer (UI centrale).
- **Dev (Amelia)** : implémentation test-first (red/green/refactor), 100 % tests pass avant review.
- **Tech writer (Paige)** : README + guide de déploiement HTTPS + guide test IAC/Dexed.
- **Compétences requises** : TypeScript, React/Vite, Socket.IO, Web MIDI API, Zod, Vitest. Toutes maîtrisables (skill level : intermediate).

---

# Synthèse finale — FM Live Wire Technical Research

> Synthèse autoritative de la recherche technique (étapes 1–6). À lire en complément des sections détaillées ci-dessus. **Date de complétion : 2026-07-06.**

## Executive Summary

FM Live Wire est **réalisable** avec la stack choisie (React + Vite + TS / Node + Express + Socket.IO / Web MIDI native / sans DB). La recherche vérifiée multi-source établit que :

- **Web MIDI API est supportée nativement sur Chrome/Edge desktop** (cible prioritaire), sur Firefox (depuis v108), **mais pas sur Safari** — la détection de feature + un message « Chrome/Edge requis » suffit pour le MVP (pas de polyfill JZZ à investir).
- **HTTPS est obligatoire** (secure context) — `localhost` OK en dev, TLS requis en prod (Caddy auto-TLS ou managé).
- **Socket.IO 4.8.x** apporte rooms, reconnexion, connection state recovery, middlewares `io.use`/`socket.use` — exactement ce qu'il faut pour un relay performer→listeners avec gate de rôle + rate limiting per-socket.
- L'invariant produit **one-way broadcast, single owner performer** est **implémentable simplement** via un secret partagé `OWNER_SECRET` (saisie manuelle côté performer, `socket.auth`, comparaison timing-safe) + un `PerformerRegistry` qui refuse un 2ᵉ performer.
- Le timing MVP est **délibérément simple** : scheduler natif `MIDIOutput.send(data, timestamp)` + lookahead ~40 ms + fallback immédiat + warning local de backpressure. Pas de précision type audio-live, pas de compensation avancée.

**Verdict :** aucune blocker technique identifiée pour le MVP. La stack est mature, les risques sont mitigables, et l'architecture est isolée pour extension future (Redis, multi-room, auth JWT, SysEx) sans rewrite.

## Invariants du projet (à figer dans Brief, PRD, Architecture)

> Ces invariants sont **non-négociables** pour le MVP. Toute dérive doit passer par un correct-course explicite.

1. **FM Live Wire est un système one-way broadcast.** Le flux va strictement `Performer → Serveur → Listeners`. Aucun chemin retour pour le MIDI.
2. **Je (Zub, admin/owner) diffuse une composition MIDI** depuis mon poste (Ableton, clavier MIDI, séquenceur).
3. **Les utilisateurs reçoivent le flux MIDI chez eux** via le site web.
4. **Le flux est envoyé vers leur sortie MIDI locale** (port `MIDIOutput` sélectionné dans le navigateur).
5. **Leur synthé FM génère le son** (Dexed, Volca FM, DX7, etc.) — le projet **ne streame jamais d'audio**.
6. **Les listeners ne peuvent pas envoyer de MIDI vers la performance.** Aucun jam collaboratif, aucun chat MIDI bidirectionnel.
7. **Un seul performer/admin est autorisé** à envoyer du MIDI. Un 2ᵉ performer est **refusé** (`performer:busy`).
8. **Pas de SysEx dans le MVP** (filtre performer + schéma serveur, double défense).
9. **Panic est local côté listener** (CC 64/120/121/123 × 16 canaux) et **fonctionne même déconnecté du serveur**, tant que la sortie MIDI locale est disponible.
10. **Web MIDI nécessite un navigateur compatible (Chrome/Edge desktop) et un contexte sécurisé HTTPS.**

## Décisions — 4 catégories distinctes

> La synthèse distingue explicitement ce qui est **stable**, ce qui est **recommandé pour le MVP**, ce qui est **à revérifier au scaffolding**, et ce qui est **hors MVP**.

### 1. Décisions d'architecture STABLES (invariants structurels)

Ces décisions ne bougeront pas pendant le MVP et guident l'étape Architecture (CA) :

- **One-way broadcast** + **single owner performer** (voir invariants §ci-dessus).
- **Mono-process Express + Socket.IO, mono-domaine HTTPS** (zéro CORS, secure context uniforme).
- **Contrat wire `midi:event` JSON compact, versionné `v:1`**, source unique via `@fmlw/shared` (Zod).
- **Défense en profondeur** : validation performer (filtre SysEx) + serveur (Zod `.strict()` + gate rôle + rate limit per-socket) + listener (ranges avant `send`).
- **Panic local pur**, indépendant de l'état de connexion Socket.IO.
- **Exclusion SysEx** du MVP (décision produit + technique).
- **Listener read-only** : aucun `midi:event` sortant autorisé ; gate `socket.use` enforce.
- **8 ADRs à formaliser** (ADR-0001 → ADR-0008, voir §« ADRs proposés »).

### 2. Choix techniques RECOMMANDÉS pour le MVP

Ces choix sont recommandés par la recherche mais **peuvent être ajustés** à l'Architecture/implémentation sans invalider les invariants :

- **Web MIDI API native** (vs WEBMIDI.js) — l'API native couvre le périmètre MVP.
- **Monorepo pnpm workspaces léger** : `apps/{web,server}` + `packages/shared` (`@fmlw/shared` = Zod `MidiEvent`). Pas de Turborepo pour le MVP.
- **Structure frontend feature-based** (`features/{performer,listener}`, dépendances directionnelles).
- **Structure backend** Controller → Service + couche Socket dédiée (`PerformerRegistry`, `RelayService`, `RoomService`, `ValidationService`).
- **Client state : Zustand** (~1KB, pas de Provider). Pas de TanStack Query (pas d'API REST métier).
- **Schéma wire `midi:event`** : champs communs `v/type/channel/roomId/seq/ts` + conditionnels selon type ; `channel` 0–15 data / 1–16 UI ; `pitchBend` 14-bit 0–16383 (8192 = centre) ; `performerId = socket.id` serveur-side (anti-spoofing).
- **Auth owner MVP** : `OWNER_SECRET` (env serveur), saisie manuelle côté performer, `socket.auth.token`, comparaison `crypto.timingSafeEqual`. **Pas de `VITE_*`**. Pas de localStorage MVP.
- **Rate limiting** : token bucket per-socket via `socket.use` (burst 200, refill 100/s) — les limiteurs HTTP ne voient pas les frames WS.
- **Timing listener** : `send(data, performance.now() + lookahead)` (~40 ms), buffer borné (cap 256), fallback immédiat si trop ancien, warning UI local de backpressure (pas d'event serveur).
- **Panic** : CC 64→120→121→123 × 16 canaux ; Force Panic (noteOff sweep 2048) en bouton opt-in.
- **Logs** : structurés, échantillonnés pour le flux MIDI (pas de log par event) ; `LOG_MIDI=1` pour debug.
- **Déploiement** : HTTPS mono-domaine (Caddy auto-TLS ou managé Render/Fly.io) ; `/health` ; graceful shutdown.
- **Tests** : Vitest + jsdom + `web-midi-test` (unitaires) + Socket.IO in-process (intégration) + plan manuel IAC/Dexed/MIDI Monitor + **Mock MIDI output** pour CI/démo.

### 3. Versions de packages — À VÉRIFIER au moment du scaffolding

> ⚠️ **Les versions ci-dessous sont des recommandations temporaires de recherche (Déc 2025), pas des décisions définitives.** Au moment du scaffolding, revérifier les **dernières versions stables compatibles entre elles** pour :

| Package | Recommandation recherche (Déc 2025) | Action scaffolding |
|---|---|---|
| `react` / `react-dom` | 19.x | Revérifier latest stable |
| `vite` | 6.x | Revérifier + compat React plugin |
| `typescript` | 5.6+ | Revérifier latest stable |
| `socket.io` / `socket.io-client` | 4.8.3 (23 Déc 2025) | Revérifier ; pinner ^4.x les deux côtés (compat 4.x↔4.x) |
| `zod` | 3.23+ (ou 4.x) | Revérifier (rupture API possible entre 3 et 4) |
| `zustand` | 5.x | Revérifier |
| `vitest` | 2.x | Revérifier + compat jsdom |
| `web-midi-test` | latest (jazz-soft) | Revérifier maintenance/compat |
| `express` | 4.21+ / 5.x | Revérifier (4 vs 5 = breaking) |
| `eslint` | 9.x (flat config) | Revérifier |

**Règle scaffolding** : `pnpm outdated` + matrice de compatibilité (Socket.IO client/serveur même majeure ; Zod 3 vs 4 ; Express 4 vs 5) avant de figer les `package.json`.

### 4. Éléments HORS MVP (futur, explicitement exclus du MVP)

- **SysEx** + envoi de **patches DX7 SysEx**.
- **Presets par type de synthé** (Dexed/Volca FM/DX7).
- **Enregistrement / replay de séquences** + **mode radio générative**.
- **Rooms multiples** + **création de room auth-gated** (MVP : room unique `fm-live-wire:main`).
- **Auth JWT légère** + RBAC (Owner/Admin/Listener) + **multi-performers** par room + summing.
- **Compensation de latence avancée** (alignement d'horloges, RTT, predictive scheduling, re-loging).
- **MIDI clock / transport** + MIDI 2.0 UMP.
- **Visualisations MIDI**.
- **Scale-out multi-instance** (Redis Streams adapter) + CDN static.
- **Persistance** (DB pour séquences/presets).
- **Polyfill Safari JZZ** (si audience Safari devient nécessaire).
- **Télémétrie Panic agrégée** côté serveur.
- **Backpressure avancée** (re-loging, predictive drop).

## Implementation Roadmap (récapitulatif)

1. Scaffold monorepo pnpm + `@fmlw/shared` (Zod `MidiEvent`) + tsconfig strict.
2. Backend skeleton : Express + `/health` + Socket.IO + middlewares + `PerformerRegistry` + `RelayService`.
3. Shared validation intégrée front+back.
4. Page Performer : saisie token + input MIDI + encode + emit + monitoring.
5. Page Listener : output MIDI + channel + test note + room:join + scheduler + Panic local + Mock output.
6. Tests : Vitest + `web-midi-test` + plan manuel IAC/Dexed.
7. Déploiement HTTPS + `.env.example` + README.

## Risk Assessment (récapitulatif)

| Risque | Mitigation MVP |
|---|---|
| Safari non supporté | Détection feature + message Chrome/Edge |
| HTTPS obligatoire | localhost dev + TLS prod (Caddy/managé) |
| Latence/jitter | Scheduler `send(data, ts)` + lookahead + warning |
| Token owner leaked build | Pas de `VITE_*` ; saisie manuelle ; `socket.auth` |
| 2ᵉ performer | `PerformerRegistry` + refus `performer:busy` |
| Stuck notes | Panic local + Force Panic |
| Rate limit contourné WS | `socket.use` token bucket per-socket |
| SysEx injecté | Filtre performer + schéma serveur |
| Owner déconnecté | UI listener + Panic local dispo |

## KPIs MVP (récapitulatif)

- 5 types d'événements relayés ; Panic coupe les stuck notes ; 2ᵉ performer refusé ; listener read-only enforced ; SysEx rejeté.
- Latence perçue < ~80 ms (LAN) / < ~150 ms (internet) ; < 5 % fallbacks en conditions stables.
- 100 % tests unitaires pass ; plan manuel IAC/Dexed sans bloquant.
- 0 secret dans le bundle frontend (vérifié `grep` du build) ; gate rôle 100 % effectif.

## Conclusion & Next Steps BMAD

La recherche technique **confirme l'architecture possible pour un MVP React + Node + Socket.IO** et produit :
- les **invariants** du projet (one-way broadcast, single owner, pas de SysEx, Panic local, HTTPS requis) ;
- les **décisions stables** vs **choix MVP recommandés** vs **versions à revérifier** vs **hors MVP** ;
- un **plan de test** concret (IAC + Dexed + MIDI Monitor + Mock output) ;
- une **matrice de risques** mitigée.

**Aucun blocker technique identifié.** Le projet peut entrer dans la phase de planning produit.

### Prochaine étape BMAD recommandée : **Product Brief** (`bmad-product-brief`, code `[CB]`, agent analyste Mary)

Lancer `bmad-product-brief` (idéalement dans une **fenêtre de contexte fraîche** pour un brief propre) avec ce research report comme input. Le brief positionnera FM Live Wire comme un **outil de broadcast live MIDI du créateur vers une audience de synthés FM** (pas un outil collaboratif), reflétera les 10 invariants, et préparera le terrain pour le **PRD** (`bmad-prd`, `[PRD]`, agent PM John) puis l'**Architecture** (`bmad-architecture`, `[CA]`, agent architect Winston) qui formalisera les **ADRs 0001→0008**.

---

**Technical Research Completion Date:** 2026-07-06
**Source Verification:** Claims critiques multi-source (MDN, W3C, Can I Use, docs Socket.IO, npm Déc 2025, spec MMA, Apple).
**Technical Confidence Level:** **Élevé** sur support navigateur / API Web MIDI / middlewares Socket.IO / format MIDI / piège Vite. **Moyen** sur les seuils chiffrés (latence, rate limit, lookahead) — recommandations d'ingénierie à caler à l'implémentation.
**Versions:** Recommandations temporaires de recherche — à revérifier au scaffolding.

_Ce document sert de référence technique autoritaire pour FM Live Wire et d'input au Product Brief, PRD et Architecture._