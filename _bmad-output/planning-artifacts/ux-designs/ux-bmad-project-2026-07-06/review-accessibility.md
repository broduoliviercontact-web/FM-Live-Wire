---
status: final
updated: 2026-07-06
project: FM Live Wire
lens: accessibilité (WCAG 2.1 AA, MVP-grade)
reviewer: UX reviewer (lens a11y)
targets:
  - ./DESIGN.md
  - ./EXPERIENCE.md
context: app web desktop sombre « live studio », shadcn/ui + Tailwind, Chrome/Edge cible, produit musical MIDI. Pas de mobile. La recherche technique ne traitait pas l'a11y — comblé côté UX.
---

# Revue accessibilité — FM Live Wire (MVP, AA)

> Socle visé : WCAG 2.1 niveau AA, interprété au niveau MVP (pas enterprise, pas AAA). Cible desktop Chrome/Edge + clavier + VoiceOver. Pas de mobile.

## Verdict

**Acceptable avec corrections.** Le socle a11y est **déjà pensé sérieusement** dans EXPERIENCE.md (`Accessibility Floor` + AC-U18/U19/U20), ce qui est rare pour un MVP musical. Le cadre est bon : contraste fort sur la paire primaire, clavier pris en charge via shadcn, `prefers-reduced-motion` explicite, refus de dépendre de la couleur seule pour StatusPill/Alert/Panic, flux MIDI brut explicitement exclu d'`aria-live`.

Cependant **2 points bloquants pour AA** subsistent, tous deux sur des contrôles critiques du parcours listener :

1. **Texte blanc sur bouton Panic (`#FF4D4F`) ≈ 3.27:1** — sous AA pour texte normal. Or Panic est le climax de sécurité du produit (AC-U13, S-2). Non acceptable tel quel.
2. **`ink.muted` sur `surface_2` ≈ 4.48:1** — juste sous le seuil 4.5:1. `muted` est réservé aux hints/métadonnées (non actionnable), donc impact limité, mais le seuil AA est raté d'un cheveu sur une paire effectivement utilisée (hints dans zones imbriquées surface_2).

Plusieurs points de spécification (non bloquants mais à verrouiller avant build) : `ChannelSelector` en `radiogroup` clavier, `aria-live` rattaché explicitement aux régions d'état (StatusPill/LateAlert), acceptance VoiceOut ferme (aujourd'hui `[ASSUMPTION]`), et focus management du `ForcePanicDialog`.

## Points forts

- **Contraste de la paire primaire excellent.** `ink.primary` `#E8EAED` sur `base.bg` `#0A0B0D` ≈ **16.4:1**, sur `surface` ≈ 15.3:1, sur `surface_2` ≈ 14.0:1. Loin au-dessus de AA. (DESIGN.md `Do` revendique ≈15:1 — cohérent, légèrement sous-estimé.)
- **`ink.secondary` `#B4B9C1`** partout ≥ 8.6:1 → OK pour descriptions.
- **Couleurs signal en tant que texte** (on_air, connected, info) sur fond sombre : toutes > 8:1 → OK pour badges/labels colorés.
- **`prefers-reduced-motion` explicite** (EXPERIENCE.md §Accessibility Floor + AC-U19) : désactive `pulse_on_air` et `MidiActivityIndicator`, remplace par changement d'opacité statique. Le warning retard reste visible statiquement. Bonne couverture.
- **Pas de couleur seule** pour les 3 éléments demandés :
  - `StatusPill` = point coloré **+ label texte** (DESIGN.md §Components ; State Patterns).
  - `Alert` = icône **+ titre + détail** + bordure gauche colorée.
  - `PanicButton` = icône stop **+ texte `PANIC`** + rouge. Un daltonien identifie l'action sans la couleur.
