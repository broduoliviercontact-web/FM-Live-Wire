---
title: "FM Live Wire — Product Brief"
status: validated
created: 2026-07-06
updated: 2026-07-06
validated: 2026-07-06
---

# Product Brief : FM Live Wire

## Résumé exécutif

**FM Live Wire** est un site web qui diffuse en temps réel les **événements MIDI** d'un unique performer vers une audience de listeners — sans jamais streamer d'audio. Chaque listener reçoit le flux chez lui, le route vers sa **sortie MIDI locale**, et **son propre synthétiseur FM** (Dexed, Volca FM, DX7…) génère le son. Le créateur joue ; l'audience écoute sur son matériel, dans sa propre pièce, avec sa propre chaîne de synthèse. C'est une **radio live de contrôle MIDI**, pas une radio de son.

Le problème : aucun moyen simple, navigateur-ouvert, pour qu'un musicien FM diffuse une performance live à un public qui possède un synthé FM compatible (ou un synthé virtuel type Dexed) — l'audio streaming fige le son, les ponts MIDI réseau sont point-à-point et natifs (détails en §Le problème). FM Live Wire occupe le vide entre les deux.

L'inversion : **le son n'est pas transporté, il est reconstitué chez chaque listener** (détails en §Ce qui le rend différent). La valeur créative principale — pour Zub, performer et owner — est de partager une esthétique FM en direct avec une communauté qui joue un synthé FM compatible (ou un synthé virtuel type Dexed), plutôt que de viser une audience grand public.

## Le problème

Un musicien qui joue un synthé FM (Dexed, Volca FM, DX7) veut pouvoir **jouer en direct devant un public**, mais le public visé n'est pas un public d'auditeurs passifs d'un mix audio figé : c'est une **communauté qui possède un synthé FM compatible (ou un synthé virtuel type Dexed)** et qui veut **entendre la performance sur son propre moteur**, dans son propre environnement, avec la possibilité d'observer, de calquer, d'interagir avec les paramètres.

Aujourd'hui, ce musicien n'a pas d'outil pour ça :

- **Streamer l'audio** (Twitch, YouTube, OBS) fige le son côté diffuseur. L'audience reçoit un mix finalisé, pas du MIDI. Pas de reconstitution locale, pas d'accès au geste instrumental. Et cela consomme de la bande passante et ajoute de la latence audio.
- **Les ponts MIDI réseau** (RTP-MIDI / Apple Network MIDI, rtpMIDI de Tobias Erichsen, Bome Network) transportent du MIDI sur le réseau mais sont **point-à-point / orientés LAN**, exigent une app native, et sont pensés pour relier des stations — pas pour ouvrir une performance à un public. Aucun n'est navigateur-ouvert ; aucun ne gère "un diffuseur, N listeners".
- **Les démos OSS WebSocket-MIDI** (JZZ-midi-WS, midi-websocket, jWsMidi) gèrent techniquement le fan-out navigateur mais sont des **librairies/expériences**, pas des produits orientés audience — et aucune ne cible les synthés FM ni le modèle performer→audience.
- **live_piano** (WebRTC MIDI live, synthèse locale) est le plus proche en esprit, mais **collaboratif P2P**, pas broadcast one-way. **Ableton Link** ne synchronise que le tempo (pas d'événements MIDI). Les outils **Twitch-chat→MIDI** (TwitchMIDI, TPTS) **inversent la direction** (audience→streamer) et streament l'audio en retour.

Le coût du statu quo : la performance FM live reste **locale au studio du créateur**. Pas de diffusion gestuelle, pas d'audience-jouant-un-synthé-FM-compatible, pas de format "radio instrumentale". La communauté FM existe et est active (Dexed : 3 300+ étoiles GitHub, v1.0 en nov. 2025 ; workflows Volca FM portés jusqu'en 2026) — elle n'a juste pas le canal pour se réunir autour d'une performance live. (Détails comparables + signal marché : voir `addendum.md`.)

## La solution

FM Live Wire est une application web à **deux rôles** :

- **Performer (unique, owner)** — Zub. Connecte son entrée MIDI (clavier, séquenceur, Ableton via IAC), joue. Ses événements MIDI (noteOn, noteOff, controlChange, programChange, pitchBend) sont relayés en temps réel vers le serveur, **jamais l'audio**.
- **Listener (audience, read-only)** — ouvre la page dans Chrome/Edge, autorise l'accès MIDI, **choisit sa propre sortie MIDI locale** (port matériel, ou bus virtuel comme IAC Driver vers Dexed standalone), rejoint la room, et reçoit le flux. **Son propre synthé FM génère le son.**

