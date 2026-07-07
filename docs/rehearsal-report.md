# FM Live Wire — Dress Rehearsal Report

- **Story :** 6.9 — Répétition générale avant première session live (S-10 / AC-U21)
- **Date :** 2026-07-07 (date de création du template — **pas** la date d'une session exécutée)
- **Statut :** `PENDING_ZUB_REHEARSAL_SIGNOFF`
- **Instance de :** `docs/session-report-template.md` § Dress rehearsal

---

## 0. Avertissement d'honnêteté

Ce fichier est un **template initialisé**, **pas un compte-rendu exécuté**. À la date ci-dessus (création), **aucune répétition générale n'a eu lieu**. Aucune date de session, latence, nombre de listeners, audience, capture, verdict ou résultat n'est inventé. Aucune case n'est cochée. Aucun `GO` n'est pré-rempli. Aucune mention « sans incident » n'est inscrite tant que la session n'est pas réellement exécutée.

La **validation finale S-10 dépend de l'exécution réelle par Zub** (répétition générale + session audience). Tant que ce rapport n'est pas rempli et signé après une session réelle, le statut reste `PENDING_ZUB_REHEARSAL_SIGNOFF` (jamais `MVP_LIVE_VALIDATED` / `S10_PASS`).

> Zub : exécute la répétition générale (performer + 1–3 listeners sur leurs synthés, bout en bout), puis remplis ce rapport en remplaçant chaque `PENDING_ZUB_SIGNOFF` par la valeur observée. Ne coche une case qu'après vérification réelle.

---

## 1. Contexte de la session

| Champ | Valeur |
|---|---|
| Date | `PENDING_ZUB_SIGNOFF` |
| Lieu | `PENDING_ZUB_SIGNOFF` |
| Version / build | `PENDING_ZUB_SIGNOFF` |
| Domaine utilisé | `PENDING_ZUB_SIGNOFF` |
| Performer | `PENDING_ZUB_SIGNOFF` (Zub) |
| Nombre de listeners | `PENDING_ZUB_SIGNOFF` (1–3) |
| Synthés / listener devices | `PENDING_ZUB_SIGNOFF` |
| Navigateur | `PENDING_ZUB_SIGNOFF` (Chrome/Edge desktop) |
| Réseau | `PENDING_ZUB_SIGNOFF` (LAN / internet) |
| Durée session | `PENDING_ZUB_SIGNOFF` |

## 2. Types MIDI testés

| Type | Testé ? | Notes |
|---|---|---|
| noteOn | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| noteOff | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| controlChange | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| programChange | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |
| pitchBend | ☐ `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

## 3. Mesures observées

| Champ | Valeur |
|---|---|
| Latence observée (ms) | `PENDING_ZUB_SIGNOFF` (cible < ~80 ms LAN / < ~150 ms internet, S-6) |
| `fallbackCount` | `PENDING_ZUB_SIGNOFF` (cible < ~5 %, S-6) |
| `droppedCount` | `PENDING_ZUB_SIGNOFF` |
| Panic testé (serveur down) | ☐ `PENDING_ZUB_SIGNOFF` (S-2) |
| Force Panic testé (si applicable) | ☐ `PENDING_ZUB_SIGNOFF` |

## 4. Incidents

| Time | Description | Severity | Blocking? | Resolution | Follow-up |
|---|---|---|---|---|---|
| `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` | `PENDING_ZUB_SIGNOFF` |

> Ne pas pré-remplir « aucun incident » avant exécution réelle.

## 5. Contournements

| Champ | Valeur |
|---|---|
| Contournements appliqués | `PENDING_ZUB_SIGNOFF` |

## 6. Verdict & sign-off

| Champ | Valeur |
|---|---|
| Verdict | `PENDING_ZUB_SIGNOFF` |
| GO / NO-GO | ☐ `GO` ☐ `NO-GO` — `PENDING_ZUB_REHEARSAL_SIGNOFF` (**ne pas préremplir GO**) |
| Signature Zub | `PENDING_ZUB_REHEARSAL_SIGNOFF` (nom + date) |

## 7. S-10 evidence (répétition)

- [ ] `PENDING_ZUB_SIGNOFF` — Audio entendu sur les synthés listeners
- [ ] `PENDING_ZUB_SIGNOFF` — Latence acceptable (cible S-6)
- [ ] `PENDING_ZUB_SIGNOFF` — Panic fonctionnel (S-2)
- [ ] `PENDING_ZUB_SIGNOFF` — Aucun incident bloquant pendant la répétition
- [ ] (Audience réelle = N/A pour la rehearsal — S-10 final validé dans `docs/session-report-template.md` § First audience session)

---

## Références

- `docs/session-report-template.md` (Story 6.9) — template source (Dress rehearsal + First audience session).
- `docs/mvp-launch-checklist.md` (Story 6.9) — checklist pré-session + séquence d'exécution.
- `docs/manual-test-plan.md` (Story 6.6) — plan test manuel IAC/Dexed/MIDI Monitor (prérequis matériel).
- `docs/deploy.md` (Story 6.8) — déploiement prod (prérequis prod).
- PRD : S-10 / AC-U21, S-1–S-9, S-6, S-2.