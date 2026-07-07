# FM Live Wire — Session Report Template

- **Story :** 6.9 — Checklist MVP + répétition générale avant première session live (S-10 / AC-U21)
- **Date :** 2026-07-07
- **Statut :** `READY_FOR_ZUB_REHEARSAL_SIGNOFF` (template — aucune session n'a été exécutée à ce stade)

> **Règle d'honnêteté :** ce fichier est un **template**. Tous les champs sont **vides** ou `PENDING_ZUB_SIGNOFF`. Aucune date, latence, audience, listener, capture ou verdict n'est pré-rempli. Aucun `GO` n'est pré-rempli. Les deux sections (Dress rehearsal / First audience session) ne sont validées que lorsque Zub exécute réellement la session et signe.
>
> Dupliquer ce template pour chaque session réelle (ex. `docs/rehearsal-report.md` pour la répétition, `docs/audience-session-report.md` pour la première session audience). Ne pas modifier ce template pour y inscrire un compte-rendu — créer une copie datée.

---

## Section 1 — Dress rehearsal

> Répétition générale interne (performer + 1–3 listeners sur leurs synthés), **avant** la première session devant audience réelle. Vise à prouver le bout-en-bout (audio + latence + Panic) sans incident bloquant. Statut initial : `PENDING_ZUB_REHEARSAL_SIGNOFF`.

### 1.1 Contexte de la session

| Champ | Valeur |
|---|---|
| Date | `PENDING_ZUB_SIGNOFF` |
| Lieu | `PENDING_ZUB_SIGNOFF` |
| Version / build | `PENDING_ZUB_SIGNOFF` (ex. `pnpm -r build` du `____/____/____`) |
| Domaine utilisé | `PENDING_ZUB_SIGNOFF` (ex. `https://fmlw.example.com`) |
| Performer | `PENDING_ZUB_SIGNOFF` (Zub) |
| Nombre de listeners | `PENDING_ZUB_SIGNOFF` (1–3) |
| Synthés / listener devices | `PENDING_ZUB_SIGNOFF` (ex. Dexed, Volca FM, DX7) |
| Navigateur (performer + listeners) | `PENDING_ZUB_SIGNOFF` (Chrome/Edge desktop) |
| Réseau | `PENDING_ZUB_SIGNOFF` (LAN / internet) |
| Durée session | `PENDING_ZUB_SIGNOFF` |

### 1.2 Types MIDI testés

| Type | Testé ? | Notes |
|---|---|---|
| noteOn | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| noteOff | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| controlChange | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| programChange | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| pitchBend | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

### 1.3 Mesures observées

| Champ | Valeur |
|---|---|
| Latence observée (ms) | `PENDING_ZUB_SIGNOFF` (cible < ~80 ms LAN / < ~150 ms internet, S-6) |
| `fallbackCount` | `PENDING_ZUB_SIGNOFF` (cible < ~5 %, S-6) |
| `droppedCount` | `PENDING_ZUB_SIGNOFF` |
| Panic testé (serveur down) | ☐ `PENDING_ZUB_SIGNOFF` (S-2) |
| Force Panic testé (si applicable) | ☐ `PENDING_ZUB_SIGNOFF` (2048 noteOff) |

### 1.4 Incidents

| Time | Description | Severity (low/med/high) | Blocking? (yes/no) | Resolution | Follow-up |
|---|---|---|---|---|---|
| `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

> Ajouter une ligne par incident. S'il n'y a aucun incident après exécution réelle, l'indiquer explicitement par « Aucun incident observé pendant la session du ____/____/____ ». Ne **pas** pré-remplir « aucun incident » avant exécution.

### 1.5 Contournements

| Champ | Valeur |
|---|---|
| Contournements appliqués | `PENDING_ZUB_SIGNOFF` |

### 1.6 Verdict & sign-off (Dress rehearsal)

| Champ | Valeur |
|---|---|
| Verdict | `PENDING_ZUB_SIGNOFF` |
| GO / NO-GO | ☐ `GO` ☐ `NO-GO` — `PENDING_ZUB_REHEARSAL_SIGNOFF` (**ne pas préremplir GO**) |
| Signature Zub | `PENDING_ZUB_REHEARSAL_SIGNOFF` (nom + date) |

### 1.7 S-10 evidence (Dress rehearsal)

> La répétition générale ne valide pas S-10 à elle seule (S-10 exige une **audience réelle**), mais doit démontrer la readiness technique. Cocher uniquement après exécution réelle.

- [ ] `PENDING_ZUB_SIGNOFF` — Audio entendu sur les synthés listeners
- [ ] `PENDING_ZUB_SIGNOFF` — Latence acceptable (cible S-6)
- [ ] `PENDING_ZUB_SIGNOFF` — Panic fonctionnel (S-2)
- [ ] `PENDING_ZUB_SIGNOFF` — Aucun incident bloquant pendant la répétition
- [ ] (Audience réelle = N/A pour la rehearsal — voir Section 2)

---

## Section 2 — First audience session

> Première session live devant une **petite audience réelle** (S-10 / AC-U21). Condition de validation finale du format « radio instrumentale FM ». Ne remplir qu'après exécution réelle. Statut initial : `PENDING_ZUB_REHEARSAL_SIGNOFF`.

### 2.1 Contexte de la session

| Champ | Valeur |
|---|---|
| Date | `PENDING_ZUB_SIGNOFF` |
| Lieu | `PENDING_ZUB_SIGNOFF` |
| Version / build | `PENDING_ZUB_SIGNOFF` |
| Domaine utilisé | `PENDING_ZUB_SIGNOFF` |
| Performer | `PENDING_ZUB_SIGNOFF` (Zub) |
| Nombre de listeners | `PENDING_ZUB_SIGNOFF` (1–3) |
| Synthés / listener devices | `PENDING_ZUB_SIGNOFF` |
| Navigateur (performer + listeners) | `PENDING_ZUB_SIGNOFF` (Chrome/Edge desktop) |
| Réseau | `PENDING_ZUB_SIGNOFF` (LAN / internet) |
| Durée session | `PENDING_ZUB_SIGNOFF` |
| Petite audience réelle présente (nombre) | `PENDING_ZUB_SIGNOFF` |

### 2.2 Types MIDI testés

| Type | Testé ? | Notes |
|---|---|---|
| noteOn | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| noteOff | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| controlChange | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| programChange | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| pitchBend | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

### 2.3 Mesures observées

| Champ | Valeur |
|---|---|
| Latence observée (ms) | `PENDING_ZUB_SIGNOFF` (cible < ~80 ms LAN / < ~150 ms internet, S-6) |
| `fallbackCount` | `PENDING_ZUB_SIGNOFF` (cible < ~5 %, S-6) |
| `droppedCount` | `PENDING_ZUB_SIGNOFF` |
| Panic testé (serveur down) | ☐ `PENDING_ZUB_SIGNOFF` (S-2) |
| Force Panic testé (si applicable) | ☐ `PENDING_ZUB_SIGNOFF` (2048 noteOff) |

### 2.4 Incidents

| Time | Description | Severity (low/med/high) | Blocking? (yes/no) | Resolution | Follow-up |
|---|---|---|---|---|---|
| `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

> Ne **pas** pré-remplir « aucun incident » avant exécution réelle.

### 2.5 Contournements

| Champ | Valeur |
|---|---|
| Contournements appliqués | `PENDING_ZUB_SIGNOFF` |

### 2.6 Verdict & sign-off (First audience session)

| Champ | Valeur |
|---|---|
| Verdict | `PENDING_ZUB_SIGNOFF` |
| GO / NO-GO | ☐ `GO` ☐ `NO-GO` — `PENDING_ZUB_REHEARSAL_SIGNOFF` (**ne pas préremplir GO**) |
| Signature Zub | `PENDING_ZUB_REHEARSAL_SIGNOFF` (nom + date) |

### 2.7 S-10 evidence (First audience session)

> S-10 / AC-U21 = session live complète devant petite audience réelle, sans incident bloquant. Cocher uniquement après exécution réelle + signature. **Tant qu'aucune case n'est cochée, S-10 n'est pas validé** et le statut release reste `READY_FOR_ZUB_REHEARSAL_SIGNOFF` (jamais `MVP_LIVE_VALIDATED` / `S10_PASS`).

- [ ] `PENDING_ZUB_SIGNOFF` — Audio entendu sur les synthés listeners
- [ ] `PENDING_ZUB_SIGNOFF` — Latence acceptable (cible S-6)
- [ ] `PENDING_ZUB_SIGNOFF` — Panic fonctionnel (S-2)
- [ ] `PENDING_ZUB_SIGNOFF` — Aucun incident bloquant pendant la session
- [ ] `PENDING_ZUB_SIGNOFF` — Petite audience réelle présente

**S-10 atteint uniquement si les 5 cases ci-dessus sont cochées après exécution réelle + signature Zub.**

---

## Références

- `docs/mvp-launch-checklist.md` (Story 6.9) — checklist pré-session + séquence d'exécution.
- `docs/rehearsal-report.md` (Story 6.9) — instance initialisée pour la répétition générale (pending).
- `docs/manual-test-plan.md` (Story 6.6) — plan test manuel IAC/Dexed/MIDI Monitor (prérequis matériel).
- `docs/deploy.md` (Story 6.8) — déploiement prod (prérequis prod).
- PRD : S-10 (session live complète devant petite audience réelle sans incident bloquant), AC-U21, S-1–S-9 (prérequis), S-6 (latence/fallbacks), S-2 (Panic local).