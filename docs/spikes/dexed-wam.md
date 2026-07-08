# Spike Dexed / Web Audio Module

> Route expérimentale isolée : `/lab/dexed`. Non listée sur le hub d'accueil.
> Code isolé dans `apps/web/src/features/dexed/`. N'impacte pas les flux
> performer / listener existants.

## Objectif

Valider la faisabilité d'une intégration Dexed (synthé FM DX7) côté navigateur
via Web Audio Modules, sans impacter le reste du site et sans committer d'asset
Dexed/WASM tant que la licence GPL-3.0 n'est pas vérifiée.

## Ce qui marche

- **Diagnostic navigateur** (`DexedLabPage.tsx`) : détection pure (sans effet de
  bord) de `AudioContext`, `AudioWorklet` (`AudioWorkletNode`), `WebAssembly`,
  et Web MIDI (`navigator.requestMIDIAccess`). Affiche un statut
  disponible/absent par capacité.
- **Start Audio sur geste utilisateur** : l'`AudioContext` est créé + resumé
  uniquement après le clic « Start Audio » (politique autoplay).
- **Synthèse de fallback audible** : un petit synthé polyphonique
  oscillateur + enveloppe (gain) permet de tester le note on/off SANS aucune
  librairie/WASM. C'est un stand-in du nœud AudioWorklet Dexed.
- **Clavier virtuel** : une octave C4–C5, jouable à la souris/au doigt
  (pointer events, anti stuck-notes) et au clavier de l'ordinateur
  (`a w s e d f t g y h u j k`).
- **Entrée Web MIDI** (`useWebMidiInput.ts`) : `requestMIDIAccess` à la demande
  (après clic), abonnement `onmidimessage`, parsing note on/off, routage vers
  le synthé de fallback. Reconnexion d'état (`onstatechange`).
- **Messages de fallback clairs** :
  - `AudioContext` absent → alerte bloquante, pas de Start.
  - Safari sans Web MIDI → alerte dédiée « MIDI non supporté — utilisez Chrome
    ou Edge » (le clavier virtuel reste disponible).
  - Accès MIDI refusé / erreur → message explicite.
- **Isolation ESLint** : élément `dexed` déclaré dans `eslint.config.js`,
  `app -> dexed` autorisé, `dexed -> [web-shared, lib]`. Aucune dépendance vers
  `performer` / `listener` / `entities`. Pas de régression sur les règles
  existantes (ajout additif).

## Ce qui ne marche pas / pas encore

- **Dexed WAM réellement chargé** : NON. Le repo `asb2m10/dexed` est un plugin
  JUCE desktop (VST3/AU/CLAP/standalone) — il **n'existe pas de build
  officielle WASM/AudioWorklet/Web Audio Module** pour Dexed. Le point
  d'insertion du vrai WAM est marqué dans `DexedHost.tsx`
  (`dexedWamInsertionPoint`), occupé aujourd'hui par le synthé oscillateur.
- **Fidélité DX7** : aucune. Le fallback est un oscillateur basique, pas le
  moteur `msfa` de Dexed. Le spike prouve le câblage (geste → AudioContext →
  note on/off → son + MIDI in), pas le moteur FM.
- **Sortie MIDI / relais Socket.IO** : hors-scope. Ce spike est 100 % client
  et local ; il ne touche pas au flux performer→listener.

## Navigateurs testés (à compléter à la main)

> Le spike n'a pas encore été testé manuellement (pas de navigateur dans cet
> environnement). À vérifier :

| Navigateur | AudioContext | AudioWorklet | WASM | Web MIDI | Remarque |
|---|---|---|---|---|---|
| Chrome (desktop) | attendu ✓ | ✓ | ✓ | ✓ | cible principale |
| Edge (desktop) | attendu ✓ | ✓ | ✓ | ✓ | cible |
| Firefox | attendu ✓ | ✓ | ✓ | ❌ (Web MIDI désactivé par défaut) | clavier virtuel OK |
| Safari (desktop) | ✓ | ✓ | ✓ | ❌ | alerte « MIDI non supporté » attendue |
| Safari (iOS) | ✓ | partiel | ✓ | ❌ | idem |

Lancer en local : `pnpm --filter web dev` puis ouvrir `http://localhost:5173/lab/dexed`.

## Risques licence GPL-3.0

- `asb2m10/dexed` = **GPL-3.0** ; `msfa` = **Apache-2.0**.
- Committer un build WASM Dexed dans ce dépôt soumettrait le dépôt aux
  obligations GPL-3.0 (divulgation des sources, etc.). **Aucun asset n'est
  committé** tant que la compatibilité n'est pas explicitement validée — voir
  `apps/web/src/features/dexed/NOTICE.md`.
- Un port WAM autonome du moteur `msfa` (Apache-2.0) serait une alternative à
  licence plus permissive, mais c'est un projet à part entière.

## Prochaine étape recommandée

1. **Tester le spike à la main** sur Chrome/Edge : vérifier Start Audio, sons
   du clavier virtuel, entrée MIDI d'un contrôleur USB, et l'alerte Safari.
2. **Décider la voie WAM** :
   - (a) Porter le moteur `msfa` (Apache-2.0) en AudioWorklet WASM — licence
     permissive, effort de portage significatif ; OU
   - (b) Build JUCE → WASM de Dexed — fidélité native, mais **GPL-3.0**
     s'applique au dépôt (décision produit + juridique à valider).
3. Si (a) ou (b) est retenenu, ajouter l'asset WASM + un fichier
   `LICENSE`/`NOTICE` dédié, puis remplacer le fallback oscillateur dans
   `DexedHost.tsx` au point d'insertion marqué.
4. Conserver l'isolation : toute évolution reste dans `features/dexed/` ;
   ne pas câbler vers `performer`/`listener`/`entities`.

## Fichiers

- `apps/web/src/features/dexed/DexedLabPage.tsx` — page + diagnostic + Start Audio
- `apps/web/src/features/dexed/DexedHost.tsx` — hôte audio + synthé fallback + clavier + MIDI
- `apps/web/src/features/dexed/useWebMidiInput.ts` — hook entrée Web MIDI
- `apps/web/src/features/dexed/NOTICE.md` — note licence (aucun asset committé)
- `apps/web/src/app/router.tsx` — route `/lab/dexed` (ajout additif)
- `eslint.config.js` — élément `dexed` + règles d'allow (ajout additif)