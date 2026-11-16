// @ts-nocheck
import assert from "node:assert/strict";
import { Vec2 } from "renda";
import { PLAYER_TRAVEL_SPEED } from "../gameServer/src/config.js";
import { Player } from "../gameServer/src/gameplay/Player.js";

/**
 * Minimal but real Player movement harness. Unlike geometry-only tests, this
 * exercises Player.loop(), trail vertices, direction changes and death logic.
 */
function createWallApproach(hasWallShield) {
	const events = { closed: 0, deaths: 0, trailUpdates: 0, serverPositions: 0 };
	const noOp = () => {};
	const connection = {
		protocolVersion: 1,
		plusSkinsAllowed: false,
		send: noOp,
		sendPlayerState() { events.serverPositions++; },
		sendPlayerSkin: noOp,
		sendPlayerName: noOp,
		sendPlayerBoost: noOp,
		sendMyScore: noOp,
		sendMyRank: noOp,
		sendPowerUpState: noOp,
		close() { events.closed++; },
	};
	const game = {
		gameMode: "normal",
		arena: {
			width: 20,
			height: 20,
			fillPlayerSpawn() { return 9; },
			getTileValue({ x, y }) {
				// A wall tile must never be read by #updateCurrentTile.
				if (x <= 0 || y <= 0 || x >= 19 || y >= 19) {
					throw new Error("Invalid tile lookup at wall");
				}
				return x === 8 && y === 3 ? 1 : 0;
			},
		},
		getNewSpawnPosition() { return { position: new Vec2(8, 3), direction: "up" }; },
		getOverlappingTrailBoundsPlayersForRect() { return []; },
		getOverlappingViewportPlayersForRect() { return []; },
		getOverlappingTrailBoundsPlayersForPos() { return []; },
		getPlayerCount() { return 0; },
		getArenaChunkForMessage() { return []; },
		broadcastPlayerState: noOp,
		broadcastPlayerTrail() { events.trailUpdates++; },
		broadcastPlayerDeath() { events.deaths++; },
		boostManager: { onPlayerEnteredTile: noOp },
		powerUpManager: { onPlayerEnteredTile: noOp },
	};
	const mainInstance = { applicationLoop: { currentTickIsSlow() { return false; } } };
	const player = new Player(1, game, connection, mainInstance, {
		skin: null,
		name: "wall-test",
		isSpectator: false,
	});
	if (hasWallShield) player.grantPowerUp("wall");
	return { player, events };
}

function advanceTile(player) {
	// One server tile step in the underlying original movement engine.
	player.loop(performance.now(), 1 / PLAYER_TRAVEL_SPEED);
}

Deno.test("Wall Shield redirects real Player movement without invalid diagonal trail or disconnect", () => {
	const { player, events } = createWallApproach(true);
	advanceTile(player); // 8,2 — begin trail
	advanceTile(player); // 8,1 — adjacent to top wall
	assert.equal(player.hasPowerUp("wall"), true);
	advanceTile(player); // Attempt 8,0; side-step to 7,1 or 9,1
	assert.equal(player.dead, false);
	assert.equal(player.hasPowerUp("wall"), false);
	assert.equal(player.getPosition().y, 1);
	assert.ok(player.getPosition().x === 7 || player.getPosition().x === 9);
	assert.ok(["left", "right"].includes(player.currentDirection));
	advanceTile(player); // Continue along wall
	assert.equal(player.dead, false);
	// A turn after the shield must not throw the diagonal vertex assertion.
	player.clientPosUpdateRequested("down", player.getPosition());
	assert.equal(player.currentDirection, "down");
	const trail = [...player.getTrailVertices()];
	assert.ok(trail.length >= 3, "the shield must create the corner of the trail");
	assert.ok(trail.every((point, i) =>
		i === 0 || point.x === trail[i - 1].x || point.y === trail[i - 1].y
	), "every trail segment must be horizontal or vertical");
	assert.equal(events.closed, 0);
	assert.equal(events.deaths, 0);
	assert.ok(events.trailUpdates >= 2);
});

Deno.test("without Wall Shield, wall hit is ordinary death without connection loss", () => {
	const { player, events } = createWallApproach(false);
	advanceTile(player);
	advanceTile(player);
	advanceTile(player);
	assert.equal(player.dead, true);
	assert.equal(events.deaths, 1);
	assert.equal(events.closed, 0);
	// The server must leave the player on the last valid tile. It must never
	// place them at y=0 or beyond and try to fetch an invalid arena tile.
	assert.deepEqual(player.getPosition().toArray(), [8, 1]);
});

Deno.test("client-supplied out-of-bounds turn cannot teleport through the wall", () => {
	const { player, events } = createWallApproach(true);
	const before = player.getPosition();
	player.clientPosUpdateRequested("left", new Vec2(-5, 3));
	assert.deepEqual(player.getPosition().toArray(), before.toArray());
	assert.equal(player.hasPowerUp("wall"), true);
	assert.equal(player.dead, false);
	assert.equal(events.closed, 0);
});

Deno.test("Wall Shield also redirects when a lagged server tick crosses multiple tiles", () => {
	const { player, events } = createWallApproach(true);
	// A single lagged tick has enough time to move multiple tiles.
	player.loop(performance.now(), 3 / PLAYER_TRAVEL_SPEED);
	assert.equal(player.dead, false);
	assert.equal(player.hasPowerUp("wall"), false);
	assert.ok(player.getPosition().x >= 1 && player.getPosition().x <= 18);
	assert.ok(player.getPosition().y >= 1 && player.getPosition().y <= 18);
	assert.ok(["left", "right"].includes(player.currentDirection));
	assert.equal(events.closed, 0);
});
