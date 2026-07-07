---
status: final
updated: 2026-07-06
project: FM Live Wire
lens: séparation claire Listener vs Performer
grade: MVP-grade
reviewer: UX reviewer (lens rôle)
sources:
  experience: ./EXPERIENCE.md
  design: ./DESIGN.md
---

# Revue UX — séparation Listener / Performer

## Verdict

**PASS avec réserves.** L'architecture de l'IA sépare effectivement les deux rôles
en deux routes dédiées précédées d'un role-picker, et les invariants hard (token
uniquement sur `/performer`, aucun composant d'envoi MIDI côté listener, refus
terminal du 2ᵉ performer) sont tenus. La séparation est **structurellement saine**.

Trois réserves bloquent le PASS pleinement serein :

1. **Q-UX10 reste ouvert** — la nav « ← Changer de rôle » n'engage **aucun
   comportement de déconnexion** (`room:leave` côté listener, libération du slot
   owner côté performer). Risque de slot owner fantôme = invariant produit.
2. **Le bouton landing « Je joue (performer) »** est ambigü en français : un
   listener qui *joue* son synthé peut s'identifier au verbe « jouer » et
   s'autoriser sur la mauvaise route. Le parenthetical `(performer)` sauve, mais
   le verbe est le piège.
3. **Les intros de panel** (microcopy table lignes 94 et 109) **ne sont pas
   représentées dans les wireframes**. Le rappel inverse MIDI-vs-audio côté
   listener n'est pas dessiné. Distinction visuelle wireframe = contenu seul,
   pas de marquage de rôle explicite en haut de panel.

Aucun problème fatal pour le MVP, mais #1 doit être tranché avant
l'implémentation (c'est un contrat serveur, pas un détail cosmétique).

## Points forts

- **IA claire à 3 surfaces** (`/`, `/listener`, `/performer`), nav transverse
  explicitement interdite, seul lien = retour à `/` (EXPERIENCE.md lignes 34,
  61-69). Le role-picker est un ajout UX qui surclasse le PRD et tient son rôle.
- **Token admin isolé sur `/performer`** : `AdminTokenInput` apparaît uniquement
  dans le parcours performer (étape 2), pas de localStorage, jamais dans l'URL,
  validation `crypto.timingSafeEqual` côté serveur (lignes 110, 175, 253). Aucun
  champ de token côté listener.
- **Aucun composant d'envoi MIDI sur `/listener`** : `TestNoteButton` envoie
  explicitement `midi:test` (autorised listener→serveur), **pas `midi:event`**
  (lignes 148, 243). Le seul autre « envoi » côté listener est `Panic`/`Force
  Panic`, qui agit **localement sur la sortie MIDI du listener**, jamais vers le
  serveur (lignes 162-163, 251-252). E11 (`forbidden`) est explicitement relégué
  au debug console, pas à l'UI (ligne 231).
- **2ᵉ performer refusé de façon terminale** : `PerformerBusyAlert` + E9
  terminal, « Pas de retry silencieux », lien retour `/`, pas de re-saisie
  possible (lignes 112, 177, 225, 254, AC-U12). Microcopy claire : « Un
  performer est déjà connecté. Attendez la fin de sa session. »
- **Rappels MIDI-vs-audio** présents des deux côtés dans la table microcopy :
  performer « Seul le MIDI est diffusé, jamais l'audio. » (ligne 109, AC-U16),
  listener « Votre synthé FM génère le son. » (ligne 94) + tagline landing « Le
  son naît chez vous, sur votre synthé. » (ligne 90).
- **Wireframes structurellement distincts** : listener = MIDI card (sortie +
  canal + note de test) + Rejoindre + flux Mock + Panic ; performer = Connexion
  card (admin token + MIDI autorisé + Entrée) + Monitoring grid
  `TYPE · CH · VAL` + compteurs. Contenu mutuellement exclusif (pas de
  `MonitoringPanel` listener, pas de `PanicButton` performer, pas de canal
  côté performer).

## Problèmes

### P1 — HIGH — Nav « ← Changer de rôle » : déconnexion non spécifiée (slot owner fantôme)

- **Localisation** : EXPERIENCE.md ligne 69 (principe IA), ligne 258
  (`BackToHome` component pattern), ligne 510 (Q-UX10 ouvert), wireframes
  lignes 323, 399, 407, 442.
