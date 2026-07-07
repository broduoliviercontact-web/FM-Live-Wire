# FM Live Wire — Audit des 10 invariants non-négociables (NFR-20)

- **Date :** 2026-07-07
- **Story :** 6.7 — Validation zéro-secret + ADRs 0001–0008 versionnés + 10 invariants + build final
- **Scope :** MVP FM Live Wire (Epics 1–5 livrés + Epic 6 stories 6.1–6.6)

---

## 0. Source des 10 invariants

Les **10 invariants exacts** sont définis **verbatim** dans le PRD addendum § A.1 « Invariants techniques non-négociables (10) » — fichier source :

`_bmad-output/planning-artifacts/prds/prd-bmad-project-2026-07-06/addendum.md` (lignes 14-27).

> « Gelés par la recherche technique 2026-07-06. Le PRD les respecte tous (NFR-20). »

La liste ci-dessous est **reprise verbatim** depuis A.1 (aucune reconstruction — la liste exacte a été trouvée). Chaque invariant est associé à une **preuve réelle** (fichier, test, grep, ADR) — aucune preuve n'est inventée. Le statut « Respecté » n'est attribué que sur preuve concrète ; l'invariant HTTPS (5) est distingué : respecté par design, déploiement prod en attente (Story 6.8 non exécutée — non prétendu testé en prod).

Référence croisée : `prd.md` ligne 177 (NFR-20), `epics.md` lignes 101/1822-1824, `review-rubric.md` ligne 34 (« Cross-check … vs the 10 invariants (addendum A.1) »).

---

## 1. Tableau des 10 invariants

