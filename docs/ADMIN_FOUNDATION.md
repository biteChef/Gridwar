# Gridwar — Foundation + Admin Dashboard v1

**Branch:** `feature/foundation-admin-v1`  
**Status:** First working foundation implementation. Designed for local and staging verification; do not expose publicly until the runtime/security acceptance checks below pass.

## What was built

The old minimal admin UI has been replaced by a responsive, dependency-light console at **`/adminPanel/`**. It reads real information from the existing server manager rather than displaying mock figures.

- **Owner login:** separate from player accounts. Requires `GRIDWAR_ADMIN_USERNAME` and a salted PBKDF2-HMAC-SHA256 `GRIDWAR_ADMIN_PASSWORD_HASH` in the server environment. The HTTP API fails closed (503) when not configured.
- **Session security:** random, opaque session tokens whose SHA-256 hashes are stored in Deno KV; HttpOnly, SameSite=Strict cookies scoped to `/api/admin`; 12-hour session expiry; server-side logout/revocation; session invalidation on password-hash rotation. Set `GRIDWAR_SECURE_COOKIES=1` behind HTTPS.
- **Origin checks:** POST/PUT/DELETE admin requests require a matching `Origin` header. No cross-origin credential support.
- **Login throttling:** basic 6-failure/15-minute per-IP guard (single-process only). Rate limits across several server-manager instances require shared storage later.
- **Server management:** authenticated create/edit/delete of *server registrations*, including public/official/recommended flags, control-socket monitoring and WebSocket endpoint validation. **These operations do not create, restart or terminate Deno game processes.**
- **Real dashboard metrics:** number of registered/online/offline/unmonitored/joinable endpoints, plus **tracked players reported by online monitored game servers only**. An unmonitored server's player count shows an em dash rather than an invented zero.
- **Activity log:** most recent 30 owner login/logout and server-registry create/update/delete events, recorded in Deno KV.
- **Security cleanup:** the old development route `/servermanagerToken`, which returned the raw server-manager admin token, is removed. Old admin WebSocket back-end is retained for compatibility with internal tools but the new browser UI does not use it. Treat `WEBSOCKET_AUTH_TOKEN` as a secret and do not expose the legacy control WebSocket publicly.

### Scope not implemented in v1

- Cross-arena accounts and PostgreSQL migration (existing player accounts still use local Deno KV).
- Per-player moderation, bans, staff roles beyond **owner**, and real player lists.
- Real token-wallet, financial balances or money movements.
- Server process orchestration, automatic matchmaking, arena capacity caps, or multi-region deployment.
- Reliable cross-machine audit logging, metrics history and alerting.
- Actual production infrastructure or browser-verified hosting.

These are distinct next milestones. Do not present their UI as working in v1.

## Local setup (Deno 2.4.1)

Clone or switch to this feature branch:

```bash
git clone https://github.com/biteChef/Gridwar.git
cd Gridwar
git switch feature/foundation-admin-v1
deno --version
```

For an existing checkout:

```bash
cd Gridwar
git fetch origin
git switch feature/foundation-admin-v1
git pull --ff-only
```

Create a strong owner password **without placing it in shell history**. In Bash or Zsh:

```bash
read -r -s GRIDWAR_ADMIN_PASSWORD
export GRIDWAR_ADMIN_PASSWORD
deno run --allow-env scripts/createAdminPasswordHash.js
unset GRIDWAR_ADMIN_PASSWORD
```

The command prints `GRIDWAR_ADMIN_PASSWORD_HASH=pbkdf2$...`. Copy the **complete hash**, not the password, into an untracked local `.env` file:

```dotenv
GRIDWAR_ADMIN_USERNAME=owner
GRIDWAR_ADMIN_PASSWORD_HASH=pbkdf2$310000$PASTE_GENERATED_SALT$PASTE_GENERATED_VERIFIER
GRIDWAR_ADMIN_KV_PATH=./gridwar-admin.kv
```

The repository already ignores `.env` and the new KV files. **Never commit credentials, local KV files or session cookies.**

