# Gridwar — Territory Token Capture Event (Feature Preview)

**Status:** Implemented on `feature/territory-token-event` for review/testing. Not merged or production-ready.  
**Economy:** Rewards are **1.00 / 0.75 / 0.50 virtual game tokens, based on capture order and tracked only for the current player session**. No wallet, tradable cryptocurrency, withdrawals, purchases, payout API, durable account credit or real-world monetary value is implemented.

## Player experience

A single golden token appears at a random safe unclaimed tile somewhere in the arena. It is announced to everyone on the minimap, including spectators, with a bright diamond marker. A directional pointer and distance estimate guide living players toward the objective.

Players capture the token by **claiming its tile using the existing Splix territory mechanics**, not merely by walking over neutral ground. Once the first or second player claims that tile, the shared event HUD starts a timer. A third successful capture immediately ends the round with the final reward. The token stays at the same map coordinates; it is **not a physical item carried by a character**. To keep the token, the player must remain alive and retain ownership of the tile.

| Capture | Time required | What happens |
| --- | --- | --- |
| 1st successful claim | **30 seconds** | Hold the territory to earn **1.00 virtual token** |
| 2nd successful claim (first steal) | **15 seconds** | The new holder gets a fresh timer; hold to earn **0.75 virtual token** |
| 3rd successful claim (final steal) | **Instant — no countdown** | Third claimant immediately earns **0.50 virtual token** and ends the round |
| Unclaimed tile / interrupted hold | Timer stops | No reward is awarded for an incomplete hold; the next capture advances the count |
| Completed round | **45-second cooldown** | Token disappears, then a new token can appear later |

A claim is counted when the **tile changes to a valid player's ownership**. Merely approaching it, touching a border, waiting on another player's land, or submitting network messages is not a claim. If the token becomes unowned after a capture, its timer stops; the next owner counts as another capture. When a third valid player claim is registered, the server awards 0.50 immediately and ends the round; no fourth capture is possible.

A completed or cancelled round is followed by a **45-second** cooldown before the next token spawns. To avoid solo farming, the server only runs the event while **at least two living, non-spectating players** are present. An active round ends without reward if the count drops below two.

## Visual design

- **In-world:** pulsing gold diamond at the actual location (no changes to tile rendering or territory rules).
- **All-player minimap:** golden diamond visible across the whole arena, regardless of radar power-up or distance.
- **Navigation:** a small arrow rotates toward the token from the local player's position, with approximate straight-line distance in tiles.
- **Shared objective HUD:** compact lower-right card, separated from the Speed Boost, power-up, leaderboard, and minimap panels; shows capture count, next/earned reward, and 30/15-second countdown when relevant.
- **Reward confirmation:** winner receives a capture-specific `+1.00`, `+0.75`, or `+0.50` session-only notification; no financial balance is credited.
- **Late joining players:** receive the current objective and time remaining immediately upon joining.

## Server authority and fairness

- One event exists per **game-server instance / arena**; this is independent across arenas and geographic regions.
- Server chooses token coordinates on unowned, non-wall tiles and prevents overlap with other 2×2 pickups.
- Existing arena tile-ownership callbacks drive captures.
- The game server alone checks holder eligibility and completion of the first/second 30/15-second holds; it settles a valid third claim instantly.
- Lost ownership or death prevents awarding; there is no client-side claim/reward command.
- No client can change the state by forging HUD packets.
- Winner credit is in-session state on `Player` and is **not** durable; disconnecting loses the preview balance.

### WebSocket messages (server to client)

| Packet | Meaning |
| --- | --- |
| `31` `TERRITORY_TOKEN_STATE` | 13-byte packet: state (inactive, available, held, won, expired), tile x/y, owner ID, capture count and **remaining milliseconds** |
| `32` `TERRITORY_TOKEN_REWARD` | 7-byte packet sent only to the winner: **1000, 750, or 500** milli game tokens (by capture order), plus cumulative in-session total |

Existing Splix and Gridwar packet IDs 1–30 are unchanged. A client not recognizing the new packets can ignore them; the gameplay simulation continues unchanged.

## Terminal commands for local testing

Requires **Deno 2.4.1** and Git. Run these commands from a terminal on your computer.

