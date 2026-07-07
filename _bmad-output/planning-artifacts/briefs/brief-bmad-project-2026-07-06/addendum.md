# Addendum — FM Live Wire Product Brief

> Profondeur de référence qui appartient aux documents en aval (PRD, architecture) ou qui a sa place mais ne tient pas dans le brief (1-2 pages). Capturé pendant la rédaction du brief. Source : recherche de landscape/comparables menée le 2026-07-06 (mode headless -A).

## Comparables et landscape MIDI-streaming

Vérifié sur sources web 2025-2026. Aucun produit fabriqué ; les outils ci-dessous sont réels.

| Outil | Ce qu'il fait | Broadcast one-way vers audience ? | Listeners navigateur ? | Listener apporte son synthé ? | Free/OSS ? |
|---|---|---|---|---|---|
| **RTP-MIDI / Apple Network MIDI** (RFC 4695) | Transport MIDI over RTP/TCP ; natif macOS/iOS | Non — point-à-point / mesh petit | Non — natif OS | Oui | Standard ouvert ; gratuit |
| **rtpMIDI** (Tobias Erichsen) | Driver Windows RTP-MIDI ; peers LAN/internet | Non — P2P | Non — driver natif | Oui | Gratuit |
| **Bome Network / Pro** | MIDI réseau vers BomeBox + ordi-à-ordi ; routeur MIDI | Partiel — one-to-many possible, mais pensé LAN/pro | Non — app native | Oui | Payant (Pro IAP) |
| **loopMIDI** (Tobias Erichsen) | Cable virtuel loopback MIDI, Windows only | Non — ports virtuels locaux, pas réseau | Non | Oui | Gratuit |
| **JZZ-midi-WS / JZZ-midi-RTC** (jazz-soft) | MIDI over WebSockets / WebRTC ; ports distants apparaissent comme ports Web MIDI navigateur | Partiel — fan-out serveur possible, mais pensé pont de ports, pas produit broadcast | **Oui** (Web MIDI navigateur) | Oui | OSS (MIT) |
| **fa-m/midi-websocket, 0la0/jWsMidi, vine77/midisocket** | Démos Node/Java : broadcast MIDI over WebSockets vers clients navigateur | Oui (fan-out) | Oui | Oui | OSS |
| **dimamik/live_piano** | WebRTC DataChannel live MIDI P2P ; chaque récepteur synthétise localement avec Tone.js | Non — P2P collaboratif, pas one-performer→audience | Oui | Oui (synth local) | OSS |
| **Phoenixai36/midi2-hub** | Sync multi-producteurs MIDI 2.0 over WebSockets + plugin JUCE | Non — collab multi-producteurs | Non (plugin DAW) | Oui | OSS |
| **TwitchMIDI / TwitchToMIDI / TPTS** | Twitch chat → commandes MIDI pilotant le synthé du streamer ; audience déclenche des notes via chat | Oui (audience→streamer, **direction inversée**) | Oui (chat Twitch) | Non — synthé du streamer, audio streamé en retour | OSS / freemium |
| **Ableton Link** | Sync tempo/beat/phase P2P sur UDP multicast | Non — **sync tempo seulement, pas de broadcast d'événements MIDI** (pas de notes/CC) | Non (apps natives ; quelques ports web) | n/a | Gratuit |
| **TouchOSC / ponts OSC** | Control-surface mobile OSC↔MIDI vers le rig du performer | Non — contrôle point-à-point | Partiel (app client) | Non | Payant |
| **Streams synthé Twitch/YouTube/OBS** | Diffusion audio+vidéo d'une perf synthé live | Oui (broadcast audio/vidéo) | Oui | Non — l'auditeur entend l'audio du performer | Plateformes gratuites |
| **musaic / Strudel radio générative** | "DJ autonome" génératif navigateur ; l'audience peut pousser des intents | Oui (one→many audio navigateur) | Oui | Non — audio rendu côté serveur/navigateur | OSS |

## Le vide occupé par FM Live Wire

Aucun produit vérifié ne combine les quatre propriétés : (1) listeners navigateur sans install native, (2) broadcast one-way d'un performer unique vers une audience, (3) son décentralisé — chaque listener route le MIDI reçu vers son propre synthé local (pas de stream audio), (4) framing centré synthé FM (Dexed/Volca FM/DX7).

- RTP-MIDI / rtpMIDI / Bome Network transportent du MIDI sur réseau mais exigent des apps natives et sont point-à-point / orientés LAN — pas des produits web "tune in to a broadcaster".
- Les démos OSS WebSocket-MIDI (JZZ-midi-WS, fa-m/midi-websocket, jWsMidi) gèrent techniquement le fan-out navigateur mais sont des **librairies/expériences développeur**, pas des produits orientés audience — et aucune ne cible les synthés FM ni le modèle performer→audience.
- Les outils Twitch-chat→MIDI **inversent la direction** (audience→streamer) et streament l'audio en retour.
- **live_piano** est le plus proche en esprit (événements MIDI live, synthèse locale) mais est **collaboratif P2P**, pas broadcast one-way.

Le pari spécifique de FM Live Wire — "tune in, route vers ton propre synthé DX7-class, entends-le localement" — est **inoccupé**.

## Signal marché

Demande réelle mais fragmentée, pas encore consolidée autour de ce cas d'usage exact.

- **Communauté Dexed/Volca FM/DX7 active et importante** : Dexed a **3 300+ étoiles GitHub**, a atteint **v1.0 en nov. 2025** ; Korg Forums + ranzee + The Digital Lifestyle portent les workflows Volca FM/FM2 jusqu'en 2026.
- **Live synth streaming** sur Twitch/YouTube est une niche établie (TwitchMIDI, TPTS ont bâti de vraies audiences).
- **Live-coding / radio générative** (Strudel, TidalCycles, musaic) montre l'appétit pour "regarder/écouter un performer distant piloter une synthèse en temps réel".

**Constat négatif** : aucun produit visible ni discussion active proposant explicitement "streamer du MIDI live vers une audience qui rend le son sur ses propres synthés FM". Les priors les plus proches sont les démos OSS WebSocket-MIDI et live_piano — ce qui indique **faisabilité technique + petite audience hacker**, mais aucun produit commercial ou communautaire n'a agrégé la demande. Le signal : "les communautés d'intérêt existent séparément ; personne ne les a cousues avec un produit broadcaster."

> Note de vérification : chaque outil du tableau provient d'une source web 2025-2026 active. Le "constat négatif" du signal marché reflète la couverture de recherche publique (forte mais non exhaustive) — une mailing list ou Discord de niche pourrait discuter de cela sans apparaître dans les résultats de recherche.

## Sources les plus pertinentes

- https://www.tobias-erichsen.de/software/rtpmidi.html
- https://midi.org/rtp-midi-or-midi-over-networks
- https://www.bome.com/products/bomenet
- https://github.com/jazz-soft/JZZ-midi-WS
- https://github.com/fa-m/midi-websocket
- https://github.com/dimamik/live_piano
- https://github.com/Phoenixai36/midi2-hub
- https://github.com/rafaelpernil2/TwitchMIDI
- https://help.ableton.com/hc/en-us/articles/209776125-Link-features-and-functions-FAQ
- https://github.com/asb2m10/dexed
- https://thedigitallifestyle.com/w/2026/02/the-best-way-to-load-dx7-banks-into-the-volca-fm-sysex-dexed/
- https://github.com/ashmitb95/musaic