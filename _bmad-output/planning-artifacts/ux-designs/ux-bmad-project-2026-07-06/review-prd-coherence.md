---
status: final
updated: 2026-07-06
reviewer: UX reviewer (lens: cohérence PRD)
target: DESIGN.md + EXPERIENCE.md vs prd.md + addendum.md
verdict: PASS-WITH-FIXES
---

# Revue UX — cohérence avec le PRD

MVP-grade. Focus sur les écarts réels, pas le nitpick. Verdict : **PASS-WITH-FIXES** — les 10 invariants et les FR UX-impactantes sont couverts, les valeurs de timing et la séquence Panic sont correctes, le override « landing / » est explicitement assumé. Reste un problème médian sur le label `Rejoindre` (reformatage justifié par une attribution factuellement fausse) et deux points bas.

## Points forts

- **Les 10 invariants non-négociables sont respectés.** one-way (listeners read-only, seuls `room:join`/`room:leave`/`midi:test`), owner unique (`performer:busy` E9), pas de SysEx MVP (`requestMIDIAccess({sysex:false})` côté listener étape 2 et performer étape 3), Panic local « toujours actif, même serveur down » (EXPERIENCE étape 8, AC-U13, State Patterns 5), HTTPS (E2), Chrome/Edge (E1), Web MIDI native (pas de wrapper), secret owner côté serveur (« pas de localStorage, jamais dans l'URL », NFR-10 reflété). Aucun invariant n'est contourné.
- **Coverage FR UX-impactantes complète.** FR-1 à FR-27 ont toutes un comportement/composant UX : RolePicker (FR-1), AdminTokenInput (FR-2), listener sans token (FR-3), PerformerBusyAlert (FR-4), « Performer déconnecté » (FR-5), MidiPortPicker input (FR-6), monitoring 5 types (FR-7/FR-9), Mock/Debug (FR-12), ChannelSelector + tooltip remappage forcé (FR-13), TestNoteButton (FR-14), PanicButton (FR-16), ForcePanicButton + Dialog (FR-17), gate listener→serveur (FR-18/FR-19 E11), RateLimitAlert (FR-22), fail-safe musical (FR-24 E5), warning local `LateAlert` (FR-25/FR-26/FR-27 E10).
- **Valeurs de timing correctes.** `MAX_LATE_MS=200` et `BUFFER_CAP=256` présents dans EXPERIENCE étape 7 et E10. `LOOKAHEAD_MS=40` est un détail perf non user-facing — son absence de l'UX est acceptable (pas un écart).
- **Séquence Panic correcte.** Panic : `CC 64 → 120 → 121 → 123 × 16 = 64 messages` (EXPERIENCE étape 8, PanicButton). Force Panic : `128 × 16 = 2048 messages` (étape 8, Force Panic dialog body, AC-U14). Ordre CC et compteurs conformes à FR-16 / FR-17 / addendum A.5.
- **5 types d'événement présents.** `noteOn`, `noteOff`, `controlChange`, `programChange`, `pitchBend` cités verbatim dans EXPERIENCE étape 5 performer et Component Patterns `MonitoringPanel`. DESIGN.md définit une couleur MIDI par type (`note_on`, `note_off`, `cc`, `program`, `pitch_bend`).
- **Microcopies verbatim globalement fidèles.** `admin token`, `Note de test`, `Panic`, `Force Panic`, `Panic étendu : ~1–2 s`, `Performer déconnecté`, `Chrome/Edge requis`, `Mock / Debug` utilisés tels quels (EXPERIENCE §Voice and Tone + états d'erreur + wireframes).
- **Override « landing / » explicitement assumé.** EXPERIENCE frontmatter ligne 28 + Notes de finalisation ligne 518 + IA §Information Architecture. Pas d'écart implicite non documenté sur ce point.
- **Marquage `[ASSUMPTION]` discipliné.** On air via `/health`, note de test (60/vel 100/300 ms), canal défaut 1, noms protagonistes — tous balisés et ajustables sans tout revoir.

## Problèmes

### MED-1 — Reformatage `Rejoindre` → `Rejoindre le flux` avec justification factuellement fausse

**Localisation** : EXPERIENCE.md §Voice and Tone ligne 77 (et propagé : `JoinButton` ligne 246, étape 6 ligne 153, wireframes lignes 335/367, AC-U3 ligne 467).

**Écart** : Le PRD (UJ-2 étape 5) donne le label verbatim « Rejoindre ». L'UX le reformate en « Rejoindre le flux » et justifie : *« le PRD dit "Rejoindre" / UJ-2 dit "Rejouindre" ; on standardise sur `Rejoindre le flux` »*. Or **UJ-2 ne dit pas « Rejouindre »** — le PRD dit « Rejoindre » partout (UJ-2 étape 5, FR-13 implicite, Epic 4). L'attribution est fausse, et le reformatage contrevient à la règle « Microcopies verbatim du PRD non modifiables sans accord PM » (EXPERIENCE ligne 520 elle-même).

**Sévérité** : MED. Ce n'est pas un simple cosmetic : le label est cité dans 6 endroits, et la fausse attribution pourrait faire croire que le PRD est incohérent alors qu'il ne l'est pas.

**Fix suggéré** : deux options.
- (A) Revenir à `Rejoindre` verbatim partout (bouton, wireframes, AC-U3). Coherent avec la règle non-reformatage.
- (B) Conserver `Rejoindre le flux` mais le documenter comme **override UX explicite** (au même titre que la landing `/`), sans fausse attribution — *« UX étend le label verbatim `Rejoindre` en `Rejoindre le flux` pour clarifier l'action ; surclassement UX assumé »* — et retirer la mention erronée « UJ-2 dit "Rejouindre" ».

### LOW-1 — Wireframe `/performer` n'affiche que 4 des 5 types MIDI

**Localisation** : EXPERIENCE.md wireframe `/performer` — diffusion active, lignes 421–425.

**Écart** : Le corps du texte (étape 5, Component Patterns `MonitoringPanel`) engage les 5 types `noteOn`/`noteOff`/`controlChange`/`programChange`/`pitchBend`. Le wireframe illustratif liste `noteOn`, `noteOff`, `cc`, `pitchBend` — **`programChange` absent**. C'est illustratif, pas normatif, mais un reviewer ou un dev pourrait le lire comme un oubli.

**Sévérité** : LOW.

**Fix suggéré** : ajouter une ligne `program · 1 · 42` (ou similaire) au wireframe pour montrer les 5 types.

### LOW-2 — FR-8 (SysEx rejeté, double défense) non surface en UX performer

**Localisation** : EXPERIENCE.md §Parcours Performer étapes 3–5 + §Component Patterns.

**Écart** : Le filtre performer `0xF0` jamais envoyé (FR-8, addendum A.6) n'est mentionné nulle part dans l'UX performer. C'est un filtre silencieux — acceptable — mais aucun indice n'indique au performer que le SysEx est ignoré. Un performer branchant un controlleur qui envoie du SysEx pourrait être confus de ne rien voir dans le monitoring.

**Sévérité** : LOW (silently filtered is the right behavior ; c'est plus un point de complétude qu'un défaut utilisateur).

**Fix suggéré** : une ligne dans étape 4 ou Component Patterns `MonitoringPanel` : *« SysEx (`0xF0…`) silencieusement filtré en double défense (filtre performer + schéma serveur) ; jamais affiché ni relayé. »* Pas d'UI surface nécessaire.

## Conflits spine-vs-PRD — assumés vs non-assumés

### Assumés (documentés explicitement)

- **Landing `/`** : ajout UX absent du PRD, documenté comme surclassement (EXPERIENCE frontmatter ligne 28, IA ligne 60, Notes de finalisation ligne 518). ✓
- **`[ASSUMPTION]` balisés** : On air via `GET /health` `owner:bool` (Q-UX5), note de test (middle C 60, vel 100, 300 ms — Q-UX6), canal défaut 1 (Q-UX7), noms protagonistes Maria/Zub, port IAC `FMLW → Dexed`. Tous balisés et ouverts dans §Questions ouvertes. ✓
- **Pas de mode clair MVP** : `[NOTE FOR UX]` (Q-UX8), hérité d'une décision produit. ✓
- **Monitoring performer minimal** : Q-UX2 confirme décision PRD Q-4 (minimal, pas de `srvTs - ts` agrégé listener). ✓
- **Mock/Debug sans mini-piano** : Q-UX3 confirme décision PRD Q-5. ✓

### Non-assumés / partiellement assumés

- **`Rejoindre le flux`** (voir MED-1) : documenté comme « standardisation » mais avec une justification factuellement fausse (« UJ-2 dit "Rejouindre" »). À corriger en override explicite ou retour au verbatim.
- Aucun autre écart implicite non assumé repéré. Les compléments de microcopy (tagline landing, « Je joue (performer) »/« J'écoute (listener) », « ← Changer de rôle », hints d'étapes) sont des additions cohérentes avec le ton PRD, pas des reformulations de labels verbatim.

## Synthèse par sévérité

| Sévérité | Count |
|---|---|
| High | 0 |
| Med | 1 |
| Low | 2 |

## Verdict

**PASS-WITH-FIXES.** Les spines UX sont cohérents avec le PRD sur les points non-négociables (invariants, FR, timing, séquence Panic, types d'événement, microcopies verbatim à l'exception de `Rejoindre`). Le override landing est explicitement assumé. Les 3 fixes sont chirurgicaux et n'affectent ni l'architecture ni les flows.