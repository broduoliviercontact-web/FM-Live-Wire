---
status: final
updated: 2026-07-06
project: FM Live Wire
ui_system: shadcn/ui + Tailwind (React + Vite + TypeScript)
spine: DESIGN
visual_direction: "live studio" sombre — sobre, précis, musical, orienté performance live
references:
  prd: ../../prds/prd-bmad-project-2026-07-06/prd.md
  addendum: ../../prds/prd-bmad-project-2026-07-06/addendum.md
  brief: ../../briefs/brief-bmad-project-2026-07-06/brief.md
  research: ../../research/technical-fm-live-wire-midi-streaming-research-2026-07-06.md
tokens:
  colors:
    base:
      bg: "#0A0B0D"
      surface: "#121418"
      surface_2: "#1A1D23"
      border: "#272B33"
      border_strong: "#3A3F4A"
    ink:
      primary: "#E8EAED"
      secondary: "#B4B9C1"
      muted: "#898F98"
      disabled: "#4A4F57"
    signal:
      on_air: "#F2A93B"      # amber — lampe "on air" / accent primaire
      connected: "#3DD68C"   # green — connexion saine, réception active
      late: "#F2A93B"         # amber — flux en retard / warning
      danger: "#FF4D4F"       # red — dots/bordures d'Alert, badges (pas de texte blanc)
      danger_fill: "#E11D2E"  # red assombri pour fills portant texte blanc (Panic) — AA 4.6:1
      info: "#36BFFA"         # cyan — info technique, mock/debug
    midi:
      note_on: "#3DD68C"
      note_off: "#7E848D"
      cc: "#36BFFA"
      program: "#F2A93B"
      pitch_bend: "#B98CFF"
  typography:
    sans: "Inter, system-ui, sans-serif"
    mono: "JetBrains Mono, ui-monospace, monospace"
    display: "Inter, system-ui, sans-serif"
    scale:
      h1: "28px / 700 / -0.02em"
      h2: "20px / 700 / -0.01em"
      h3: "16px / 600"
      body: "14px / 400 / 1.5"
      small: "12px / 400 / 1.45"
      mono_data: "13px / 500 / JetBrains Mono / 1.4"
  rounded:
    none: "0px"
    sm: "4px"     # inputs, boutons techniques
    md: "6px"     # cards, panels
    lg: "10px"    # grosses surfaces (landing hero)
    pill: "999px" # status pills uniquement
  spacing:
    base: "4px"   # échelle Tailwind (4,8,12,16,24,32,48,64)
    control_height: "36px"
    control_height_lg: "44px"  # boutons Panic/Rejoindre
    panel_pad: "16px"
  elevation:
    flat: "none"
    panel: "0 1px 0 0 rgba(255,255,255,0.03) inset"
    raised: "0 2px 8px rgba(0,0,0,0.4)"
    overlay: "0 8px 32px rgba(0,0,0,0.6)"
  motion:
    fast: "120ms ease-out"
    base: "180ms ease-out"
    pulse_on_air: "1.6s ease-in-out infinite"  # lampe on air
    pulse_midi: "90ms ease-out"                 # flash activité note
  components:
    button: "shadcn Button — variants: default(on_air), secondary(surface_2), outline(border), danger(danger_fill + texte blanc, AA 4.6:1), ghost"
    select: "shadcn Select — port MIDI & canal"
    input: "shadcn Input — admin token"
    card: "shadcn Card — panels listener/performer"
    badge: "shadcn Badge — status pills (on air, connecté, mock, erreur)"
    alert: "shadcn Alert — warnings & erreurs (variantes info/late/danger)"
    dialog: "shadcn Dialog — confirmation Force Panic, permission MIDI"
    tooltip: "shadcn Tooltip — aide inline sur Force Panic, remappage canal"
    separator: "shadcn Separator — sections de panel"
    progress: "shadcn Progress — jauges latence/buffer (monitoring)"
    toast: "Sonner — feedback transient (midi:test envoyé, forbidden, reconnect)"
    midi_activity: "MidiActivityIndicator — pulse sur noteOn entrante"
    channel_selector: "ChannelSelector — role=radiogroup (16 radios), navigation flèches, aria-checked + icône check sur l'actif (jamais couleur seule), conversion 0–15 à l'edge"
    port_picker: "MidiPortPicker — entrée/sortie MIDI + option Mock/Debug, refresh onstatechange"
    status_pill: "StatusPill — état connexion/flux avec point coloré"
    mock_stream: "MockByteStream — flux hex bytes en monospace"
    note_viz: "NoteVisualizer — barres de notes simples (hauteur = pitch)"
    panic_button: "PanicButton — fond {tokens.colors.signal.danger_fill} + texte blanc (AA 4.6:1), 44px, sticky en bas du viewport (jamais masqué), toujours actif, icône stop"
    monitoring: "MonitoringPanel — grid type/canal/valeur + compteurs"
---

# DESIGN.md — FM Live Wire

