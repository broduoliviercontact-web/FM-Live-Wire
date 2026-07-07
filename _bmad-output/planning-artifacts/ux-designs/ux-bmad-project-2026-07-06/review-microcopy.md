# Review UX — lens Microcopy / Clarté utilisateur

**Cible** : `EXPERIENCE.md` (sections Voice and Tone, Wireframes, États d'erreur, Parcours, États vides, Component Patterns, State Patterns).
**Date** : 2026-07-06.
**Scope** : MVP-grade. Clarté + cohérence + français correct. Pas de revue visuelle (DESIGN.md hors scope).

---

## Verdict

**ACCEPTÉ AVEC RÉSERVES.** La microcopy est globalement sobre, actionnable et fidèle au ton DIY/hacker annoncé. Le modèle mental « MIDI pas son » est bien posé en intro panel + landing tagline. Les codes techniques (`performer:busy`, `forbidden`, `rate:limited`, `unsupported-version`) sont correctement traduits pour l'utilisateur. Aucune microcopy ne promet un replay ou un rattrapage — invariant respecté.

Trois points bloquent un ACCEPTÉ franc :
1. **Contradiction tutoiement déclaré vs vouvoiement pratiqué** (partout).
2. **Reformatage du label verbatim `Rejoindre` en `Rejoindre le flux`** + erreur factuelle sur la source PRD.
3. **Pluralisation française non gérée** (`{n} events reçus` quand n=1).

---

## Points forts

- **Clarté du modèle mental** : landing tagline « Le son naît chez vous, sur votre synthé. » + intro listener « Votre synthé FM génère le son. » + rappel permanent performer « Seul le MIDI est diffusé, jamais l'audio. » — triple redondance bien dosée, néophyte servi.
- **Ton DIY sobre** : pas de marketing, pas de superlatifs, phrases courtes. « Radio live de contrôle MIDI » est le seul clin d'œil poétique, acceptable.
- **Pas de promesse de replay** : lignes 54 et 157 explicites, aucune microcopy ne trahit l'invariant.
- **Codes traduits** : E9 (`performer:busy` → « Un performer est déjà connecté… »), E11 (`forbidden` → « Envoi MIDI interdit depuis un listener. »), E12 (`rate:limited` → « Limite de débit atteinte… »), E13 (`unsupported-version` → « Version de protocole incompatible… »). Aucun code brut affiché à l'utilisateur.
- **Canal = remappage forcé** : tooltip (l. 98) + hint (l. 97) + AC-U5 — l'ambiguïté est levée deux fois, c'est suffisant voire redondant.
- **Panic toujours atteignable** : microcopy « Fonctionne même si le serveur est injoignable. » — la promesse de sécurité musicale est claire pour le listener.
- **Labels verbatim PRD** : `admin token`, `Note de test`, `Panic`, `Force Panic`, `Panic étendu : ~1–2 s`, `Performer déconnecté`, `Chrome/Edge requis`, `Mock / Debug` — tous respectés à la lettre.

---

## Problèmes

### P1 — Tutoiement déclaré, vouvoiement pratiqué — **HIGH**

**Localisation** : `EXPERIENCE.md` l. 73 (Voice and Tone) vs l. 90–120, 140, 151, 188, 217–229, 305, 396, 440 (toutes microcopies).

**Description** : La spec pose « Tutoiement. » comme règle de ton. L'intégralité des microcopies utilise le vouvoiement : « Autorisez l'accès MIDI dans **votre** navigateur. », « **Vous** recevez des événements… », « **Saisissez votre** admin token. », « **Rebranchez le** périphérique… », « **Attendez la** fin de **sa** session. ». Aucune forme « tu » n'apparaît. Contradiction totale entre la règle édictée et la pratique.

**Impact** : Incohérence de voix, risque de réécriture tardive si l'on décide d'aligner sur le tu. Le ton DIY/hacker appelle normalement le tu ; le vouvoiement est plus distant que ce que le Voice and Tone promet.

**Suggestion** : Trancher en PM/UX. Deux options :
- **Option A (chirurgicale, recommandée MVP)** : corriger la règle l. 73 en « Vouvoiement sobre, phrases courtes. » — aligne la règle sur la pratique, zéro réécriture de microcopy.
- **Option B (alignement hacker)** : réécrire toutes les microcopies en tu. Exemples : « Autorise l'accès MIDI dans ton navigateur. », « Tu reçois des événements MIDI en direct. Ton synthé FM génère le son. », « Saisis ton admin token. Il n'est pas mémorisé. », « Rebranche le périphérique ou choisis une autre sortie. », « Un performer est déjà connecté. Attends la fin de sa session. ».

Quelle que soit l'option, **rendre la ligne 73 cohérente avec la pratique** avant finalisation.

---

### P2 — `Rejoindre` (verbatim PRD) reformatté en `Rejoindre le flux` + erreur factuelle sur UJ-2 — **HIGH**

**Localisation** : `EXPERIENCE.md` l. 77 (Labels verbatim), l. 56 (principe « pas de reformatage des labels verbatim »), l. 244 (Component Patterns `JoinButton`), l. 335 & 367 (wireframes listener), l. 153 (parcours étape 6).

**Description** :
- L. 77 liste `Rejoindre` comme label verbatim **non modifiable**, puis déclare dans la même ligne « **on standardise sur `Rejoindre le flux`** ». Contradiction interne : soit `Rejoindre` est verbatim et on ne le modifie pas, soit on le modifie et il n'est plus verbatim.
- L. 77 justifie : « le PRD dit « Rejoindre » / UJ-2 dit « Rejouindre » ». **Erreur factuelle** : `prd.md` l. 83 (UJ-2) dit « Rejoindre », pas « Rejouindre ». Le mot « Rejouindre » n'apparaît nulle part dans le PRD ni l'addendum — uniquement dans cette ligne de l'EXPERIENCE.md.
- L'usage effectif est incohérent : wireframes (l. 335, 367) et `JoinButton` (l. 244) et parcours étape 6 (l. 153) affichent `Rejoindre le flux` ; AC-U3 (l. 467) et États vides (l. 201) et State Patterns (l. 272) parlent de `Rejoindre`. Deux labels coexistent.

**Impact** : Violation du principe l. 56 (« pas de reformatage des labels verbatim »). Le label bouton réel diverge entre sections. Un testeur qui vérifie AC-U3 (« le label `Rejoindre` est désactivé ») ne retrouvera pas ce texte à l'écran (« Rejoindre le flux »).

**Suggestion** : Standardiser sur le verbatim PRD `Rejoindre` partout (bouton primaire, wireframes, component, parcours, AC). Retirer « le flux » de toutes les occurrences. Corriger la l. 77 en :
```
- `Rejoindre` — bouton listener (PRD UJ-2 l. 83 : « Rejoindre »). Label verbatim, non modifié.
```
Si l'équipe veut expliciter « le flux » à l'écran, l'ajouter en hint/aria-label, pas dans le label bouton.

---

### P3 — Pluralisation française non gérée (n=1) — **MEDIUM**

**Localisation** : l. 102 (« ● Réception active — {n} events reçus »), l. 113 (« {events} envoyés · {listeners} listeners · {erreurs} erreurs »), l. 156 (parcours), l. 325 (wireframe « 1 284 events »), l. 204 (« 0 event reçu » — correct, singulier), l. 427 (wireframe performer).

**Description** : Les microcopies à compteur interpolent `{n}` sans passer au singulier quand n=1. « 1 events reçus », « 1 envoyés », « 1 listeners », « 1 erreurs » sont grammaticalement faux en français. L. 204 gère correctement le cas 0 (« 0 event reçu »), ce qui montre que le souci est connu mais incohéremment traité.

**Impact** : Faute de français affichée à l'utilisateur dès le premier event. Effet « produit pas fini » sur un MVP qui se veut DIY soigné.

**Suggestion** : Utiliser une pluralisation ICU ou un ternaire par compteur. Formes singulières :
- `Réception active — {n} event reçu` (n=1) / `{n} events reçus` (n>1)
- `{events} envoyé` (n=1) / `{events} envoyés` (n>1)
- `{listeners} listener` (n=1) / `{listeners} listeners` (n>1)
- `{erreurs} erreur` (n=1) / `{erreurs} erreurs` (n>1)

Documentation technique : `Intl.PluralRules('fr-FR')` ou helper `plural(n, sing, plur)`.

---

### P4 — « Reroutés » anglicisme — **LOW**

**Localisation** : l. 97 (« Tous les événements seront reroutés vers ce canal (remappage forcé). »).

**Description** : « Rerouter » est un anglicisme (de *reroute*). « Remappage » (l. 97, 145) l'est aussi mais il est consacré en MIDI/tech et présent dans le PRD. « Reroutés » est plus évitable.

**Suggestion** : « Tous les événements seront **redirigés** vers ce canal (remappage forcé). » — ou, plus explicite : « Tous les événements seront **renvoyés** vers ce canal, quel que soit le canal d'origine. »

---

### P5 — E11 microcopy peu actionnable pour un listener normal — **LOW**

**Localisation** : l. 120 & 227 (E11, `forbidden`).

**Description** : « Envoi MIDI interdit depuis un listener. » décrit l'interdiction mais ne dit pas quoi faire ensuite. Le contexte (rare, debug console, listener read-only sans contrôle d'envoi UI) le justifie en partie, mais la microcopy reste technique. La spec précise (l. 231) que c'est un cas débug plus qu'un parcours utilisateur — accepté comme tel.

