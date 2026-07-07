# FM Live Wire — Déploiement MVP (Story 6.8)

- **Date :** 2026-07-07
- **Story :** 6.8 — Déploiement MVP HTTPS mono-domaine + env prod + graceful shutdown verify + `/health` prod
- **Statut :** `READY_FOR_ZUB_DEPLOY_SIGNOFF` — configuration de déploiement prête ; exécution production en attente de sign-off Zub (aucun environnement prod réel n'a été manipulé ; aucune validation HTTPS prod prétendue exécutée).

> **Honnêteté de scope (consigne Story 6.8) :** ce document décrit la configuration de déploiement et les commandes à exécuter. Le déploiement réel sur un hôte prod + la terminaison TLS réelle ne sont PAS exécutés ici. Tant que Zub n'a pas exécuté la §12 et signé la §14, le statut reste `READY_FOR_ZUB_DEPLOY_SIGNOFF`. Ne pas marquer `DEPLOYED_AND_VERIFIED` sans exécution réelle.

---

## Sommaire

1. Scope & objectif
2. Prérequis
3. Variables d'environnement (prod)
4. Build
5. Run (démarrage du serveur)
6. Reverse proxy Caddy (HTTPS auto-TLS, same origin)
7. Health check (`GET /health`)
8. Web MIDI secure context (`window.isSecureContext`)
9. Socket.IO prod (transports, same origin, zéro CORS)
10. Graceful shutdown (SIGTERM/SIGINT)
11. Zéro secret (vérification bundle)
12. Checklist `PENDING_ZUB_DEPLOY_SIGNOFF`
13. Rollback minimal
14. Sign-off Zub

---

## 1. Scope & objectif

Déployer le MVP FM Live Wire en **mono-process mono-domaine HTTPS** (ADR-0001, invariant 5) :

- un seul processus Node sert l'app web statique (build Vite) **et** Socket.IO sur la **même origine** (zéro CORS en prod) ;
- la terminaison TLS est assurée par un reverse proxy (Caddy auto-TLS) ou un hôte managé — l'app Node **ne gère pas TLS** elle-même (AD-1) ;
- `OWNER_SECRET` reste **côté serveur uniquement** (AD-10, invariant 10) — jamais dans le bundle Vite, jamais dans une variable `VITE_*` ;
- `/health` expose la forme exacte `{ ok, uptime, ownerActive, listeners }` (aucun secret, aucun owner id, aucune origine) ;
- SIGTERM/SIGINT déclenchent un **graceful shutdown** : drain des clients (chemin `disconnect` existant Story 5.5) + fermeture io + HTTP + exit 0.

**Hors scope 6.8 :** pipeline MIDI performer/listener, schéma shared, composants UI, Panic/ForcePanic/Mock/scheduler/fail-safe — non modifiés.

---

## 2. Prérequis

- **Node.js 22** (pinné dans `.github/workflows/ci.yml` + `engines.node`).
- **pnpm 11.7.0** (pinné via `packageManager`).
- **Navigateur cible :** Chrome ou Edge desktop (invariant 6 — Web MIDI `[SecureContext]`). Safari non supporté (feature-detection côté app).
- **Reverse proxy :** Caddy ≥ 2 (recommandé, auto-TLS) **ou** un hôte managé terminant TLS (Render/Fly/Cleavr…). Le présent document utilise Caddy (`Caddyfile` à la racine).
- **Domaine :** un nom de domaine pointant vers l'hôte (Caddy émet le certificat automatiquement). Le `Caddyfile` utilise le placeholder `fmlw.example.com` — **remplacez-le** par votre domaine réel.
- **Pas de DB / Redis** (invariant 8 — état en mémoire mono-process). Aucune dépendance d'infrastructure supplémentaire.

---

## 3. Variables d'environnement (prod)

Toutes **côté serveur** (jamais préfixées `VITE_` — AD-10). Aucune variable `VITE_OWNER_SECRET`.

| Variable | Requis prod | Défaut | Rôle |
|---|---|---|---|
| `NODE_ENV` | **oui** `production` | — | Active les transports WebSocket-only + l'enforcement `OWNER_SECRET`. |
| `OWNER_SECRET` | **oui** (non vide) | `""` (dev) | Secret d'auth propriétaire, validé `crypto.timingSafeEqual` (AD-10). **Fail-fast** : `startServer` lance si vide en prod (`requireOwnerSecretInProd`). |
| `PUBLIC_ORIGIN` | **oui** | `http://localhost:8787` | Origine publique unique (AD-15). Le gate `allowRequest` rejette toute `Origin` différente (anti-CSWSH). Ex : `https://fmlw.example.com`. |
| `PORT` | non | `8787` | Port d'écoute HTTP du Node. En prod derrière Caddy, généralement `8787` sur `127.0.0.1`. |
| `LOG_MIDI` | non | `0` (false) | `1` = log détaillé des events MIDI (dev uniquement, AD-18). **Laisser `0`/unset en prod.** |
| `MAX_LISTENERS` | non | `100` | Garde-fou nombre max de listeners (FR-22, NFR-3). Optionnel. |

**Variables interdites côté web :** `VITE_OWNER_SECRET`, `VITE_*SECRET`, `VITE_*TOKEN`, `VITE_*KEY` (vérifié par `pnpm verify:no-secrets` sur `apps/web/dist`).

Exemple d'environnement prod (systemd `Environment=` ou fichier `.env` sourceé hors VCS) :

```sh
NODE_ENV=production
OWNER_SECRET=<secret-long-aléatoire-généré-via-openssl-rand-hex-32>
PUBLIC_ORIGIN=https://fmlw.example.com
PORT=8787
LOG_MIDI=0
# MAX_LISTENERS=100   # optionnel
```

---

## 4. Build

Depuis la racine du monorepo :

```sh
pnpm install --frozen-lockfile
pnpm -r build
```

Produit :

- `packages/shared/dist/` — schéma Zod partagé (consommé par web + server) ;
- `apps/web/dist/` — build Vite (SPA statique) servi par Express en prod ;
- `apps/server/dist/` — build TypeScript du serveur (entrypoint `dist/index.js`).

Vérification zéro-secret sur le bundle web (Story 6.7, NFR-9) :

```sh
pnpm verify:no-secrets   # scanne apps/web/dist → 0 OWNER_SECRET, 0 VITE_*SECRET/TOKEN/KEY
```

---

## 5. Run (démarrage du serveur)

Deux formes équivalentes :

```sh
# Via le script du package serveur (recommandé) :
NODE_ENV=production \
OWNER_SECRET=<...> \
PUBLIC_ORIGIN=https://fmlw.example.com \
PORT=8787 \
pnpm --filter @fmlw/server start

# Ou directement sur le build :
NODE_ENV=production \
OWNER_SECRET=<...> \
PUBLIC_ORIGIN=https://fmlw.example.com \
PORT=8787 \
node apps/server/dist/index.js
```

`startServer` (`apps/server/src/app/index.ts`) :
1. résout la config via `resolveEnv(process.env)` ;
2. **fail-fast** : `requireOwnerSecretInProd` si `NODE_ENV=production` et `OWNER_SECRET` vide → throw (le processus crash avant d'écouter) ;
3. `createApp(distDir)` → Express (`/health` d'abord, puis static Vite + SPA fallback) ;
4. `http.createServer(app)` + `createIoServer(server, { publicOrigin, isProd, ownerSecret })` sur la **même origine** ;
5. `server.listen(port)` ;
6. `installShutdownHandlers(server, io, logger)` → SIGTERM/SIGINT (§10).

> En prod, le serveur écoute en **HTTP** sur `127.0.0.1:8787` (ou `PORT`). Caddy termine TLS devant (§6). Ne pas exposer le port Node directement sur Internet.

---

## 6. Reverse proxy Caddy (HTTPS auto-TLS, same origin)

Fichier : `Caddyfile` (racine du dépôt). **Remplacez `fmlw.example.com`** par votre domaine réel.

```caddy
fmlw.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787 {
        header_up Host {host}
    }
}
```

- Caddy émet et renouvelle automatiquement le certificat TLS (Let's Encrypt / ZeroSSL) via le challenge HTTP-01 sur :80.
- **Same origin** : le navigateur voit `https://fmlw.example.com` pour l'app **et** pour le WebSocket Socket.IO (`wss://fmlw.example.com`) → **zéro CORS** côté Express/Socket.IO en prod.
- **WebSocket** : Caddy gère l'upgrade automatiquement via `reverse_proxy` — aucune directive supplémentaire.
- **Aucun secret** dans le `Caddyfile` (AD-10). `OWNER_SECRET` reste dans l'env du process Node uniquement.

Déploiement Caddy :

```sh
sudo caddy start --config Caddyfile      # ou caddy run --config Caddyfile
# après édition du domaine :
sudo caddy reload --config Caddyfile
```

> Alternative : hôte managé (Render/Fly/etc.) terminant TLS + proxy vers le port Node. Les invariants (HTTPS, same origin, WebSocket) s'appliquent identiquement.

---

## 7. Health check (`GET /health`)

Forme **exacte** (AD-20, FR-28) — aucun secret, aucun owner id, aucune origine :

```json
{ "ok": true, "uptime": 1234.56, "ownerActive": true, "listeners": 3 }
```

- `ownerActive` : bool — un performer propriétaire est connecté (`PerformerRegistry.isOwnerActive()`).
- `listeners` : nombre de listeners joints (`RoomService.getListenerCount()`).

Vérification prod :

```sh
curl -s -H 'Accept: application/json' https://fmlw.example.com/health | jq .
```

> `/health` est monté **avant** le fallback SPA dans Express (`apps/server/src/http/routes/health.ts` + `static.ts`), donc il n'est jamais masqué par `index.html`. Caddy le proxie sans auth.

---

## 8. Web MIDI secure context (`window.isSecureContext`)

Web MIDI API est `[SecureContext]` (W3C, invariant 5) — l'app ne peut pas fonctionner sans HTTPS. Vérification prod (console Chrome/Edge sur `https://fmlw.example.com`) :

```js
window.isSecureContext        // doit être true
'function' === typeof navigator.requestMIDIAccess   // true sur Chrome/Edge desktop
```

Si `isSecureContext` est `false`, Caddy ne termine pas TLS correctement (vérifier le certificat + le domaine).

---

## 9. Socket.IO prod (transports, same origin, zéro CORS)

`apps/server/src/socket/index.ts` :

- `resolveTransports(isProd)` → **prod : `["websocket"]`** (pas de fallback polling) ; dev/test : `["polling","websocket"]`.
- `isOriginAllowed(origin, publicOrigin)` — le gate `allowRequest` rejette toute `Origin` ≠ `PUBLIC_ORIGIN` au moment de l'upgrade WebSocket (anti-CSWSH). En prod, `PUBLIC_ORIGIN=https://fmlw.example.com`.
- `cors: { origin: publicOrigin }` — limité à l'unique origine publique. **Aucun wildcard `*` en prod.**

Derrière Caddy (same origin), le `Origin` du navigateur correspond à `PUBLIC_ORIGIN` → handshake accepté. Aucune configuration CORS large n'est réintroduite.

---

## 10. Graceful shutdown (SIGTERM/SIGINT)

`apps/server/src/app/shutdown.ts` + wiring dans `startServer`.

Séquence sur SIGTERM (ou SIGINT) :

1. `io.disconnectSockets(true)` — chaque client reçoit son event `disconnect` → **chemin UI existant Story 5.5** (`OutputLostAlert` / server-down pill). Aucun nouvel event client introduit (pipeline listener inchangé).
2. `io.close()` — ferme le serveur Socket.IO + Engine.IO.
3. `server.close()` — arrête d'accepter de nouvelles connexions HTTP et ferme quand les connexions restantes tombent.
4. Hard timeout `5000 ms` (best-effort) — si le drain n'est pas terminé, `finish(false)` puis `process.exit(0)` (dans le path signal-handler).
5. `process.exit(0)`.

**Tests d'intégration** (`apps/server/src/__tests__/shutdown.test.ts`, 5 tests) : client réel déconnecté + serveur fermé + résultat `{closed:true, timedOut:false}` ; cas sans client ; branche timeout `{closed:false, timedOut:true}` (socket TCP brut maintenu + io fake jamais résolu) ; callback `onClosed` ; `installShutdownHandlers` installe SIGTERM/SIGINT.

**Avec systemd :** `KillSignal=SIGTERM` + `TimeoutStopSec=10` — systemd envoie SIGTERM, le Node draine (≤5 s), puis exit 0. Caddy `reload` ne tue pas le Node.

---

## 11. Zéro secret (vérification bundle)

- `scripts/verify-no-secrets.mjs` (Story 6.7) scanne `apps/web/dist` → échoue si `OWNER_SECRET` ou `VITE_*SECRET|TOKEN|KEY` apparaît dans le bundle.
- En CI (`.github/workflows/ci.yml`), exécuté **après** `pnpm -r build`.
- En prod, rejouer localement avant chaque déploiement :

```sh
pnpm -r build && pnpm verify:no-secrets
```

Greps de contrôle :

```sh
grep -R "OWNER_SECRET" apps/web/dist            # attendu : 0
grep -RE '\bVITE_[A-Z0-9_]*(SECRET|TOKEN|KEY)\b' apps/web/dist   # attendu : 0
```

Aucune variable `VITE_OWNER_SECRET` n'existe dans le codebase.

---

## 12. Checklist `PENDING_ZUB_DEPLOY_SIGNOFF`

> À exécuter par Zub sur l'hôte prod réel. Chaque case → marquer `[x]` + preuve (capture/log/valeur observée) dans le bloc §14. Ne pas cocher sans exécution.

- [ ] **12.1 Build local vert** : `pnpm install --frozen-lockfile && pnpm -r build && pnpm verify:no-secrets` → 0 finding.
- [ ] **12.2 Tests + coverage + lint + boundaries verts** : `pnpm test && pnpm test:coverage && pnpm lint && pnpm -r build && pnpm --filter @fmlw/web build && node scripts/verify-boundaries.mjs && pnpm verify:no-secrets`.
- [ ] **12.3 Domaine + DNS** : `fmlw.example.com` remplacé par le domaine réel dans `Caddyfile` ; DNS pointe vers l'hôte ; Caddy émet le certificat (`caddy start --config Caddyfile`).
- [ ] **12.4 Env prod** : `NODE_ENV=production`, `OWNER_SECRET` non vide (généré `openssl rand -hex 32`), `PUBLIC_ORIGIN=https://<domaine>`, `PORT=8787`, `LOG_MIDI=0`. Aucune variable `VITE_*SECRET/TOKEN/KEY`.
- [ ] **12.5 Démarrage** : `node apps/server/dist/index.js` (ou `pnpm --filter @fmlw/server start`) → log `listening` + aucune throw `requireOwnerSecretInProd`.
- [ ] **12.6 /health prod** : `curl -s https://<domaine>/health` → `{ ok:true, uptime, ownerActive:<bool>, listeners:<n> }` (aucun secret/owner id/origine).
- [ ] **12.7 Secure context** : console Chrome/Edge sur `https://<domaine>` → `window.isSecureContext===true` + `navigator.requestMIDIAccess` disponible.
- [ ] **12.8 Same origin + WebSocket** : performer + listener se connectent en `wss://<domaine>` ; aucune erreur CORS ; le gate `allowRequest` accepte l'origine publique (et la rejette si modifiée).
- [ ] **12.9 Transports prod** : le handshake Socket.IO utilise `websocket` uniquement (pas de polling) — vérifiable dans l'onglet Network.
- [ ] **12.10 Flux MIDI end-to-end** : performer → server → listener (reprendre `docs/manual-test-plan.md` Story 6.6 pour les 11 étapes matériel IAC/Dexed/MIDI Monitor si applicable).
- [ ] **12.11 Graceful shutdown** : `kill -TERM <pid>` (ou `systemctl restart`) → clients reçoivent `disconnect` (UI server-down 5.5) → process exit 0 en ≤5 s ; aucun zombie.
- [ ] **12.12 Zéro secret post-build prod** : `grep -R "OWNER_SECRET" apps/web/dist` → 0 ; `grep -RE '\bVITE_[A-Z0-9_]*(SECRET|TOKEN|KEY)\b' apps/web/dist` → 0.
- [ ] **12.13 Rollback testé** (§13) : redémarrage de la version précédente possible sans DB (état in-memory perdu = listeners doivent rejoindre).

---

## 13. Rollback minimal

Aucune DB / Redis (invariant 8) — l'état (owner slot, listeners, relay) est en mémoire et **perdu à l'arrêt**. Le rollback est donc trivial :

1. Arrêter le process Node (`kill -TERM <pid>` / `systemctl stop fmlw`) → graceful shutdown (§10), clients déconnectés.
2. Optionnellement restaurer le build précédent (`apps/web/dist` + `apps/server/dist` + `packages/shared/dist` d'une version antérieure).
3. Redémarrer : `node apps/server/dist/index.js` (env prod inchangé).
4. Le performer doit se reconnecter (le slot owner est libéré) ; les listeners doivent rejoin (`room:join`).

> Pas de migration à inverser, pas de persistence à restaurer. Le coût d'un rollback = interruption du flux en cours (assumé MVP).

---

## 14. Sign-off Zub

> Bloc à compléter par Zub après exécution de la §12. Tant que vide, statut = `READY_FOR_ZUB_DEPLOY_SIGNOFF`.

- **Déploiement exécuté le :** `____ / ____ / ____`
- **Domaine prod :** `________________________`
- **Hôte / reverse proxy :** `________________________`
- **/health prod observé :** `________________________`
- **Secure context vérifié :** ☐
- **Flux MIDI end-to-end vérifié (Story 6.6 si applicable) :** ☐
- **Graceful shutdown vérifié :** ☐
- **Zéro secret post-build vérifié :** ☐
- **Décision :** ☐ `DEPLOYED_AND_VERIFIED` ☐ `READY_FOR_ZUB_DEPLOY_SIGNOFF` (toujours en attente)
- **Notes :** `________________________`

---

## Références

- ADR-0001 : monolithe modulaire mono-process, mono-domaine HTTPS.
- AD-1, AD-10, AD-13, AD-15, AD-18, AD-20 : décisions architecture (invariants 5, 8, 10).
- `docs/release-invariants-audit.md` : 10 invariants NFR-20 (HTTPS = invariant 5, déploiement prod = cette story).
- `docs/manual-test-plan.md` : plan de test manuel IAC → Dexed → MIDI Monitor (Story 6.6).
- `apps/server/src/app/shutdown.ts`, `apps/server/src/app/index.ts`, `apps/server/src/config/env.ts`, `apps/server/src/socket/index.ts`, `apps/server/src/http/routes/health.ts`, `Caddyfile`.