- **Problème** : `BackToHome` est défini uniquement comme « lien discret vers
  `/` ». Aucun comportement de cleanup n'est spécifié. Q-UX10 laisse ouvert
  « Recommandé : déconnexion propre au changement de rôle » sans le trancher.
  Côté performer, si la navigation vers `/` **ne déclenche pas** la libération
  du slot owner (fermeture socket / `disconnect` serveur), le serveur peut
  garder un owner fantôme : le 2ᵉ performer suivant sera refusé sur une session
  qui n'existe plus, et les listeners restent en `waiting` sur un owner absent.
  C'est une violation de l'invariant « un seul performer/admin » par dégradation
  silencieuse.
- **Côté listener**, même question : sans `room:leave` explicite au changement
  de rôle, le compteur `listeners` côté performer reste gonflé d'un fantôme
  jusqu'au timeout socket.
- **Suggestion** : transformer Q-UX10 en décision ferme dans EXPERIENCE.md :
  `BackToHome` **doit** émettre `room:leave` (listener) et **doit** fermer la
  socket proprement (performer) avant la navigation, et le serveur **doit**
  libérer le slot owner sur `disconnect` (déjà spécifié ligne 190 pour la
  fermeture d'onglet — étendre explicitement au changement de rôle). Ajouter un
  AC : « AC-U22 : la navigation « ← Changer de rôle » libère le slot owner
  (performer) et quitte la room (listener) avant de quitter la page. » Trancher
  Q-UX10 = « déconnexion propre ».

### P2 — MEDIUM — Bouton landing « Je joue (performer) » ambigu

- **Localisation** : EXPERIENCE.md lignes 92, 128, 171, 311 (wireframe landing).
- **Problème** : le verbe « jouer » est le verbe naturel d'un musicien. Un
  listener qui *joue* son synthé FM (Volca FM, Dexed…) peut lire « Je joue »
  comme « je suis celui qui joue » et cliquer la mauvaise route. Le
  parenthetical `(performer)` désambiguïse pour qui connaît le vocabulaire
  produit, mais pas pour un arrivant neuf qui n'a pas encore lu l'intro panel.
  La confusion est aggravée par le fait que le listener « fait le son »
  (tagline ligne 90), donc se perçoit légitimement comme celui qui *joue*.
- **Suggestion** : reformuler le bouton performer pour utiliser le verbe de
  **diffusion**, pas de jeu : « **Je diffuse (performer)** » ou « **Je joue en
  direct → diffusion** ». Garder « J'écoute (listener) » (asymétrie
  sémantiquement correcte : le listener reçoit, le performer diffuse).
  Alternative : tester la paire « Je diffuse / Je reçois » en user test
  post-traction, mais pour le MVP trancher vers « Je diffuse ».

### P3 — MEDIUM — Intros de panel absentes des wireframes

- **Localisation** : microcopy table lignes 94 (listener) et 109 (performer) ;
  wireframes `/listener` lignes 322-349 et `/performer` lignes 406-431.
- **Problème** : les deux phrases d'intro distinctives (« Vous recevez des
  événements MIDI… » / « Vous diffusez… ») existent dans la table microcopy
  mais **n'apparaissent dans aucun wireframe**. Les wireframes démarrent
  directement par un `StatusPill` (« ● Réception active » / « ● Diffusion
  active »). Or c'est l'intro panel qui porte la distinction de rôle la plus
  forte dès l'arrivée sur la page (avant tout état). Un utilisateur qui
  arrive sur un onglet ouvert peut hésiter sur sa route, surtout si les deux
  wireframes partagent l'en-tête `← Changer de rôle  FM LIVE WIRE`.
- **Suggestion** : ajouter en tête de chaque wireframe une ligne d'intro
  explicite (bandeau `Alert info` discret ou simple `<p>` secondary) :
  - `/listener` : « Vous recevez le MIDI. Votre synthé FM fait le son. »
  - `/performer` : « Vous diffusez le MIDI. Seul le MIDI part, jamais l'audio. »
  Reporter ce bandeau dans Component Patterns (nouveau composant
  `RoleIntroBanner` ou réutiliser `Alert info`).

### P4 — LOW/MEDIUM — Rappel inverse MIDI-vs-audio non dessiné côté listener

- **Localisation** : microcopy ligne 94, AC-U16 (côté performer seulement),
  wireframe `/listener` lignes 322-349.