L'expérience listener : un bouton "rejoindre", un sélecteur de sortie MIDI, un canal, une note de test, et un **bouton Panic local**. C'est tout. Pas de compte, pas d'install, pas d'app native — un onglet de navigateur compatible (Chrome/Edge desktop, HTTPS obligatoire). La performance sonne chez le listener sur le synthé qu'il a choisi, dans sa pièce, avec sa chaîne.

L'expérience performer : une page publique (pas de secret dans le build), une saisie de token admin, un sélecteur d'entrée MIDI, un monitoring des événements envoyés.

L'invariant structurel : **one-way broadcast**. Le flux va strictement `Performer → Serveur → Listeners`. Aucun chemin retour pour le MIDI. Les listeners sont read-only ; un seul performer est autorisé à la fois (un deuxième est refusé). Pas de jam collaboratif, pas de chat MIDI bidirectionnel — par design.

## Ce qui le rend différent

L'inversion centrale : **le son n'est pas transporté, il est reconstitué chez chaque listener.** Aucun produit vérifié ne combine les quatre propriétés que FM Live Wire réunit — listeners navigateur sans install native + broadcast one-way d'un performer unique vers une audience + son décentralisé (chaque listener route vers son propre synthé, pas de stream audio) + cadrage centré synthé FM. Le vide est documenté (voir `addendum.md`).

- **Le performer ne mixe pas, ne masterise pas.** Il ne choisit pas le timbre de l'auditeur — chaque listener possède l'instance locale de son synthé, peut observer les CC, calquer les presets, restituer la performance sur un synthé FM compatible dans sa propre chaîne.
- **La clarté du modèle est la caractéristique, pas une limite.** One-way broadcast (un diffuseur, une audience read-only) — contrairement à live_piano (P2P collaboratif) ou midi2-hub — rend l'autorisation, la sécurité et l'UI simples.

La singularité tient à **l'application d'idées existantes à un créneau mal servi** (communauté FM, performance live distribuée) plutôt qu'à une technologie inédite. Web MIDI, Socket.IO, et les ponts MIDI réseau sont tous matures — le différentiel est le produit assemblé autour d'eux, pas un quelconque avantage technique. L'avantage concurrentiel est l'exécution et le positionnement de créneau, pas la technologie.

## À qui cela sert

**Utilisateur principal — le Performer / owner (Zub).** Musicien FM, joue Dexed / Volca FM / DX7. Veut diffuser une performance live à une communauté qui possède un synthé FM compatible (ou un synthé virtuel type Dexed), plutôt que de streamer un mix audio passif. Succès pour lui : pouvoir ouvrir une session live et qu'une audience se connecte, entende la performance sur leur propre matériel, sans friction d'install ni de configuration réseau.

**Utilisateur secondaire — le Listener.** Membre de la communauté FM (Dexed/Volca FM/DX7), possède un synthé FM et une sortie MIDI accessible depuis un navigateur (matériel USB-MIDI, ou bus virtuel type IAC vers Dexed standalone). Veut entendre une performance live **sur son propre synthé**, observer les gestes instrumentaux / événements MIDI / CC en direct, éventuellement calquer. Succès pour lui : ouvrir un onglet, choisir sa sortie, entendre le live en direct avec une latence acceptable, et pouvoir Panic si une note reste coincée.

Audience cible initiale : petite communauté de passionnés FM, MAO, synthés et hackers MIDI — pas grand public. La forme est une "session radio" plutôt qu'un service à grande échelle.

## Critères de succès

- **Fonctionnels** : les 5 types d'événements MIDI relayés (noteOn, noteOff, controlChange, programChange, pitchBend) ; Panic local coupe les notes coincées ; un deuxième performer est refusé (`performer:busy`) ; les listeners sont read-only (filtrage effectif) ; SysEx rejeté (double défense : filtre performer + schéma serveur).
- **Performance perçue** : latence performer→listener mesurée < ~80 ms en LAN / < ~150 ms sur internet typique (via `srvTs - ts`) ; moins de ~5 % de fallbacks immédiats en conditions stables.
- **Qualité** : tests unitaires (mapping wire→bytes, panic, scheduler, schéma, registre owner, rate limit) à 100 % ; plan de validation manuel IAC/Dexed/MIDI Monitor exécuté sans point bloquant.
- **Sécurité** : zéro secret dans le bundle frontend (vérifié par `grep` du build) ; token owner comparé timing-safe ; contrôle de rôle 100 % effectif.
- **Signal produit** : au moins une session live complète performée par Zub devant une petite audience réelle, sans incident bloquant — c'est la preuve que le format "radio instrumentale FM" fonctionne comme expérience.