### 1. Clone the feature branch

```bash
git clone https://github.com/biteChef/Gridwar.git
cd Gridwar
git fetch origin
git switch feature/territory-token-event
deno --version
```

If you already cloned Gridwar, run only:

```bash
cd Gridwar
git fetch origin
git switch feature/territory-token-event
git pull --ff-only
```

If the installed Deno version is different, follow the official Deno installation instructions and use `deno upgrade --version=2.4.1`.

### 2. Run the automated checks

```bash
deno task install-deps
deno fmt --check
deno task check
deno task test
deno test -A --unstable-kv tests/territoryToken.test.js
```

The final line runs only the new territory-token test file. If you have not yet built this repository locally, the dependency installation task may download files. Do not use `deno fmt` without `--check` when you only intend to inspect formatting.

### 3. Start the local game

```bash
deno task dev
```

Open **http://localhost:8080/client/** and select the local development game server. The server's base page at **http://localhost:8080/** also provides a direct local game link.

To see the token spawn, **join with two active players** (for example, in two separate browser windows), because the event requires at least two living, non-spectating participants. Run the first player in one window and the second with a different nickname in another. Keep the terminal running while playing; press `Ctrl+C` to stop it.

Manual smoke test:

1. Verify the golden marker appears on both players' minimaps, with an arrow pointing toward its position.
2. Capture the token's neutral tile using normal Splix territory rules; the first holder should see a **30s** countdown.
3. Have a different player take ownership of that tile; the next countdown should be **15s**.
4. Test the **third capture**; it must win **immediately**, with **no countdown**, for **0.50 virtual token**. No fourth capture should be possible.
5. Complete a **first** hold for **1.00** and a **second** hold for **0.75** (in separate rounds). Verify the respective session-token notifications; reload to confirm these are not persistent wallet balances.
6. Try a spectator, death, and disconnect while holding the token.

### 4. Optional build checks

```bash
deno task build-client
deno task build-gameserver --target linux
```

The Linux server build target above is for CI/servers; it is not a macOS executable. All builds, runtime smoke tests, and network tests still need to pass before merging the feature PR.

## Roadmap for production readiness

- [x] Implement capture/hold/steal event manager with a three-capture limit.
- [x] Wire server authority into territory ownership and periodic game loops.
- [x] Broadcast token position/state, including to late joiners.
- [x] Add on-map rendering, shared minimap icon, compass arrow, and hold timer.
- [x] Avoid overlap with existing speed/power-up pickup areas.
- [x] Add focused unit tests for spawn, 30/15 seconds, tiered 1.00/0.75/0.50 rewards, instant final capture, death, no solo farming and duplicate reward protection.
- [ ] Run `deno fmt --check`, `deno task check`, `deno task test` and full WebSocket integration test.
- [ ] Verify visually in-browser in desktop and mobile, including scale/placement at non-square layouts.
- [ ] Test late-join, disconnect, spectator, slow network and high-population behavior.
- [ ] Define the game token's exact purpose and whether it can be earned, spent or merely counted.
- [ ] If tokens should persist, design an **auditable, idempotent, server-owned game reward ledger** that works across multiple arenas. Never trust client-reported wins; add anti-collusion controls and review platform/legal requirements if rewards acquire monetary value.
- [ ] Add round analytics and optional admin config for timing, spawn frequency and player threshold.
- [ ] Decide whether token events belong in all normal arenas or a dedicated Capture-the-Token mode.

## Code

- `gameServer/src/gameplay/TerritoryTokenManager.js`
- `gameServer/src/gameplay/Game.js`
- `gameServer/src/gameplay/Player.js`
- `gameServer/src/WebSocketConnection.js`
- `gameServer/src/gameplay/SpeedBoostManager.js`
- `gameServer/src/gameplay/PowerUpManager.js`
- `client/src/main.js`
- `client/index.html`
- `client/static/territory-token.css`
- `tests/territoryToken.test.js`

**Rule clarification:** The final (third) successful territory ownership capture wins 0.50 immediately. Counting is based on changes to a valid player’s ownership—not the number of players who touch the marker. These are virtual in-session game tokens, not cash or a redeemable crypto asset.
