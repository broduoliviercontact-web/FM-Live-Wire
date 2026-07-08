# Dexed/WAM spike — LICENSE & NOTICE

## État des assets

**Aucun asset Dexed / WASM / Web Audio Module n'est committé dans ce dépôt.**

Le code de ce spike (`apps/web/src/features/dexed/`) est du TypeScript pur
(diagnostic navigateur + synthèse de fallback oscillateur + entrée Web MIDI).
Il ne vendorise aucun binaire, aucun module WASM, aucun code Dexed.

## Licence Dexed (information, pas un asset inclus)

Le projet Dexed source — https://github.com/asb2m10/dexed — est publié sous
**GPL-3.0**. Son moteur de synthèse (`msfa`, issu de
`music-synthesizer-for-android` de Google) est sous **Apache-2.0**.

**Important :**
- Le repo `asb2m10/dexed` est un plugin JUCE **desktop** (VST3 / AU / CLAP /
  standalone). Il **n'existe pas** de build officielle WASM / AudioWorklet /
  Web Audio Module pour Dexed.
- Intégrer le vrai moteur Dexed dans le navigateur exigerait soit (a) un port
  WAM séparé du moteur `msfa`, soit (b) une compilation JUCE → WASM
  (non-triviale). Dans les deux cas, l'inclusion de code Dexed dans ce dépôt
  soumettrait le dépôt aux obligations de la **GPL-3.0** (divulgation des
  sources, etc.).

## Décision

Tant que la compatibilité GPL-3.0 n'est pas explicitement validée, **aucun
asset Dexed/WASM n'est committé**. Le spike reste un diagnostic + fallback
oscillateur. Voir `docs/spikes/dexed-wam.md` pour la prochaine étape
recommandée et l'analyse de risque licence.