import assert from "node:assert/strict";
import {
	SPEED_BOOST,
	rectTouchesBoost,
	getCompleteBoostOwner,
	isValidBoostPlacement,
	SpeedBoostManager,
} from "../gameServer/src/gameplay/SpeedBoostManager.js";

function fakeArena(width = 60, height = 60) {
	const cells = new Map();
	return {
		width, height,
		set(x, y, owner) { cells.set(x + "," + y, owner); },
		getTileValue({ x, y }) { return cells.get(x + "," + y) || 0; },
	};
}

Deno.test("2×2 booster requires complete ownership by the same player", () => {
	const arena = fakeArena();
	const patch = { x: 10, y: 10 };
	assert.equal(getCompleteBoostOwner(arena, patch), 0);
	arena.set(10, 10, 1);
	arena.set(11, 10, 1);
	arena.set(10, 11, 1);
	assert.equal(getCompleteBoostOwner(arena, patch), 0);
	arena.set(11, 11, 2);
	assert.equal(getCompleteBoostOwner(arena, patch), 0);
	arena.set(11, 11, 1);
	assert.equal(getCompleteBoostOwner(arena, patch), 1);
});

Deno.test("booster cannot spawn on occupied cells or outside safe boundaries", () => {
	const arena = fakeArena();
	assert.equal(isValidBoostPlacement(arena, 4, 4), true);
	arena.set(5, 4, 1);
	assert.equal(isValidBoostPlacement(arena, 4, 4), false);
	assert.equal(isValidBoostPlacement(arena, 0, 4), false);
	assert.equal(isValidBoostPlacement(arena, 56, 55), false);
});

Deno.test("filled rectangle is tested only if it overlaps booster", () => {
	const patch = { x: 25, y: 25 };
	assert.equal(rectTouchesBoost({ min: { x: 2, y: 2 }, max: { x: 6, y: 6 } }, patch), false);
	assert.equal(rectTouchesBoost({ min: { x: 26, y: 26 }, max: { x: 27, y: 27 } }, patch), true);
});

Deno.test("claim grants one server boost, clears patch and delays respawn", () => {
	const arena = fakeArena();
	let now = 1000;
	const changes = [];
	const awards = [];
	const player = {
		dead: false, permanentlyDead: false, isSpectator: false,
		grantSpeedBoost(ms) { awards.push(ms); },
	};
	const game = {
		arena,
		getPlayerById: (id) => id === 8 ? player : null,
		boostClock: () => now,
		broadcastBoostLocation: (location) => changes.push(location),
	};
	const manager = new SpeedBoostManager(game);
	manager.loop(now);
	const patch = manager.location;
	assert.ok(patch);
	arena.set(patch.x, patch.y, 8);
	arena.set(patch.x + 1, patch.y, 8);
	arena.set(patch.x, patch.y + 1, 8);
	const changedRect = {
		min: { x: patch.x, y: patch.y },
		max: { x: patch.x + 2, y: patch.y + 2 },
	};
	manager.onRectFilled(changedRect);
	assert.equal(awards.length, 0);
	arena.set(patch.x + 1, patch.y + 1, 8);
	manager.onRectFilled(changedRect);
	assert.deepEqual(awards, [SPEED_BOOST.durationMs]);
	assert.equal(manager.location, null);
	assert.equal(changes.at(-1), null);
	manager.onRectFilled(changedRect);
	assert.equal(awards.length, 1);
	now += SPEED_BOOST.respawnMs - 1;
	manager.loop(now);
	assert.equal(manager.location, null);
	now++;
	manager.loop(now);
	assert.ok(manager.location);
});

Deno.test("dead players and spectators cannot receive booster awards", () => {
	const arena = fakeArena();
	let awarded = false;
	const player = {
		dead: true, permanentlyDead: false, isSpectator: false,
		grantSpeedBoost() { awarded = true; },
	};
	const manager = new SpeedBoostManager({
		arena, boostClock: () => 100,
		broadcastBoostLocation() {},
		getPlayerById() { return player; },
	});
	manager.loop(100);
	const patch = manager.location;
	assert.ok(patch);
	for (let x = patch.x; x < patch.x + 2; x++) {
		for (let y = patch.y; y < patch.y + 2; y++) arena.set(x, y, 9);
	}
	manager.onRectFilled({ min: { x: patch.x, y: patch.y }, max: { x: patch.x + 2, y: patch.y + 2 } });
	assert.equal(awarded, false);
	assert.ok(manager.location);
});
