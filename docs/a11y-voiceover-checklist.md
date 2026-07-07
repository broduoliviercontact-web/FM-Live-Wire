# Checklist VoiceOver — FM Live Wire (Story 6.3, AC-U20 / UX-DR28)

Procédure manuelle de validation accessibility sur macOS avec **VoiceOver**.
À exécuter sur un build de production (`pnpm --filter @fmlw/web build && pnpm --filter @fmlw/web preview`, ou un serveur HTTPS local — Web MIDI exige un contexte sécurisé).

Lancer VoiceOver : `Cmd + F5` (ou Pomme → Réglages Système → Accessibilité → VoiceOver).

Convention de navigation clavier utilisée ci-dessous :
- `Tab` / `Maj+Tab` : déplacement sequentiel.
- `Flèches` : déplacement dans un `radiogroup` / liste.
- `Ctrl+Option+Flèche` : navigation VoiceOver par élément.
- `Ctrl+Option+Espace` : activation.

## Pré-requis

- [ ] Navigateur Chrome ou Edge (Web MIDI requis).
- [ ] Contexte sécurisé HTTPS (ou `localhost`).
- [ ] Un périphérique MIDI de sortie connecté (ou la sortie **Mock / Debug**).
- [ ] VoiceOver activé (`Cmd + F5`).

## 1. Landing `/`

- [ ] Au chargement, VoiceOver annonce le titre « FM Live Wire » puis le tagline « Radio live de contrôle MIDI. Le son naît chez vous, sur votre synthé. ».
- [ ] `Tab` atteint l'indicateur On air → VoiceOver annonce « ● On air » ou « ○ Hors antenne » (région `aria-live=polite` → le changement d'état est annoncé au prochain poll `/health`).
- [ ] `Tab` atteint le bouton « Performer » puis « Listener » → labels annoncés ; `Entrée` navigue vers la route.
- [ ] Le pied de page « Chrome/Edge · HTTPS · Web MIDI » est lisible en navigation par élément.

## 2. Listener `/listener`

### 2.1 Ordre de tabulation (flux guidé, AC-U18)

- [ ] `Tab` traverse dans l'ordre : `← Retour` → bouton « Autoriser le MIDI » → sélecteur de sortie → `radiogroup` Canal de sortie → `Rejoindre le flux` → `Note de test` → `StatusPill` → `Force Panic` → `Panic`.
- [ ] Aucun piège clavier : on peut `Tab`/`Maj+Tab` d'un bouton à l'autre sans rester bloqué.
- [ ] Chaque contrôle focalisé montre un anneau de focus visible couleur `on_air` (ambre).

### 2.2 ChannelSelector — radiogroup (UX-DR25)

- [ ] `Tab` atterrit sur le canal actif (canal 1 par défaut) — un seul arrêt de tabulation (roving tabindex).
- [ ] VoiceOver annonce « Canal de sortie, radio group, 1 of 16, sélectionné ».
- [ ] `Flèche Droite` / `Flèche Bas` : la sélection avance et le focus suit ; VoiceOver annonce le nouveau canal sélectionné.
- [ ] `Flèche Gauche` / `Flèche Haut` : la sélection recule.
- [ ] `Home` : canal 1. `End` : canal 16.
- [ ] Le canal actif porte une **icône check** visible (la sélection ne dépend pas uniquement de la couleur).
- [ ] L'état sélectionné est annoncé par `aria-checked` (pas uniquement par la couleur).

### 2.3 Régions d'état — aria-live (AC-U20 / UX-DR27)

- [ ] `StatusPill` (`aria-live=polite`) : au changement d'état (idle → waiting → active → server-down → performer-disconnected), VoiceOver annonce le nouveau libellé (ex. « Serveur déconnecté. Reconnexion automatique en cours… »).
- [ ] `LateAlert` (`role=alert`) : quand `⚠ Flux en retard / connexion instable — latence {ms} ms` apparaît, VoiceOver l'annonce immédiatement (assertif).
- [ ] `OutputLostAlert` (`role=alert`) : « Sortie MIDI déconnectée. Rebranchez le périphérique ou choisissez une autre sortie. » est annoncé immédiatement.
- [ ] `ProtocolVersionAlert` (`role=alert`) : « Version de protocole incompatible. Rafraîchissez la page. » est annoncé immédiatement.

