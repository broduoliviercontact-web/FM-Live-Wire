# Revue UX — Parcours Listener (lens: simplicité du parcours)

**Cible** : `/Users/zub/bmad-project/_bmad-output/planning-artifacts/ux-designs/ux-bmad-project-2026-07-06/EXPERIENCE.md`
**Lens** : simplicité du parcours Listener, posture utilisateur néophyte mais technicien musical.
**Posture** : revue MVP-grade, on cherche le friction qui fait hésiter Maria devant son Volca FM, pas le polissage post-traction.

---

## Verdict

**MVP acceptable avec corrections mineures.** Les 6 étapes canoniques (connecter → sortie → canal → tester → rejoindre → Panic) sont présentes, dans le bon ordre, sans cul-de-sac bloquant ni branche arrière cassante. Le modèle mental « je reçois du MIDI, mon synthé fait le son » est bien posé (intro panel, rappel performer, microcopy). Le Panic toujours-actif-même-serveur-down est le point fort du produit et il est bien spécifié.

Ce qui nuit à la lisibilité néophyte n'est pas le parcours lui-même mais **sa présentation** : (a) un décalage de numbering entre les « 6 étapes » annoncées et les étapes numérotées du récit, (b) l'absence d'un wireframe de l'état initial/idle qui montrerait le parcours à vide, (c) une surcharge d'indicateurs simultanés en réception active, (d) des boutons désactivés sans feedback sur la raison. Aucun de ces points ne casse le parcours ; tous le ralentissent pour un néophyte.

---

## Points forts

