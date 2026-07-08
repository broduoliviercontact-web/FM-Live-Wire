# FM Live Wire — Plan de test manuel (IAC → Dexed → MIDI Monitor)

> **Story 6.6** — Plan + exécution du test manuel macOS (IAC → Dexed → MIDI Monitor, 11 étapes) + sign-off.
> Couvre les invariants S-1 à S-6 et S-9. S-7 et S-8 sont déjà couverts par les stories 6.4 / 6.5 (automatisés) et sont référencés ici pour traçabilité ; S-7 est à confirmer formellement en Story 6.7.

---

## 0. Source du plan

Le plan source 11 étapes a été **trouvé** dans les artefacts de planning et est utilisé comme base (il n'a pas été réinventé) :

- **Source primaire (base du plan)** : `addendum.md` § A.7 « Plan de test manuel prioritaire (macOS IAC → Dexed → MIDI Monitor) » — chemin :
  `_bmad-output/planning-artifacts/prds/prd-bmad-project-2026-07-06/addendum.md` (lignes 80-94).
- **Source secondaire (détails opérationnels)** : `technical-fm-live-wire-midi-streaming-research-2026-07-06.md` (§ « Tests manuels MVP », § IAC setup, § chaîne Dexed) — chemin :
  `_bmad-output/planning-artifacts/research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md` (lignes 147-158, 312-328, 740-745).
- **Invariants et cibles de latence** : `prd.md` (S-1 à S-10, NFR-1/NFR-2, FR-26) — chemin :
  `_bmad-output/planning-artifacts/prds/prd-bmad-project-2026-07-06/prd.md`.
- **Codes d'erreur UI (E5/E7/E13)** : `EXPERIENCE.md` § codes d'erreur — chemin :
  `_bmad-output/planning-artifacts/ux-designs/ux-bmad-project-2026-07-06/EXPERIENCE.md` (lignes 226-234).

La structure 11 étapes ci-dessous suit la spécification de la Story 6.6 (préflight automatisé en étape 1, sign-off go/no-go en étape 11) et fusionne les détails opérationnels de l'addendum A.7 (setup IAC, commande backend, chaîne Dexed, latence IAC < 1 ms) dans les étapes correspondantes.

> **Convention de statut** : toute case de résultat, latence, capture ou sign-off est laissée à `PENDING_ZUB_SIGNOFF` tant que Zub n'a pas exécuté manuellement l'étape correspondante. **Aucune étape ne doit être marquée `PASS` sans preuve (capture/log) ET signature de Zub.** Aucune latence, aucun résultat, aucune capture n'est pré-rempli.

---

## 1. Scope

Ce document est **documentaire + validation manuelle**. Il ne contient **aucun test automatisé** et n'ajoute **aucun hook de debug**. Il décrit :

- un plan d'exécution manuel en 11 étapes sur macOS (IAC Driver → Dexed standalone → MIDI Monitor),
- une checklist exécutable avec champs de résultats,
- des champs de mesures de latence,
- les emplacements attendus pour les captures MIDI Monitor et les logs serveur,
- un bloc de sign-off Zub (verdict GO / NO-GO).

**Exécutant** : Zub (matériel macOS requis). **Préparation** : Claude (ce document + vérification des prérequis automatisés).

**Périmètre hors scope** : aucune modification du serveur, du schéma shared, du pipeline MIDI ou des composants UI. Aucun support SysEx n'est ajouté (S-5 reste un rejet). Aucun hook de debug dangereux pour tester S-4 ou S-5 côté UI (voir étapes 8 et 9).

---

## 2. Matériel et logiciels requis

| Élément | Rôle | Remarques |
|---|---|---|
| macOS | OS hôte | IAC Driver intégré à macOS. Latence IAC < 1 ms (addendum A.7). |
| Audio MIDI Setup | Création du bus IAC | `Applications/Utilitaires/Configuration audio MIDI` |
| IAC Driver (bus virtuel) | Pont MIDI in-process | Jusqu'à 16 ports virtuels par device IAC. Noms ASCII. |
| Dexed (standalone, pas plugin DAW) | Synthé récepteur | Chaîne courte préférée (addendum A.7). Input MIDI = port IAC. |
| MIDI Monitor (Snoize) | Inspection des bytes | Preuves capturées par type d'événement. |
| Clavier MIDI physique OU Mock performer | Source d'événements | Performer peut utiliser une entrée MIDI physique OU le mode Mock (Story 5.1) pour générer les 5 types. |
| Navigateur Chrome / Edge | Client web | `/performer` et `/listener` (Web MIDI). |
| Serveur FM Live Wire | Backend Socket.IO | `OWNER_SECRET=<dev> pnpm --filter server dev` (addendum A.7). |

> **Valeur du token owner de dev** : la valeur de dev documentée dans l'addendum A.7 est `devsecret`. **En production, la valeur réelle provient de l'env serveur et n'est jamais commitée ni exposée côté web (S-7).** Zub saisit le token owner manuellement à chaque session (AD-10).

Statut prérequis logiciels (à confirmer par Zub) :

- [ ] `PENDING_ZUB_SIGNOFF` — Audio MIDI Setup présent
- [ ] `PENDING_ZUB_SIGNOFF` — Dexed standalone installé
- [ ] `PENDING_ZUB_SIGNOFF` — MIDI Monitor installé
- [ ] `PENDING_ZUB_SIGNOFF` — Chrome/Edge présent

---

## 3. Préparation IAC Driver

D'après l'addendum A.7 (étape 1) et la recherche (lignes 147-158) :

1. Ouvrir **Audio MIDI Setup** → menu **Window > Show MIDI Studio**.
2. Double-cliquer **IAC Driver**.
3. Cocher **« Device is online »**.
4. Cliquer **+** sous la liste des ports pour ajouter un port nommé (ex. `FMLW → Dexed`). Noms ASCII uniquement.
5. **Apply**.
6. (Optionnel) Prévoir un port send et un port return séparés pour éviter une boucle de feedback (recherche § IAC setup).

> Latence IAC attendue : < 1 ms (addendum A.7). Jusqu'à 16 ports virtuels par device IAC.

- [ ] `PENDING_ZUB_SIGNOFF` — Port IAC `FMLW → Dexed` créé et « Device is online » coché
- Capture attendue : `docs/captures/01-iac-driver-ports.png` (fenêtre IAC Driver montrant le port)
  - Emplacement : `PENDING_ZUB_SIGNOFF`

---

## 4. Préparation Dexed (standalone)

D'après l'addendum A.7 (étape 2) et la recherche (lignes 312-328) :

1. Relancer **Dexed standalone** (et DAW le cas échéant) pour que le port IAC soit détecté.
2. Dans Dexed standalone : **Input MIDI = port IAC `FMLW → Dexed`**.
3. Vérifier qu'un son est produit quand un message noteOn arrive sur le canal 1.

> Préférer Dexed standalone (chaîne courte) au plugin Dexed en DAW : moins de couches, latence plus faible, diagnostic plus simple (addendum A.7).

- [ ] `PENDING_ZUB_SIGNOFF` — Dexed standalone relancé, input MIDI = port IAC, son produit sur canal 1
- Capture attendue : `docs/captures/02-dexed-input.png` (réglage input MIDI Dexed)
  - Emplacement : `PENDING_ZUB_SIGNOFF`

---

## 5. Préparation MIDI Monitor

1. Lancer **MIDI Monitor** (Snoize).
2. Ajouter une source d'écoute sur le **même port IAC `FMLW → Dexed`** (ou un port miroir) pour observer les bytes relayés.
3. Activer l'affichage en hex/brut pour relever les 5 types d'événements.

- [ ] `PENDING_ZUB_SIGNOFF` — MIDI Monitor écoute le port IAC, affichage hex activé
- Capture attendue : `docs/captures/03-midi-monitor-listening.png` (MIDI Monitor prêt, source = port IAC)
  - Emplacement : `PENDING_ZUB_SIGNOFF`

---

## 6. Plan d'exécution — 11 étapes

> Pour chaque étape : sous-étapes, **attendu**, **preuves attendues** (capture / log), et **champ de résultat** (`PENDING_ZUB_SIGNOFF` jusqu'à exécution + signature). Les étapes 8 et 9 peuvent être partiellement **non exposées côté UI par design** ; dans ce cas, marquer `covered by 6.5 automated in-process test` + `manual not exposed by design` et **ne pas modifier l'app**.

### Étape 1 — Préflight automatisé (S-8)

**Objectif** : confirmer que tous les checks automatisés sont verts avant l'exécution matérielle (S-8 / NFR-16, déjà couvert par Story 6.4 + consolidé par Story 6.5).

Sous-étapes (à exécuter par Zub depuis la racine du projet) :

1. `pnpm test`
2. `pnpm test:coverage`
3. `pnpm lint`
4. `pnpm -r build`
5. `node scripts/verify-boundaries.mjs`

**Attendu** : les 5 commandes terminent en succès (exit 0) ; `pnpm test:coverage` atteint 100 % par fichier sur les modules critiques (configuré dans `vitest.config.ts`, Story 6.4) ; `verify-boundaries` retourne 16/16.

**Preuves attendues** :
- Log console de chaque commande (exit code visible).
- Résultat `pnpm test:coverage` (table de couverture par fichier critique).

**Résultat** :
- [ ] `PENDING_ZUB_SIGNOFF` — `pnpm test` → exit 0 ; nb tests : ______ / ______
- [ ] `PENDING_ZUB_SIGNOFF` — `pnpm test:coverage` → exit 0 ; couverture par fichier critique : ______
- [ ] `PENDING_ZUB_SIGNOFF` — `pnpm lint` → exit 0
- [ ] `PENDING_ZUB_SIGNOFF` — `pnpm -r build` → exit 0 ; bundle web : ______ kB
- [ ] `PENDING_ZUB_SIGNOFF` — `node scripts/verify-boundaries.mjs` → 16/16
- Log consolidé : `docs/captures/04-preflight.log` — Emplacement : `PENDING_ZUB_SIGNOFF`

---

### Étape 2 — Setup matériel IAC / Dexed / MIDI Monitor

**Objectif** : finaliser la chaîne physique (sections 3, 4, 5 ci-dessus).

Sous-étapes :
1. Port IAC créé (section 3).
2. Dexed standalone relancé + input = port IAC (section 4).
3. MIDI Monitor écoute le port IAC (section 5).

**Attendu** : la chaîne `Listener (navigateur) → Web MIDI → port IAC → Dexed standalone → audio` est opérationnelle, et MIDI Monitor voit les bytes transitant par le port IAC.

**Preuves attendues** : captures 01, 02, 03 (sections 3-5).

**Résultat** :
- [ ] `PENDING_ZUB_SIGNOFF` — Chaîne IAC → Dexed → MIDI Monitor opérationnelle

---

### Étape 3 — Lancement application et surfaces

**Objectif** : démarrer le backend et charger les trois surfaces web ; vérifier `/health`.

Sous-étapes (addendum A.7 étape 3) :
1. Terminal serveur : `OWNER_SECRET=<dev> pnpm --filter server dev`.
2. Vérifier `GET /health` → `200` + `ownerActive: false` (aucun performer connecté).
3. Onglet/fenêtre 1 (Chrome/Edge) : ouvrir `/` (landing hub, Story 6.1).
4. Onglet/fenêtre 2 : ouvrir `/performer`.
5. Onglet/fenêtre 3 : ouvrir `/listener`.

**Attendu** :
- Serveur démarré sans erreur ; `/health` renvoie `{ ownerActive: false }` (ou équivalent contractuel AD-20).
- Landing affiche l'indicateur « ● On air » / « ○ Hors antenne » selon `ownerActive` (Story 6.1, Q-UX5 : polling `/health`, pas de Socket.IO).
- `/performer` et `/listener` chargent sans erreur console.

**Preuves attendues** :
- Log serveur : `docs/captures/05-server-start.log` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture `/health` : `docs/captures/06-health-ownerActive-false.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture landing : `docs/captures/07-landing-offair.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** :
- [ ] `PENDING_ZUB_SIGNOFF` — Serveur démarré, `/health` = `{ ownerActive: false }`
- [ ] `PENDING_ZUB_SIGNOFF` — `/`, `/performer`, `/listener` chargent sans erreur

---

### Étape 4 — Connexion performer et listener

**Objectif** : établir la session live (performer → serveur → listener) sans erreur d'auth/permission/port.

Sous-étapes (addendum A.7 étapes 4-5) :
1. **Performer** (`/performer`) : saisir le token owner de dev (`devsecret` par addendum A.7) → sélectionner une entrée MIDI (physique ou Mock Story 5.1) → jouer → le monitoring affiche les 5 types.
2. **Listener** (`/listener`) : autoriser l'accès MIDI → sélectionner la sortie = port IAC `FMLW → Dexed` → canal 1 → cliquer **Rejoindre le flux** → envoyer une note de test → Dexed sonne + MIDI Monitor affiche les bytes.

**Attendu** :
- Performer authentifié (token accepté) ; `ownerActive: true` côté `/health` après connexion ; monitoring performer affiche les 5 types (noteOn, noteOff, controlChange, programChange, pitchBend).
- Listener rejoint le flux (`room:join` ok) ; aucune erreur **E5** (Sortie MIDI déconnectée), **E7** (Performer absent), **E13** (Version protocole incompatible) ; Dexed produit du son ; MIDI Monitor montre les bytes.
- Indicateur landing passe à « ● On air » (`ownerActive: true`).

**Preuves attendues** :
- Log serveur : `docs/captures/08-performer-connected.log` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Log serveur : `docs/captures/09-listener-joined.log` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture `/health` `ownerActive: true` : `docs/captures/10-health-ownerActive-true.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture landing « On air » : `docs/captures/11-landing-onair.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** :
- [ ] `PENDING_ZUB_SIGNOFF` — Performer connecté (token accepté), monitoring affiche les 5 types
- [ ] `PENDING_ZUB_SIGNOFF` — Listener a rejoint le flux, Dexed sonne, MIDI Monitor affiche les bytes
- [ ] `PENDING_ZUB_SIGNOFF` — Aucune erreur E5 / E7 / E13 visible côté UI

---

### Étape 5 — S-1 : les 5 types d'événements sont relayés

**Objectif** : valider l'invariant S-1 (noteOn, noteOff, controlChange, programChange, pitchBend tous relayés performer → listener).

Sous-étapes (addendum A.7 étape 4-5) :
1. Performer : envoyer successivement un événement de chaque type (noteOn + noteOff, controlChange, programChange, pitchBend).
2. Listener : Dexed réagit (notes) ; MIDI Monitor affiche les bytes correspondants pour les 5 types.

**Attendu** : les 5 types sont relayés et observables dans MIDI Monitor avec le bon statut byte :
- noteOn `0x9n` + note + velocity
- noteOff `0x8n` + note + velocity
- controlChange `0xBn` + cc + value
- programChange `0xCn` + program
- pitchBend `0xEn` + lsb + msb

**Preuves attendues** (5 captures MIDI Monitor, une par type) :
- `docs/captures/12-midi-noteOn.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- `docs/captures/13-midi-noteOff.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- `docs/captures/14-midi-controlChange.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- `docs/captures/15-midi-programChange.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- `docs/captures/16-midi-pitchBend.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** (S-1) :
- [ ] `PENDING_ZUB_SIGNOFF` — noteOn relayé
- [ ] `PENDING_ZUB_SIGNOFF` — noteOff relayé
- [ ] `PENDING_ZUB_SIGNOFF` — controlChange relayé
- [ ] `PENDING_ZUB_SIGNOFF` — programChange relayé
- [ ] `PENDING_ZUB_SIGNOFF` — pitchBend relayé

---

### Étape 6 — S-2 : Panic local fonctionne même serveur down

**Objectif** : valider l'invariant S-2 (Panic local coupe les notes même quand le backend est arrêté — Correction 1).

Sous-étapes (addendum A.7 étape 7) :
1. Coincer une note (noteOn sans noteOff) → Dexed sonne en continu.
2. Cliquer **Panic** (Story 5.2, 64 messages CC 64/120/121/123 × 16) → son coupé.
3. **Tuer le backend** (Ctrl-C du terminal serveur).
4. Coincer à nouveau une note, cliquer **Panic** → **le Panic fonctionne encore** (S-2, valide Correction 1) ; aucune dépendance au serveur.
5. (Optionnel) Tester **Force Panic** (Story 5.3, 2048 noteOff × 16 canaux, confirmation obligatoire) → son coupé.

**Attendu** :
- Panic coupe le son avec backend en ligne.
- Panic coupe **toujours** le son avec backend arrêté (S-2) — preuve que le chemin local `MidiSendable.send` ne dépend ni du serveur, ni du join, ni du scheduler.
- Force Panic (si testé) coupe le son après confirmation du dialog.

**Preuves attendues** :
- Capture MIDI Monitor du sweep Panic CC : `docs/captures/17-panic-cc-sweep.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Log/capture montrant backend tué : `docs/captures/18-backend-killed.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture MIDI Monitor du Panic post-kill : `docs/captures/19-panic-after-kill.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- (Optionnel) Capture Force Panic dialog + sweep : `docs/captures/20-force-panic.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** (S-2) :
- [ ] `PENDING_ZUB_SIGNOFF` — Panic coupe le son (backend en ligne)
- [ ] `PENDING_ZUB_SIGNOFF` — Panic coupe le son **backend arrêté** (S-2 / Correction 1)
- [ ] `PENDING_ZUB_SIGNOFF` — (Optionnel) Force Panic coupe le son après confirmation

---

### Étape 7 — S-3 : 2ᵉ performer refusé (`performer:busy`)

**Objectif** : valider l'invariant S-3 (slot owner unique ; un 2ᵉ performer valide est refusé avec `performer:busy` ; le premier owner reste actif, pas de ghost slot).

Sous-étapes (addendum A.7 étape 8) :
1. Avec un performer déjà connecté (étape 4), ouvrir un **2ᵉ onglet** `/performer`.
2. Saisir le même token owner de dev → tenter de se connecter.

**Attendu** :
- Le 2ᵉ performer reçoit `performer:busy` et est refusé.
- Le 1ᵉ performer reste connecté (`ownerActive` toujours `true` côté `/health`) ; aucun ghost slot.
- (Vérification croisée avec Story 6.5 : le test in-process `socketIntegration.test.ts` § 3 prouve déjà ce scénario avec fan-out réel — référence traçabilité, pas substitute de preuve manuelle.)

**Preuves attendues** :
- Capture UI 2ᵉ performer refusé : `docs/captures/21-performer-busy.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Log serveur `performer:busy` : `docs/captures/22-performer-busy.log` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture `/health` toujours `ownerActive: true` : `docs/captures/23-health-still-active.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** (S-3) :
- [ ] `PENDING_ZUB_SIGNOFF` — 2ᵉ performer refusé (`performer:busy`)
- [ ] `PENDING_ZUB_SIGNOFF` — 1ᵉ performer reste actif, pas de ghost slot

---

### Étape 8 — S-4 : listener read-only (`forbidden` → disconnect)

**Objectif** : valider l'invariant S-4 (les listeners sont read-only ; toute tentative d'émission `midi:event` est refusée avec `forbidden` ; la 3ᵉ tentative déconnecte le listener).

> ⚠️ **Avertissement de scope** : cette vérification nécessite d'injecter un `socket.emit('midi:event', …)` depuis la console du navigateur listener. **Si cette injection n'est pas réalisable sans ajouter un hook de debug dangereux côté app, NE PAS modifier l'app**. Marquer l'étape :
> `covered by 6.5 automated in-process test` (cf. `socketIntegration.test.ts` § 2, listener read-only + 3ᵉ tentative → disconnect, fan-out réel via `expectNoEvent`) **+** `manual not exposed by design`.

Sous-étapes (addendum A.7 étape 9) — **si réalisable sans modifier l'app** :
1. Ouvrir la console DevTools du navigateur listener.
2. Récupérer la référence socket côté client (si exposée/debug) et émettre `socket.emit('midi:event', { ... })` (payload valide).
3. Répéter 3 fois.

**Attendu** :
- 1ʳᵉ et 2ᵉ tentative → ack `forbidden`, listener encore connecté, **rien n'est relayé** aux autres listeners.
- 3ᵉ tentative → ack `forbidden` **et** déconnexion du listener.

**Preuves attendues** (si exécutable) :
- Capture console `forbidden` ×3 + déconnexion : `docs/captures/24-listener-forbidden.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Log serveur `forbidden` : `docs/captures/25-listener-forbidden.log` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** (S-4) — choisir l'une des deux voies, ne pas inventer :
- [ ] `PENDING_ZUB_SIGNOFF` — **Exécuté manuellement** : 1ʳᵉ/2ᵉ → `forbidden` (connecté), 3ᵉ → `forbidden` + déconnexion, aucun relay
- [ ] `PENDING_ZUB_SIGNOFF` — **Non exposé côté UI par design** : `covered by 6.5 automated in-process test` + `manual not exposed by design` (aucune modification de l'app)

---

### Étape 9 — S-5 : SysEx rejeté (jamais relayé)

**Objectif** : valider l'invariant S-5 (les messages SysEx `0xF0…0xF7` sont rejetés par le schéma strict et ne sont jamais relayés).

> ⚠️ **Avertissement de scope** : générer un SysEx côté performer nécessite du matériel spécialisé ou un éditeur MIDI dédié. **Si l'injection SysEx n'est pas réalisable côté UI sans ajouter un support SysEx (interdit par scope), NE PAS modifier l'app** et NE PAS ajouter de support SysEx. Marquer l'étape :
> `covered by 6.5 automated in-process test` (cf. `socketIntegration.test.ts` § 5, cas `type: "sysex"` → ack `invalid` + `expectNoEvent` prouve l'absence de relay) **+** `manual not exposed by design`.

Sous-étapes (addendum A.7 étape 10) — **si réalisable sans modifier l'app** :
1. Côté performer, injecter un message SysEx `0xF0 … 0xF7` (via matériel/éditeur dédié, pas via l'app).
2. Observer le listener / MIDI Monitor.

**Attendu** :
- SysEx rejeté (ack `invalid` côté performer, schema strict — `type: "sysex"` non autorisé).
- **Aucun** byte SysEx observé côté listener ni MIDI Monitor.

**Preuves attendues** (si exécutable) :
- Capture performer ack `invalid` : `docs/captures/26-sysex-rejected.png` — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture MIDI Monitor (absence de SysEx) : `docs/captures/27-sysex-not-relayed.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** (S-5) — choisir l'une des deux voies, ne pas inventer :
- [ ] `PENDING_ZUB_SIGNOFF` — **Exécuté manuellement** : SysEx rejeté (`invalid`), aucun byte observé côté listener
- [ ] `PENDING_ZUB_SIGNOFF` — **Non exposé côté UI par design** : `covered by 6.5 automated in-process test` + `manual not exposed by design` (aucun support SysEx ajouté)

---

### Étape 10 — S-6 : latence et fallbacks

**Objectif** : valider l'invariant S-6 (latence perçue performer → listener < ~80 ms LAN / < ~150 ms internet ; < ~5 % de fallbacks immédiats en conditions stables) et observer la backpressure (Story 5.4, FR-26 : `MAX_LATE_MS = 200`).

> ⚠️ **Précaution source MIDI (rate-limit serveur, Story 2.5)** : pour le test de base, **désactiver toute MIDI clock / boucle IAC / arpège continu** côté performer. Un flux continu (loops/arps/clock) sature rapidement le burst serveur (200 events, refill 100/s) → `Limite de débit atteinte` côté performer + burst relayé au listener → backpressure (fallbacks/drops) qui n'est PAS un défaut de latence réseau. Ces flux continus sont utiles pour tester la backpressure exprès (sous-étape 2), mais PAS pour mesurer la latence de base (sous-étape 1). Jouer des notes individuelles / phrases pour la mesure S-6.

Sous-étapes (addendum A.7 étapes 6 + 11) :
1. **Relay live** : performer joue → listener entend sur Dexed ; mesurer la latence perçue (méthode : enregistrement audio/click comparé, ou perception jouée).
2. **Backpressure** : simuler un burst de CC (ou noteOn rapide) → observer l'UI listener (LateAlert Story 5.4 : `⚠ Flux en retard / connexion instable — latence estimée {ms} ms`) **en cas de retard** ; sinon aucun LateAlert persistant.
3. Relever les compteurs internes si visibles (telemetry) : `fallbackCount`, `droppedCount`, `lastLatencyMs` (Story 5.4 / 5.5).

> **Note latence négative / décalage d'horloge (hotfix post-retest Render)** : la valeur affichée (`Latence estimée`) est la latence **effective** `max(0, receivedAtMs - srvTs)`, soit l'estimation downstream relay→listener (les deux horloges sont epoch `Date.now()`, comparables). Cette estimation **est affectée par le décalage d'horloge serveur/client** (NTP) : si l'horloge du listener retarde de quelques centaines de ms par rapport au serveur Render, le brut `receivedAtMs - srvTs` devient **négatif** (ex. `-162 ms`) — cela ne signifie PAS que l'event est arrivé « avant » son relay, c'est un artefact de skew. La latence négative est donc **clampée à 0** (`effectiveLatencyMs`), affichée `0 ms` / `~0 ms`, et ne déclenche **jamais** `isLate` ni LateAlert. LateAlert ne s'affiche que si `effectiveLatencyMs > MAX_LATE_MS (200)` ou en cas de vrais fallbacks/drops récents (overflow du buffer borné, FR-25). Le libellé « estimée » rappelle ce caractère estimé.

**Attendu** :
- Latence perçue < ~80 ms LAN (ou < ~150 ms internet selon l'environnement de Zub).
- < ~5 % de fallbacks immédiats en conditions stables.
- En cas de retard dépassant `MAX_LATE_MS` (200) : LateAlert apparaît (LOCAL pur, Story 5.4) ; pas de blocage.
- En conditions calmes : **pas de LateAlert persistant** (vigilance 5.4 : buffer MVP sans drain progressif — surveiller si alerte trop tôt après 256 events en réception calme prolongée).
- **Latence négative (skew horloge)** : jamais affichée comme un retard — clampée à `0 ms`, pas de LateAlert lié à la latence.

**Preuves attendues** :
- Capture/measure latence : `docs/captures/28-latency-measure.png` (ou `.log`) — Emplacement : `PENDING_ZUB_SIGNOFF`
- Capture LateAlert (si retard observé) : `docs/captures/29-late-alert.png` — Emplacement : `PENDING_ZUB_SIGNOFF`

**Résultat** (S-6) : voir § 7 (Mesures de latence) pour les champs chiffrés.
- [ ] `PENDING_ZUB_SIGNOFF` — Latence perçue mesurée et conforme (< ~80 ms LAN / < ~150 ms internet)
- [ ] `PENDING_ZUB_SIGNOFF` — Taux de fallbacks < ~5 % en conditions stables
- [ ] `PENDING_ZUB_SIGNOFF` — LateAlert apparaît en cas de retard > 200 ms (FR-26) ; pas de blocage
- [ ] `PENDING_ZUB_SIGNOFF` — Aucun LateAlert persistant en conditions calmes (vigilance 5.4)

---

### Étape 11 — S-9 : go/no-go et sign-off

**Objectif** : consigner le verdict global GO / NO-GO de Zub après exécution des étapes 1 à 10 (S-9 : plan manuel exécuté sans point bloquant).

> ⚠️ **Ne pas pré-remplir `GO`.** Le verdict est vide (`PENDING_ZUB_SIGNOFF`) tant que Zub n'a pas exécuté et signé.

**Attendu** : Zub renseigne le bloc de sign-off (§ 10) avec son nom, la date, l'environnement, le verdict GO / NO-GO et des commentaires.

**Résultat** (S-9) :
- [ ] `PENDING_ZUB_SIGNOFF` — Plan 11 étapes exécuté sans point bloquant
- [ ] `PENDING_ZUB_SIGNOFF` — Verdict GO / NO-GO consigné (§ 10)

---

## 7. Tableau de résultats (synthèse)

| Étape | Invariant | Attendu | Statut | Preuve |
|---|---|---|---|---|
| 1 | S-8 | 5 checks automatisés verts | `PENDING_ZUB_SIGNOFF` | `04-preflight.log` |
| 2 | — | Chaîne IAC→Dexed→MIDI Monitor opérationnelle | `PENDING_ZUB_SIGNOFF` | 01-03 |
| 3 | — | Serveur + 3 surfaces + `/health` | `PENDING_ZUB_SIGNOFF` | 05-07 |
| 4 | — | Session live sans E5/E7/E13 | `PENDING_ZUB_SIGNOFF` | 08-11 |
| 5 | S-1 | 5 types relayés | `PENDING_ZUB_SIGNOFF` | 12-16 |
| 6 | S-2 | Panic local coupe même serveur down | `PENDING_ZUB_SIGNOFF` | 17-20 |
| 7 | S-3 | 2ᵉ performer `performer:busy` | `PENDING_ZUB_SIGNOFF` | 21-23 |
| 8 | S-4 | Listener read-only (`forbidden` → disconnect) OU `covered by 6.5` | `PENDING_ZUB_SIGNOFF` | 24-25 ou N/A |
| 9 | S-5 | SysEx rejeté OU `covered by 6.5` | `PENDING_ZUB_SIGNOFF` | 26-27 ou N/A |
| 10 | S-6 | Latence < ~80 ms LAN / < ~5 % fallbacks | `PENDING_ZUB_SIGNOFF` | 28-29 |
| 11 | S-9 | Plan exécuté sans bloquant + sign-off | `PENDING_ZUB_SIGNOFF` | § 10 |

**Traçabilité S-7 / S-8** (déjà couvertes en automatisé, référencées pour traçabilité) :

- **S-7** (zéro secret bundle frontend + token timing-safe) : déjà couvert par grep build (Story 6.4) ; **à confirmer formellement en Story 6.7**.
  - [ ] `PENDING_ZUB_SIGNOFF` — S-7 référencé (confirmation formelle en 6.7)
- **S-8** (tests 100 % NFR-16) : couvert par `pnpm test:coverage` (Story 6.4, étape 1 ci-dessus).
  - [ ] `PENDING_ZUB_SIGNOFF` — S-8 confirmé par étape 1

---

## 8. Mesures de latence

> **Ne pas inventer de valeurs.** Laisser les champs vides / `PENDING_ZUB_SIGNOFF` tant que Zub n'a pas mesuré.

### Environnement de mesure (à renseigner par Zub)

- Machine / CPU : `PENDING_ZUB_SIGNOFF`
- Navigateur + version : `PENDING_ZUB_SIGNOFF`
- Réseau : `PENDING_ZUB_SIGNOFF` (LAN / internet / localhost)
- Backend : `PENDING_ZUB_SIGNOFF` (localhost / distant)
- Méthode de mesure de la latence : `PENDING_ZUB_SIGNOFF`

### Mesures chiffrées (à renseigner par Zub)

| Mesure | Cible | Valeur observée | Conforme ? |
|---|---|---|---|
| Latence perçue performer → listener (min) | < ~80 ms LAN / < ~150 ms internet | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| Latence perçue performer → listener (moy) | idem | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| Latence perçue performer → listener (max) | idem | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| Nombre d'événements relayés (échantillon) | — | `PENDING_ZUB_SIGNOFF` | — |
| Taux de fallbacks immédiats | < ~5 % conditions stables | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| `fallbackCount` (telemetry 5.4/5.5) | — | `PENDING_ZUB_SIGNOFF` | — |
| `droppedCount` (telemetry 5.4) | — | `PENDING_ZUB_SIGNOFF` | — |
| `lastLatencyMs` (telemetry 5.4/5.5) | < 200 (FR-26 MAX_LATE_MS) | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| LateAlert déclenché (oui/non + seuil) | seulement si > 200 ms | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

---

## 9. Captures et logs attendus (index)

Tous les chemins sont relatifs à `docs/captures/`. **Emplacement réel à remplir par Zub** (`PENDING_ZUB_SIGNOFF`).

| # | Fichier attendu | Contenu | Emplacement |
|---|---|---|---|
| 01 | `01-iac-driver-ports.png` | Fenêtre IAC Driver, port `FMLW → Dexed` | `PENDING_ZUB_SIGNOFF` |
| 02 | `02-dexed-input.png` | Dexed standalone, input = port IAC | `PENDING_ZUB_SIGNOFF` |
| 03 | `03-midi-monitor-listening.png` | MIDI Monitor écoute le port IAC | `PENDING_ZUB_SIGNOFF` |
| 04 | `04-preflight.log` | Sortie des 5 checks automatisés | `PENDING_ZUB_SIGNOFF` |
| 05 | `05-server-start.log` | Log démarrage serveur | `PENDING_ZUB_SIGNOFF` |
| 06 | `06-health-ownerActive-false.png` | `/health` ownerActive false | `PENDING_ZUB_SIGNOFF` |
| 07 | `07-landing-offair.png` | Landing « Hors antenne » | `PENDING_ZUB_SIGNOFF` |
| 08 | `08-performer-connected.log` | Log connexion performer | `PENDING_ZUB_SIGNOFF` |
| 09 | `09-listener-joined.log` | Log join listener | `PENDING_ZUB_SIGNOFF` |
| 10 | `10-health-ownerActive-true.png` | `/health` ownerActive true | `PENDING_ZUB_SIGNOFF` |
| 11 | `11-landing-onair.png` | Landing « On air » | `PENDING_ZUB_SIGNOFF` |
| 12-16 | `12..16-midi-*.png` | 5 types MIDI Monitor | `PENDING_ZUB_SIGNOFF` |
| 17 | `17-panic-cc-sweep.png` | Sweep Panic CC MIDI Monitor | `PENDING_ZUB_SIGNOFF` |
| 18 | `18-backend-killed.png` | Backend arrêté | `PENDING_ZUB_SIGNOFF` |
| 19 | `19-panic-after-kill.png` | Panic post-kill MIDI Monitor | `PENDING_ZUB_SIGNOFF` |
| 20 | `20-force-panic.png` | Force Panic dialog + sweep (optionnel) | `PENDING_ZUB_SIGNOFF` |
| 21 | `21-performer-busy.png` | 2ᵉ performer refusé | `PENDING_ZUB_SIGNOFF` |
| 22 | `22-performer-busy.log` | Log serveur `performer:busy` | `PENDING_ZUB_SIGNOFF` |
| 23 | `23-health-still-active.png` | `/health` toujours actif | `PENDING_ZUB_SIGNOFF` |
| 24 | `24-listener-forbidden.png` | Console `forbidden` ×3 + disconnect (si testable) | `PENDING_ZUB_SIGNOFF` |
| 25 | `25-listener-forbidden.log` | Log serveur `forbidden` (si testable) | `PENDING_ZUB_SIGNOFF` |
| 26 | `26-sysex-rejected.png` | Performer ack `invalid` SysEx (si testable) | `PENDING_ZUB_SIGNOFF` |
| 27 | `27-sysex-not-relayed.png` | MIDI Monitor absence SysEx (si testable) | `PENDING_ZUB_SIGNOFF` |
| 28 | `28-latency-measure.png` | Mesure latence | `PENDING_ZUB_SIGNOFF` |
| 29 | `29-late-alert.png` | LateAlert si retard observé | `PENDING_ZUB_SIGNOFF` |

---

## 10. Critères bloquants / non bloquants

### Critères bloquants (→ NO-GO si non satisfaits)

- S-1 (les 5 types relayés) : si un type n'est pas relayé, **NO-GO**.
- S-2 (Panic local même serveur down) : si le Panic échoue backend arrêté, **NO-GO**.
- S-3 (2ᵉ performer refusé) : si un 2ᵉ performer peut voler le slot ou laisser un ghost slot, **NO-GO**.
- S-4 (listener read-only) : si un listener peut relayer un `midi:event` avec succès, **NO-GO** (sauf si étape 8 marquée `covered by 6.5` — alors preuve automatisée acceptée).
- S-5 (SysEx rejeté) : si un SysEx est relayé, **NO-GO** (sauf si étape 9 marquée `covered by 6.5`).
- S-6 (latence / fallbacks) : si latence très supérieure aux cibles (>> ~80 ms LAN / >> ~150 ms internet) ou taux de fallbacks >> ~5 % en conditions stables, **NO-GO** (analyser la cause ; vigilance 5.4 buffer MVP).

### Critères non bloquants (→ GO avec commentaire)

- LateAlert apparaît en cas de retard réel > 200 ms (comportement attendu FR-26, pas un défaut).
- Aucune capture pour une étape marquée `covered by 6.5 automated in-process test` + `manual not exposed by design` (accepté par design).
- Force Panic (étape 6 optionnelle) non testé.

---

## 11. Sign-off Zub

> **Ne pas pré-remplir `GO`.** Verdict laissé à `PENDING_ZUB_SIGNOFF` jusqu'à exécution complète + signature.

- Nom : `PENDING_ZUB_SIGNOFF`
- Date : `PENDING_ZUB_SIGNOFF`
- Environnement (machine / navigateur / réseau) : `PENDING_ZUB_SIGNOFF`
- Verdict : `PENDING_ZUB_SIGNOFF`  _(valeurs possibles : `GO` | `NO-GO`)_
- Commentaires / points bloquants / écarts : `PENDING_ZUB_SIGNOFF`
- Signature : `PENDING_ZUB_SIGNOFF`

---

*Références internes : invariants S-1 à S-10 et cibles de latence — `prd.md` ; codes d'erreur UI E5/E7/E13 — `EXPERIENCE.md` ; plan source 11 étapes — `addendum.md` § A.7 ; détails opérationnels IAC/Dexed — `technical-fm-live-wire-midi-streaming-research-2026-07-06.md`. Preuves automatisées complémentaires (S-3/S-4/S-5/S-8, fan-out réel) — Story 6.5 `apps/server/src/__tests__/integration/socketIntegration.test.ts`.*