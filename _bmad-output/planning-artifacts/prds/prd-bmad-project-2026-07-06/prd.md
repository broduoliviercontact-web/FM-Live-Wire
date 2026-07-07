---
title: "FM Live Wire — Product Requirements Document (MVP)"
status: final
created: 2026-07-06
updated: 2026-07-06
product: FM Live Wire
source_brief: _bmad-output/planning-artifacts/briefs/brief-bmad-project-2026-07-06/brief.md
source_research: _bmad-output/planning-artifacts/research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md
language: fr
---

# FM Live Wire — PRD MVP

> **Radio live de contrôle MIDI, pas une radio de son.**
> Un site qui diffuse les **événements MIDI** d'un seul performer vers une audience de listeners ; chaque listener route le flux vers sa **sortie MIDI locale**, et **son propre synthé FM** (Dexed, Volca FM, DX7…) génère le son.
> **Le son n'est pas transporté, il est reconstitué chez chaque listener.**

**North Star** — *un réseau de performance live où le geste instrumental voyage, pas le son — et où chaque listener possède l'instrument.*

## 1. Vision et positionnement

FM Live Wire occupe un créneau inoccupé : la combinaison de quatre propriétés qu'aucun produit vérifié ne réunit simultanément —

1. **Listeners navigateur sans install native** (un onglet Chrome/Edge, pas d'app, pas de driver côté listener).
2. **Broadcast one-way d'un performer unique vers une audience** (pas de P2P, pas de mesh, pas de jam).
3. **Son décentralisé** — chaque listener route le MIDI reçu vers son propre synthé local ; **pas de stream audio**.
4. **Framing centré synthé FM** (Dexed / Volca FM / DX7, classe DX7).

Le différentiel est le **produit assemblé** (modèle + UX + créneau), pas un avantage technique. L'avantage concurrentiel est l'exécution et le positionnement de créneau.

> `[NOTE FOR PM]` Le « constat négatif » du signal marché reflète la couverture de recherche publique (forte mais non exhaustive) ; une mailing list ou Discord de niche pourrait exister sans apparaître dans les résultats. Ne pas sur-énoncer l'absence de concurrence.

## 2. Objectifs produit (MVP)

- **O-1** Permettre à un performer FM de **diffuser en live** les événements MIDI de son jeu (5 types) vers une audience, depuis un navigateur, sans installer d'app native.
- **O-2** Permettre à un listener FM de **recevoir le flux et de l'entendre sur son propre synthé**, en choisissant sa sortie MIDI locale et son canal, sans compte ni installation.
- **O-3** Garantir le modèle **one-way / read-only** : un seul performer émet, les listeners ne peuvent jamais envoyer de MIDI vers la performance.
- **O-4** Prouver le format « radio instrumentale FM » lors d'**au moins une session live réelle** devant une petite audience, sans incident bloquant.
- **O-5** Livrer une base technique saine (sécurité, validation stricte, backpressure borné) qui rende les extensions futures (rooms multiples, SysEx/presets, replay, multi-performers) **envisageables sans réécriture** — sans les construire maintenant.

## 3. Non-objectifs (hors MVP)

- **N-1** Streaming audio (jamais, par nature du produit) — le son est toujours local.
- **N-2** SysEx (et patches DX7 SysEx) ; presets par type de synthé.
- **N-3** Enregistrement / replay de séquences ; mode radio générative.
- **N-4** Rooms multiples + création auth-gated — **MVP : room unique `fm-live-wire:main`**.
- **N-5** Auth JWT + RBAC ; multi-performers par room ; summing / mixage ; **jam collaboratif** ; **chat MIDI bidirectionnel**.
- **N-6** Compensation de latence avancée (alignement d'horloges, RTT, predictive scheduling, re-loging).
- **N-7** MIDI clock / transport ; MIDI 2.0 UMP ; visualisations MIDI.
- **N-8** Scale-out multi-instance (Redis Streams adapter) ; CDN static ; **persistance (DB)**.
- **N-9** Polyfill Safari (JZZ) ; télémétrie Panic agrégée ; backpressure avancé.
- **N-10** Mobile (Chrome Android/Samsung) — cible desktop uniquement pour le MVP.

Le multi-performer / collaboration est un **mode futur séparé, pas une évolution naturelle du cœur MVP** — à ne considérer que si une demande réelle émerge.

## 4. Personas

### P-1 — Performer / Owner (Zub)
Musicien FM jouant Dexed / Volca FM / DX7. Veut **broadcaster live** à une communauté qui possède un synthé FM compatible (ou un synthé virtuel comme Dexed standalone), plutôt que streamer un mix audio passif. Branche un clavier/séquenceur ou un DAW (Ableton via IAC) comme source MIDI. Opère le site, détient le secret owner, anime la session.

### P-2 — Listener (communauté FM)
Membre de la communauté FM (Dexed / Volca FM / DX7) qui possède un synthé FM et une sortie MIDI accessible depuis le navigateur (USB-MIDI matériel, ou bus virtuel type IAC → Dexed standalone). Veut **entendre la performance live sur son propre synthé**, observer les gestes instrumentaux / événements / CC en direct, et couper le son en cas de besoin (Panic local). Pas de compte, pas d'install.

### Audience initiale
Petite communauté d'enthousiastes FM, MAO, synth et MIDI hackers — **pas mainstream**. La forme est une **session radio** (5–20 listeners), pas un service à grande échelle.

## 5. Parcours utilisateur

### UJ-1 — Parcours Performer (Zub)
1. Zub ouvre `/performer` dans Chrome/Edge (HTTPS). La page est **publique et statique** (aucun secret dans le build).
2. Il saisit son **admin token** (`OWNER_SECRET`) pour la session.
3. Il autorise l'accès MIDI ; il **sélectionne son entrée MIDI** (clavier USB, ou IAC Driver provenant d'Ableton).
4. Il joue. La page affiche un **monitoring** en direct des événements envoyés (type, canal, valeur).
5. Le serveur valide son rôle (token timing-safe), l'enregistre comme **owner unique** ; un deuxième performer serait refusé (`performer:busy`).
6. Ses événements (5 types) sont relayés vers tous les listeners connectés à `fm-live-wire:main`.
7. Fin de session : il se déconnecte / ferme l'onglet ; le serveur libère le slot owner ; les listeners voient « Performer déconnecté ».

### UJ-2 — Parcours Listener (Maria, communauté FM)
1. Maria ouvre `/listener` dans Chrome/Edge (HTTPS). **Pas de compte.**
2. Le navigateur demande l'autorisation MIDI ; elle accepte.
3. Elle **choisit sa sortie MIDI locale** (port matériel, ou bus virtuel IAC `FMLW → Dexed`) — ou le **mode Mock / Debug** pour tester sans périphérique.
4. Elle **choisit son canal** (1–16). Par remappage forcé, **tout** le flux du performer sera rerouté vers ce canal — utile car son Volca FM n'écoute qu'un canal.
5. Elle clique **« Rejoindre »** ; elle reçoit le flux live.
6. Elle clique **« Note de test »** pour vérifier que Dexed sonne et que MIDI Monitor affiche les bons bytes.
7. Le performer joue : Maria entend la performance **sur son propre synthé**, avec une latence perçue cible < ~80 ms (LAN) / < ~150 ms (internet typique).
8. Une note reste coincée (noteOff perdu) → elle clique **Panic local** ; le son s'arrête. **Panic fonctionne même si le serveur est down.**
9. Si elle veut tout couper étendument : **Force Panic** (opt-in, bouton secondaire avec avertissement « ~1–2 s »).
10. Si le flux est trop en retard : **warning local** (pas de queue infinie), elle peut Panic ou quitter.

> `[ASSUMPTION]` Noms des protagonistes listener (Maria) et du port IAC (`FMLW → Dexed`) inférés pour rendre le parcours concret ; à ajuster librement.

## 6. Exigences fonctionnelles

Les IDs (FR-N) sont stables et globalement numérotés.

### 6.1 Rôles et accès

- **FR-1** L'application expose deux rôles : **Performer (owner unique)** et **Listener (read-only)**. Aucun autre rôle en MVP.
- **FR-2** Le Performer s'authentifie via un **secret partagé** (`OWNER_SECRET`) saisi manuellement à chaque session dans la page `/performer`. Le secret **n'est jamais dans le build frontend** (aucune variable `VITE_*` pour le secret).
- **FR-3** Le Listener rejoint **sans token** (`auth: { role: "listener" }`). Pas de compte, pas d'install.
- **FR-4** **Un seul Performer à la fois.** Un deuxième performer valide est refusé avec le code `performer:busy` (message clair côté client). Pas de remplacement silencieux.
- **FR-5** À la déconnexion du Performer, le serveur libère le slot owner et notifie les listeners (« Performer déconnecté »).

### 6.2 Capture et relay Performer

- **FR-6** Le Performer sélectionne une **entrée MIDI** parmi les ports Web MIDI disponibles.
- **FR-7** Le Performer relaye **exactement 5 types d'événements** : `noteOn`, `noteOff`, `controlChange`, `programChange`, `pitchBend`. **Jamais d'audio.**
- **FR-8** **SysEx rejeté en double défense** : filtre performer (`0xF0` jamais envoyé) + schéma serveur qui n'expose aucun type SysEx (rejet automatique).
- **FR-9** La page `/performer` affiche un **monitoring** en direct des événements envoyés (type, canal, valeur principale).
- **FR-10** Chaque événement transporte : `v=1`, `type`, `channel` (0–15), `roomId="fm-live-wire:main"`, `seq` (uint32 monotone par performer), `ts` (DOMHighResTimeStamp). `performerId` est **interdit/ignoré dans le payload** — le serveur l'attache (`socket.id`).

### 6.3 Réception et rendu Listener

- **FR-11** Le Listener **rejoint la room** `fm-live-wire:main` et reçoit le flux `midi:event` en direct.
- **FR-12** Le Listener **choisit sa sortie MIDI locale** parmi les ports Web MIDI disponibles, **ou** le **mode Mock / Debug** (visualisation des bytes à l'écran, sans périphérique).
- **FR-13** Le Listener **choisit un canal** (1–16, UI ; 0–15 en données). **Remappage forcé** : tous les événements reçus sont reroutés vers le canal choisi par le listener avant envoi à la sortie MIDI. Le canal d'origine du performer est remplacé.
  - `[NOTE FOR PM]` Conséquence : un performer multi-timbral (ch.1 mélodie, ch.2 basse) sera entendu par un listener single-timbral comme **tout fusionné sur son canal unique**. C'est le comportement attendu vu le choix « remappage forcé ».
- **FR-14** Le Listener dispose d'un bouton **« Note de test »** qui émet une note sur sa sortie/canal choisis pour valider la chaîne locale.
- **FR-15** Le mapping wire → bytes MIDI est **déterministe 1:1** (noteOn `0x90|ch`, noteOff `0x80|ch`, controlChange `0xB0|ch`, programChange `0xC0|ch` 2 bytes, pitchBend `0xE0|ch` lsb/msb). Convention velocity 0 = noteOff respectée.
- **FR-16** **Panic local** : bouton qui envoie CC 64 → 120 → 121 → 123 × 16 canaux (64 messages). **Doit fonctionner même déconnecté du serveur**, tant qu'une sortie MIDI locale est disponible.
- **FR-17** **Force Panic (opt-in)** : bouton secondaire avec avertissement UI « Panic étendu : ~1–2 s », qui envoie un noteOff sweep (128×16 = 2048 messages). Opt-in, pas défaut.
- **FR-18** Les seuls événements listener→serveur autorisés sont `room:join`, `room:leave`, `midi:test`. **Aucun handler `midi:event` côté listener** — le Panic n'a pas de handler serveur (purement local).

### 6.4 Sécurité / modèle one-way

- **FR-19** **One-way strict** : aucun chemin retour pour le MIDI. Un Listener qui tente `socket.emit('midi:event', …)` est rejeté (`forbidden`), loggué, et déconnecté après N tentatives.
- **FR-20** Le rôle est **déclaré à la connexion** (`auth.role`) et **épinglé** dans `socket.data.role` (non modifiable ensuite). Le `performerId` vient du serveur (`socket.id`), jamais du client.
- **FR-21** **Validation stricte** des événements via schéma partagé `@fmlw/shared` (Zod `.strict()`) : rejection des champs inconnus, des hors-plages, et `v !== 1`. Schéma identique front+back (zéro dérive).
- **FR-22** **Rate limit per-socket** (token bucket) : capacité burst 200, refill 100/s par performer. Dépassement → `rate:limited` + log échantillonné.
- **FR-23** **Allowlist d'origin** au niveau HTTP upgrade (anti-CSWSH), mono-domaine HTTPS (zéro CORS).
- **FR-24** **Fail-safe musical** : à la déconnexion d'un listener, le scheduler arrête d'envoyer (pas de notes orphelines) ; à la reconnexion, reprise du flux live **sans re-loger** le passé.

### 6.5 Backpressure Listener

- **FR-25** Buffer listener **borné à 256 événements** (`BUFFER_CAP`). Au-delà : drop oldest + warning. **Pas de queue infinie.**
- **FR-26** Si un événement est trop en retard (`MAX_LATE_MS = 200`, valeur par défaut ajustable à l'implémentation) : **fallback immédiat** pour noteOn/noteOff (ne pas perdre la note) ; drop acceptable pour CC haute-fréquence. Warning UI local. (Politique par défaut figée ; le tuning du seuil reste un paramètre.)
- **FR-27** `listener:overload` est un **warning UI local pur**, pas un événement serveur.

### 6.6 Opérations

- **FR-28** Healthcheck `GET /health` → `{ ok, uptime, owner: bool, listeners: n }`.
- **FR-29** **Graceful shutdown** : notification clients, drain connexions, fermeture propre Socket.IO.
- **FR-30** **Logs structurés, échantillonnés** pour le flux MIDI (pas de log par événement) ; `LOG_MIDI=1` pour debug dev ; log des connexions, changements de room, erreurs de validation (échantillonnées 1/N avec `seq` + raison), rate-limit hits (compteur agrégé + flush périodique), Panic déclenché.

## 7. Exigences non fonctionnelles

### Performance
- **NFR-1** Latence perçue performer→listener **< ~80 ms (LAN) / < ~150 ms (internet typique)**, mesurée via `srvTs - ts`.
- **NFR-2** **< ~5 % de fallbacks immédiats** en conditions stables.
- **NFR-3** Soutenir **100 `midi:event`/s** en continu, **burst court 200 `midi:event`/s** (rate limit aligné).
- **NFR-4** Cible **5–20 listeners simultanés** (mono-process largement suffisant ; ~10k+ connexions théoriques).
- **NFR-5** Scheduler listener via `MIDIOutput.send(data, performance.now() + lookahead)`, lookahead ~40 ms (configurable 30–50), scheduling niveau driver (anti-jitter).

### Compatibilité navigateur
- **NFR-6** **Cible MVP : Chrome/Edge desktop en HTTPS** (Web MIDI API native). Firefox v108+ accepté en secondaire.
- **NFR-7** **Safari non supporté** : feature detection (`'requestMIDIAccess' in navigator`) + message clair « Chrome/Edge requis ». **Aucun investissement polyfill en MVP.**
- **NFR-8** **HTTPS obligatoire** (Web MIDI `[SecureContext]`) ; dev sur localhost, prod TLS (Caddy auto-TLS ou host managé).

### Sécurité
- **NFR-9** **Zéro secret dans le bundle frontend**, vérifié par `grep` du build. `OWNER_SECRET` côté serveur uniquement, comparaison **timing-safe** (`crypto.timingSafeEqual`), messages d'erreur génériques (anti-énumération).
- **NFR-10** Pas de `localStorage` pour le token en MVP (ressaisi à chaque session) ; token jamais dans l'URL ; `.env` gitignored ; `.env.example` sans valeurs.
- **NFR-11** Contrôle de rôle **100 % effectif** : un listener ne peut jamais émettre de `midi:event` accepté.

### Architecture / stack
- **NFR-12** **Stack fixe** : React + Vite + TypeScript / Node + Express + Socket.IO / Web MIDI API native / **monorepo pnpm** avec package partagé `@fmlw/shared` (Zod) pour le contrat MIDI.
- **NFR-13** **Mono-process, mono-domaine HTTPS, état en mémoire, pas de DB, pas de Redis.** Architecture isolée pour permettre un futur swap vers Redis Streams adapter **sans réécriture**.
- **NFR-14** Pin `transports: ["websocket"]` en prod (pas de long-polling fallback).
- **NFR-15** Wire format **JSON compact `v:1`** (debuggable + Zod + logs lisibles ; overhead négligeable à l'échelle humaine).

### Qualité / test
- **NFR-16** **Tests unitaires 100 %** sur : mapping wire→bytes, Panic, scheduler, schéma, owner registry, rate limit.
- **NFR-17** Tests d'intégration Socket.IO in-process ; mock Web MIDI via `web-midi-test` (Vitest + jsdom).
- **NFR-18** **Test manuel prioritaire exécuté sans bloqueur** : macOS IAC Driver → Dexed standalone → MIDI Monitor (plan détaillé en addendum).
- **NFR-19** **Mock MIDI Output mode** pour valider le pipeline (socket → scheduler → encode) sans IAC ni Dexed (CI + demos).

### Conformité produit
- **NFR-20** Les **10 invariants techniques non-négociables** de la recherche (one-way, owner unique, no SysEx, Panic local, HTTPS, Chrome/Edge, etc.) sont respectés.

## 8. Critères de succès

| ID | Critère | Comment mesurer |
|----|---------|-----------------|
| **S-1** | Les 5 types d'événements MIDI sont relayés correctement | Test manuel IAC/Dexed + tests unitaires mapping |
| **S-2** | Panic local coupe les notes coincées, **même serveur down** | Test manuel étape 7 (kill backend) |
| **S-3** | Un 2ᵉ performer est refusé (`performer:busy`) | Test manuel étape 8 |
| **S-4** | Les listeners sont read-only (filtrage effectif à 100 %) | Test manuel étape 9 (console emit → `forbidden`) |
| **S-5** | SysEx rejeté (double défense) | Test manuel étape 10 |
| **S-6** | Latence perçue < ~80 ms LAN / < ~150 ms internet ; < ~5 % fallbacks | Télémétrie `srvTs - ts` + compteur fallback |
| **S-7** | Zéro secret dans le bundle frontend ; token timing-safe | `grep` du build + revue code |
| **S-8** | Tests unitaires à 100 % sur les modules listés (NFR-16) | Couverture CI |
| **S-9** | Plan de test manuel IAC/Dexed/MIDI Monitor exécuté sans point bloquant | Checklist signée |
| **S-10** | **Au moins une session live complète** par Zub devant une petite audience réelle, sans incident bloquant — preuve que le format « radio instrumentale FM » fonctionne comme expérience | Compte-rendu de session |

**Contre-métriques** : latence perçue > 150 ms en condition stable, taux de fallback > 5 %, fuite de secret dans le bundle, listener capable d'émettre un `midi:event` accepté → échec du critère correspondant.

## 9. Risques

| ID | Risque | Probabilité | Impact | Atténuation MVP |
|----|--------|-------------|--------|-----------------|
| **R-1** | Safari non supporté | Certain | Moyen | Feature detection + message « Chrome/Edge requis » (pas de polyfill) |
| **R-2** | HTTPS absent en prod (Web MIDI bloqué) | Certain si non géré | Bloquant | TLS obligatoire (Caddy/managed), dev localhost |
| **R-3** | Latence/jitter réseau | Moyen | Moyen | Scheduler + lookahead + backpressure warning |
| **R-4** | 2ᵉ performer tente de prendre la main | Moyen | Moyen | `PerformerRegistry` + `performer:busy` |
| **R-5** | noteOff perdu → note coincée | Moyen | Moyen | Panic local + Force Panic |
| **R-6** | Rate limit contourné via WS | Moyen | Moyen | Token bucket per-socket `socket.use` |
| **R-7** | Injection SysEx | Faible | Élevé | Double défense (filtre performer + schéma serveur) |
| **R-8** | Owner déconnecte en pleine performance | Moyen | Moyen | UI listener « Performer déconnecté » + Panic local dispo |
| **R-9** | Fuite du secret owner via le build | Éliminé par design | Élevé | Pas de `VITE_*`, saisie manuelle, `socket.auth` |
| **R-10** | Versions de paquets (recommandations recherche Dec 2025) périmées au scaffolding | Moyen | Faible–Moyen | `pnpm outdated` + matrice compat au scaffolding (Socket.IO même major, Zod 3 vs 4, Express 4 vs 5) |
| **R-11** | Pas de borne supérieure garantie sur latence MIDIInput (W3C #187) | Certain | Faible | MVP relaye, n'enregistre pas — précision recording hors scope |
| **R-12** | Sur-énoncer l'absence de concurrence (couverture recherche non exhaustive) | Moyen | Faible | Formulation prudente (cf. NOTE FOR PM §1) |

## 10. Questions ouvertes

- **Q-1** Tuning du seuil `MAX_LATE_MS` (200 par défaut) et de `LOOKAHEAD_MS` (40 par défaut) en conditions réelles — la politique fallback/drop par type est figée (FR-26), seul le calibrage reste ouvert.
- **Q-2** Re-vérification des versions de paquets au scaffolding (Zod 3 vs 4 breaking, Express 4 vs 5 breaking, Socket.IO client/server même major).
- **Q-3** Politique de déconnexion d'un listener après N tentatives `forbidden` : seuil N exact et comportement (disconnect temporaire vs ban).
- **Q-4** UX : le monitoring performer doit-il afficher `srvTs - ts` / compte de fallback côté listener agrégé, ou rester minimal ? (Implicite : minimal en MVP, mais à confirmer en UX.)
- **Q-5** Mode Mock / Debug listener : affichage des bytes uniquement, ou aussi un mini-piano virtuel pour déclencher des notes sans périphérique ?
- **Q-6** Lookahead par défaut exact dans la fourchette 30–50 ms (40 ms proposé) — à valider en UX/perf.
- **Q-7** Quelle est la prochaine extension prioritaire **si** le format trouve son public ? (Rooms multiples, SysEx/presets DX7, replay/radio générative, multi-performer) — décision de roadmap post-traction, pas MVP.

## 11. Epics recommandés

Découpés pour qu'**aucun epic ne franchisse plusieurs invariants non-négociables en même temps**, et que chaque story soit codable par Claude Code en une session.

### Epic 1 — Fondation monorepo & contrat MIDI
Scaffold pnpm monorepo (`apps/web`, `apps/server`, `packages/shared`), schéma Zod `@fmlw/shared`, mapping wire→bytes, config Vite/Express mono-domaine HTTPS.

### Epic 2 — Serveur Socket.IO & sécurité one-way
`io.use` (rôle + performerId), `socket.use` (role gate + rate limit), `PerformerRegistry` (owner unique, `performer:busy`), validation 3-couches, `OWNER_SECRET` timing-safe, origin allowlist, `/health`, graceful shutdown.

### Epic 3 — Page Performer
Page publique `/performer`, saisie token, sélection entrée MIDI, capture Web MIDI, relay des 5 types, filtre SysEx performer, monitoring des événements envoyés, gestion `performer:busy`.

### Epic 4 — Page Listener & rendu local
Page `/listener`, autorisation MIDI, sélection sortie MIDI (+ Mock/Debug), sélection canal **remappage forcé**, `room:join`, réception `midi:event`, mapping → `MIDIOutput.send(data, ts)`, note de test, feature detection Chrome/Edge.

### Epic 5 — Backpressure & Panic local
Scheduler lookahead (40 ms), buffer borné 256, fallback/drop selon `MAX_LATE_MS`, warning UI local `listener:overload`, Panic local (CC ×16) **serveur-déconnecté-proof**, Force Panic opt-in, fail-safe musical déconnexion.

### Epic 6 — Tests & validation manuelle
Tests unitaires (mapping, panic, scheduler, schéma, registry, rate limit) 100 %, intégration Socket.IO in-process, mock `web-midi-test`, Mock MIDI Output, plan manuel IAC → Dexed → MIDI Monitor, vérification `grep` zéro-secret, ADRs 0001–0008.

## 12. Stories (codables par Claude Code)

Chaque story est petite, autonome, avec critères d'acceptation testables. `[ASSUMPTION]` signale une inférence à valider au grooming.

### Epic 1 — Fondation monorepo & contrat MIDI

- **Story 1.1 — Scaffold monorepo pnpm**
  - Créer `pnpm-workspace.yaml`, `apps/web` (Vite + React + TS), `apps/server` (Node + Express + TS), `packages/shared`.
  - AC : `pnpm install` ok ; `pnpm --filter web dev` et `pnpm --filter server dev` démarrent ; TS config partagée.
- **Story 1.2 — Package `@fmlw/shared` + schéma Zod `MidiEvent`**
  - Définir `MidiEventSchema` (`.strict()`) : `v=1`, `type` enum, `channel` 0–15, `roomId`, `seq` uint32, `ts`, + champs conditionnels par type. Pas de type SysEx.
  - AC : `safeParse` rejette champs inconnus, hors-plages, `v≠1`, SysEx ; tests unitaires 100 % sur cas valides/invalides.
- **Story 1.3 — Mapping wire → bytes MIDI (déterministe 1:1)**
  - Fonction pure `toMidiBytes(event) → Uint8Array` pour les 5 types, avec convention velocity 0 = noteOff, pitchBend lsb/msb.
  - AC : tests unitaires couvrent chaque type + limites (0, 127, 16383, 8192) ; 100 %.
- **Story 1.4 — Config Express mono-domaine HTTPS + `/health`**
  - Express sert le build Vite statique + `GET /health` → `{ ok, uptime, owner: bool, listeners: n }` (owner/listeners = stubs pour l'instant).
  - AC : `https://localhost` local fonctionne ; `/health` répond.

### Epic 2 — Serveur Socket.IO & sécurité one-way

- **Story 2.1 — Socket.IO server + `io.use` (rôle, performerId)**
  - Brancher Socket.IO sur Express ; `io.use` épingle `socket.data.role` + `socket.data.performerId = socket.id` depuis `auth`.
  - AC : listeners connectent sans token ; performer avec token valide est marqué performer ; tests intégration.
- **Story 2.2 — `OWNER_SECRET` timing-safe + anti-énumération**
  - Comparaison `crypto.timingSafeEqual` vs `process.env.OWNER_SECRET` ; erreurs génériques ; `.env`/`.env.example`.
  - AC : token faux → erreur générique ; pas de timing leak mesurable ; pas de `VITE_*`.
- **Story 2.3 — `PerformerRegistry` + `performer:busy`**
  - Registry in-memory `ownerPerformerId: string|null` ; 2ᵉ performer → `next(Error("performer:busy"))` ; déconnexion libère.
  - AC : tests unitaires/intégration : 1er ok, 2ᵉ refusé, déconnexion libère le slot.
- **Story 2.4 — Role gate per-event `socket.use` + rate limit token bucket**
  - `socket.use` : si `role !== performer || performerId !== owner` sur `midi:event` → `forbidden`. Token bucket capacity 200 / refill 100/s → `rate:limited`.
  - AC : listener emit `midi:event` → `forbidden` ; burst > 200 → `rate:limited` ; tests 100 %.
- **Story 2.5 — Handler `midi:event` : validation Zod + broadcast room**
  - `safeParse` → `ack({ok:false,error,issues})` ou `relayService.broadcast("fm-live-wire:main", data)` ; `srvTs` ajouté ; pas de re-log.
  - AC : événement valide broadcasté à la room ; invalide rejeté avec `issues` ; tests intégration.
- **Story 2.6 — Origin allowlist + graceful shutdown**
  - `origin: process.env.PUBLIC_ORIGIN` au upgrade ; shutdown : notify clients, drain, close `io`.
  - AC : origin non allowlistée rejetée ; shutdown propre en test.

### Epic 3 — Page Performer

- **Story 3.1 — Page `/performer` (publique, statique) + saisie token**
  - Route `/performer` ; champ « admin token » ; connexion Socket.IO avec `auth: { role:"performer", token }` ; gestion `connect_error` (`performer:busy` message).
  - AC : pas de secret dans le build (`grep`) ; `performer:busy` affiché clairement.
- **Story 3.2 — Sélection entrée MIDI + capture Web MIDI**
  - `requestMIDIAccess({sysex:false})` ; liste inputs ; `MIDIInput.onmessage` → payload `MidiEvent` (5 types) ; filtre SysEx (`0xF0` jamais envoyé) ; `seq` monotone, `ts` `event.timeStamp`.
  - AC : 5 types émis avec bons champs ; SysEx jamais émis ; `performerId` absent du payload.
- **Story 3.3 — Monitoring performer + relay**
  - Affichage en direct type/canal/valeur ; `socket.emit("midi:event", payload)` + `ack` ; état connexion.
  - AC : monitoring reflète le jeu ; ack gère `invalid`/`rate:limited` gracieusement.
- **Story 3.4 — Gestion déconnexion / libération slot**
  - Déconnexion / fermeture onglet → serveur libère owner ; UI performer gère reconnect.
  - AC : après déconnexion, un nouveau performer peut prendre le slot.

### Epic 4 — Page Listener & rendu local

- **Story 4.1 — Page `/listener` + autorisation MIDI + feature detection**
  - Route `/listener` ; feature detection Web MIDI ; message « Chrome/Edge requis » si absent ; `requestMIDIAccess`.
  - AC : navigateur non supporté → message clair ; autorisation refusée gérée.
- **Story 4.2 — Sélection sortie MIDI + Mock/Debug**
  - Liste outputs ; option « Mock / Debug » (`MockMidiOutput.send` visualise les bytes) ; persistance choix dans la session.
  - AC : sélection réelle envoie vers le port ; Mock affiche les bytes ; déconnexion port gérée.
- **Story 4.3 — Sélection canal + remappage forcé**
  - Sélecteur canal 1–16 (UI) → 0–15 (data) ; remap du canal sur tout événement reçu avant `send`.
  - AC : événement entrant sur ch.5, listener sur ch.1 → bytes émis sur ch.1 ; tests unitaires remap.
- **Story 4.4 — `room:join` + réception `midi:event` + scheduling `send(data, ts)`**
  - `room:join` `fm-live-wire:main` ; réception → `toMidiBytes` → remap canal → `send(data, performance.now()+lookahead)` ; `room:leave`.
  - AC : flux live atteint la sortie MIDI ; latence perçue affichée (`srvTs - ts`).
- **Story 4.5 — Note de test listener**
  - Bouton « Note de test » → émet note sur sortie/canal choisis.
  - AC : note audible (ou visible en Mock) ; confirme la chaîne locale.

### Epic 5 — Backpressure & Panic local

- **Story 5.1 — Scheduler lookahead + buffer borné 256**
  - `LOOKAHEAD_MS=40`, `BUFFER_CAP=256` ; target = `recvPerfNow + lookahead` ; si futur → schedule, si trop vieux → fallback/drop ; drop oldest au-delà du cap + warning.
  - AC : tests unitaires scheduler (futur/past/cap) ; pas de queue infinie.
- **Story 5.2 — Fallback/drop par type + warning UI `listener:overload`**
  - `MAX_LATE_MS=200` ; noteOn/noteOff → fallback immédiat ; CC HF → drop acceptable ; warning UI local pur (pas d'event serveur) + compteur fallback.
  - AC : comportement par type testé ; warning affiché ; pas d'event serveur.
- **Story 5.3 — Panic local (CC ×16) serveur-déconnecté-proof**
  - Bouton Panic → CC 64 → 120 → 121 → 123 × 16 canaux ; **fonctionne même déconnecté du serveur** tant que sortie MIDI locale dispo.
  - AC : test manuel kill backend → Panic coupe le son ; tests unitaires séquence.
- **Story 5.4 — Force Panic opt-in (FR-17)**
  - Bouton secondaire opt-in avec avertissement « ~1–2 s » → noteOff sweep 128×16 = 2048 messages.
  - AC : avertissement affiché avant envoi ; sweep envoyé sur sortie/canal ; tests unitaires séquence.
- **Story 5.5 — Fail-safe musical déconnexion listener (FR-24)**
  - À la déconnexion listener (ou perte sortie MIDI), le scheduler arrête d'envoyer (pas de notes orphelines) ; à la reconnexion, reprise du flux live sans re-loger le passé.
  - AC : déconnexion → arrêt net (pas de bytes en vol) ; reconnexion → reprise live ; tests unitaires/intégration.

### Epic 6 — Tests & validation manuelle

- **Story 6.1 — Tests unitaires 100 % (mapping, panic, scheduler, schéma, registry, rate limit)**
  - Vitest + jsdom ; couverture cible 100 % sur ces modules.
  - AC : CI verte ; 100 % sur les modules listés.
- **Story 6.2 — Tests intégration Socket.IO in-process + `web-midi-test`**
  - Server + client Socket.IO in-process ; mock `requestMIDIAccess` via `web-midi-test` ; scénarios join/relay/forbidden/busy.
  - AC : scénarios passent ; pas de port matériel requis.
- **Story 6.3 — Plan de test manuel IAC → Dexed → MIDI Monitor**
  - Checklist exécutable (11 étapes de la recherche) ; résultat signé.
  - AC : toutes étapes passent sans bloqueur ; latence mesurée.
- **Story 6.4 — Vérification zéro-secret + ADRs 0001–0008**
  - `grep` du build pour `OWNER_SECRET` ; ADRs (mono-process, one-way owner unique, Web MIDI native, in-memory isolation Redis-swap, JSON v:1 wire, OWNER_SECRET vs JWT, scheduler lookahead, SysEx exclusion).
  - AC : grep négatif ; ADRs versionnés.

## 13. Annexes & références

- **Product Brief** : `_bmad-output/planning-artifacts/briefs/brief-bmad-project-2026-07-06/brief.md`
- **Addendum Brief** : `…/briefs/brief-bmad-project-2026-07-06/addendum.md`
- **Recherche technique** : `_bmad-output/planning-artifacts/research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md`
- **PRD addendum** (mécanismes transport, alternatives rejetées, plan de test détaillé, ADRs, invariants techniques) : `addendum.md` (même dossier).
- **Memlog (décisions du run)** : `.memlog.md` (même dossier).