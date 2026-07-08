# FM Live Wire — MVP Launch Checklist

- **Story :** 6.9 — Checklist MVP + répétition générale avant première session live (S-10 / AC-U21)
- **Date :** 2026-07-07
- **Statut :** `READY_FOR_ZUB_REHEARSAL_SIGNOFF`
- **Auteur :** Dev Agent (livrable documentaire) — exécution terrain par Zub

---

## 0. Honnêteté de scope (à lire avant tout sign-off)

Cette checklist agrège les **preuves existantes** des Stories 6.4 → 6.8 et prépare la **répétition générale + la première session audience** (S-10). **Aucune exécution terrain n'a eu lieu à ce stade.** Plus précisément, à la date ci-dessus :

- **Déploiement prod HTTPS (6.8) : `DEPLOYED_AND_VERIFIED`** — déployé et vérifié en prod Render (`https://fm-live-wire.onrender.com/`) par Zub : HTTPS / `window.isSecureContext === true` OK, performer + listener connectés, MIDI relayé par Internet, websocket-only prod OK, flux utilisable après hotfix latence cross-client, `verify-no-secrets` PASS dans le build. Détails + sign-off dans `docs/deploy.md` §14. (`/health` prod signé + graceful shutdown restent à vérifier lors d'un prochain passage — non bloquants pour 6.8.)
- **Test manuel IAC/Dexed/MIDI Monitor (6.6) : PENDING_ZUB_SIGNOFF** — le plan 11 étapes est livré (`docs/manual-test-plan.md`), mais l'exécution matérielle macOS par Zub n'a **pas** eu lieu (captures, mesures latence, sign-off §11 non produits).
- **Répétition générale (dress rehearsal) : PENDING_ZUB_REHEARSAL_SIGNOFF** — aucune session live de bout en bout n'a été exécutée.
- **Première session audience réelle : PENDING_ZUB_REHEARSAL_SIGNOFF** — aucune session devant petite audience réelle n'a eu lieu.

**Statut interdit tant que exécution réelle absente :** `MVP_LIVE_VALIDATED`, `S10_PASS`, `GO`. La validation finale S-10 **dépend de l'exécution réelle par Zub** (répétition générale + session audience, comptes-rendus signés dans `docs/session-report-template.md`).

> **Convention de statut des items ci-dessous :**
> - `[x]` **AUTO validé (Story X.Y)** = preuve automatisée existante (test/build/grep vert, reproductible en CI) — **à re-jouer pré-session** pour confirmer la non-régression.
> - `[ ]` **PENDING_ZUB_SIGNOFF** = exécution manuelle par Zub (matériel macOS).
> - `[ ]` **PENDING_ZUB_DEPLOY_SIGNOFF** = exécution déploiement prod par Zub.
> - `[ ]` **PENDING_ZUB_REHEARSAL_SIGNOFF** = exécution session live (répétition ou audience) par Zub.
>
> **Aucun item terrain non exécuté n'est marqué PASS.**

---

## 1. Checklist pré-session MVP

### A. Build & tests automatisés (re-jouer pré-session)

| # | Item | Preuve existante | Statut pré-session |
|---|---|---|---|
| A1 | **Build final vert (6.7)** — `pnpm -r build` produit `packages/shared/dist` + `apps/web/dist` + `apps/server/dist` | Story 6.7 : build vert (web 470.73 kB JS / 22.93 kB CSS, server tsc, shared) | `[x] AUTO validé (6.7)` — re-jouer `pnpm -r build` pré-session |
| A2 | **Tests unitaires 100 % + coverage gate (6.4)** — `pnpm test:coverage` EXIT 0, 8 fichiers critiques 100/100/100/100 | Story 6.4 : `vitest.config.ts` `coverage.thresholds.perFile` sur 8 fichiers ; CI gate | `[x] AUTO validé (6.4)` — re-jouer `pnpm test:coverage` pré-session |
| A3 | **Tests intégration Socket.IO in-process (6.5)** — 14 tests (join/relay/forbidden/busy/disconnected/invalid/rate/origin) | Story 6.5 : `apps/server/src/__tests__/integration/socketIntegration.test.ts` | `[x] AUTO validé (6.5)` — inclus dans `pnpm test` |
| A4 | **Zéro secret bundle (6.7 / S-7)** — `OWNER_SECRET` dans `apps/web/dist` = 0, `VITE_*SECRET/TOKEN/KEY` = 0, pas de `VITE_OWNER_SECRET` | Story 6.7 : `scripts/verify-no-secrets.mjs` + CI step ; `OWNER_SECRET` server-only (AD-10) | `[x] AUTO validé (6.7)` — re-jouer `pnpm verify:no-secrets` pré-session |
| A5 | **Boundaries architecture (1.1)** — 16/16 assertions (isolation performer/listener AD-2) | Story 1.1 : `scripts/verify-boundaries.mjs` | `[x] AUTO validé (1.1)` — re-jouer `node scripts/verify-boundaries.mjs` |
| A6 | **Lint vert** — `pnpm lint` exit 0 | Toutes stories : ESLint flat v9 + plugin boundaries | `[x] AUTO validé` — re-jouer `pnpm lint` pré-session |

**Commande pré-session (A1–A6) :**
```sh
pnpm install --frozen-lockfile && \
pnpm test && pnpm test:coverage && pnpm lint && \
pnpm -r build && pnpm --filter @fmlw/web build && \
node scripts/verify-boundaries.mjs && pnpm verify:no-secrets
```
Attendu : 794/794 tests, coverage EXIT 0, lint exit 0, builds ✓, 16/16 boundaries, verify:no-secrets PASS (0/0).

### B. Invariants automatiquement prouvés (re-confirmer en répétition)

| # | Item invariant | Preuve automatisée existante | Statut pré-session | Re-confirmation rehearsal |
|---|---|---|---|---|
| B1 | **Panic local serveur down (S-2)** — CC 64/120/121/123 ×16, fonctionne hors-ligne serveur, bypass scheduler | Story 5.2 (`panic.ts`) + 5.5 (`listenerFailSafe.test.tsx` : Panic 64 local bypass scheduler serveur down) ; ADR-0007 | `[x] AUTO validé (5.2/5.5)` | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| B2 | **2ᵉ performer refusé (S-3)** — `performer:busy`, no ghost slot | Story 6.5 §3 (2ᵉ → `connect_error` `/performer:busy/`, first stays owner, `getOwnerPerformerId()===first.id`) + `registry.test.ts` ; ADR-0002 | `[x] AUTO validé (6.5)` | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| B3 | **Listener read-only (S-4)** — `midi:event` listener → `forbidden`, 3ᵉ → disconnect | Story 6.5 §2 (listener `midi:event` → ack `forbidden` + watcher silence ; 3ᵉ → disconnect) + `eventGate.test.ts` ; ADR-0002 | `[x] AUTO validé (6.5)` | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| B4 | **SysEx rejeté (S-5)** — double défense (filtre performer + schéma serveur) | Story 6.5 §5 (`type:"sysex"` → ack `invalid` + no relay) + `decode.test.ts` (0xF0 → null) + `MidiEventSchema` aucune variante sysex ; ADR-0008 | `[x] AUTO validé (6.5/1.2)` | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| B5 | **Validation stricte Zod partagée (S-9 / invariant 9)** — `.strict()` front+back via `@fmlw/shared` | Story 1.2 (`midi-event.ts`) + 6.5 §5 (unknown field → `invalid`, `v:2` → `unsupported-version`, channel 16 → `invalid`) ; ADR-0005 | `[x] AUTO validé (1.2/6.5)` | (couvert par B4 rehearsal) |

### C. Items terrain — exécution réelle par Zub obligatoire

| # | Item | Prérequis / preuve partielle | Statut |
|---|---|---|---|
| C1 | **Test manuel IAC/Dexed/MIDI Monitor (6.6)** — 11 étapes macOS, captures `docs/captures/01-29`, mesures latence, sign-off §11 | Plan livré `docs/manual-test-plan.md` (30.4 K, 12 sections) — plan **prêt**, exécution **non faite** | `[ ] PENDING_ZUB_SIGNOFF` |
| C2 | **Déploiement prod HTTPS (6.8)** — Caddy auto-TLS sur domaine réel, env prod (`NODE_ENV=production`, `OWNER_SECRET`, `PUBLIC_ORIGIN`), `node apps/server/dist/index.js` | Config livrée `docs/deploy.md` + `Caddyfile` (placeholder `fmlw.example.com` à remplacer) — readiness **validée**, exécution **non faite** | `[ ] PENDING_ZUB_DEPLOY_SIGNOFF` |
| C3 | **`/health` prod OK** — `curl https://<domaine>/health` → `{ok:true,uptime,ownerActive,listeners}` (aucun secret/owner id/origine) | Forme exacte conforme (AD-20, `health.ts`) — prod **non déployé** | `[ ] PENDING_ZUB_DEPLOY_SIGNOFF` |
| C4 | **Web MIDI secure context prod OK** — console Chrome/Edge : `window.isSecureContext===true` + `navigator.requestMIDIAccess` disponible | Invariant 5 par design (W3C `[SecureContext]`) — prod **non vérifiée** | `[ ] PENDING_ZUB_DEPLOY_SIGNOFF` |
| C5 | **Lance/arrêt prod OK** — `startServer` écoute, `requireOwnerSecretInProd` fail-fast si `OWNER_SECRET` vide, graceful shutdown SIGTERM | Story 6.8 : `shutdown.ts` + `requireOwnerSecretInProd` testés (5+3 tests) — prod **non exécuté** | `[ ] PENDING_ZUB_DEPLOY_SIGNOFF` |
| C6 | **Llatence/fallbacks réels (S-6)** — < ~80 ms LAN / < ~150 ms internet, fallbacks < ~5 %, backpressure FR-26 (`MAX_LATE_MS=200`) | Logique backpressure testée (5.4 `scheduler.ts`) — **mesure terrain requise** (répétition) | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| C7 | **Répétition générale (dress rehearsal)** — performer + 1–3 listeners sur leurs synthés, bout en bout, audio + latence + Panic, sans incident bloquant, compte-rendu | Template `docs/session-report-template.md` § Dress rehearsal + `docs/rehearsal-report.md` (pending) — **non exécutée** | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| C8 | **Première session audience réelle (S-10 / AC-U21)** — petite audience réelle, session live complète, sans incident bloquant, compte-rendu | Template `docs/session-report-template.md` § First audience session — **non exécutée** | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |

### D. Sign-off GO/NO-GO

| # | Item | Statut |
|---|---|---|
| D1 | **Review pré-session** — tous les items A + B + C ci-dessus validés | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` |
| D2 | **Décision GO/NO-GO** — Zub après répétition générale + session audience | `[ ] PENDING_ZUB_REHEARSAL_SIGNOFF` — **ne pas préremplir GO** |

---

## 2. Références (prérequis 6.4 → 6.8 + S-10)

| Story / invariant | Rôle pour la release | Artefact |
|---|---|---|
| **6.4** | Tests unitaires 100 % + coverage gate CI (NFR-16 / S-8) | `vitest.config.ts`, `.github/workflows/ci.yml`, 8 fichiers critiques 100/100/100/100 |
| **6.5** | Tests intégration Socket.IO in-process (NFR-17, S-3/S-4/S-5, AD-19) | `apps/server/src/__tests__/integration/socketIntegration.test.ts` (14) + harness |
| **6.6** | Plan test manuel IAC → Dexed → MIDI Monitor (11 étapes macOS) | `docs/manual-test-plan.md` — plan prêt, **sign-off matériel pending** |
| **6.7** | Zéro-secret + ADRs 0001–0008 + 10 invariants NFR-20 + build final | `scripts/verify-no-secrets.mjs`, `docs/adr/ADR-0001..0008.md`, `docs/release-invariants-audit.md` |
| **6.8** | Déploiement MVP HTTPS mono-domaine + env prod + graceful shutdown + `/health` prod | `docs/deploy.md`, `Caddyfile`, `apps/server/src/app/shutdown.ts` — **readiness validée, prod sign-off pending** |
| **S-10 / AC-U21** | Au moins une session live complète devant petite audience réelle, sans incident bloquant | `docs/session-report-template.md` + `docs/rehearsal-report.md` — **non exécutée** |

---

## 3. Séquence d'exécution par Zub

1. **Pré-session (automatisé)** : re-jouer §A (A1–A6). Toutes les cases AUTO doivent rester vertes.
2. **Test manuel matériel (6.6)** : exécuter les 11 étapes de `docs/manual-test-plan.md` sur macOS IAC/Dexed/MIDI Monitor → remplir tableau résultats + mesures latence + captures + signer §11.
3. **Déploiement prod (6.8)** : remplacer `fmlw.example.com` dans `Caddyfile`, configurer env prod, `caddy start`, exécuter `docs/deploy.md` §12 (13 items), signer §14 → statut 6.8 bascule `DEPLOYED_AND_VERIFIED`.
4. **`/health` + secure context prod (C3, C4)** : `curl https://<domaine>/health` + console Chrome/Edge `window.isSecureContext`.
5. **Répétition générale (C7)** : performer + 1–3 listeners sur leurs synthés, bout en bout, mesurer latence/fallbacks, tester Panic, remplir `docs/rehearsal-report.md` (depuis `docs/session-report-template.md` § Dress rehearsal).
6. **Première session audience (C8, S-10)** : petite audience réelle, session live complète, remplir `docs/session-report-template.md` § First audience session.
7. **Sign-off GO/NO-GO (D1, D2)** : Zub décide après 6. Si GO sans incident bloquant → S-10 atteint, statut release → `MVP_LIVE_VALIDATED` (réservé à ce moment, **jamais avant**).

---

## 4. Sign-off Zub (à compléter après exécution réelle)

> Tant que vide, statut = `READY_FOR_ZUB_REHEARSAL_SIGNOFF`. Ne pas cocher GO sans session audience réelle signée.

- **Pré-session automatisée (§A) re-jouée le :** `____ / ____ / ____` → ☐
- **Test manuel 6.6 exécuté le :** `____ / ____ / ____` → ☐
- **Déploiement prod 6.8 exécuté le :** `2026-07-07` (initial) — retest post-hotfix `2026-07-08` → ☑ (statut 6.8 → `DEPLOYED_AND_VERIFIED`, voir `docs/deploy.md` §14)
- **`/health` prod signé :** ☐ (non signé ce cycle)
- **Secure context prod signé :** ☑ (`window.isSecureContext === true` confirmé sur Render)
- **Répétition générale exécutée le :** `____ / ____ / ____` → ☐ (compte-rendu `docs/rehearsal-report.md`)
- **Première session audience réelle exécutée le :** `____ / ____ / ____` → ☐ (compte-rendu `docs/session-report-template.md` § First audience session)
- **Décision finale :** ☐ `MVP_LIVE_VALIDATED` (S-10 atteint) ☐ `NO-GO` ☐ toujours `READY_FOR_ZUB_REHEARSAL_SIGNOFF`
- **Notes :** `________________________`

---

## 5. Références croisées

- `docs/deploy.md` (Story 6.8) — déploiement prod + checklist §12 + sign-off §14.
- `docs/manual-test-plan.md` (Story 6.6) — plan test manuel 11 étapes.
- `docs/session-report-template.md` (Story 6.9) — template compte-rendu rehearsal + audience.
- `docs/rehearsal-report.md` (Story 6.9) — template initialisé de compte-rendu rehearsal (pending).
- `docs/release-invariants-audit.md` (Story 6.7) — 10 invariants NFR-20 + preuves.
- `docs/adr/ADR-0001..0008.md` (Story 6.7) — décisions architecture.
- PRD : S-10 (session live complète devant petite audience réelle sans incident bloquant), AC-U21, S-1–S-9 (prérequis).