### 2.4 Flux MIDI brut — exclus (UX-DR28)

- [ ] Avec la sortie **Mock / Debug** sélectionnée et des événements reçus, le **flux de bytes** (`MockByteStream`) n'est **pas** annoncé en continu (`aria-live=off`). Il reste lisible si on navigue explicitement dedans, mais ne harcèle pas VoiceOver.
- [ ] `MonitoringPanel` (côté performer) : le dernier événement + les compteurs ne sont pas annoncés en continu (`aria-live=off`).

### 2.5 Panic / Force Panic

- [ ] `Panic` est toujours atteignable et activable, jamais désactivé ; VoiceOver annonce « Panic ». L'icône stop est décorative (`aria-hidden`), n'est pas annoncée séparément.
- [ ] `Force Panic` est désactivé tant qu'aucune sortie n'est choisie ; VoiceOver annonce « Force Panic, estompé » (disabled). Avec une sortie choisie, il est activable.
- [ ] Ouvrir le dialogue Force Panic : VoiceOver annonce le titre « Panic étendu : ~1–2 s. Confirmer ? » et l'intro « Force Panic envoie un noteOff sur les 128 notes × 16 canaux (2048 messages). Utile si une note reste coincée après un Panic normal. »
- [ ] Le focus est piégé dans le dialogue ; `Tab` circule entre « Annuler » et « Confirmer ». `Échap` ferme sans envoyer.
- [ ] Le bouton `Panic` normal reste visible/cliquable au-dessus du dialogue (échappatoire maintenue).
- [ ] « Confirmer » envoie le sweep ; le toast « Force Panic envoyé. » est annoncé (sonner `role=status`).

### 2.6 Reduced-motion (AC-U19)

- [ ] Activer « Réduire les animations » (Pomme → Accessibilité → Affichage → Réduire le mouvement). L'indicateur On air et le `MidiActivityIndicator` ne pulsent plus (opacité statique). Le warning retard reste visible.

## 3. Performer `/performer`

- [ ] `Tab` : `← Retour` → champ « admin token » → bouton « Connecter ».
- [ ] Le champ « admin token » est annoncé avec son label.
- [ ] À la connexion : « Connecté » est annoncé ; le `ConnectionStatus` (badge vert « Connecté ») est lisible.
- [ ] `MonitoringPanel` : « Diffusion active » annoncé ; les compteurs + dernier événement **non** annoncés en continu (`aria-live=off`).
- [ ] `RateLimitAlert` / `PerformerBusyAlert` (`role=alert`) : annoncés immédiatement à l'apparition.
- [ ] `Force Panic` / `Panic` (côté listener) — non présents ici. Le bouton « ← Retour » déconnecte proprement avant de revenir à `/`.

## 4. États critiques spécifiques (à déclencher manuellement)

- [ ] **Server-down** (couper le serveur pendant une session listener) → `StatusPill` annonce « Serveur déconnecté. Reconnexion automatique en cours… » ; `Panic` reste activable.
- [ ] **Output lost** (débrancher le périphérique MIDI en session) → `OutputLostAlert` annonce « Sortie MIDI déconnectée… » ; le sélecteur de sortie réouvre.
- [ ] **Panic** (clic bouton) → les notes coincées coupent sur le synthé local ; aucune annonce verbeuse requise (action silencieuse locale).
- [ ] **Force Panic** (confirmer le dialogue) → le toast « Force Panic envoyé. » est annoncé.

---

## Sign-off manuel (à compléter par Zub)

- Build / serveur vérifié : `____________________________________` (date / commit)
- VoiceOver (version macOS) : `____________________________________`
- Navigateur : `____________________________________`

Résultat par section :

- [ ] 1. Landing `/` — OK / anomalies : ____________________
- [ ] 2. Listener `/listener` (tab order + radiogroup + aria-live + exclusions + Panic + reduced-motion) — OK / anomalies : ____________________
- [ ] 3. Performer `/performer` — OK / anomalies : ____________________
- [ ] 4. États critiques (server-down / output lost / Panic / Force Panic) — OK / anomalies : ____________________

Décision finale :

- [ ] **Validé** — l'audit accessibilité Story 6.3 est conforme (AC-U18, AC-U19, AC-U20).
- [ ] **À revoir** — anomalies à corriger : ____________________

Signé : **Zub** — Date : `____________`