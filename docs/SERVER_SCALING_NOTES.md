# Gridwar — Multiplayer Server Scaling & Architecture Notes

_Last reviewed against `main`: 2026-11-15. This document describes what the repository currently does and the proposed evolution. Nothing in this file changes runtime behavior._

## 1. Vocabulary: the important distinction

- **Region:** geographic deployment location or group (e.g. US East, Europe). One region can include one or more machines and many arena instances.
- **Physical server / VM:** hardware or cloud compute on which multiple game processes may run.
- **Game-server instance:** one running copy of the Deno gameplay server with its own WebSocket endpoint and simulation loop.
- **Arena:** one independent game world: tiles, players, trails, pickups, leaderboards, and collisions.
- **Lobby / matchmaker:** a separate service that finds an instance with room and returns a way to join it.
- **Server manager:** an existing registry/control service that tracks configured game-server endpoints and some metadata; it is **not yet** a capacity-aware matchmaker.

### Current structure

```text
Player browser
  -> existing server selector
    -> one WebSocket endpoint
      -> gameServer/src/Main.js
        -> one ApplicationLoop
        -> one Game (gameServer/src/gameplay/Game.js)
          -> one Arena (gameServer/src/gameplay/Arena.js)
          -> players, trails, territory, pickups
```

**One game-server process currently owns one Game/Arena.** This does *not* mean one geographic region is limited to a single arena.

### Proposed structure

```text
Player -> Play Now -> region selection (automatic or user-selected)
                     |
                  Matchmaker
                     |
             regional arena directory
                     |
       +-------------+--------------+
       |             |              |
    US East        Europe         Asia (future)
       |             |              |
    instance A     instance D     instance G
    instance B     instance E     instance H
    instance C     instance F     ...
       |             |              |
   one arena      one arena      one arena
   per instance   per instance   per instance
```

An example with a **trial** cap of 50 active players per arena:
- 4 instances in one region => up to 200 active player slots, provided the hardware can support all four.
- 20 instances total => up to 1,000 active player slots, before spectators and reserved slots.
- Number of **machines** is a separate capacity decision; 20 instances are not automatically 20 VMs.

## 2. What the repository actually enforces today

| Concern | Current behavior | Code |
| --- | --- | --- |
| Arena construction | `Main` creates exactly one `Game`, which constructs one `Arena` | `gameServer/src/Main.js`, `gameServer/src/gameplay/Game.js` |
| Join | READY message calls `game.createPlayer()` without a capacity check | `gameServer/src/WebSocketConnection.js` |
| Player storage | `Game` stores players in a `Map<number, Player>`; no configured hard max | `gameServer/src/gameplay/Game.js` |
| Simulation update | Main loop scheduled every **50 ms** (~20 ticks/s target) | `gameServer/src/ApplicationLoop.js` |
| Reporting | Player count is sent to server manager; it clamps **reported** count to 0–999 | `serverManager/src/GameServer.js` |
| Server directory | Lists available configured WebSocket endpoints and counts | `serverManager/src/ServerManager.js` |
| Network throttling | Per-IP connection attempts and inbound message-rate checks exist | `gameServer/src/WebSocketManager.js` |
| Efficient updates | Tile changes and player/trail updates can be limited to relevant nearby client viewports | `gameServer/src/gameplay/Game.js` |
| Background updates | Leaderboard every **3,000 ms**, minimap part every **250 ms** | `gameServer/src/config.js`, `gameServer/src/gameplay/Game.js` |
| Player identity | Guest play and account/session support via Deno KV | `docs/GRIDWAR_FEATURES.md`, `gameServer/src/auth/AccountService.js` |

**Important:** The 999 value is a *reporting clamp*, not permission for 999 people to play smoothly. Rate limiting also does **not** substitute for a player cap.

Arena size is configurable. The `Game` constructor defaults to 600×600, but the standalone command-line launcher defaults to 100×100 unless explicitly configured; the actual launched arena depends on its runtime configuration. Do not infer a production capacity from map dimensions alone.