- **Les 6 étapes sont dans l'ordre explicite** dans le récit (Étapes 2→3→4→5→6→8 du parcours = connecter→sortie→canal→tester→rejoindre→Panic). Pas d'inversion, pas de cul-de-sac.
- **Panic toujours atteignable** (principe ligne 52, AC-U13, climax beat étape 8 + S-2). C'est la promesse de sécurité musicale et elle est bien défendue.
- **Mock/Debug comme secours, pas comme complexité** : introduit seulement quand `MIDIOutputMap` vide ou à l'initiative de l'utilisateur, badge `mock` distinct, microcopy « Aucun périphérique ? Utilisez Mock / Debug ». Bonne rampe d'accès pour le néophyte sans périphérique.
- **État avant action** + **une colonne, un flux guidé** : la structuration verticale en cartes est adaptée à un technicien musical qui lit de haut en bas.
- **Microcopy fidèle et tooltips sur le remappage forcé** : le point de confusion majeur (canal = sortie vers mon synthé, pas canal d'origine) est explicité par tooltip (ligne 98, AC-U5).
- **États d'erreur couverts** (E1–E13) avec microcopy + action proposée. Pas d'état orphelin.
- **Accessibilité floor sérieux** : clavier, focus visible, reduced-motion, aria-live sur changements d'état, ne-dépend-pas-de-la-couleur-seule.

---

## Problèmes

Sévérité : **High** (casse ou dégrade le parcours néophyte), **Medium** (friction réelle mais contournable), **Low** (polissage post-MVP).

### P1 — High — Décalage de numbering entre « 6 étapes » et étapes numérotées du récit
- **Localisation** : §Key Flows > Parcours Listener (lignes 124–167) vs §Objectifs UX point 2 (ligne 39).
- Les 6 étapes canoniques sont annoncées comme (1) connecter MIDI → (2) sortie → (3) canal → (4) tester → (5) rejoindre → (6) Panic. Mais le récit numérote « Étape 1 — Compatibilité navigateur » (gate), « Étape 2 — Connecter MIDI », etc. Donc **« Étape 1 » du récit ≠ « étape 1 » des 6 étapes** : il y a un décalage de +1 (avec Étape 0 landing en sus). Un néophyte qui lit « onboarding en 6 étapes » puis voit « Étape 1 — Compatibilité navigateur » peut croire que la compatibilité navigateur compte pour l'une des 6.
- **Suggestion** : renuméroter le récit en étapes « gate » (Étape 0 landing, Étape 0b compat) et réserver « Étape 1–6 » au parcours actif, ou bien nommer explicitement « pré-étapes » (gate) vs « les 6 étapes ». Aligner le wireframe sur la même numérotation visible (badges 1–6 sur les cartes).

### P2 — High — Aucun wireframe de l'état initial (idle) du listener
- **Localisation** : §Wireframes textuels (lignes 297–371). Wireframes présents : landing, listener réception active, listener en attente+retard, Force Panic dialog, E1, performer diffusion, E9. **Manquant : listener idle, avant toute action**.
- Le néophyte débarque sur `/listener` : que voit-il ? La carte MIDI vide, le bouton Rejoindre désactivé, pas de StatusPill « réception active ». Aucun wireframe ne montre cet état, qui est pourtant le premier contact avec le parcours. Le wireframe « réception active » montre tout déjà rempli (MIDI autorisé, sortie Mock, canal 1) — utile pour montrer l'état cible, pas le point de départ.
- **Suggestion** : ajouter un wireframe `/listener` — état initial (idle) : carte MIDI avec bouton « Connecter MIDI » seul, Sortie/Canal/Note de test grisés ou absents, Rejoindre désactivé avec hint, Panic déjà visible en bas (pour rassurer).

### P3 — High — Surcharge d'indicateurs simultanés en réception active
- **Localisation** : wireframe `/listener` réception active (lignes 322–349) + Component Patterns (MidiActivityIndicator, NoteVisualizer, MockByteStream, LatenceStat, StatusPill).
- En réception active, le listener a simultanément à l'écran : (1) StatusPill « Réception active — N events », (2) MidiActivityIndicator pulsant, (3) NoteVisualizer dessinant les notes, (4) MockByteStream (en Mock) ou byte stream implicite, (5) LatenceStat `{ms} ms`. Soit **5 indicateurs visuels concurrents** pour un MVP qui se veut « une colonne, un flux guidé, pas de densité ».
- Le technicien musical veut savoir « le flux arrive-t-il ? ma chaîne sonne-t-elle ? » — pas lire 5 widgets. NoteVisualizer + MidiActivityIndicator sont redondants (les deux disent « activité »). LatenceStat est utile seulement si quelque chose va mal.
- **Suggestion** : hiérarchiser. Garder StatusPill + MidiActivityIndicator comme signaux primaires ; cacher LatenceStat par défaut (n'apparaître qu'en alerte `late`, déjà géré par LateAlert) ; cacher MockByteStream derrière un toggle « voir les bytes » ou le réserver au mode Mock explicite. NoteVisualizer optionnel, pas obligatoire au MVP.

### P4 — Medium — Bouton « Rejoindre le flux » désactivé sans explication visible
- **Localisation** : AC-U3 (ligne 467), Interaction Primitives (ligne 290), wireframe réception active (ligne 335 — mais ici il est actif). État initial non wireframé (cf. P2).
- « Rejoindre désactivé tant qu'aucune sortie choisie » est une bonne règle (sélection dépendante). Mais il n'y a **aucune microcopy expliquant pourquoi le bouton est gris**. Pour un néophyte, un bouton désactivé sans raison = frustration + hésitation « est-ce que ça marche ? ».
- **Suggestion** : sous le bouton désactivé, hint mono : « Choisissez une sortie MIDI pour rejoindre. » Alternative : bouton toujours actif, au clic si pas de sortie → scroll/pointe vers MidiPortPicker avec alert `info`. La deuxième option est plus guidée mais ajoute une étape ; la première est plus simple pour MVP.

### P5 — Medium — Wireframe « en attente + retard » combine deux états logiquement incompatibles
- **Localisation** : wireframe `/listener` — état en attente + retard (lignes 354–371).
- Le wireframe montre simultanément « ○ En attente du performer… » (StatusPill `waiting`, owner absent) ET « ⚠ Flux en retard / connexion instable — latence 240 ms » (LateAlert, qui suppose un flux actif donc performer présent). Ces deux états s'excluent : si le performer est absent, il n'y a pas de flux à être en retard. Le wireframe amalgamé peut induire en erreur sur la coexistence de ces états.
- **Suggestion** : séparer en deux wireframes distincts — `/listener` état waiting (pas de retard) et `/listener` état late (réception active + retard). Ou, si l'intention est de montrer la pile des Alert/StatusPill, le commenter explicitement « exemple de empilement d'alertes, pas un état réel unique ».

### P6 — Medium — Panic : « fixe en bas du panel listener » est ambigu (sticky vs fin de flux)
- **Localisation** : principe ligne 52 (« bouton Panic fixe en bas du panel listener »), wireframes (lignes 346–348, 369).
- « Fixe en bas du panel » peut signifier (a) sticky en bas du viewport (toujours visible sans scroller) ou (b) en bas du flux de cartes (disparaît si on scroll). Le principe « Panic toujours atteignable, jamais masqué » plaide pour (a), mais le wireframe le montre dans une carte en fin de colonne, ce qui suggère (b). Sur un viewport court avec MockByteStream long, le Panic peut défiler hors vue.
- **Suggestion** : trancher explicitement — Panic sticky bottom (viewport), pas dans le flux de cartes. Documenter dans le principe. Ajouter au wireframe une annotation « sticky viewport ».

### P7 — Medium — « Note de test » désactivée sans hint (sortie + canal requis)
- **Localisation** : Interaction Primitives ligne 290 (« Note de test désactivé tant qu'aucune sortie + aucun canal »), wireframe réception active (ligne 332, ici actif).
- Même problème que P4 : règle de sélection dépendante correcte, mais pas de feedback sur la raison. Un néophyte qui voit « Note de test » grisée ne sait pas qu'il doit d'abord choisir sortie + canal.
- **Suggestion** : hint sous le bouton « Choisissez une sortie et un canal pour tester. » Ou tooltip au hover.

### P8 — Low — Landing « Hors antenne » sans guidance « vous pouvez quand même rejoindre »
- **Localisation** : wireframe landing (lignes 301–317), état vide landing (ligne 200).
- L'indicateur « ○ Hors antenne » est bien visible, les boutons restent actifs (ligne 200), mais rien ne dit au néophyte « vous pouvez cliquer J'écoute et attendre le performer ». Un néophyte peut interpréter « Hors antenne » comme « ne pas cliquer ».
- **Suggestion** : microcopy sous l'indicateur « Hors antenne » : « Vous pouvez rejoindre et attendre le démarrage. » ou rendre le bouton listener avec sous-texte « rejoindre et attendre ».

### P9 — Low — MockByteStream dense pour un néophyte, même en Mock
- **Localisation** : wireframe réception active (lignes 337–342), Component Patterns MockByteStream (ligne 248).
- Le byte stream `noteOn · ch1 · 60 · 100` est lisible pour un technicien musical, mais la liste scrollante peut donner l'impression d'une console de debug plutôt que d'une radio. Pour le MVP, c'est acceptable (le persona est technicien), mais cela contredit le ton « radio live » si le mode Mock devient l'usage par défaut en l'absence de périphérique.
- **Suggestion** : garder pour MVP, mais plier/cacher par défaut avec un toggle « afficher les bytes ». Le StatusPill + NoteVisualizer suffisent à signaler l'activité.

### P10 — Low — Latence affichée par défaut, même saine
- **Localisation** : wireframe réception active (ligne 344), Component Patterns LatenceStat (ligne 249).
- Afficher « latence : 42 ms » en permanence donne une info que le néophyte ne sait pas interpréter (42 ms c'est bien ? mal ?). LateAlert gère déjà le cas pathologique. La latence saine affichée ajoute du bruit.
- **Suggestion** : ne pas afficher LatenceStat par défaut ; ne montrer la latence qu'au-delà du seuil (via LateAlert) ou dans un panneau « détails » plié.

### P11 — Low — Étape 7 « Pendant la performance » est une 7e étape implicite
- **Localisation** : Étape 7 (lignes 159–160).
- Les 6 étapes canoniques s'arrêtent à Panic, mais le récit a une Étape 7 « Pendant la performance » (latence, activity) qui s'insère entre Rejoindre (étape 6 du récit = étape 5 des 6) et Panic (étape 8 du récit = étape 6 des 6). C'est logique narrativement, mais cela ajoute une étape non annoncée dans les 6. Cohérent avec P1.
- **Suggestion** : présenter Étape 7 comme « état continu » et non comme une étape d'onboarding, ou la fusionner dans l'état « réception active » (état 3 du State Patterns).

---

## Réponse point par point aux 7 questions

1. **6 étapes dans l'ordre explicite dans parcours ET wireframe ?** Oui dans le récit (bon ordre, pas de cul-de-sac, branches arrière = reprises intentionnelles : permission retry, sortie re-sélection). Wireframe : ordre vertical cohérent (MIDI→Sortie→Canal→Note→Rejoindre→Panic), **mais** pas de wireframe de l'état initial (P2) et le numbering du récit est décalé vs les 6 étapes (P1).
2. **Tester avant Rejoindre — logique ?** Oui, c'est la bonne décision pour un technicien musical : valider la chaîne locale avant de consommer le flux évite l'ambiguïté « pas de son = mon setup ou le serveur ? ». L'inverse serait plus simple conceptuellement mais moins diagnostique. Garder. Note : le bouton Note de test reste dispo après rejoin (wireframe réception active), donc l'ordre n'est pas figé — bien.
3. **Rejoindre désactivé sans sortie — clair ou frustrant ?** Règle correcte, mais **frustrant sans hint** (P4). Ajouter une microcopy sous le bouton désactivé.
4. **États d'attente — clairs ?** Oui, StatusPill `waiting` + indice « Dès que le performer démarre, le flux arrive » (ligne 202) est clair. Le listener peut rejoindre avant (bouton actif si sortie choisie, owner: false géré). Manque léger : la landing « Hors antenne » ne guide pas vers « vous pouvez quand même rejoindre » (P8).
5. **Panic atteignable et compréhensible ? Force Panic obscurcit ?** Oui, Panic primaire 44px, Force Panic secondaire + Dialog de confirmation avec explication 2048 messages. Hiérarchie visuelle bonne, pas d'obscurcissement. Seul risque : « fixe en bas du panel » ambigu (sticky vs fin de flux, P6) — trancher en sticky viewport.
6. **Mock/Debug — secours clair ou complexité ?** Secours clair : introduit sur état vide, badge distinct, microcopy dédiée. Le MockByteStream ajoute un peu de complexité visuelle (P9) mais reste scoppé au mode Mock. Acceptable pour MVP.
7. **Surcharge d'infos simultanées ?** **Oui, risque réel** (P3) : 5 indicateurs concurrents (StatusPill + Activity + Visualizer + ByteStream + Latence) en réception active. Pour un MVP « une colonne, pas de densité », c'est trop. Hiérarchiser : primaires (StatusPill + Activity), secondaires pliés (Latence, ByteStream, Visualizer).

---

## Synthèse actionnable (corrections MVP)

1. **Renuméroter** les étapes du récit pour aligner « Étape 1–6 » sur les 6 étapes canoniques ; passer landing + compat en « pré-étapes » (P1).
2. **Ajouter un wireframe `/listener` état idle** (P2) — premier contact néophyte.
3. **Ajouter des hints sous les boutons désactivés** (Rejoindre P4, Note de test P7) avec microcopy.
4. **Hiérarchiser les indicateurs** réception active (P3) : StatusPill + Activity primaires ; Latence/ByteStream/Visualizer pliés ou on-demand.
5. **Trancher Panic sticky viewport** (P6) et l'annoter dans le principe + wireframe.
6. **Séparer le wireframe « en attente + retard »** en deux états distincts (P5).