**Suggestion** (optionnelle, pour robustesse) : « Envoi MIDI non disponible en écoute. Seules les actions Rejoindre, Note de test et Panic sont autorisées. » — plus pédagogique, reste sobre.

---

### P6 — « Hors antenne » vs « On air » : cohérence acceptable mais asymétrie — **LOW (note)**

**Localisation** : l. 93 (« ● On air » / « ○ Hors antenne »), l. 308 (wireframe).

**Description** : « On air » est un anglicisme consacré en radio, mais l'appairement avec « Hors antenne » (français) crée une asymétrie de registre. Ce n'est pas un bug — c'est un choix de ton assumé — mais à signaler pour validation.

**Suggestion** : Statuer en UX : soit conserver « On air / Hors antenne » (registre radio assumé), soit aligner « En antenne / Hors antenne ». Pas bloquant pour le MVP.

---

## Synthèse sévérité

| Sévérité | Count | Items |
|---|---|---|
| HIGH | 2 | P1 (tutoiement/vouvoiement), P2 (`Rejoindre` verbatim + erreur UJ-2) |
| MEDIUM | 1 | P3 (pluralisation n=1) |
| LOW | 3 | P4 (reroutés), P5 (E11 actionnable), P6 (On air/Hors antenne) |

**Total** : 6 problèmes, dont 2 HIGH à résoudre avant finalisation, 1 MEDIUM à résoudre en implémentation, 3 LOW optionnels.

---

## Les 3 microcopies à retravailler (priorité)

1. **Label bouton listener** (P2) : remplacer `Rejoindre le flux` → `Rejoindre` partout (wireframes l. 335/367, component l. 244, parcours l. 153). Verbatim PRD respecté, AC-U3 alignée.
2. **Intro panel listener** (P1, option B si alignement hacker) : « Vous recevez des événements MIDI en direct. Votre synthé FM génère le son. » → « Tu reçois des événements MIDI en direct. Ton synthé FM génère le son. » — ou statuer en Option A et garder le vous.
3. **Compteurs pluralisés** (P3) : « ● Réception active — {n} events reçus » → singulier géré (`{n} event reçu` quand n=1) ; idem pour `envoyés/listeners/erreurs` côté performer (l. 113, 427).

---

## Notes hors scope mais signalées

- Aucune faute d'orthographe ou d'accord détectée hors P3.
- Tutoiement/vouvoiement (P1) est la seule incohérence de registre ; le reste est cohérent en vouvoiement.
- Les `[ASSUMPTION]` (note de test 60/100/300 ms, canal défaut 1, on air via `/health`) sont balisés et ajustables — pas des problèmes de microcopy.