## 3. Why lag grows

Each additional connected player adds some or all of:

1. Player movement, territory ownership and collision/trail processing.
2. Visible nearby-player and tile update fan-out.
3. Network writes and WebSocket buffer/backpressure.
4. Leaderboard/minimap updates and serialization.
5. Power-up scans, including radar processing where applicable.

Interest management already helps: a player does not need to receive every change on the entire map. It does **not** eliminate simulation work or all-to-many updates. Overall cost depends on active behavior, collision density, captured-area shapes, spectator behavior, and machine performance, not just connection count.

Symptoms to monitor: slow tick execution, movement corrections, spikes in input-to-feedback latency, bandwidth saturation, memory growth, slow-client send queues, crashes and disconnects.

## 4. Recommended admission policy (not implemented)

**Candidate default:** `MAX_ACTIVE_PLAYERS_PER_ARENA = 50`. This number is a starting test configuration, not a measured safe limit.

Define whether these consume separate quotas:
- Active players.
- Spectators (who still consume network and update work).
- Pending joins and reconnections.
- Operator/admin diagnostic clients.

Suggested flow:

1. WebSocket opens and authenticates guest or account.
2. Connection presents a **short-lived, server-signed reservation/join ticket** for a particular arena.
3. On READY, the server atomically checks the live count **plus reserved seats**.
4. If there is a slot, reserve/consume it and create the player exactly once.
5. Otherwise send an explicit `arena_full` response **without spawning a player**, and release resources.
6. On timeout, disconnect, kick, death/spectator conversion or intentional transfer, adjust counts according to the chosen policy.
7. The client asks the matchmaker for another room if the first room is full or unhealthy.

Key edge cases to test: two players joining for the last slot, duplicate READY packets, disconnect during spawn, stale reservations, reconnect while the previous socket still exists, spectator-to-player promotion, and capacity changes while players are present.

Do **not** trust the browser's self-reported room capacity. The matchmaker can make a tentative choice, but the destination game server must make the final admission decision.

## 5. Matchmaker and registry design

Keep the game engine as an independent simulation service. Extend the existing server manager or build a small dedicated matchmaking service with records such as:

```text
instanceId
regionId
endpointWss
gameMode
arenaWidth / arenaHeight
maxActivePlayers
activePlayers
reservedSlots
spectatorCount / spectatorLimit
healthState: healthy | draining | unhealthy
lastHeartbeatAt
serverVersion
```

The directory may rank candidate instances by region/ping, health, spare capacity and player-population target. For a social territory game, avoid spreading the first few players across too many empty arenas; prefer reasonably populated rooms but retain capacity headroom.

A recommended basic policy:

- Filter out unavailable, full, draining and incompatible-mode instances.
- Choose an instance in the preferred region with headroom, using occupancy-aware placement.
- Acquire a short-lived reservation atomically.
- Give the client a signed join ticket plus the chosen WSS endpoint.
- Time out and release unused reservations; retry another instance if needed.
- If nothing is available, offer a clear queue/retry state or another region **with an explicit latency tradeoff**.

Allow a developer/admin override to connect to a specific instance, while ordinary players see only Play Now and optionally a region choice.

### Why use one process per arena first?

- Gameplay remains isolated and server-authoritative.
- Different processes can be put on one machine or spread across machines.
- An overloaded/crashed game affects fewer players.
- Existing single-arena code changes are smaller.
- Capacity and lifecycle can be measured per arena.

An alternative is several `Game` objects in one Deno process. That requires routing connections and tick/update ownership carefully; one blocked event loop can affect all arenas in the process. It is **not** required for the proposed MVP.

## 6. Regions and physical hosting

A name like `US East` is a **regional grouping**, not proof of a single machine or single arena. Never infer the actual number of live Splix production arenas from server menu labels alone.

Deployment sequence:
1. Prove a single local instance is stable with its cap.
2. Run two or three game-server processes on distinct local ports.
3. Place them behind stable HTTPS/WSS routing.
4. Add regional pools only when you have hosting in those regions.
5. Later add startup/shutdown orchestration and spare-capacity rules.