Install dependencies, run checks, then launch the development server:

```bash
deno task install-deps
deno fmt --check
deno task check
deno task test
deno task dev
```

Visit **http://localhost:8080/adminPanel/**. The lower-case old path `/adminpanel/` redirects to the canonical path. Sign in using the configured owner name and the password you chose. Open **http://localhost:8080/client/** in another tab for the existing game.

Because the dashboard reads from the server-manager registry, it may initially show **0 configured game-server endpoints**. This is valid, not an error. Use **Game servers → Add server** to register the local development endpoint:

- Display name: `Local development`
- Endpoint: `ws://localhost:8080/gameserver`
- Monitor control socket: enabled
- Public: enabled **only when you intend it to appear in the public development server listing**

The dashboard refreshes every 10 seconds when visible. Multiple browser windows running the game should then contribute to the monitored player count when the control socket has connected.

## Admin API surface

All routes are same-origin and no-store, with anonymous data access disallowed except login/me.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/admin/me` | Check whether admin is configured and the browser has a valid session |
| POST | `/api/admin/login` | Verify owner password and set HttpOnly session |
| POST | `/api/admin/logout` | Revoke the session |
| GET | `/api/admin/overview` | Real current server summary and per-server statuses |
| GET | `/api/admin/servers` | Registered endpoint details |
| POST | `/api/admin/servers` | Create a validated endpoint registration |
| PUT | `/api/admin/servers/:id` | Update server metadata |
| DELETE | `/api/admin/servers/:id` | Delete server registration |
| GET | `/api/admin/audit` | Most recent 30 admin audit events |

No admin password is stored by the browser or sent to the game server. Admin login is entirely separate from guest/player login.

## Important deployment requirements

1. **Do not deploy `scripts/dev.js` as a production web server.** It is for local development, uses an insecure localhost control token internally, and runs developer utilities.
2. Run the server manager with appropriate Deno KV permissions and the owner environment variables. For an unbundled development-style deployment: `deno run -A --unstable-kv serverManager/main.js`, with your externally defined `WEBSOCKET_AUTH_TOKEN`, port, hostname and `PERSISTENT_STORAGE_PATH`.
3. Expose the website/admin page over HTTPS and proxy `/api/admin/*` to the server manager. The static admin UI should be served from `adminPanel/` at the corresponding `/adminPanel/` URL.
4. Set `GRIDWAR_ADMIN_PUBLIC_ORIGIN` to the public HTTPS origin when the reverse proxy terminates TLS, and `GRIDWAR_SECURE_COOKIES=1`. Restrict the legacy `/servermanager` WebSocket route to an internal control network; do not disclose `WEBSOCKET_AUTH_TOKEN`.
5. Give `GRIDWAR_ADMIN_KV_PATH` an absolute persistent writable path and back it up. Define a staff credential rotation and recovery procedure.
6. Require origin checks, CSRF tests, login-throttle tests, browser-level smoke tests, and production security review before publishing to the internet.

## Acceptance checklist

- [x] Dedicated, hashed admin credentials with fail-closed configuration.
- [x] Authenticated owner session API and logout.
- [x] Server create/update/delete with validation and audit logging.
- [x] Dashboard uses real registered server and monitored player counts.
- [x] Responsive UI: overview, game servers, and activity log.
- [x] No raw management token endpoint served to the development browser.
- [x] Focused Deno test file added to repository.
- [ ] Run `deno fmt --check`, `deno task check` and the full Deno test suite.
- [ ] Verify login, logout, server actions and live counts using a real browser.
- [ ] Perform a separate security review on the legacy admin WebSocket route and deployment configuration.
- [ ] Test persistent data, recovery and reverse-proxy session cookies.

## Next milestone

**Foundation v2: Shared player identity and database.** Design PostgreSQL tables and migrations for players, profiles, match sessions, server instances, gameplay statistics and virtual achievement history, while retaining existing guest play. Then add read-only player insights and moderation roles to the admin dashboard.

The goal of this branch is a **real, secure starting admin console**, not an unverified full production platform.
