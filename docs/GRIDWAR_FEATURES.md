# Gridwar speed booster and accounts

This feature branch comes directly from Gridwar main. It does NOT include the earlier landing-page redesign. The original Splix MIT license is preserved.

## 2x2 territory speed booster

- The server spawns one highlighted golden patch measuring 2x2 grid cells on neutral OR already captured territory. It prefers a fully captured 2x2 region on approximately half of spawns; otherwise it chooses a valid walkable patch.
- To collect: a player capturing new land must claim ALL FOUR tiles; when the patch appears inside territory already owned, its owner must actively MOVE ONTO a tile within the 2x2 patch. It is NOT automatically collected on spawn. An opponent can also capture all four tiles to earn it.
- A successful collection consumes the patch and grants 1.5x movement for 10 seconds.
- The next patch spawns after a 20-second delay. Boosts are not accumulated.
- On death, the player loses their boost.
- Movement, ownership, and collision detection remain server-authoritative. Clients receive WebSocket packet 25 for patch location and packet 26 for player boost state.
- The client draws a gold 2x2 marker and a remaining-duration indicator.

Code: gameServer/src/gameplay/SpeedBoostManager.js, Game.js, Player.js, WebSocketConnection.js, client/src/main.js.


## Five additional power-ups (2x2 capture-based)

These run alongside the existing 10-second Speed Boost, without modifying the
original Splix encirclement and territory-elimination rules.

All five have distinct colored 2x2 map markers. Their initial appearances are
staggered over the first 8 seconds and each collected patch respawns after 35
seconds. The server picks walkable neutral or already-claimed land, prevents
overlaps with other pickups, and never auto-awards on spawn. Claim all four
tiles through a new capture, or, if the area is already yours, move onto the
patch. Spectators and dead players cannot collect pickups. Effects do not stack
with copies of themselves.

| Type | Duration | Effect |
| --- | --- | --- |
| Shield | 8 seconds, one hit | Blocks a single opponent strike on your exposed trail; the trail remains |
| Radar | 15 seconds | Reveals opponent positions and sampled exposed-trail points within 55 tiles on your minimap |
| Ghost Mode | 5 seconds | Ignore collisions with your own exposed trail only; enemies and walls remain dangerous |
| Double Score | 15 seconds | Award one bonus point per additional tile captured while active, doubling that capture's points but not the owned tile count |
| Trail Repair | One use | Automatically blocks one opponent strike to your exposed trail and clears the exposed trail |

Shield has priority over Trail Repair when both are active. A successful
defensive interception provides 1.1 seconds of collision grace so overlapping
enemy positions do not immediately repeat the same strike. Defensive power-ups
do not prevent hitting walls, and Ghost Mode does not ignore enemy trails.

Radar updates are transmitted only to a player while their Radar effect is
active. Score bonuses contribute to the in-game player score and leaderboard.
Persistent account scoring and original global scoreboard integration can be
added later.

WebSocket packet types 27-30 carry pickup locations, player-owned active
effect timers/charges, radar contacts, and the earned score bonus. Original
legacy packet IDs remain unchanged. The original landing page is preserved.

Code: gameServer/src/gameplay/PowerUpState.js,
gameServer/src/gameplay/PowerUpManager.js,
gameServer/src/gameplay/Player.js,
gameServer/src/gameplay/Game.js,
gameServer/src/WebSocketConnection.js,
client/src/main.js.

## Optional accounts with immediate guest play

- The existing Join button still works without logging in. Guest entry is immediate.
- The original landing-page design remains unchanged; only small account controls appear below the existing form.
- Users may register with a username (3–20 ASCII letters, digits, underscores) and a password (12–128 characters), or log in later.
- Passwords are hashed with PBKDF2-HMAC-SHA256 (310,000 iterations) and a random salt.
- Account records and expiring sessions use durable Deno KV, not browser localStorage.
- Session cookies are HttpOnly and SameSite=Strict, plus Secure for HTTPS.
- Login sessions expire after seven days. Server stores hashes of randomized session tokens rather than raw tokens.
- Authenticated players use their verified account username; guests keep the existing nickname workflow.
- Current scope: persistent account identity only. Persisted scores, achievements, email verification, recovery and account upgrade/guest progress migration are future work.
- Registration/login rate limiting is in-memory and per connection IP. For a high-traffic production deployment, add distributed throttling, account recovery and monitoring.

### Same-origin JSON HTTP API

GET /api/account/me — current session or guest.
POST /api/account/register — create account and sign in.
POST /api/account/login — sign in.
POST /api/account/logout — revoke session.

Mutating routes require application/json and matching Origin. The implementation does not enable cross-origin credentials or store passwords in localStorage.

## Running locally

Use Deno 2.4.1:

    deno task dev

Open http://localhost:8080/client/ and choose the development server.

The development task now includes --unstable-kv. The standalone server build task also has KV permission flags:

    deno task build-gameserver --target linux

To test:

    deno task test
    deno task check

The account service uses these optional configuration values:
- GRIDWAR_KV_PATH: persistent writable KV file, default ./gridwar-accounts.kv
- GRIDWAR_PUBLIC_ORIGIN: public HTTPS origin, if behind a reverse proxy
- GRIDWAR_SECURE_COOKIES=1: force Secure cookies behind HTTPS termination
- GRIDWAR_TRUST_PROXY=1: accept X-Real-IP only from a loopback reverse proxy, for per-client throttling

Production deployment must expose the same-origin account API and WS endpoint over HTTPS/WSS and persist/back up the KV database. Avoid exposing the local development admin endpoints publicly.

## Tests and limitations

- tests/speedBoost.test.js covers 2x2 ownership, neutral/captured placement, active re-collection by the existing owner, opposing capture, eligibility and respawn timing.
- tests/accounts.test.js covers guest access, registration, secure cookies, login, duplicate usernames, logout and Origin checks.
- Full multiplayer browser and server integration testing with Deno is still required before merging.
- A future release should support authenticated per-account statistics and account recovery.
