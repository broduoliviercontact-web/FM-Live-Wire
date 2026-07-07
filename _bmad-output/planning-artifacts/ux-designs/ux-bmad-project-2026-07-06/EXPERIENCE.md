---
status: final
updated: 2026-07-06
project: FM Live Wire
spine: EXPERIENCE
ui_system: shadcn/ui + Tailwind
visual_identity: ./DESIGN.md
references:
  prd: ../../prds/prd-bmad-project-2026-07-06/prd.md
  addendum: ../../prds/prd-bmad-project-2026-07-06/addendum.md
  brief: ../../briefs/brief-bmad-project-2026-07-06/brief.md
  research: ../../research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md
invariants:
  - one-way broadcast (Performer → Serveur → Listeners)
  - un seul performer/admin (OWNER_SECRET)
  - listeners read-only (room:join, room:leave, midi:test uniquement)
  - pas de streaming audio
  - pas de SysEx MVP
  - Panic local côté listener (fonctionne serveur down)
  - Chrome/Edge desktop + HTTPS
  - pas de jam, pas de chat MIDI bidirectionnel
  - canal listener = canal de sortie vers mon synthé (remappage forcé)
  - pas de mobile, pas de compte, pas d'install
---

# EXPERIENCE.md — FM Live Wire

> **Spine comportemental.** Possède *comment ça marche*. Référence les tokens visuels de `./DESIGN.md` par nom via `{tokens.path}`. En cas de conflit avec un mock, wireframe ou import, **les spines priment**. Sur le point IA « landing », cette spec surclasse le PRD (qui n'avait pas de page d'accueil).

## Foundation

- **Form-factor** : web desktop, navigateur Chrome/Edge récent, contexte sécurisé HTTPS (ou `localhost` en dev). Pas de mobile. Pas d'app installée — un onglet.
- **UI system** : `shadcn/ui` + `Tailwind` sur React + Vite + TypeScript (stack imposée par le PRD). DESIGN.md étend les defaults shadcn ; cette spec ne décrit que le **delta comportemental**.
- **Surfaces MVP** : 3 — `/` (landing role-picker), `/listener`, `/performer`. Pas de navigation entre listener et performer (rôles exclusifs) ; seul lien retour = retour à `/`.

## Objectifs UX

1. **Compréhension immédiate du modèle.** Le listener doit comprendre en quelques secondes qu'il reçoit du MIDI (pas du son) et que **son** synthé génère l'audio. Éviter la confusion « où est le son ? ».
2. **Onboarding listener en 6 étapes explicites**, dans cet ordre, sans cul-de-sac : (1) connecter MIDI → (2) choisir sa sortie → (3) choisir le canal de son synthé → (4) tester une note → (5) rejoindre le flux → (6) Panic si besoin.
3. **Sécurité perceptible.** Le listener sait qu'il est read-only ; le performer sait qu'il est seul ; un 2ᵉ performer est refusé clairement.
4. **Reprise de confiance musicale.** Une note coincée ou un serveur qui tombe ne doit jamais laisser le listener sans issue : Panic local fonctionne **déconnecté du serveur**.
5. **Lisibilité scène/faible lumière** — cf. DESIGN.md `live studio` sombre.
6. **Monitoring performer minimal mais suffisant** pour savoir que le flux part et vers combien de listeners, sans surcharge.
7. **Friction zéro install** : pas de compte, pas de plugin, pas de config réseau — on ouvre une URL.

## Principes d'interface

- **Une colonne, un flux guidé.** Pas de sidebar, pas de densité. Chaque surface est une séquence verticale de cartes.
- **État avant action.** Chaque panel commence par son état (navigateur compatible, MIDI connecté, flux actif…) avant les contrôles.
- **Données en mono, labels en sans.** Bytes, canal, valeur, latence → `JetBrains Mono` (`{tokens.typography.mono}`). Labels/descriptions → Inter.
- **Couleur = sémantique uniquement.** Vert = sain, amber = on air/retard, rouge = danger/panic, cyan = info/mock. Cf. DESIGN.md Colors.
- **Panic toujours atteignable.** Bouton Panic fixe en bas du panel listener, jamais désactivé, jamais masqué par un dialogue.
- **Pas de retour serveur inventé.** Les warnings de retard/overload sont **locaux** (calculés côté listener), jamais un event serveur `listener:overload` (retiré en correction 3).
- **Pas de replay, pas de passé.** Reconnect = reprise du flux live, sans rejouer les events manqués. L'UI ne promet jamais un « rattrapage ».
- **Confirmation avant geste lourd.** Force Panic (2048 messages) demande confirmation ; tout geste à effet musical massif s'explicite avant envoi.
- **Microcopy fidèle aux termes du PRD** — pas de reformatage des labels verbatim.

## Information Architecture

```
/                  → Landing / role-picker (ajout UX, absent du PRD)
  ├─ /listener     → Page publique : recevoir le flux MIDI
  └─ /performer    → Page admin : diffuser le MIDI (token requis)
```

- **`/`** : très simple. Nom du projet + tagline, indicateur *On air* (polling léger via `GET /health` exposant `ownerActive: boolean` — pas de temps réel sur la landing), deux boutons : « Je diffuse » → `/performer`, « J'écoute » → `/listener`. Pas de hero marketing.
- **`/listener`** : page publique, pas de compte. Flux vertical : détection navigateur → autorisation MIDI → sortie MIDI → canal → note de test → rejoindre → réception → Panic.
- **`/performer`** : page admin. Flux vertical : détection navigateur → admin token → autorisation MIDI → entrée MIDI → monitoring live.
- Aucune nav transverse entre `/listener` et `/performer`. Un lien discret « ← Retour » ramène à `/` **après déconnexion propre** (`room:leave` côté listener, libération du slot owner côté performer — résout Q-UX10, évite tout slot owner fantôme). Chaque route affiche un **tag de rôle en en-tête** (`LISTENER` / `PERFORMER`) pour lever toute confusion d'onglet ouvert ; les intros de panel (cf. Voice and Tone) rappellent le rôle et le modèle MIDI-pas-son.

## Voice and Tone (microcopy)

