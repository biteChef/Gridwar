# Gridwar — Project Roadmap

_Last reviewed: 2026-11-15. Planning document; items marked proposed are not implemented._

## Vision

Ship a responsive, reliable multiplayer territory-capture game based on the existing Splix engine. Preserve the familiar core rules and controls, improve the landing page and player experience, and scale from one arena to multiple arenas per geographic region without making every player share one giant simulation.

**Architecture direction:** one running game-server instance owns one arena; one hosting machine or geographic region can run multiple such instances. See [Server Scaling & Architecture Notes](./SERVER_SCALING_NOTES.md).

## Current repository baseline (verified on `main`)

- [x] Forked Splix client, WebSocket gameplay server, and server-manager/admin code exist.
- [x] A game-server `Main` creates one `Game`, which creates one `Arena`.
- [x] The gameplay server updates on a 50 ms interval (target 20 ticks/s).
- [x] A server registry and server-selection UI exist, and game-server player counts are reported.
- [x] Original territorial gameplay, leaderboard, minimap, and spectator-mode foundations exist.
- [x] Speed booster, five additional power-up effects, and optional player accounts with guest-first play are present in the current main code; see [GRIDWAR_FEATURES.md](./GRIDWAR_FEATURES.md).
- [ ] **Enforced per-arena player cap:** there is currently no admission check rejecting a new player because an arena is full.
- [ ] **Automatic match assignment:** players still select endpoints/servers; the manager does not place players into available arenas.
- [ ] **Multi-instance lifecycle and autoscaling:** no built-in arena process orchestrator.
- [ ] **Regional pools and distributed account setup:** not implemented in the existing architecture.
- [ ] **Landing-page redesign:** PR [#1](https://github.com/biteChef/Gridwar/pull/1) was closed without merging; do not assume it is in `main`.

Other ongoing work may be on separate branches/PRs. Do not mark it shipped until merged and verified.

## Initial decisions and assumptions

| Topic | Proposed v1 decision | Status |
| --- | --- | --- |
| Arena model | One arena per running game-server process | Current architecture |
| Initial active players per arena | **50** | Proposed starting point, **not benchmarked** |
| Spectators | Count/limit separately; determine a safe cap | To decide in milestone 1 |
| Arena dimensions | Trial **600 × 600 tiles** for default mode | Configurable; measure CPU and memory before locking |
| Tick interval | Keep current **50 ms** initially | Existing |
| Joining | Choose region, then let matchmaking pick a non-full arena | Planned |
| Regions | Start with the best available deployment region; add US/EU/Asia regions based on actual usage | Planned |
| Full arenas | Do not overflow; offer another arena or a clear retry/queue state | Planned |
| Core gameplay | Preserve server-authoritative movement/collisions/territory, including power-ups | Required |

**Capacity example:** 1,000 concurrent active players ÷ 50 players/arena = **20 arena instances**, plus spare capacity. This is not the same as 20 physical machines.

## Milestones

### M0 — Capture the baseline and decisions — **Done for documentation**

- [x] Record how the current code treats an instance, game, arena, and region.
- [x] Record the lack of a player cap and automatic matchmaking.
- [x] Document a proposed capacity target and testing plan.
- [ ] Run an initial real-client performance baseline at 10, 25, and 50 players.

**Exit criteria:** project assumptions and gaps are explicit, with baseline results attached when measurements are available.

### M1 — Safe single-arena capacity limit — **Highest priority**

- [ ] Add configurable `MAX_ACTIVE_PLAYERS_PER_ARENA` (initial default candidate: 50).
- [ ] Decide whether spectators have a separate cap; account for active joins, reconnects, and reservations.
- [ ] Reject or gracefully redirect attempts above capacity **before creating a Player**.
- [ ] Return a structured `arena_full` outcome the client can distinguish from network failure.
- [ ] Report active/available slots (not only a raw total count).
- [ ] Add automated tests for the 50th/51st admission, rapid concurrent joins, disconnects, and spectators.

**Exit criteria:** a full arena cannot be overfilled under simultaneous joins and the user sees a clear message.

### M2 — Multiple arenas on one hosting machine

- [ ] Run two or more isolated Deno game-server processes on different ports/endpoints.
- [ ] Add stable instance IDs, game mode, arena dimensions, active players, cap, status, and heartbeat/health metadata.
- [ ] Register individual instances with the existing server manager.
- [ ] Protect process failures from breaking other arenas; clean up dead/stale instances.
- [ ] Add a simple admin view for arena health and occupancy.

**Exit criteria:** at least three independent arena instances can run at once; one can be restarted without ending the others.

### M3 — Automatic matchmaking and a simpler Play flow

- [ ] Make the landing page offer **Play Now** plus an optional region preference (no raw endpoint selection for ordinary players).
- [ ] Select a healthy arena with enough free slots; reserve a slot atomically during connection.
- [ ] Implement retry/timeout/release for abandoned reservations.
- [ ] Use a short-lived, server-validated join ticket or equivalent to prevent spoofing/overfill.
- [ ] Return a direct secure WebSocket endpoint for the assigned game.
- [ ] Handle full-region and connection-failure states; implement reconnect behavior without duplicate players.
- [ ] Keep advanced/manual server selection available for development or private sessions.

**Exit criteria:** 100 players can enter two independent 50-slot arenas via the same Play flow without manual server choice.

### M4 — Regional deployment and persistent identity

- [ ] Define regional pools (e.g., US East, Europe, Asia **when actually deployed**).
- [ ] Route first by chosen/nearest reasonable region, then by arena capacity.
- [ ] Deploy HTTPS/WSS and health monitoring for each region.
- [ ] Centralize account/session validation and persistent player records; **do not rely on separate local Deno KV account databases per arena instance**.
- [ ] Define global leaderboard consistency vs. per-arena leaderboards.
- [ ] Decide how maintenance, drain, and failover affect in-progress games.

**Exit criteria:** at least two regions accept joins independently, and the same authenticated player identity works across instances.

### M5 — Realistic load testing and optimization

- [ ] Build repeatable WebSocket load scenarios with players moving, changing direction, capturing territory, colliding, and collecting power-ups (not just idle sockets).
- [ ] Test **25 / 50 / 75 / 100 players per arena** on the intended hardware.
- [ ] Measure tick execution time, event-loop delay, CPU, RAM, network egress, WebSocket queue/backpressure, and disconnects.
- [ ] Profile collision/trail checks, leaderboard sorting, minimap broadcasting, radar scans, and per-player viewport updates.
- [ ] Compare player-per-arena limits on both busy and mostly idle maps.
- [ ] Set a measured production cap with headroom and record the hardware/test conditions.

**Exit criteria:** load tests demonstrate stable gameplay and acceptable latency at the chosen cap, with documented safety margin.

### M6 — Operations, scale-out, and release readiness

- [ ] Automate adding/removing arena instances based on sustained occupancy and machine headroom.
- [ ] Keep spare capacity, use cooldowns, and never send new players to draining/failed instances.
- [ ] Add health dashboards, capacity alerts, crash recovery, structured logs, backups, and deployment runbooks.
- [ ] Add monitoring for abuse/rate limiting and account/session availability.
- [ ] Run smoke/regression tests for the existing Splix mechanics and Gridwar power-ups after each server change.
- [ ] Perform a controlled public test with capacity limits before scaling wider.

**Exit criteria:** operators can see capacity and safely expand or drain instances without silently losing all new join requests.

## Prioritized next sprint

1. **M1.1:** Design the admission policy and `arena_full` response; decide spectator accounting.
2. **M1.2:** Implement the configurable 50-player **trial** cap with concurrency tests.
3. **M1.3:** Add a basic player-count/capacity API suitable for a lobby.
4. **M2.1:** Launch two local instances and confirm games are isolated.
5. **M0 follow-up:** Run the first load test and adjust the trial cap if the data requires it.

## Out of scope for this scaling work

- Changing Splix territory-capture or movement rules.
- A single arena shared across multiple physical machines (distributed simulation).
- Cross-arena live combat or transferring active trails between rooms.
- Promising a fixed player count without realistic benchmark results.
- New cosmetic features and landing-page redesign unless they directly support joining.

## Definition of done for the scaling MVP

- [ ] Player admission has a hard, tested limit.
- [ ] Several independent arenas are reachable.
- [ ] Players join a healthy non-full arena automatically.
- [ ] Full or unavailable regions show a recoverable error.
- [ ] Existing game rules and power-ups continue working.
- [ ] Basic server metrics and an operator recovery path exist.
- [ ] Capacity numbers are supported by repeatable load tests.

---

_Keep this document updated as tasks move from planned to implemented; reference PRs and test results rather than treating targets as facts._
