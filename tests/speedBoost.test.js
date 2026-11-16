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

Deno.test("booster can spawn on claimed territory, but not on walls or outside safe boundaries", () => {
	const arena = fakeArena();
	assert.equal(isValidBoostPlacement(arena, 4, 4), true);
	arena.set(5, 4, 1);
	assert.equal(isValidBoostPlacement(arena, 4, 4), true);
	arena.set(4, 5, -1);
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

Deno.test("speed boost duration is ten seconds", () => {
	assert.equal(SPEED_BOOST.durationMs, 10_000);
});

Deno.test("spawning in owned territory does not auto-award; owner must enter", () => {
	const arena = fakeArena(16, 16);
	// Every safely placeable patch belongs to player 4.
	for (let x = 3; x <= 12; x++) {
		for (let y = 3; y <= 12; y++) arena.set(x, y, 4);
	}
	let now = 1_000;
	const awards = [];
	const player = {
		id: 4, dead: false, permanentlyDead: false, isSpectator: false,
		grantSpeedBoost(ms) { awards.push(ms); },
	};
	const game = {
		arena, boostClock: () => now,
		broadcastBoostLocation() {},
		getPlayerById: (id) => id == 4 ? player : null,
	};
	const manager = new SpeedBoostManager(game);
	manager.loop(now);
	const patch = manager.location;
	assert.ok(patch, "boost should spawn in a claimed area");
	assert.equal(getCompleteBoostOwner(arena, patch), 4);
	assert.deepEqual(awards, [], "spawn should never automatically award");
	manager.onRectFilled({
		min: { x: patch.x, y: patch.y },
		max: { x: patch.x + 2, y: patch.y + 2 },
	});
	assert.deepEqual(awards, [], "unchanged ownership callback should not award");
	manager.onPlayerEnteredTile(player, { x: patch.x - 1, y: patch.y });
	assert.deepEqual(awards, [], "must enter the 2x2 patch");
	manager.onPlayerEnteredTile({ ...player, id: 5 }, { x: patch.x, y: patch.y });
	assert.deepEqual(awards, [], "a rival can't take it without owning all four tiles");
	manager.onPlayerEnteredTile(player, { x: patch.x, y: patch.y });
	assert.deepEqual(awards, [10_000]);
	assert.equal(manager.location, null);
	manager.onPlayerEnteredTile(player, { x: patch.x, y: patch.y });
	assert.equal(awards.length, 1, "consumed booster cannot award twice");
});

Deno.test("an opponent can take a booster by capturing all four tiles", () => {
	const arena = fakeArena(16, 16);
	for (let x = 3; x <= 12; x++) {
		for (let y = 3; y <= 12; y++) arena.set(x, y, 4);
	}
	const awards = [];
	const player4 = {
		id: 4, dead: false, permanentlyDead: false, isSpectator: false,
		grantSpeedBoost() { awards.push("owner"); },
	};
	const player5 = {
		id: 5, dead: false, permanentlyDead: false, isSpectator: false,
		grantSpeedBoost(ms) { awards.push(["challenger", ms]); },
	};
	const manager = new SpeedBoostManager({
		arena,
		boostClock: () => 2_000,
		broadcastBoostLocation() {},
		getPlayerById(id) { return id == 4 ? player4 : id == 5 ? player5 : null; },
	});
	manager.loop(2_000);
	const patch = manager.location;
	assert.ok(patch);
	arena.set(patch.x, patch.y, 5);
	arena.set(patch.x, patch.y + 1, 5);
	arena.set(patch.x + 1, patch.y, 5);
	const rect = { min: { x: patch.x, y: patch.y }, max: { x: patch.x + 2, y: patch.y + 2 } };
	manager.onRectFilled(rect);
	assert.deepEqual(awards, []);
	arena.set(patch.x + 1, patch.y + 1, 5);
	manager.onRectFilled(rect);
	assert.deepEqual(awards, [["challenger", 10_000]]);
	assert.equal(manager.location, null);
});

Deno.test("a boost does not award just because unrelated territory is filled", () => {
	const arena = fakeArena();
	let awards = 0;
	const manager = new SpeedBoostManager({
		arena,
		boostClock() { return 1_000; },
		broadcastBoostLocation() {},
		getPlayerById() { return { dead: false, permanentlyDead: false, isSpectator: false, grantSpeedBoost() { awards++; } }; },
	});
	manager.loop(1_000);
	const patch = manager.location;
	assert.ok(patch);
	manager.onRectFilled({ min: { x: 1, y: 1 }, max: { x: 2, y: 2 } });
	assert.equal(awards, 0);
	assert.ok(manager.location);
});
