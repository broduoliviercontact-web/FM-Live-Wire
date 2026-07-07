# ADR-0003 — Web MIDI API native (pas WEBMIDI.js MVP)

- **Statut :** Accepté
- **Date :** 2026-07-06
- **Supersede :** aucun
- **Liens :** PRD FR-6, FR-7, FR-15, NFR-6..8 ; spine AD-3 ; recherche §Web MIDI natif vs WEBMIDI.js

## Contexte

Le MVP relaye **exactement 5 types** d'événements MIDI channel-voice : `noteOn`, `noteOff`, `controlChange`, `programChange`, `pitchBend`. Côté navigateur, l'API Web MIDI native (W3C, supportée Chrome/Edge desktop, Firefox v108+) couvre 100 % de ce périmètre : `navigator.requestMIDIAccess({ sysex: false })`, `MIDIInput.onmessage` (capture), `MIDIOutput.send(data, timestamp)` (rendu, scheduling driver-level). WEBMIDI.js (v3.1.16, mars 2025) est un wrapper optionnel au-dessus de l'API native apportant du sucre (`playNote()`, listeners typés, `sendPitchBend()`).

Le mapping wire→bytes pour 5 types est trivial (~30 lignes) et reste auditable. Le wrapper apporte surtout de la verbosité réduite pour des apps complexes (NRPN/RPN multi-CC, SysEx) — hors MVP.

## Decision

**Utiliser l'API Web MIDI native, sans WEBMIDI.js pour le MVP.**

- `requestMIDIAccess({ sysex: false })` natif (jamais `sysex: true` — voir ADR-0008).
- Capture performer via `MIDIInput.onmessage` (`event.data`, `event.timeStamp`).
- Rendu listener via `MIDIOutput.send(data, timestamp)` (scheduling driver-level, anti-jitter — voir stratégie timing).
- Feature-detection (`'requestMIDIAccess' in navigator`) **avant** tout prompt ; Safari/non-compatible → écran terminal `Chrome/Edge requis`. Pas de polyfill JZZ MVP.
- Geste utilisateur requis pour `requestMIDIAccess` (au clic, jamais auto au load).

**Reconsidérer WEBMIDI.js si** : NRPN/RPN multi-CC ou SysEx deviennent nécessaires (hors MVP). L'API native reste obligatoire sous le capot de toute façon.

## Conséquences

**Positives :**
- Dépendances minimales ; contrôle total du format wire ; mapping auditable.
- Pas de couche d'abstraction à maintenir pour 5 types channel-voice.
- `MIDIOutput.send(data, ts)` expose directement le scheduling driver-level (anti-jitter).

**Négatives :**
- API native plus verbeuse que le sucre WEBMIDI.js — coût réel faible pour 5 types.
- Safari non supporté (feature-detection + message, pas d'investissement polyfill MVP).

## Alternatives considérées

- **WEBMIDI.js dès le MVP** : rejeté — surcoût de dépendance non justifié pour 5 types channel-voice que l'API native couvre intégralement.
- **Polyfill JZZ pour Safari** : rejeté MVP — cible = Chrome/Edge desktop ; feature-detection + message suffit. À reconsidérer si une audience Safari émerge.