- **Problème** : AC-U16 exige le rappel « Seul le MIDI est diffusé, jamais
  l'audio » côté **performer** (visible dans wireframe ligne 410-411). Il
  n'existe **pas d'AC symétrique côté listener** pour le rappel inverse « vous
  recevez le MIDI, votre synthé fait le son ». La microcopy existe (ligne 94)
  mais n'est ni placée dans le wireframe, ni exigée par un AC. Or l'objectif
  UX #1 (ligne 38) est précisément « éviter la confusion "où est le son ?" » —
  le rappel inverse est l'arme anti-confusion principale côté listener.
- **Suggestion** : (a) fusionner avec P3 si on ajoute `RoleIntroBanner` côté
  listener portant cette phrase ; (b) ajouter **AC-U23** : « le rappel "vous
  recevez le MIDI, votre synthé fait le son" est visible en permanence sur
  `/listener` (bandeau d'intro ou pied de panel) ».

### P5 — LOW — Écran E9 (2ᵉ performer refusé) : label « ← Changer de rôle » sémantiquement odd

- **Localisation** : wireframe lignes 433-444, microcopy ligne 112.
- **Problème** : un 2ᵉ performer qui vient d'être refusé n'a pas encore de
  rôle actif. Le lien « ← Changer de rôle » implique qu'il en avait un.
  Mineur — l'utilisateur comprend l'action — mais c'est une micro-incohérence
  de ton (le reste de la spec est très précis sur les labels verbatim).
- **Suggestion** : sur l'écran E9 (et E1/E2), utiliser « ← Retour à l'accueil »
  plutôt que « ← Changer de rôle ». Garder « ← Changer de rôle » uniquement
  sur les pages où un rôle est effectivement actif (`/listener`, `/performer`
  connectés).

### P6 — LOW — Wireframes partagent l'en-tête « ← Changer de rôle  FM LIVE WIRE » sans marquage de rôle

- **Localisation** : wireframes lignes 323 et 407.
- **Problème** : l'en-tête est identique entre les deux routes. La distinction
  ne vient que du contenu dessous. Combiné à P3 (intros absentes), un coup
  d'œil rapide aux deux wireframes côte à côte ne marque pas le rôle
  immédiatement. La spec visuelle DESIGN.md n'introduit pas non plus de
  marqueur de rôle (icône, couleur d'accent différenciée).
- **Suggestion** : ajouter un marquage de rôle dans l'en-tête — par exemple un
  `Badge` `info` (cyan) « LISTENER » ou `on_air` (amber) « PERFORMER » à côté
  du nom du projet. Coûte 1 token visuel, lève toute ambiguïté de route. À
  spécifier dans DESIGN.md → Components (`RoleHeaderBadge`).

## Résumé compact

- **Verdict** : PASS avec réserves. Séparation structurellement saine, invariants
  hard tenus (token isolé, pas d'envoi MIDI côté listener, refus terminal du 2ᵉ
  performer). Réserves = 1 invariant à trancher (Q-UX10) + 2 risques de
  confusion de rôle à marquer.
- **Problèmes par severity** :
  - HIGH : 1 (P1 — slot owner fantôme sur `← Changer de rôle`)
  - MEDIUM : 2 (P2 — bouton « Je joue » ambigu, P3 — intros de panel absentes
    des wireframes)
  - LOW/MEDIUM : 1 (P4 — rappel inverse MIDI/audio non dessiné côté listener,
    pas d'AC symétrique)
  - LOW : 2 (P5 — label « Changer de rôle » sur écran E9, P6 — en-tête sans
    marquage de rôle)
- **3 risques de confusion principaux** :
  1. **Bouton « Je joue (performer) »** : un listener-musicien peut
     s'autoidentifier au verbe « jouer » et s'engager sur `/performer` au lieu
     de `/listener`. (P2)
  2. **Wireframes sans intro de rôle en tête** : arrivée sur un onglet ouvert,
     rien dans le wireframe ne dit explicitement « vous êtes côté écoute » ou
     « vous êtes côté diffusion » avant le contenu. (P3 + P6)
  3. **Slot owner fantôme** : `← Changer de rôle` non spécifié comme
     déconnexion → un performer qui change de rôle peut laisser le serveur
     penser qu'un owner est actif, et le prochain performer légitime est refusé
     E9 par erreur → l'utilisateur pense « le rôle performer est bloqué » alors
     que c'est un résidu de session précédente. (P1)