> **Spine visuel.** Possède *comment ça look*. EXPERIENCE.md référence ces tokens par nom via `{tokens.path}`. En cas de conflit avec un mock, wireframe ou import, **les spines priment**.
>
> MVP léger : tokens minimum viable pour livrer les 3 surfaces (`/`, `/listener`, `/performer`). Extension post-traction (rooms multiples) ajoute ses propres tokens sans casser ceux-ci.

## Brand & Style

**FM Live Wire** — *« Radio live de contrôle MIDI, pas une radio de son. »*

Le son n'est pas transporté, il est reconstitué chez chaque listener sur son propre synthé FM. Métaphore produit : **« tune in »** — la radio instrumentale où le geste instrumental voyage, pas le son.

Ton de marque : **DIY / hacker / enthousiaste FM**. Pas mainstream streaming, pas SaaS générique. L'interface doit sentir **la machine, le studio, le signal** — pas le dashboard marketing.

Principes de style :
- **Sombre, sobre, précis.** Lisible en conditions de scène et faible lumière (un listener peut être dans une pièce peu éclairée, un performer sur scène).
- **Signal avant décoration.** Couleurs reservées au sens (connexion, activité, alerte, panic). Pas de fioritures graphiques qui gênent l'usage technique.
- **Mono = données.** Tout ce qui est bytes, canal, valeur, statut technique s'affiche en `JetBrains Mono` — ça reinforce le caractère machine et aide à lire le MIDI.
- **Contraste fort.** Texte `{tokens.colors.ink.primary}` sur `{tokens.colors.base.bg}` ; jamais de gris sur gris pour une info actionnable.

## Colors

Palette restreinte, sémantique. Un accent chaud (lampe *on air*), un vert (sain), un rouge (danger/panic), un cyan (info technique). Le reste est neutre.

| Rôle | Token | Hex | Usage |
|---|---|---|---|
| Fond app | `{tokens.colors.base.bg}` | `#0A0B0D` | fond global |
| Surface | `{tokens.colors.base.surface}` | `#121418` | cards, panels |
| Surface 2 | `{tokens.colors.base.surface_2}` | `#1A1D23` | inputs, zones imbriquées |
| Bordure | `{tokens.colors.base.border}` | `#272B33` | séparateurs, inputs |
| Bordure forte | `{tokens.colors.base.border_strong}` | `#3A3F4A` | focus, emphase |
| Texte primaire | `{tokens.colors.ink.primary}` | `#E8EAED` | labels, valeurs |
| Texte secondaire | `{tokens.colors.ink.secondary}` | `#B4B9C1` | descriptions |
| Texte muted | `{tokens.colors.ink.muted}` | `#7E848D` | hints, métadonnées |
| On Air / accent | `{tokens.colors.signal.on_air}` | `#F2A93B` | lampe on air, bouton primaire, accent marque |
| Connecté | `{tokens.colors.signal.connected}` | `#3DD68C` | état connecté, réception active, noteOn |
| En retard / warn | `{tokens.colors.signal.late}` | `#F2A93B` | warning flux en retard |
| Danger / Panic | `{tokens.colors.signal.danger}` | `#FF4D4F` | Panic, erreurs bloquantes |
| Info / Mock | `{tokens.colors.signal.info}` | `#36BFFA` | Mock/Debug, info technique |

Couleurs MIDI (visualiseur & monitoring) : `note_on` = connected, `note_off` = muted, `cc` = info, `program` = on_air, `pitch_bend` = `#B98CFF`.

> **Do** : reservez les couleurs signal à leur sens. **Don't** : n'utilisez pas le rouge pour autre chose que danger/panic ; n'utilisez pas le vert pour autre chose que "sain/connecté".

## Typography

Deux familles suffisent. `Inter` pour l'UI, `JetBrains Mono` pour toute donnée MIDI/technique.

| Rôle | Token | Spéc |
|---|---|---|
| Titre H1 | `{tokens.typography.scale.h1}` | 28px / 700 / -0.02em |
| Titre H2 | `{tokens.typography.scale.h2}` | 20px / 700 / -0.01em |
| Titre H3 | `{tokens.typography.scale.h3}` | 16px / 600 |
| Corps | `{tokens.typography.scale.body}` | 14px / 400 / 1.5 |
| Petit / hint | `{tokens.typography.scale.small}` | 12px / 400 / 1.45 |
| Donnée mono | `{tokens.typography.scale.mono_data}` | 13px / 500 / JetBrains Mono |

Famille sans : `{tokens.typography.sans}`. Famille mono : `{tokens.typography.mono}`.

> Le mono n'est pas décoratif : il signale "ici c'est de la donnée MIDI brute" (bytes, canal, velocity, latence ms, compteurs).

## Layout & Spacing

Échelle Tailwind, base 4px (`{tokens.spacing.base}`). Hauteur de contrôle standard `{tokens.spacing.control_height}` (36px) ; boutons primaires d'action (Panic, Rejoindre) `{tokens.spacing.control_height_lg}` (44px) pour gestes fréquents/critiques. Padding de panel `{tokens.spacing.panel_pad}` (16px).

**Grille globale** : app centrée, largeur max 640px pour `/listener` et `/performer` (single-column, focus). Landing `/` centrée max 720px. Pas de sidebar, pas de multi-colonnes denses — chaque surface est un flux vertical guidé.