Ton **DIY/hacker, sobre, précis**. Pas de marketing. Vouvoiement sobre (vous). Phrases courtes. Les labels verbatim du PRD sont **non modifiables** (hors override UX explicite documenté ci-dessous).

> **Compteurs pluralisés** : tout compteur affiché (`{n} events reçus`, `{events} envoyés`, `{listeners}`, `{erreurs}`) gère le singulier/pluriel via `Intl.PluralRules('fr-FR')` — ex. « 1 event reçu », « 7 events reçus ».

### Labels verbatim (à utiliser tels quels)
- `admin token` — champ performer
- `Rejoindre le flux` — bouton listener. **Override UX explicite** : le PRD verbatim dit « Rejoindre » (UJ-2 étape 5), mais le brief utilisateur nomme le bouton « Rejoindre le flux » (plus explicite pour un néophyte). Surclassement PRD documenté ; le label court « Rejoindre » peut rester en microcopy de référence.
- `Note de test` — bouton listener
- `Panic` / `Panic local` — bouton listener
- `Force Panic` — bouton secondaire listener
- `Panic étendu : ~1–2 s` — avertissement Force Panic
- `Performer déconnecté` — état listener
- `Chrome/Edge requis` — navigateur incompatible
- `Mock / Debug` — option sortie MIDI

### Microcopies recommandées (compléments)

| Contexte | Microcopy |
|---|---|
| Landing — sous-titre | « Radio live de contrôle MIDI. Le son naît chez vous, sur votre synthé. » |
| Landing — bouton performer | « Je diffuse (performer) » (évite le piège du listener qui « joue » aussi son synthé) |
| Landing — bouton listener | « J'écoute (listener) » |
| Landing — on air | « ● On air » / « ○ Hors antenne » |
| Listener — intro panel | « Vous recevez des événements MIDI en direct. Votre synthé FM génère le son. » |
| Listener — étape 1 hint | « Autorisez l'accès MIDI dans votre navigateur. » |
| Listener — sortie hint | « Choisissez la sortie MIDI qui pilote votre synthé. Aucun périphérique ? Utilisez Mock / Debug. » |
| Listener — canal hint | « Tous les événements seront reroutés vers ce canal (remappage forcé). » |
| Listener — canal tooltip | « Le canal ici = la sortie vers votre synthé. Le flux d'origine est ignoré : tout passe sur ce canal. » |
| Listener — note de test | « Envoie un Do central (60) sur votre canal pour vérifier la chaîne. » |
| Listener — après note de test | « Note de test envoyée. » (toast) |
| Listener — en attente | « En attente du performer… » |
| Listener — réception active | « ● Réception active — {n} events reçus » |
| Listener — retard | « ⚠ Flux en retard / connexion instable — latence {ms} ms » |
| Listener — panic hint | « Coupe toutes les notes sur votre sortie locale. Fonctionne même si le serveur est injoignable. » |
| Listener — force panic intro | « Force Panic envoie un noteOff sur les 128 notes × 16 canaux (2048 messages). Utile si une note reste coincée après un Panic normal. » |
| Listener — force panic confirm | « Panic étendu : ~1–2 s. Confirmer ? » |
| Listener — force panic done | « Force Panic envoyé. » (toast) |
| Listener — mock actif | « Sortie Mock / Debug — les bytes s'affichent à l'écran, aucun son n'est produit. » |
| Performer — intro panel | « Vous diffusez des événements MIDI en direct vers les listeners. Seul le MIDI est diffusé, jamais l'audio. » |
| Performer — token hint | « Saisissez votre admin token. Il n'est pas mémorisé. » |
| Performer — token invalide | « Admin token invalide. » |
| Performer — déjà connecté | « Un performer est déjà connecté. Attendez la fin de sa session. » (`performer:busy`) |
| Performer — monitoring | « {events} envoyés · {listeners} listeners · {erreurs} erreurs » |
| Performer — rate limited | « ⚠ Limite de débit atteinte — certains events ont été ignorés par le serveur. » |
| Performer — fin session | « Déconnexion : slot owner libéré. Les listeners voient « Performer déconnecté ». » |
| Erreur permission MIDI | « Autorisation MIDI refusée. Activez l'accès MIDI dans les réglages du navigateur, puis réessayez. » |
| Erreur HTTPS | « Web MIDI nécessite HTTPS. Ouvrez l'app via une URL https:// (ou localhost en dev). » |
| Erreur serveur déconnecté | « Serveur déconnecté. Reconnexion automatique en cours… » |
| Erreur sortie déconnectée | « Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie. » |
| Erreur forbidden (rare, debug) | « Envoi MIDI interdit depuis un listener. » |
| Listener déconnecté après 3 `forbidden` | « Connexion interrompue : action non autorisée. » |

## Key Flows

### Parcours Listener — étape par étape (Maria, possede un Volca FM + une sortie USB-MIDI)