- **Flux MIDI brut exclu d'`aria-live`** (EXPERIENCE.md §Accessibility Floor) — bon, c'est la bonne décision (sinon : flood verbeux). Changements d'état (connecté/déconnecté/erreur) en `aria-live="polite"`.
- **Clavier** : ordre de tabulation = ordre du flux guidé (AC-U18), focus ring `on_air` (DESIGN.md §Components Input). Panic = actionnable, pas lien décoratif (AC-U13).
- **Labels** : chaque Select/Input a un `<label>` ; tooltips prévus pour Force Panic et remappage canal (§Accessibility Floor).
- **Pas de localStorage pour le token** — bonne hygiène (pas de fuite d'info sensible).

## Problèmes

### Critical

#### A1 — Texte blanc sur bouton Panic : 3.27:1 (sous AA)
- **Fichier/section** : `DESIGN.md` → `tokens.colors.signal.danger` `#FF4D4F` + `§Components PanicButton` (« fond `{danger}`, texte blanc ») ; `EXPERIENCE.md` → AC-U13.
- **Estimation** : `#FF4D4F` luminance ≈ 0.271 ; blanc = 1.0 ; ratio = (1.0+0.05)/(0.271+0.05) = **3.27:1**. WCAG AA requiert 4.5:1 (texte normal) ou 3:1 (grand texte ≥ 18.66px bold ou ≥ 24px). Le bouton Panic fait 44px de hauteur (`control_height_lg`) mais le texte `PANIC` est typiquement 14–16px (default shadcn `text-sm`/`text-base`), donc **non grand texte** → seuil 4.5:1 applicable → **échec**.
- **Impact** : lecture du label du contrôle le plus critique du produit compromise en faible lumière / pour l'utilisateur legèrement malvoyant. C'est exactement le climax beat (étape 8, S-2) — ne peut pas être en échec AA.
- **Fix suggéré** (au choix) :
  1. **Assombrir `danger`** pour le fill bouton à ~`#D63A3A` ou `#E11D2E` (luminance plus basse → ratio blanc ~4.6–5:1). Conserver `#FF4D4F` pour le dot StatusPill `error` (pas de texte dessus) et pour la bordure gauche d'Alert `danger` (texte = `ink.primary` sur `surface`, déjà OK). Split token : `signal.danger` (fill) vs `signal.danger_bright` (indicateur).
  2. Ou conserver `#FF4D4F` comme fond et passer le texte en `#0A0B0D` (`bg`) : ratio ≈ 9.86:1 (bg sur danger) — mais rouge vif + texte noir = moins « urgence » visuellement ; à valider créa.
  3. Ou monter le label `PANIC` en ≥ 18.66px bold pour qualifier « grand texte » (seuil 3:1) — facile mais fragile (dépend du respect strict du poids/taille) ; préférer la solution 1.
- **Recommandation** : solution 1 (token `danger` légèrement assombri pour les fills porteurs de texte).

### Major

#### A2 — `ink.muted` sur `surface_2` ≈ 4.48:1 (juste sous AA)
- **Fichier/section** : `DESIGN.md` → `tokens.colors.ink.muted` `#7E848D` + `tokens.colors.base.surface_2` `#1A1D23` ; usage déclaré « hints, métadonnées ».
- **Estimation** : muted luminance ≈ 0.229 ; surface_2 ≈ 0.0122 ; ratio = (0.229+0.05)/(0.0122+0.05) = **4.48:1** — 0.02 sous le seuil AA 4.5:1. (`muted` sur `surface` ≈ 4.89:1 OK ; `muted` sur `bg` ≈ 5.23:1 OK.)
- **Impact** : `surface_2` est le fond des inputs et zones imbriquées (DESIGN.md §Colors) — les hints/placeholder/métadonnées dans ces zones tombent sous AA. `muted` est réservé aux infos **non actionnables** (DESIGN `Do`/`Don't`), donc impact fonctionnel limité, mais le seuil formel est raté.
- **Fix suggéré** : éclaircir `ink.muted` de ~+6 de luminosité, p. ex. `#868C95` ou `#888E97` (pousse le ratio surface_2 à ~4.7–4.8:1). Vérifier que `muted` reste visuellement « muted » vs `secondary` (`#B4B9C1`) — marge confortable, OK. À recalculer après fix.
- **Note** : c'est l'estimation la plus proche du seuil ; à confirmer avec un outil (WAVE / Contrast checker) post-fix.

#### A3 — `ChannelSelector` : 16 tab-stops présumés, pas de sémantique radiogroup
- **Fichier/section** : `DESIGN.md` → `§Components ChannelSelector` (« 16 créneaux 1–16 en grille, actif = fond `{on_air}` texte `{bg}` ») ; `EXPERIENCE.md` → `§Component Patterns ChannelSelector`, AC-U18.
- **Problème** : la spec décrit 16 créneaux en grille mais ne dit pas sémantique ARIA. Si implémentés comme 16 `<button>` séparés → 16 tab-stops, ce qui **casse l'ordre de tabulation = flux guidé** (AC-U18) et bloat le clavier. De plus, « actif = fond on_air » seul peut dépendre de la couleur pour l'état sélectionné.
- **Fix suggéré** : `role="radiogroup"` + `aria-label="Canal de sortie"` conteneur, 16 `role="radio"` + `aria-checked`, navigation par **flèches** (gauche/droite/haut/bas), un seul tab-stop. État sélectionné = fond `on_air` **+** `aria-checked="true"` **+** icône check ou anneau `border_strong` (ne pas dépendre du seul fond couleur). Compatibilité shadcn : composer sur `RadioGroup` + grille visuelle.
- **Sévérité Major** parce que ça touche 100% du parcours listener (étape 4 obligatoire) et AC-U18.

#### A4 — `aria-live` : rattachement aux régions d'état non explicite
- **Fichier/section** : `EXPERIENCE.md` → `§Accessibility Floor` (« Les changements d'état (connecté/déconnecté/erreur) utilisent `aria-live="polite"` ») ; `§State Patterns` (StatusPill mapping) ; `§Component Patterns LateAlert`.
- **Problème** : la spec dit *que* les changements d'état utilisent `aria-live`, mais **ne dit pas quelle région DOM** est marquée `aria-live`. `StatusPill` est un composant réutilisé à plusieurs endroits (landing On air, listener réception, performer diffusion). Si l'implémenteur oublie de poser `aria-live` sur le conteneur du pill, AC-U20 échoue sans que personne le voie. Idem pour `LateAlert` (Apparaît/disparaît, non mentionné explicitement comme `aria-live`).
- **Fix suggéré** : expliciter dans `Component Patterns` : « `StatusPill` racine = `role="status"` + `aria-live="polite"` + `aria-atomic="true"` ; `LateAlert` = `role="alert"` (donc `aria-live="assertive"` à réserver au danger bloquant) ou `aria-live="polite"` pour `late` (warning non bloquant). Discriminer : `danger` → `role="alert"` ; `late`/`info` → `role="status"`. »
- **Sévérité Major** : sans cette précision, AC-U20 (`[ASSUMPTION]` VoiceOver) est invérifiable et probablement partiellement cassé.

#### A5 — Acceptance VoiceOver marquée `[ASSUMPTION]` au lieu de ferme
- **Fichier/section** : `EXPERIENCE.md` → AC-U20 (`[ASSUMPTION]`), `§Accessibility Floor` (`[ASSUMPTION] : test lecteur d'écran à prévoir`), Q-UX8.
- **Problème** : AC-U20 est la seule AC a11y runtime, et elle est balisée assumption. Si elle n'est pas promue en AC ferme, il n'y a **aucun gate de non-regression a11y** dans la définition de done.
- **Fix suggéré** :
  - Promouvoir AC-U20 en AC ferme (retirer `[ASSUMPTION]`).
  - Ajouter une procédure de test VoiceOver minimale dans `§Critères d'acceptation UX` : (a) naviguer `/listener` au clavier + VoiceOver, vérifier annonce de : « MIDI autorisé », « Réception active — N events », « Serveur déconnecté », « Panic ». (b) Vérifier que le flux `MockByteStream` n'est **pas** annoncé. (c) Vérifier `ForcePanicDialog` : focus trap + annonce du libellé « Panic étendu : ~1–2 s » à l'ouverture, retour focus à `ForcePanicButton` à la fermeture.
  - Ajouter AC : « navigation clavier seule (sans souris) ferme une session listener complète, Panic inclus » — démo de S-2 en clavier pur.

### Minor

#### A6 — `NoteVisualizer` : pas de mention `prefers-reduced-motion`
- **Fichier/section** : `DESIGN.md` → `§Components NoteVisualizer` ; `EXPERIENCE.md` → `§Accessibility Floor` (ne couvre que `pulse_on_air` et `MidiActivityIndicator`).
- **Problème** : les barres de notes apparaissent/disparaissent à l'attaque/release — c'est un mouvement. Sous reduced-motion, pas de directive. Moins critique que la pulse (le mouvement porte de l'information : note active), mais à spécifier.
- **Fix suggéré** : sous `prefers-reduced-motion`, conserver l'affichage statique de la note (barre présente tant que noteOn, transition instantanée 0ms au lieu d'animation d'attaque). Ne pas supprimer l'information (la note est jouée). Documenter dans `§Accessibility Floor`.

#### A7 — `ForcePanicDialog` : focus management non spécifié
- **Fichier/section** : `EXPERIENCE.md` → `§Component Patterns ForcePanicButton + ForcePanicDialog`, `§Interaction Primitives Confirmation modale`.
- **Problème** : la spec dit « Dialog confirmation » mais ne pose pas : focus initial sur bouton `Confirmer` (ou `Annuler` ?), focus trap, retour focus au trigger après fermeture, `Escape` = annulation. shadcn Dialog (Radix) fournit tout ça par défaut, mais à expliciter pour verrouiller.
- **Fix suggéré** : ajouter à `Component Patterns` : « `ForcePanicDialog` : focus initial sur `Annuler` (geste destructif, choix sûr par défaut), focus trap activé, `Escape` = `Annuler`, retour focus sur `ForcePanicButton` à la fermeture. `aria-labelledby` = titre « Force Panic », `aria-describedby` = détail « Panic étendu : ~1–2 s… 2048 messages ». »

#### A8 — Déclencheur de tooltip `ⓘ` : nom accessible manquant
- **Fichier/section** : `DESIGN.md` → `§Components Tooltip` ; `EXPERIENCE.md` wireframes (`ⓘ` à côté de Force Panic, sortie MIDI, canal).
- **Problème** : le glyphe `ⓘ` comme trigger tooltip n'a pas de nom accessible (un lecteur d'écran lit « info » ou rien). shadcn/Radix Tooltip est focus-accessible par défaut, mais le trigger doit avoir un `aria-label` explicite (p. ex. « Aide — remappage canal »).
- **Fix suggéré** : chaque trigger tooltip = `<button>` avec `aria-label` descriptif + `aria-describedby` pointant vers le contenu tooltip (le tooltip étant `role="tooltip"`). Documenter dans `Component Patterns Tooltip`.

#### A9 — `Select` item actif : surligné `on_air` 20% seul (couleur)
- **Fichier/section** : `DESIGN.md` → `§Components Select` (« item actif surligné `{on_air}` à 20% opacité »).
- **Problème** : surligné par couleur seule (un utilisateur daltonien ou en high-contrast pourrait confondre). shadcn Select affiche un `Check` icon par défaut — à confirmer dans la spec.
- **Fix suggéré** : expliciter « item actif = fond `on_air` 20% **+** icône check `ink.primary` » et s'appuyer sur `aria-selected="true"` (shadcn natif).

#### A10 — Pas de mode clair MVP : assumé mais pas de mitigation salle claire
- **Fichier/section** : `EXPERIENCE.md` → `§Accessibility Floor` (`prefers-color-scheme : non applicable`), Q-UX8.
- **Problème** : la décision « sombre par design » est légitime pour un produit scène. Q-UX8 l'ouvre explicitement (salle claire, lecture d'écran en journée). Le cas légitime = utilisateur **svoyant** en salle claire (glare) — un lecteur d'écran fonctionne indépendamment du thème, donc le cas « lecture d'écran en salle claire » est en réalité non concerné par l'absence de mode clair (VoiceOver lit aloud). Le vrai cas = faible vision + salle claire. À MVP, c'est un **risque accepté**, mais non documenté comme tel.
- **Fix suggéré** : fermer Q-UX8 pour le MVP avec un verdict explicite dans `Accessibility Floor` : « Mode clair non livré MVP — risqué pour utilisateurs faible vision en salle très éclairée. Mitigation MVP : `ink.primary` 16:1 sur `bg` reste lisible en glare modéré ; recommander aux utilisateurs en salle très claire de baisser la luminosité écran ou d'utiliser un onglet dédié. Post-MVP : évaluer un thème clair si retour terrain. » Tracer comme décision, pas comme question ouverte.

#### A11 — Pas de skip-link / landmarks (header/nav/main) spécifiés
- **Fichier/section** : `EXPERIENCE.md` → `§Information Architecture`, `§Wireframes`.
- **Problème** : aucune mention de `<header>`, `<main>`, `<nav>`, ni de skip-link. Avec une colonne guidée c'est peu coûteux et aide clavier + VoiceOver.
- **Fix suggéré** : chaque surface = `<main>` avec `<h1>` « FM Live Wire » (déjà présent en wireframe), `← Changer de rôle` dans un `<nav aria-label="Rôle">`. Skip-link « Aller au contenu principal » en premier tab-stop. Faible effort, bon retour.

#### A12 — `LateAlert` : `aria-live` non spécifié par variante
- **Fichier/section** : `EXPERIENCE.md` → `§Component Patterns LateAlert`, `§États d'erreur E10/E12`.
- **Problème** : lié à A4. `LateAlert` est une `Alert` variante `late` qui apparaît dynamiquement (warning local). Si `role="alert"` (assertive) → annonce intrusive pour un warning non bloquant. Si `role="status"` (polite) → plus approprié.
- **Fix suggéré** : `LateAlert` = `role="status"` + `aria-live="polite"` (warning, pas blocage). `Alert` variante `danger` (E1/E2/E3/E8/E9/E13) = `role="alert"` (assertive, blocage). À tracer dans `Component Patterns Alert`.

## Synthèse par sévérité

| Sévérité | Count | Items |
|---|---|---|
| Critical | 1 | A1 (Panic white-on-red 3.27:1) |
| Major | 4 | A2 (muted/surface_2 4.48:1), A3 (ChannelSelector radiogroup), A4 (aria-live régions), A5 (VoiceOver AC ferme) |
| Minor | 7 | A6 NoteVisualizer reduced-motion, A7 Dialog focus mgmt, A8 tooltip trigger label, A9 Select active item, A10 light mode verdict, A11 landmarks/skip-link, A12 LateAlert aria-live variant |
| **Total** | **12** | |

## Points à verrouiller avant build (top 5)

1. **A1** — assombrir `signal.danger` (fill) ou texte noir sur rouge vif : corriger le bouton Panic.
2. **A2** — éclaircir `ink.muted` ~+6 (recalculer) pour passer `surface_2` au-dessus de 4.5:1.
3. **A3** — `ChannelSelector` en `radiogroup` + nav flèches + `aria-checked` + icône check.
4. **A4 + A12** — `aria-live` explicite par composant (`StatusPill`/`LateAlert`/`Alert` danger).
5. **A5** — promouvoir AC-U20 en AC ferme + procédure VoiceOver minimale.

## Notes méthodologiques

- Ratios de contraste estimés à la main via formule luminance relative WCAG 2.1 (sRGB → linéarisation → 0.2126R+0.7152G+0.0722B). À confirmer avec un outil (WAVE, axe-core, Contrast app) au build. Les seuils proches de 4.5:1 (A2 à 4.48, A1 à 3.27) sont robustes quant à la décision (sous le seuil), mais la valeur exacte post-fix doit être re-vérifiée.
- AA interprété MVP : pas de AAA visé, pas de 2.1.1 Keyboard beyond native shadcn (déjà OK), pas de 2.2 Timing (pas de timeout UI MVP), pas de 3.2.3 Consistent Navigation (3 surfaces, 1 nav), pas de 4.1.3 Status Messages (couvert par aria-live A4).
- Cible Chrome/Edge desktop uniquement — pas de review mobile/touch.
- La revue ne couvre que DESIGN.md + EXPERIENCE.md. Les implémentations (composants réels) sont hors scope ; les fixes suggérés visent à verrouiller la spec pour qu'un build shadcn droit-sortie respecte AA.