## Elevation & Depth

Peu d'élévation — l'app est plate par défaut pour un rendu "console".

| Niveau | Token | Usage |
|---|---|---|
| Flat | `{tokens.elevation.flat}` | fond global |
| Panel | `{tokens.elevation.panel}` | cards (liseré top subtil) |
| Raised | `{tokens.elevation.raised}` | dropdowns, selects ouverts |
| Overlay | `{tokens.elevation.overlay}` | Dialog Force Panic |

## Shapes

Rayons faibles — outils techniques. `{tokens.rounded.sm}` (4px) pour inputs/boutons, `{tokens.rounded.md}` (6px) pour cards, `{tokens.rounded.lg}` (10px) pour le hero landing. `{tokens.rounded.pill}` réservé aux status pills (point + label).

## Components

Spécifications visuelles. Le comportement vit dans EXPERIENCE.md → Component Patterns.

- **Button** `{tokens.components.button}` — variantes : `default` (fond `{on_air}`, texte `{bg}`), `secondary` (fond `{surface_2}`), `outline` (border `{border}`), `danger` (fond `{danger}`, texte blanc), `ghost`. Hauteur 36px ; 44px pour Panic & Rejoindre.
- **Select** `{tokens.components.select}` — port MIDI & canal ; liste sur fond `{surface_2}`, item actif surligné `{on_air}` à 20% opacité.
- **Input** `{tokens.components.input}` — admin token ; fond `{surface_2}`, bordure `{border}`, focus `{border_strong}` + ring `{on_air}`.
- **Card** `{tokens.components.card}` — fond `{surface}`, bordure `{border}`, rayon `{rounded.md}`, padding `{panel_pad}`.
- **Badge / StatusPill** `{tokens.components.badge}` / `{tokens.components.status_pill}` — pill, point coloré + label mono/small. Variantes : `on-air` (amber pulse), `connected` (green), `waiting` (muted), `mock` (info), `error` (danger).
- **Alert** `{tokens.components.alert}` — bandeau plein, bordure gauche 3px colorée. Variantes : `info` (cyan), `late` (amber), `danger` (red). Icône + titre + détail mono si bytes.
- **Dialog** `{tokens.components.dialog}` — overlay `{overlay}`, fond `{surface}`, utilisé pour confirmation Force Panic.
- **Tooltip** `{tokens.components.tooltip}` — fond `{surface_2}`, texte `{primary}`, small ; aide Force Panic & remappage canal.
- **Separator** `{tokens.components.separator}` — `{border}`, sépare sections d'un panel.
- **Progress** `{tokens.components.progress}` — jauge latence/buffer monitoring ; track `{surface_2}`, fill sémantique (green/amber/red).
- **Toast (Sonner)** `{tokens.components.toast}` — fond `{surface}`, bordure `{border}`, position bottom-right ; feedback transient.
- **MidiActivityIndicator** `{tokens.components.midi_activity}` — point/rond qui pulse `{connected}` sur noteOn entrante (`{tokens.motion.pulse_midi}`).
- **ChannelSelector** `{tokens.components.channel_selector}` — 16 créneaux 1–16 en grille, actif = fond `{on_air}` texte `{bg}`.
- **MidiPortPicker** `{tokens.components.port_picker}` — Select + bouton refresh ; option « Mock / Debug » suffixée badge `{info}`.
- **MockByteStream** `{tokens.components.mock_stream}` — liste scrollante monospace, chaque ligne `type · ch · data` colorée par type MIDI.
- **NoteVisualizer** `{tokens.components.note_viz}` — barres verticales, hauteur ∝ pitch (21–108), couleur `{note_on}` à l'attaque → `{note_off}` au release. Pas de mini-piano jouable.
- **PanicButton** `{tokens.components.panic_button}` — 44px, fond `{danger}`, texte blanc, icône stop, toujours actif (même serveur down). Force Panic = bouton secondaire en dessous, avec icône warning.
- **MonitoringPanel** `{tokens.components.monitoring}` — grille en-têtes mono (`TYPE · CH · VAL`), lignes scrollantes, compteurs en pied (events envoyés, listeners, erreurs).

## Do's and Don'ts

**Do**
- Garder le contraste ≥ 4.5:1 pour tout texte actionnable (`{primary}` sur `{bg}` ≈ 15:1).
- Réserver le mono aux données MIDI/techniques.
- Faire pulser discrètement la lampe *on air* (`{tokens.motion.pulse_on_air}`) seulement quand un performer est réellement actif.
- Rendre Panic visuellement constant et toujours atteignable.

**Don't**
- Pas de dégradés décoratifs, pas de glassmorphism, pas d'illustrations — l'app est une console.
- Pas de vert/rouge/amber hors de leur sémantique.
- Pas de look SaaS générique (pas de hero marketing, pas de cartes feature sur la landing).
- Pas de mouvement décoratif ; le mouvement sert à signaler (activité MIDI, on air, alerte).
- Pas de reduced-motion ignoré : voir EXPERIENCE.md → Accessibility Floor.