| # | Invariant (verbatim A.1) | Preuve (code / test / grep / ADR) | Statut |
|---|---|---|---|
| 1 | **One-way broadcast** — flux strict `Performer → Serveur → Listeners` ; aucun chemin retour pour le MIDI. | `apps/server/src/socket/middlewares/roleAuth.ts` (rôle épinglé) + `eventGate.ts` (gate per-event : `midi:event` accepté seulement si `role==="performer"`) ; handlers listener = `room:join`/`room:leave`/`midi:test` uniquement (aucun handler `midi:event` listener). Test : `apps/server/src/__tests__/integration/socketIntegration.test.ts` §2 (S-4 : listener `midi:event` → `forbidden`, 3ᵉ → disconnect, watcher joint observe silence). ADR : `docs/adr/ADR-0002.md`. | Respecté |
| 2 | **Owner unique** — un seul performer ; 2ᵉ refusé `performer:busy`. | `apps/server/src/socket/services/PerformerRegistry.ts` (single-slot `ownerPerformerId`) + `roleAuth.ts` (2ᵉ → `performer:busy`). Test : `socketIntegration.test.ts` §3 (S-3 : 2ᵉ performer → `connect_error` `/performer:busy/`, first stays owner, `registry.getOwnerPerformerId()===first.id` no ghost slot) + `apps/server/src/__tests__/registry.test.ts`. ADR : `docs/adr/ADR-0002.md`. | Respecté |
| 3 | **Pas de SysEx** — double défense (filtre performer + schéma serveur). | Défense 1 (performer) : `apps/web/src/features/performer/lib/decode.ts` (`STATUS_SYSEX_START = 0xf0` → `null`, jamais envoyé). Défense 2 (serveur) : `packages/shared/src/midi-event.ts` (schéma `.strict()`, **aucune** variante `sysex` → rejet Zod automatique). Navigateur : `requestMIDIAccess({ sysex: false })` dans `apps/web/src/app/providers/MidiAccessProvider.tsx`. Test : `socketIntegration.test.ts` §5 (S-5 : `type:"sysex"` → ack `invalid` + `expectNoEvent` prouve no relay) + `apps/web/src/__tests__/decode.test.ts` (SysEx → null). ADR : `docs/adr/ADR-0008.md`. | Respecté |
| 4 | **Panic local** — fonctionne même déconnecté du serveur. | `apps/web/src/features/listener/lib/panic.ts` + `force-panic.ts` dépendent **uniquement** de `MidiSendable` (sortie MIDI locale) — **pas** de Socket.IO, **pas** du scheduler, **pas** du join. Test : `apps/web/src/__tests__/panic.test.ts` + `force-panic.test.ts` + `apps/web/src/__tests__/listenerFailSafe.test.tsx` (Panic 64 local bypass scheduler, serveur down). ADR : `docs/adr/ADR-0007.md`. Critère de succès S-2 (manuel 6.6 étape 6 — `PENDING_ZUB_SIGNOFF` côté exécution matérielle, mais le chemin local est prouvé par tests). | Respecté |
| 5 | **HTTPS obligatoire** — Web MIDI `[SecureContext]`. | Par design : Web MIDI API est `[SecureContext]` (W3C) — l'app ne peut pas fonctionner sans HTTPS. ADR : `docs/adr/ADR-0001.md` (mono-domaine HTTPS, zéro CORS). Config : `apps/server/src/config/env.ts` (`PUBLIC_ORIGIN`, `isProd`). **Déploiement HTTPS prod = Story 6.8 (non exécutée)** — terminaison TLS au reverse proxy (Caddy/managed host), pas dans l'app. Non testé en CI (pas d'env prod). | Respecté par design — déploiement prod pending (Story 6.8) |
| 6 | **Chrome/Edge desktop** — cible MVP ; Safari non supporté (feature detection). | Feature-detection `'requestMIDIAccess' in navigator` **avant** tout prompt, écran terminal `Chrome/Edge requis` si absent. Composants : `apps/web/src/features/performer/components/BrowserCompatGate.tsx` + `apps/web/src/features/listener/components/BrowserCompatGate.tsx`. Test : `apps/web/src/__tests__/browserCompatGate.test.tsx` (7) + `listenerBrowserCompatGate.test.tsx` (7). Landing footer `Chrome/Edge · HTTPS · Web MIDI` (Story 6.1). ADR : `docs/adr/ADR-0003.md`. | Respecté |
| 7 | **Web MIDI API native** — pas de wrapper sauf si le coût de verbosité devient réel. | Aucune dépendance `webmidi.js` (grep `webmidi.js` dans `apps/web/package.json` + `apps/server/package.json` + `package.json` → **0**). Usage direct : `navigator.requestMIDIAccess` (provider), `MIDIInput.onmessage` (capture, `decode.ts`), `MIDIOutput.send(data, ts)` (rendu, `scheduler.ts`). ADR : `docs/adr/ADR-0003.md`. | Respecté |
| 8 | **État en mémoire, mono-process** — pas de DB, pas de Redis ; isolation pour swap futur. | Aucune dépendance `redis`/`ioredis`/`prisma`/`sqlite`/`better-sqlite` (grep dans tous `package.json` → **0**). Services in-memory : `apps/server/src/socket/services/PerformerRegistry.ts`, `RoomService.ts`, `RelayService.ts` (`InMemoryRelayService` = `io.to(room).emit`). Interface d'adapter `RelayService` pour swap futur Redis Streams sans toucher les handlers. ADR : `docs/adr/ADR-0001.md` + `docs/adr/ADR-0006.md`. | Respecté |
| 9 | **Validation stricte** — Zod `.strict()` partagé front+back via `@fmlw/shared`. | `packages/shared/src/midi-event.ts` — `MidiEventSchema` composé de variantes `.strict()` (rejette champs inconnus, hors-plages, `v!==1` `unsupported-version`, pas de `sysex`). Consommé par `apps/web` (encode/decode) ET `apps/server` (ValidationService) via `@fmlw/shared` workspace. Test : `socketIntegration.test.ts` §5 (unknown field → `invalid`, `v:2` → `unsupported-version`, channel 16 → `invalid`, watcher observe silence) + `apps/web/src/__tests__/decode.test.ts` (`MidiEventSchema.safeParse` success sur events produits). Coverage 100 % sur `midi-event.ts` + `encode.ts` + `ValidationService.ts` (Story 6.4). ADR : `docs/adr/ADR-0005.md`. | Respecté |
| 10 | **Secret owner côté serveur uniquement** — jamais dans le build Vite ; `crypto.timingSafeEqual`. | `OWNER_SECRET` présent uniquement côté serveur : `apps/server/src/config/env.ts`, `apps/server/src/socket/middlewares/roleAuth.ts` (`crypto.timingSafeEqual`). **0 occurrence** dans `apps/web/src` (grep) et **0** dans le bundle `apps/web/dist` (`scripts/verify-no-secrets.mjs` + grep contrôle — Story 6.7). **0 variable `VITE_*SECRET/TOKEN/KEY`** dans le bundle. Aucune variable `VITE_OWNER_SECRET`. ADR : `docs/adr/ADR-0002.md`. Addendum A.3. | Respecté |

**Verdict NFR-20 :** 10/10 invariants respectés. L'invariant 5 (HTTPS) est respecté par design (contrainte W3C `[SecureContext]` non contournable) ; sa validation opérationnelle en production est du ressort de Story 6.8 (déploiement — non exécutée à ce stade, non prétendue testée en prod).

---

## 2. Notes complémentaires de release (preuves supplémentaires hors A.1)

Ces points ne font pas partie des 10 invariants NFR-20 (la liste A.1 est la source verbatim), mais sont des **garde-fous de release** demandés par la Story 6.7 et confirmés ici avec preuve réelle :

- **Fail-safe musical (FR-24, pas de replay, queue bornée, stop scheduler sur fail-safe)** : `apps/web/src/features/listener/lib/scheduler.ts` — `stop()` gate tout schedule ultérieur (no-op, no send, no replay) ; `start()` reprend live avec buffer reset 0 (no replay) ; `BUFFER_CAP = 256` (queue bornée, drop oldest). Tests : `apps/web/src/__tests__/listenerSchedulerFailSafe.test.ts` (13) + `listenerFailSafe.test.tsx` (15). Stories 5.4/5.5 validées par Zub. ADR : `docs/adr/ADR-0007.md` (fail-safe musical).
- **`/health` ne fuit pas de secret** : `GET /health` retourne `{ ok, uptime, ownerActive, listeners }` (AD-20) — aucun champ secret. Le `OWNER_SECRET` n'est jamais lu par `/health`. Test : `apps/web/src/features/landing/lib/health.ts` + `health.test.ts` (consomme `/health`, ne manipule aucun secret). Contrat serveur `apps/server/src/app/index.ts` (`/health` handler).
- **Tests critiques + intégration + coverage gate verts (S-8, NFR-16)** : `pnpm test` 786/786 ; `pnpm test:coverage` EXIT 0 (8 fichiers critiques 100/100/100/100) ; `socketIntegration.test.ts` (Story 6.5, 14 tests intégration in-process) verts. CI GitHub Actions (`.github/workflows/ci.yml`) gate le tout.
- **Zéro-secret bundle (S-7, NFR-9)** : `scripts/verify-no-secrets.mjs` (Story 6.7) scanne `apps/web/dist` → 0 `OWNER_SECRET`, 0 `VITE_*SECRET/TOKEN/KEY`. Invoqué en CI après `pnpm -r build`. Preuve contrôle : `grep -R "OWNER_SECRET" apps/web/dist` → 0.

---

## 3. ADRs versionnés (traçabilité architecture)

Les 8 ADRs formalisant les décisions sous-jacentes aux invariants sont versionnés dans `docs/adr/` (Story 6.7) :

| ADR | Titre | Invariant(s) soutenu(s) | AD spine |
|---|---|---|---|
| ADR-0001 | Monolithe modulaire mono-process, mono-domaine HTTPS | 5, 8 | AD-1 |
| ADR-0002 | One-way broadcast, owner unique | 1, 2, 10 | AD-2 |
| ADR-0003 | Web MIDI API native (pas WEBMIDI.js MVP) | 6, 7 | AD-3 |
| ADR-0004 | Socket.IO v4 pour le relay temps réel | 1 (transport) | AD-4 |
| ADR-0005 | Contrat MIDI partagé Zod dans `@fmlw/shared` | 9 | AD-5, AD-9 |
| ADR-0006 | État en mémoire, pas de DB (MVP) | 8 | AD-6 |
| ADR-0007 | Panic local côté listener | 4 | AD-7, AD-17 |
| ADR-0008 | Exclusion SysEx du MVP | 3 | AD-8 |

Tous : `Status: Accepted`, `Date: 2026-07-06`, `Supersedes: none`, `Superseded by: none`, note d'immutabilité (« Accepted ADRs are immutable. Future changes must create a new ADR that supersedes this one. »). Format Nygard léger (Contexte / Décision / Conséquences / Alternatives considérées). Source : `_bmad-output/planning-artifacts/architecture/architecture-bmad-project-2026-07-06/adr/` (8 fichiers).

---

## 4. Conclusion

- **10/10 invariants NFR-20 respectés** (verbatim addendum A.1), chacun sur preuve réelle (fichier/test/grep/ADR).
- **Invariant 5 (HTTPS)** : respecté par design (contrainte `[SecureContext]` Web MIDI) ; validation prod = Story 6.8 (non exécutée — non prétendue testée en prod).
- **8 ADRs** versionnés `docs/adr/`, `Accepted`, immuables, supersede-only.
- **Zéro-secret bundle** prouvé par `scripts/verify-no-secrets.mjs` + grep contrôle (Story 6.7, S-7/NFR-9).
- **Aucune preuve inventée** : chaque pointeur renvoie à un fichier, un test, un grep ou une décision réelle.