> Nom du protagoniste inféré `[ASSUMPTION]` (le PRD utilise « Maria » en UJ-2). Ajustable.
>
> **Mapping des 6 étapes canoniques** — la compatibilité navigateur (étape 1) et la landing (étape 0) sont des **prérequis**. Les 6 étapes canoniques du listener (Objectifs UX #2) correspondent à : étape 2 = connecter MIDI, 3 = choisir sortie, 4 = choisir canal, 5 = tester une note, 6 = rejoindre, 8 = Panic.

**Étape 0 — Arrivée sur `/`.** Maria ouvre l'URL. Elle voit le nom du projet, la tagline, et deux boutons. Elle comprend qu'elle est côté écoute. Elle clique « J'écoute (listener) » → `/listener`.

**Étape 1 — Compatibilité navigateur.** `/listener` fait feature-detection Web MIDI *avant* tout prompt.
- Si absent (Safari, Firefox < 108, etc.) → écran terminal `{tokens.colors.signal.danger}` : « Chrome/Edge requis » + 1 phrase d'explication + lien retour `/`. Pas de bouton MIDI.
- Si HTTPS absent → écran terminal « Web MIDI nécessite HTTPS. »
- Sinon → passe à l'étape 2.

**Étape 2 — Connecter MIDI (autorisation).** Carte « Connecter MIDI » avec bouton `Connecter MIDI`. Au clic → `navigator.requestMIDIAccess({ sysex: false })` (geste utilisateur explicite).
- Permission refusée (`NotAllowedError`) → Alert `danger` « Autorisation MIDI refusée. » + bouton « Réessayer ».
- Succès → StatusPill `connected` « MIDI autorisé », on passe à l'étape 3.

**Étape 3 — Choisir sa sortie MIDI.** `MidiPortPicker` (sortie) parmi `MIDIOutputMap` + option « Mock / Debug ». Refresh live via `onstatechange` (hot-plug).
- Aucun périphérique + Mock non choisi → Alert `info` « Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester. » (état vide, cf. états vides).
- Sélection Mock → badge `mock` « Sortie Mock / Debug ».
- Sélection port → StatusPill `connected` « {nom du port} sélectionné ».

**Étape 4 — Choisir le canal.** `ChannelSelector` 1–16 (UI) → conversion 0–15 à l'edge.
- Tooltip « Le canal ici = la sortie vers votre synthé. Le flux d'origine est ignoré : tout passe sur ce canal. » pour expliciter le **remappage forcé**.
- Défaut : **canal 1** (confirmé Q-UX7).

**Étape 5 — Tester une note.** Bouton `Note de test` (envoie `midi:test` listener→serveur autorisé ; le listener joue localement `[0x90|ch, 60, 100]` puis noteOff 300 ms plus tard — **standardisé Q-UX6** : note 60, velocity 100, durée 300 ms).
- En Mock → les bytes s'affichent dans `MockByteStream`.
- Sur port réel → si le synthé sonne, la chaîne est validée. Toast « Note de test envoyée. »
- Si rien ne sonne → hint « Vérifiez que votre synthé écoute sur le canal choisi. » (pas une erreur bloquante ; Maria peut quand même rejoindre).

**Étape 6 — Rejoindre le flux.** Bouton primaire `Rejoindre le flux` (44px, `{tokens.colors.signal.on_air}`).
- Au clic → `room:join` `fm-live-wire:main`. États possibles :
  - **En attente du performer** (`owner: false` sur `/health` ou état socket) → StatusPill `waiting` « En attente du performer… ». L'activité MIDI reste muette. Maria attend.
  - **Réception active** (performer présent + events entrants) → StatusPill `connected` « ● Réception active — {n} events reçus », `MidiActivityIndicator` pulse, `NoteVisualizer` dessine les notes.
- Reconnexion auto (Socket.IO) ; au reconnect, **reprise du live sans replay**. Pas de promesse de rattrapage.

**Étape 7 — Pendant la performance.** Maria entend son synthé. Latence perçue affichée en mono dans un mini-stat (`{ms} ms`). `MidiActivityIndicator` pulse à chaque noteOn.
- Si `srvTs - ts` > `MAX_LATE_MS` (200 ms) ou buffer > `BUFFER_CAP` (256) → Alert `late` « ⚠ Flux en retard / connexion instable — latence {ms} ms ». Warning **local pur**.

**Étape 8 — Panic si besoin.** Note coincée (noteOff perdu) → Maria clique `Panic` (bouton rouge 44px, **toujours actif**, même serveur down). Envoie séquence CC 64→120→121→123 × 16 = 64 messages sur **sa sortie locale**. Son coupé.
- Si insuffisant → `Force Panic` (bouton secondaire) → Dialog confirmation « Panic étendu : ~1–2 s. Confirmer ? » → sweep 128×16 = 2048 messages. Toast « Force Panic envoyé. »

**Étape 9 — Fin.** Le performer déconnecte → StatusPill `waiting` « Performer déconnecté ». Panic reste dispo. Maria peut rester (en attente d'un nouveau performer) ou quitter (`room:leave` en fermant l'onglet).

> **Climax beat** : étape 8 — la note coincée, le Panic qui coupe le son **alors même que le serveur vient de tomber**. C'est la promesse de sécurité musicale du produit, testée par S-2 (kill backend → Panic fonctionne).

### Parcours Performer — étape par étape (Zub, owner)

**Étape 0 — Arrivée sur `/`.** Zub clique « Je diffuse (performer) » → `/performer`.

**Étape 1 — Compatibilité navigateur.** Même feature-detection que listener (Chrome/Edge + HTTPS). Écran terminal sinon.

**Étape 2 — Admin token.** `Input` « admin token » (saisie manuelle, **pas de localStorage**, jamais dans l'URL). Bouton `Se connecter` → `socket.auth.token` → validation serveur `crypto.timingSafeEqual`.
- Token invalide → Alert `danger` « Admin token invalide. »
- Token valide mais `performer:busy` (un owner déjà actif) → Alert `danger` terminal « Un performer est déjà connecté. Attendez la fin de sa session. » **Pas de retry silencieux.** Lien retour `/`.

**Étape 3 — Connecter MIDI Input.** Bouton `Connecter MIDI Input` → `requestMIDIAccess({ sysex: false })`. Permission refusée gérée comme listener.

**Étape 4 — Choisir l'entrée MIDI.** `MidiPortPicker` (entrée) parmi `MIDIInputMap` (clavier USB, ou IAC Driver `FMLW → Dexed` depuis Ableton). Refresh `onstatechange`. Aucun périphérique → état vide (cf. états vides).

**Étape 5 — Diffusion live + monitoring.** Dès qu'une entrée est sélectionnée, le relay démarre. `MonitoringPanel` affiche (monitoring **minimal confirmé Q-UX2** — pas de latence agrégée listeners) :
- État connexion (`StatusPill` `connected` « Diffusion active »).
- **Dernier événement MIDI** envoyé (ligne mono `TYPE · CH · VAL` parmi les 5 types).
- Compteurs en pied : `events envoyés`, `listeners` (nb), `erreurs récentes`.
- Rappel permanent (carte ou pied) : **« Seul le MIDI est diffusé, jamais l'audio. »**
- Rate limit (`rate:limited`) → Alert `late` « Limite de débit atteinte — certains events ignorés. »

**Étape 6 — Fin de session.** Fermeture d'onglet / déconnexion → serveur libère le slot owner → listeners voient « Performer déconnecté ». Pas de dialogue de confirmation au départ (déconnexion = fin naturelle).

> **Climax beat** : étape 5 — Zub joue, voit ses events partir en direct, voit le compteur `listeners` passer à N, et sait qu'autre part des synthés FM sonnent sur du matériel qu'il ne possède pas. C'est la promesse « tune in ».

## États vides

Aucun état vide explicite n'était nommé dans le PRD. Spécification UX :

| Surface | État vide | Affichage |
|---|---|---|
| `/` landing | Aucun performer connecté | « ○ Hors antenne » (pill muted) — les boutons restent actifs (le listener peut rejoindre et **attendre**). |
| `/listener` | Aucun périphérique MIDI détecté | Alert `info` + option « Mock / Debug » mise en avant. Le bouton `Rejoindre` reste désactivé tant qu'aucune sortie n'est choisie. |
| `/listener` | En attente du performer (rejoint, personne ne joue) | StatusPill `waiting` « En attente du performer… » + `MidiActivityIndicator` éteint. Pas d'erreur. Indice : « Dès que le performer démarre, le flux arrive. » |
| `/listener` Mock actif, pas encore de flux | `MockByteStream` vide + placeholder mono « — en attente d'événements — » |
| `/listener` réception active, 0 event reçu | « ● Réception active — 0 event reçu » (l'état connecté suffit ; pas d'erreur) |
| `/performer` | Aucune entrée MIDI détectée | Alert `info` « Aucune entrée MIDI détectée. Branchez un clavier ou un bus IAC. » + bouton refresh. |
| `/performer` | Connecté, 0 event envoyé, 0 listener | Monitoring compteurs à 0, ligne de flux vide « — en attente de jeu — ». StatusPill `connected`. Pas d'erreur. |
| `/performer` | 0 listener connecté | Compteur `listeners : 0` + hint discret « Aucun listener pour l'instant. Le flux part quand même. » |

> Principe : un état vide n'est jamais une erreur. On indique ce qui manque et la prochaine action, sans alarme.

## États d'erreur

Tous les états demandés + ceux issus de la recherche technique. Chaque erreur = code technique (réfléchi dans les logs/monitoring) + microcopy utilisateur.

| # | État | Détection | UI | Microcopy | Action proposée |
|---|---|---|---|---|---|
| E1 | Navigateur non compatible Web MIDI | `!('requestMIDIAccess' in navigator)` → `UNSUPPORTED_BROWSER` | Écran terminal `danger` | « Chrome/Edge requis » + « Web MIDI n'est pas supporté par ce navigateur. Utilisez Chrome ou Edge sur desktop. » | Lien retour `/` |
| E2 | HTTPS requis | `SecurityError` → `SECURE_CONTEXT_REQUIRED` | Écran terminal `danger` | « Web MIDI nécessite HTTPS. » + « Ouvrez l'app via une URL https:// (ou localhost en dev). » | Lien retour `/` |
| E3 | Permission MIDI refusée | `NotAllowedError` → `PERMISSION_DENIED` | Alert `danger` | « Autorisation MIDI refusée. Activez l'accès MIDI dans les réglages du navigateur, puis réessayez. » | Bouton « Réessayer » |
| E4 | Aucun périphérique MIDI | `MIDIOutputMap`/`MIDIInputMap` vide | Alert `info` (pas une erreur) | « Aucun périphérique MIDI détecté. Utilisez Mock / Debug pour tester. » (listener) / « Branchez un clavier ou un bus IAC. » (performer) | Mock / Debug ou refresh |
| E5 | Sortie MIDI déconnectée en session | `onstatechange` → port `connection: "closed"` ; `send()` lève `InvalidStateError` | Alert `late` + fail-safe musical (scheduler arrête) | « Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie. » | `MidiPortPicker` ré-ouvert |
| E6 | Serveur déconnecté | Socket.IO `disconnect` / `connect_error` | StatusPill `waiting` + Alert `late` (transient) | « Serveur déconnecté. Reconnexion automatique en cours… » | Auto-reconnect (backoff) ; Panic reste actif |
| E7 | Performer absent (listener) | `owner: false` / état socket | StatusPill `waiting` | « En attente du performer… » / « Performer déconnecté » | Attendre ; Panic dispo |
| E8 | Token admin invalide | serveur `invalid` | Alert `danger` | « Admin token invalide. » | Re-saisir |
| E9 | Deuxième performer refusé | `connect_error` `performer:busy` | Alert `danger` terminal | « Un performer est déjà connecté. Attendez la fin de sa session. » | Lien retour `/` (pas de retry) |
| E10 | Flux MIDI en retard | `srvTs - ts` > 200 ms ou buffer > 256 | Alert `late` | « ⚠ Flux en retard / connexion instable — latence {ms} ms » | Panic ou quitter ; warning local pur |
| E11 | Listener tente d'envoyer des events interdits | serveur `forbidden` (gate `socket.use`) | (côté listener, rare — debug console) | « Envoi MIDI interdit depuis un listener. » puis, après déconnexion : « Connexion interrompue : action non autorisée. » | **Déconnexion après 3 tentatives** (Q-UX1 résolu) ; pas de ban persistant MVP |
| E12 | Rate limit dépassé (performer) | event serveur `rate:limited` | Alert `late` | « Limite de débit atteinte — certains events ont été ignorés par le serveur. » | Ralentir le jeu |
| E13 | Version protocole incompatible | `unsupported-version` | Alert `danger` | « Version de protocole incompatible. Rafraîchissez la page. » | Reload |

> **E11** est un cas de sécurité/débug plus qu'un parcours utilisateur normal : un listener read-only ne dispose d'aucun contrôle d'envoi dans l'UI. Le message existe pour le test manuel étape 9 (console `socket.emit('midi:event', …)` → `forbidden`). **Résolu Q-UX1** : après **3 tentatives** `forbidden`, le serveur déconnecte le listener (pas de ban persistant dans le MVP) ; l'UI affiche alors « Connexion interrompue : action non autorisée. » (état déconnecté).

## Component Patterns (composants UI nécessaires)

Comportement. Spéc visuelle = DESIGN.md → Components.

| Composant | Rôle | Comportement clé |
|---|---|---|
| `BrowserCompatGate` | détection Web MIDI + HTTPS | bloque avant tout prompt ; écran terminal si E1/E2 |
| `MidiPermissionButton` | « Connecter MIDI » / « Connecter MIDI Input » | déclenche `requestMIDIAccess({sysex:false})` ; gère E3 |
| `MidiPortPicker` | sélection entrée/sortie + Mock/Debug | refresh `onstatechange` ; option Mock suffixée badge `info` ; **switch Mock à chaud autorisé même après sélection d'un port réel** (Q-UX9 résolu) |
| `ChannelSelector` | 1–16 (UI) → 0–15 (edge) | grille 16 créneaux ; tooltip remappage forcé |
| `TestNoteButton` | « Note de test » | envoie `midi:test` ; joue `[0x90\|ch,60,100]` + noteOff 300 ms (standard Q-UX6 : note 60, vel 100, 300 ms) ; **désactivé tant qu'aucune sortie/canal** avec hint « Choisissez une sortie et un canal pour tester. » |
| `JoinButton` | « Rejoindre le flux » | `room:join` ; transition vers état attente/actif ; **désactivé tant qu'aucune sortie** avec hint « Choisissez une sortie MIDI pour rejoindre. » |
| `StatusPill` | état connexion/flux | variantes on-air/connected/waiting/mock/error ; point coloré |
| `MidiActivityIndicator` | pulse activité | pulse `{connected}` sur noteOn entrant |
| `NoteVisualizer` | visualiseur simple de notes | barres ∝ pitch ; pas de mini-piano jouable ; **secondaire/pliable** — `MidiActivityIndicator` est l'indicateur primaire d'activité (évite la surcharge) |
| `MockByteStream` | flux bytes (Mock/Debug) | liste monospace scrollante, lignes colorées par type |
| `LatencyStat` | latence perçue mono | `{ms} ms` ; seuil couleur (green/amber/red) ; **n'apparaît qu'en alerte** (latence > `MAX_LATE_MS`) — pas affiché par défaut en réception calme, pour éviter la surcharge d'indicateurs |
| `LateAlert` | warning retard/overload | Alert `late` ; **local pur**, jamais d'event serveur |
| `PanicButton` | « Panic » | 44px, **sticky en bas du viewport** (jamais masqué par un dialogue ou le scroll), toujours actif, serveur down inclus ; 64 msg |
| `ForcePanicButton` + `ForcePanicDialog` | « Force Panic » | bouton secondaire → Dialog confirmation → 2048 msg |
| `AdminTokenInput` | « admin token » | pas de localStorage ; validation → `socket.auth.token` |
| `PerformerBusyAlert` | `performer:busy` | terminal, pas de retry |
| `MonitoringPanel` | monitoring performer | **dernier événement MIDI** (`TYPE · CH · VAL`) + compteurs (events envoyés / listeners / erreurs récentes) ; pas de latence agrégée listeners (Q-UX2) ; note « SysEx silencieusement filtré, jamais affiché ni relayé » (FR-8, double défense) |
| `RateLimitAlert` | `rate:limited` | Alert `late` côté performer |
| `RolePicker` | landing `/` | deux boutons + indicateur On air via polling léger `GET /health` (`ownerActive: boolean`, Q-UX5) — pas de temps réel sur la landing |
| `BackToHome` | « ← Retour » | lien discret vers `/` ; **déclenche une déconnexion propre** (listener : `room:leave` ; performer : libération slot owner) avant navigation — résout Q-UX10, évite tout slot owner fantôme |

> shadcn fournit : Button, Select, Input, Card, Badge, Alert, Dialog, Tooltip, Separator, Progress, Sonner. Les composants métier ci-dessus sont des compositions/custom au-dessus de shadcn.

## State Patterns

### États de connexion (StatusPill)
`connecting` → `connected` → `disconnected` → `reconnecting` → `connect_error` (avec raison). Mapping UI :
- `connecting` / `reconnecting` → `waiting` + libellé « Connexion… » / « Reconnexion… »
- `connected` → `connected` + libellé métier (« MIDI autorisé », « Réception active », « Diffusion active »)
- `disconnected` → `waiting` + « Serveur déconnecté. Reconnexion… »
- `connect_error` `performer:busy` → `error` terminal (E9) ; `forbidden` → `error` (E11)

### États du flux listener
1. **Idle** (pas rejoint) — contrôles seuls, bouton `Rejoindre` actif si sortie choisie.
2. **Waiting** (rejoint, pas de performer) — pill `waiting`, activité éteinte.
3. **Active** (réception) — pill `connected`, activity pulse, visualizer actif, latence affichée.
4. **Late** (warning) — Alert `late` superposée, flux continue (fallback immédiat noteOn/noteOff, drop CC HF).
5. **Server-down** — pill `waiting`, Panic **reste actif**, reconnexion auto en arrière-plan.
6. **Output-lost** — Alert `late` E5, scheduler arrêté (fail-safe), re-sélection sortie.

### États du flux performer
1. **Idle** (pas connecté) — token input seul.
2. **Busy** (`performer:busy`) — terminal E9.
3. **Active** (diffusion) — monitoring live, compteurs.
4. **Rate-limited** — Alert `late` E12, flux continue.
5. **Disconnected** — slot libéré, message de fin.

## Interaction Primitives

- **Geste utilisateur requis pour MIDI** : `requestMIDIAccess` lancé au clic sur « Connecter MIDI » (et au plus tard à l'entrée sur la page), jamais auto au load. Feature-detection **avant** le prompt.
- **Hot-plug MIDI** : pas de polling ; `onstatechange` rafraîchit `MidiPortPicker` en temps réel.
- **Sélection dépendante** : sur `/listener`, `Rejoindre` désactivé tant qu'aucune sortie n'est choisie ; `Note de test` désactivé tant qu'aucune sortie + aucun canal.
- **Confirmation modale** : Force Panic uniquement. Panic normal = action directe (geste fréquent, critique).
- **Toast** : feedback transient (note de test, force panic, reconnect réussi). Pas de toast pour les états persistants (Alert/StatusPill).
- **Pas de localStorage pour le token** ; pas de valeur dans l'URL.
- **Reconnexion auto** : backoff Socket.IO, indicateur visible, pas de dialogue bloquant.
- **Réduction de mouvement** : la pulse *on air* et `MidiActivityIndicator` se désactivent sous `prefers-reduced-motion` (cf. Accessibility Floor).

## Wireframes textuels simples

### `/` — Landing

```
┌───────────────────────────────────────┐
│            FM LIVE WIRE               │
│   Radio live de contrôle MIDI.        │
│   Le son naît chez vous, sur votre    │
│   synthé.                             │
│                                       │
│            ○ Hors antenne             │
│  vous pouvez rejoindre et patienter   │
│                                       │
│   ┌──────────────┐  ┌──────────────┐  │
│   │ Je diffuse   │  │ J'écoute     │  │
│   │ (performer)  │  │ (listener)   │  │
│   └──────────────┘  └──────────────┘  │
│                                       │
│   Chrome/Edge · HTTPS · Web MIDI      │
└───────────────────────────────────────┘
```

### `/listener` — état idle (premier contact)

```
┌───────────────────────────────────────┐
│ ← Retour          FM LIVE WIRE        │
├───────────────────────────────────────┤
│ LISTENER · vous recevez le MIDI,      │
│ votre synthé fait le son.             │
│                                       │
│ ┌─ MIDI ────────────────────────────┐ │
│ │ ○ MIDI non connecté               │ │
│ │ [ Connecter MIDI ]                │ │
│ │                                   │ │
│ │ Sortie :  (à choisir)             │ │
│ │ Canal :   (à choisir)             │ │
│ └───────────────────────────────────┘ │
│                                       │
│ [ Rejoindre le flux — désactivé ]     │
│  Choisissez une sortie MIDI pour      │
│  rejoindre.                           │
│                                       │
│ [  PANIC  ]   [ Force Panic ⓘ ]       │
└───────────────────────────────────────┘
```

### `/listener` — état réception active (Mock/Debug)

```
┌───────────────────────────────────────┐
│ ← Retour          FM LIVE WIRE        │
├───────────────────────────────────────┤
│ ● Réception active — 1 284 events     │
│                                       │
│ ┌─ MIDI ────────────────────────────┐ │
│ │ ● MIDI autorisé                   │ │
│ │ Sortie :  ▼ Mock / Debug      ⓘ   │ │
│ │ Canal :   [1][2][3]…[16]          │ │
│ │           ▲ 1 sélectionné         │ │
│ │ [ Note de test ]                  │ │
│ └───────────────────────────────────┘ │
│                                       │
│ [      Quitter le flux       ]       │
│                                       │
│ ┌─ Flux Mock / Debug ───────────────┐ │
│ │ noteOn  · ch1 · 60 · 100          │ │
│ │ noteOff · ch1 · 60 · 0            │ │
│ │ cc      · ch1 · 74 · 91           │ │
│ │ ...                               │ │
│ └───────────────────────────────────┘ │
│                                       │
│ latence : 42 ms                        │
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ [  PANIC  ]   [ Force Panic ⓘ ]  │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

### `/listener` — état en attente + retard

```
┌───────────────────────────────────────┐
│ ○ En attente du performer…            │
│                                       │
│ ⚠ Flux en retard / connexion instable │
│   latence 240 ms                       │
│                                       │
│ ┌─ MIDI ────────────────────────────┐ │
│ │ ● MIDI autorisé                   │ │
│ │ Sortie :  ▼ FMLW → Dexed          │ │
│ │ Canal :   [1] sélectionné         │ │
│ └───────────────────────────────────┘ │
│                                       │
│ [      Quitter le flux       ]       │
│                                       │
│ [  PANIC  ]   [ Force Panic ⓘ ]       │
└───────────────────────────────────────┘
```

### `/listener` — Force Panic (dialog)

```
        ┌─────────────────────────────┐
        │  Force Panic                │
        │                             │
        │  Panic étendu : ~1–2 s.     │
        │  Envoie un noteOff sur les  │
        │  128 notes × 16 canaux      │
        │  (2048 messages).           │
        │                             │
        │  [ Annuler ]  [ Confirmer ] │
        └─────────────────────────────┘
```

### `/listener` — navigateur incompatible (écran terminal E1)

```
┌───────────────────────────────────────┐
│            FM LIVE WIRE               │
│                                       │
│   ⛔ Chrome/Edge requis               │
│   Web MIDI n'est pas supporté par     │
│   ce navigateur. Utilisez Chrome ou   │
│   Edge sur desktop.                   │
│                                       │
│            ← Retour                   │
└───────────────────────────────────────┘
```

### `/performer` — diffusion active

```
┌───────────────────────────────────────┐
│ ← Retour          FM LIVE WIRE        │
├───────────────────────────────────────┤
│ ● Diffusion active                     │
│ Seul le MIDI est diffusé, jamais      │
│ l'audio.                               │
│                                       │
│ ┌─ Connexion ───────────────────────┐ │
│ │ admin token : ●●●●●●●●  ✓         │ │
│ │ ● MIDI autorisé                   │ │
│ │ Entrée : ▼ Arturia KeyLab 49      │ │
│ └───────────────────────────────────┘ │
│                                       │
│ ┌─ Monitoring ──────────────────────┐ │
│ │ TYPE      · CH · VAL              │ │
│ │ noteOn   · 1  · 60 · 100          │ │
│ │ noteOff  · 1  · 60 · 0            │ │
│ │ cc       · 1  · 74 · 91           │ │
│ │ program  · 1  · 42                │ │
│ │ pitchBend· 1  · 8192              │ │
│ │ ...                               │ │
│ ├───────────────────────────────────┤ │
│ │ events : 4 210 · listeners : 7 ·  │ │
│ │ erreurs : 0                       │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

### `/performer` — deuxième performer refusé (E9)

```
┌───────────────────────────────────────┐
│            FM LIVE WIRE               │
│                                       │
│   ⛔ Un performer est déjà connecté.  │
│   Attendez la fin de sa session.      │
│                                       │
│            ← Retour                   │
└───────────────────────────────────────┘
```

## Accessibility Floor

La recherche technique ne traitait **pas** l'a11y — à combler côté UX.

- **Contraste** : tout texte actionnable ≥ 4.5:1 (WCAG AA). `{tokens.colors.ink.primary}` sur `{tokens.colors.base.bg}` ≈ 15:1. Muted/secondary réservé aux infos non critiques.
- **Clavier** : tous les contrôles atteignables et opérables au clavier (shadcn fournit focus rings `{on_air}`). Panic = actionnable, pas un lien décoratif. Ordre de tabulation = ordre du flux guidé.
- **États focus visibles** : ring `{tokens.colors.signal.on_air}` sur focus.
- `prefers-reduced-motion` : désactive la pulse *on air* (`{tokens.motion.pulse_on_air}`) et le pulse `MidiActivityIndicator` ; remplace par un changement d'opacité statique. Le warning retard reste visible (statique).
- `prefers-color-scheme` : non applicable — l'app est sombre par design (scène). Pas de mode clair MVP `[NOTE FOR UX]`.
- **Labels associés** : chaque Select/Input a un `<label>` ; tooltips pour Force Panic et remappage canal.
- **Ne pas dépendre de la couleur seule** : StatusPill = point + label texte ; Alert = icône + texte + couleur. Un daltonien identifie Panic au texte/icône, pas seulement au rouge.
- **Données MIDI audibles ?** Non — c'est un produit audio-musical piloté par le synthé de l'utilisateur ; l'UI elle-même n'émet pas de son. Le flux MIDI brut (`MockByteStream`, `NoteVisualizer`, `MonitoringPanel`) est **exclu d'aria-live** (trop verbeux). Les **changements d'état** (connecté/déconnecté/erreur/retard/panic) utilisent `aria-live="polite"` sur les régions dédiées `StatusPill` / `LateAlert` / `Alert`.
- Test lecteur d'écran (VoiceOver macOS) requis en acceptance — cf. AC-U20.

## Critères d'acceptation UX

Reprend et affine les AC du PRD (§12) + succès (§8) côté UX.

### Parcours
- **AC-U1** : un listener neuf, depuis `/`, rejoint un flux actif en ≤ 6 étapes explicites (connecter → sortie → canal → tester → rejoindre → entendre), sans documentation externe.
- **AC-U2** : l'indicateur *On air* reflète l'état réel du performer via polling léger `GET /health` (`ownerActive: boolean`) — pas de temps réel sur la landing.
- **AC-U3** : le label `Rejoindre` est désactivé tant qu'aucune sortie MIDI n'est choisie ; activé dès sélection (port réel ou Mock).
- **AC-U4** : `Note de test` produit un feedback visible (toast + byte en Mock / son sur port réel) sur le canal choisi.
- **AC-U5** : le remappage forcé est explicite (tooltip) — un event entrant sur ch.5, listener sur ch.1, émet sur ch.1 (AC PRD Story 4.3).

### États
- **AC-U6** : navigateur incompatible → écran terminal « Chrome/Edge requis » (E1), pas de prompt MIDI.
- **AC-U7** : HTTPS absent → écran terminal (E2).
- **AC-U8** : permission refusée → Alert + bouton « Réessayer » (E3).
- **AC-U9** : sortie déconnectée en session → Alert + fail-safe (scheduler arrêté) (E5).
- **AC-U10** : serveur déconnecté → StatusPill + reconnexion auto + **Panic reste actif** (E6). Test manuel PRD étape 7 (kill backend → Panic coupe le son) = S-2.
- **AC-U11** : flux en retard → warning **local** `LateAlert` (E10), pas d'event serveur.
- **AC-U12** : token invalide → Alert (E8) ; 2ᵉ performer → Alert terminal (E9), pas de retry.

### Panic
- **AC-U13** : `Panic` toujours actif, jamais désactivé, même serveur down (FR-16, S-2).
- **AC-U14** : `Force Panic` requiert confirmation modale affichant « Panic étendu : ~1–2 s » **avant** envoi (FR-17, Story 5.4 AC).

### Performer
- **AC-U15** : monitoring affiche état connexion + nb listeners + events envoyés + erreurs (FR-3).
- **AC-U16** : rappel permanent « Seul le MIDI est diffusé, jamais l'audio » visible sur `/performer`.
- **AC-U16b** : rappel inverse côté listener (« vous recevez le MIDI, votre synthé fait le son ») visible sur `/listener` (symétrique à AC-U16).
- **AC-U17** : `rate:limited` → Alert (E12).

### Accessibilité
- **AC-U18** : navigation clavier complète, focus visible, ordre logique.
- **AC-U19** : `prefers-reduced-motion` désactive pulses.
- **AC-U20** : VoiceOver (macOS) lit les états critiques (connecté/déconnecté/erreur/retard/panic) via `aria-live="polite"` sur les régions `StatusPill` / `LateAlert` / `Alert`. Procédure de test : naviguer `/listener` au clavier avec VoiceOver activé, déclencher une déconnexion serveur puis un Panic, vérifier l'annonce vocale de l'état.

### Critère ultime (PRD S-10)
- **AC-U21** : au moins une session live complète par Zub devant une petite audience réelle, sans incident bloquant — preuve que le format « radio instrumentale FM » fonctionne comme expérience.

## Questions ouvertes restantes

Héritées du PRD (§10) + ouvertes par l'UX — **toutes résolues** (validation Zub 2026-07-06). Détail ci-dessous ; seul Q-UX11 reste un axe de suivi post-traction.

> **Toutes les questions ouvertes MVP sont résolues** (validation Zub 2026-07-06). Reste en suivi post-traction uniquement.

- **Q-UX1 (= PRD Q-3)** ✅ **Résolu** : après **3 tentatives** `forbidden`, le serveur déconnecte le listener. **Pas de ban persistant dans le MVP.** Message UI : « Connexion interrompue : action non autorisée. »
- **Q-UX2 (= PRD Q-4)** ✅ **Résolu** : monitoring performer **minimal confirmé** — état connexion, nombre de listeners, compteur d'événements envoyés, erreurs récentes, dernier événement MIDI. **Pas de latence agrégée listeners dans le MVP.**
- **Q-UX3 (= PRD Q-5)** ✅ **Résolu** : **pas de mini-piano jouable obligatoire** en Mock/Debug. Le mode Mock affiche les bytes MIDI + un visualiseur simple de notes/activité.
- **Q-UX4 (= PRD Q-1/Q-6)** ✅ **Résolu** : `MAX_LATE_MS = 200 ms` et `LOOKAHEAD_MS = 40 ms` conservés par défaut ; **valeurs tunables après tests réels**.
- **Q-UX5** ✅ **Résolu** : indicateur *On air* via **polling léger** sur endpoint type `/status` ou `/health` exposant `ownerActive: boolean`. Polling simple, **pas de complexité temps réel sur la landing**.
- **Q-UX6** ✅ **Résolu** : note de test **standardisée** — MIDI note 60, velocity 100, durée 300 ms.
- **Q-UX7** ✅ **Résolu** : **canal par défaut = canal 1**.
- **Q-UX8** ✅ **Résolu** : **pas de mode clair dans le MVP** (l'app est sombre par design).
- **Q-UX9** ✅ **Résolu** : **switch Mock Output à chaud autorisé**, même après sélection d'un port réel.
- **Q-UX10** ✅ **Résolu** — « ← Retour » déclenche une déconnexion propre (`room:leave` / libération slot owner) avant navigation.
- **Q-UX11 (= PRD Q-7)** ✅ **Confirmé** : post-traction prioritaire = **rooms multiples**, avant SysEx, replay ou multi-performers. L'IA landing évoluera (sélecteur de room) — impact UX à prévoir post-traction.

---

## Notes de finalisation

- **Spines priment** sur tout mock/wireframe/import en conflit.
- **Landing `/` est un ajout UX** (le PRD n'avait que `/listener` et `/performer`) ; ce point IA surclasse le PRD.
- **`Rejoindre le flux` est un override UX explicite** : le PRD verbatim dit « Rejoindre » (UJ-2 étape 5) ; le brief utilisateur nomme le bouton « Rejoindre le flux » (plus explicite pour un néophyte). Surclassement PRD documenté.
- Les `[ASSUMPTION]` ci-dessus sont des décisions balisées, ajustables sans tout revoir. Les `[NOTE FOR UX]` sont des points à trancher plus tard (post-MVP).
- Microcopies verbatim du PRD : `admin token`, `Note de test`, `Panic`, `Force Panic`, `Panic étendu : ~1–2 s`, `Performer déconnecté`, `Chrome/Edge requis`, `Mock / Debug` — non modifiables sans accord PM.

### Résolutions MVP (validation Zub 2026-07-06)

Les 11 questions ouvertes MVP sont **toutes résolues** et intégrées aux spines (cf. « Questions ouvertes restantes ») :
- **Q-UX1** : 3 tentatives `forbidden` → déconnexion, pas de ban persistant, message « Connexion interrompue : action non autorisée. »
- **Q-UX2** : monitoring performer minimal (état connexion, nb listeners, events envoyés, erreurs récentes, dernier événement MIDI) — pas de latence agrégée.
- **Q-UX3** : Mock/Debug = bytes + visualiseur simple, pas de mini-piano obligatoire.
- **Q-UX4** : `MAX_LATE_MS=200` / `LOOKAHEAD_MS=40` par défaut, tunables après tests réels.
- **Q-UX5** : *On air* via polling léger `/health` (`ownerActive: boolean`), pas de temps réel sur la landing.
- **Q-UX6** : note de test standardisée (60 / vel 100 / 300 ms).
- **Q-UX7** : canal par défaut = 1.
- **Q-UX8** : pas de mode clair MVP.
- **Q-UX9** : switch Mock à chaud autorisé après port réel.
- **Q-UX10** : déconnexion propre au changement de rôle.
- **Q-UX11** : post-traction = rooms multiples en priorité.

### Reviewer Gate — passée (2026-07-06)

5 lenses MVP-grade en parallèle ; rapports dans `review-{slug}.md`. Verdicts : cohérence-PRD PASS-WITH-FIXES, accessibilité Acceptable+corrections, microcopy Accepté-avec-réserves, parcours-listener MVP-acceptable, séparation-rôles PASS-avec-réserves. Fixes appliquées aux spines :
- **A11y critique** : token `danger_fill` (#E11D2E) pour les fills Panic portant du texte blanc (3.27:1 → 4.6:1, AA) ; `ink.muted` éclaircie (#7E848D → #898F98, AA sur surface_2) ; `ChannelSelector` en `radiogroup` (flèches + `aria-checked` + icône, pas couleur seule) ; `aria-live` rattaché aux régions StatusPill/LateAlert/Alert ; AC-U20 promue (VoiceOver, procédure de test).
- **Microcopy** : règle tutoiement → vouvoiement sobre (cohérent avec les copies existantes) ; compteurs pluralisés via `Intl.PluralRules('fr-FR')` ; override « Rejoindre le flux » documenté (attribution erronée « Rejouindre » purgée).
- **Parcours listener** : ajout wireframe idle (premier contact) ; mapping des 6 étapes canoniques clarifié ; `LatencyStat` et `NoteVisualizer` déclarés secondaires (réduction de la surcharge d'indicateurs) ; hints sur boutons désactivés (Rejoindre, Note de test) ; Panic déclaré sticky viewport ; wireframe attente+retard corrigé (Rejoindre → Quitter, état post-join).
- **Séparation rôles** : « ← Changer de rôle » → « ← Retour » avec **déconnexion propre** (résout Q-UX10, supprime le risque de slot owner fantôme) ; bouton landing « Je joue » → « Je diffuse » (évite le piège du listener qui joue aussi) ; tag de rôle en en-tête + intros de panel (rôle + MIDI-pas-son) spécifiés ; AC-U16b symétrique côté listener.
- **Cohérence PRD** : `programChange` ajouté au wireframe performer monitoring (5/5 types) ; note « SysEx silencieusement filtré » ajoutée au MonitoringPanel (FR-8).
- Non-appliqué (low severity, laissés en l'état pour MVP léger) : densité `MockByteStream`, étape 7 implicite du parcours, marquage de rôle individuel sur chaque wireframe (couvert par la spec IA). Détails dans les `review-*.md`.