Example per-region hosting:

```text
US-East region / VM A
  -> ws://internal:8101 (arena 1, cap 50)
  -> ws://internal:8102 (arena 2, cap 50)
  -> ws://internal:8103 (arena 3, cap 50)
  -> public WSS routing via reverse proxy
```

Do not expose internal ports, admin APIs or raw join controls publicly. Production WebSockets should use WSS, authenticated admission, and a reverse proxy configured for connection upgrades and sensible timeouts.

## 7. Persistent accounts are a key multi-instance dependency

Current Gridwar guest/account functionality uses Deno KV with a configurable local storage path. If each arena instance starts with a separate local KV file, users registered through one instance may not have the same account/session on another instance.

**Before multi-region launch**, design a shared identity service/data store and centrally validated session or signed identity credential. Keep arena gameplay state in each arena; persist account profile, progression and global stats in a consistent shared service. The existing guest-first Join path should remain functional throughout this migration.

Do not copy or synchronize live per-process account KV files as a matchmaking strategy.

## 8. Load test and performance acceptance

Use real gameplay-like synthetic clients, not just thousands of idle WebSockets. Cover:

- 10, 25, 50, 75, 100 connected active players on one arena.
- Movement and 90° turns, collisions, fast changing territory, large captures.
- Power-ups, score events, radar spectators, and reconnect spikes.
- Network conditions and clients with slow or interrupted connections.
- Multiple simultaneous arenas on the same target machine.

Record for each run:
- VM/CPU and available cores, memory limit, runtime/version, map dimensions.
- Active vs spectator count, tick interval, game mode, packet throughput.
- p50/p95/p99 tick execution time and event-loop delay.
- CPU %, resident memory, outgoing bandwidth, slow socket queues.
- Disconnects, lost joins, client update delay, collision correctness.

**Example evaluation gate:** p99 tick execution should stay below the 50 ms tick budget, ideally with meaningful headroom, and the simulation should remain consistent. Decide exact acceptable client latency/disconnect rates based on measured gameplay experience. Lower the player cap if 50 is not stable.

Run CI unit/integration tests for joining, collision/trail logic and power-up behavior, plus a browser smoke test at each milestone. A static/code audit does not prove server capacity.

## 9. Failure, fairness and rollout considerations

- **Failure isolation:** a crashed arena stops accepting joins and is removed from matchmaking.
- **Draining:** stop new joins before restart; decide whether ongoing matches are allowed to finish.
- **Reconnects:** use short-lived identity/reservation rules so reconnection does not take two slots.
- **Observability:** collect capacity by region and arena, slow ticks, queue length, connection errors and process restarts.
- **Fairness:** preserve server-authoritative movement and collision checks; monitor whether lag affects players unequally.
- **Game modes:** never mix incompatible modes in one arena; maintain mode-specific pools/caps.
- **Rollout:** ship admission cap first, then multi-instance, matchmaking, regions, and finally autoscaling. Do not introduce all of them at once.

## 10. Decisions still needed

- What is the acceptable player density/feel on a 600×600 map?
- How many spectators should be allowed per arena?
- Should full regions suggest another region, queue, or both?
- How should the service group beginner, regular and special-mode arenas?
- What hosting budget, hardware, and expected regional demand are available?
- Do we keep one continuous game per arena (current model), or add time-limited matches later?

### Related implementation files

- `gameServer/src/Main.js`
- `gameServer/src/gameplay/Game.js`
- `gameServer/src/gameplay/Arena.js`
- `gameServer/src/WebSocketConnection.js`
- `gameServer/src/WebSocketManager.js`
- `gameServer/src/ApplicationLoop.js`
- `gameServer/src/config.js`
- `serverManager/src/GameServer.js`
- `serverManager/src/ServerManager.js`
- `gameServer/src/auth/AccountService.js`
- `docs/GRIDWAR_FEATURES.md`

See [Project Roadmap](./ROADMAP.md) for milestones, checklists and acceptance criteria.