## Périmètre

**Dans le MVP :**

- Relay live one-way des 5 types d'événements MIDI (noteOn, noteOff, controlChange, programChange, pitchBend), performer → listeners.
- Un seul performer/owner autorisé à la fois (refus `performer:busy` du deuxième).
- Listeners read-only : rejoindre la room, sélectionner sortie MIDI locale, canal, note de test, recevoir le flux.
- Panic **local** côté listener (CC 64/120/121/123 × 16 canaux) + Force Panic opt-in (noteOff sweep) — fonctionne même déconnecté du serveur.
- Auth owner par secret partagé (`OWNER_SECRET`, saisie manuelle côté performer, jamais dans le build frontend).
- Cible navigateur : Chrome/Edge desktop, HTTPS obligatoire (détection de feature + message "Chrome/Edge requis").
- Mode Mock MIDI output (visualisation on-screen des bytes) pour validation/démo sans périphérique.
- Stack : React + Vite + TypeScript / Node + Express + Socket.IO / Web MIDI API native / monorepo pnpm + `@fmlw/shared` (Zod). État en mémoire, mono-process, pas de DB.

**Explicitement hors MVP :**

- SysEx (et patches DX7 SysEx) ; presets par type de synthé ; enregistrement/replay de séquences ; mode radio générative.
- Rooms multiples + création auth-gated (MVP : room unique `fm-live-wire:main`).
- Auth JWT + RBAC ; multi-performers par room ; summing/mixage ; jam collaboratif ; chat MIDI bidirectionnel.
- Compensation de latence avancée (alignement d'horloges, RTT, predictive scheduling, re-loging).
- MIDI clock/transport ; MIDI 2.0 UMP ; visualisations MIDI.
- Scale-out multi-instance (Redis Streams adapter) ; CDN static ; persistance (DB).
- Polyfill Safari JZZ ; télémétrie Panic agrégée ; backpressure avancée.

## Vision

Si FM Live Wire réussit comme MVP, il devient le **format "radio instrumentale FM"** : un canal où un créateur diffuse une performance live et où l'audience l'entend sur son propre synthé, dans sa propre pièce. À 2-3 ans, cela pourrait s'étendre en :

- **Presets par synthé** : le performer pousse non seulement les événements mais aussi les patches (SysEx DX7), pour que l'audience entende **exactement** le même timbre — la performance devient reproductible bit-à-bit côté listener.
- **Rooms multiples + programmation** : plusieurs "stations" live, un calendrier de sessions, une audience qui passe d'un performer à l'autre — une vraie radio communautaire FM.
- **Enregistrement / replay + mode radio générative** : les sessions deviennent rediffusables, et un mode différé peut générer un flux MIDI continu — une station qui tourne sans performer live.
- **Multi-performers / collaboration** — **mode futur séparé, pas une évolution naturelle du cœur MVP** (levée de l'invariant one-way via auth + RBAC) : jams distribués, summing, où plusieurs créateurs jouent ensemble vers une audience. Le cœur du produit reste le broadcast MIDI live à sens unique ; ce mode serait une variante distincte, à ne considérer que si une demande réelle émerge.

La North Star : **un réseau de performance live où le geste instrumental voyage, pas le son — et où chaque listener possède l'instrument.** La trajectoire dépend de la traction communauté réelle après le MVP ; elle n'est pas un engagement de roadmap, juste la direction si le format trouve son public.

---

*Ce brief est un document de frontière produit : il positionne FM Live Wire pour le PRD et l'Architecture en aval. Les 10 invariants techniques non-négociables (one-way broadcast, single owner, pas de SysEx, Panic local, HTTPS, Chrome/Edge…) sont figés par la Technical Research du 2026-07-06 et repris ici tels quels. Validé par Zub le 2026-07-06 — les inférences du mode headless (-A) ont été confirmées (projet artistique personnel, valeur créative partagée avec une communauté jouant un synthé FM compatible, audience communauté FM/MAO/synthés/hackers MIDI, signal produit = une session live, North Star conditionnelle à la traction communauté).*