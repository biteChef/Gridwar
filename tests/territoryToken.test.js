import assert from "node:assert/strict";
import { TerritoryTokenManager, TERRITORY_TOKEN_RULES } from "../gameServer/src/gameplay/TerritoryTokenManager.js";

function harness(width = 48, height = 48) {
	const tiles = new Map();
	const arena = {
		width,
		height,
		getTileValue({ x, y }) { return tiles.get(x + "," + y) || 0; },
		set(x, y, id) { tiles.set(x + "," + y, id); },
	};
	let now = 1_000;
	const events = [];
	const awards = [];
	const players = new Map();
	function addPlayer(id, flags = {}) {
		const player = {
			id, dead: false, permanentlyDead: false, isSpectator: false,
			...flags,
			grantTerritoryTokenReward(milliTokens) { awards.push({ id, milliTokens }); },
		};
		players.set(id, player);
		return player;
	}
	addPlayer(1);
	addPlayer(2);
	addPlayer(3);
	const game = {
		arena,
		boostManager: { location: { x: 5, y: 5 } },
		powerUpManager: { locations: [{ x: 8, y: 8, typeId: 1 }] },
		getPlayerById(id) { return players.get(id) || null; },
		getEligibleTokenPlayerCount() {
			return Array.from(players.values()).filter((p) => !p.dead && !p.permanentlyDead && !p.isSpectator).length;
		},
		boostClock() { return now; },
		broadcastTerritoryTokenState(state) { events.push({ ...state }); },
	};
	const manager = new TerritoryTokenManager(game);
	const sync = () => manager.onRectFilled({
		min: { x: 0, y: 0 }, max: { x: width, y: height },
	});
	return {
		arena, game, manager, events, awards, players, sync,
		now: () => now,
		setNow(value) { now = value; },
		elapse(ms) { now += ms; manager.loop(now); },
		spawn() {
			manager.loop(now);
			const p = manager.location;
			assert.ok(p, "a token should be available");
			return p;
		},
		capture(id) {
			const p = manager.location;
			assert.ok(p, "round must have an active token");
			arena.set(p.x, p.y, id);
			sync();
			return manager.getState();
		},
	};
}

Deno.test("only one random token appears on a safe unclaimed tile and is broadcast", () => {
	const h = harness();
	const pos = h.spawn();
	assert.equal(h.arena.getTileValue(pos), 0);
	assert.notDeepEqual(pos, { x: 5, y: 5 });
	assert.ok(!(pos.x >= 5 && pos.x < 7 && pos.y >= 5 && pos.y < 7));
	assert.ok(!(pos.x >= 8 && pos.x < 10 && pos.y >= 8 && pos.y < 10));
	assert.equal(h.manager.getState().phase, "available");
	assert.equal(h.events.length, 1);
	h.manager.loop(h.now());
	assert.equal(h.events.length, 1, "repeated ticks must not create another token");
});

Deno.test("first claim must hold the tile for 30 seconds and awards exactly 0.75 virtual token", () => {
	const h = harness();
	h.spawn();
	const state = h.capture(1);
	assert.equal(state.phase, "held");
	assert.equal(state.ownerId, 1);
	assert.equal(state.captures, 1);
	assert.equal(state.remainingMs, 30_000);
	h.elapse(29_999);
	assert.equal(h.awards.length, 0);
	h.elapse(1);
	assert.deepEqual(h.awards, [{ id: 1, milliTokens: 750 }]);
	assert.equal(h.manager.getState().phase, "won");
	assert.equal(h.manager.location, null);
	h.sync();
	h.manager.loop(h.now());
	assert.equal(h.awards.length, 1, "winning round must never pay twice");
	assert.equal(TERRITORY_TOKEN_RULES.rewardMilliTokens, 750);
});

Deno.test("stealing the tile restarts a 15-second timer instead of the old 30-second timer", () => {
	const h = harness();
	h.spawn();
	h.capture(1);
	h.elapse(12_000);
	const takeover = h.capture(2);
	assert.equal(takeover.ownerId, 2);
	assert.equal(takeover.captures, 2);
	assert.equal(takeover.remainingMs, 15_000);
	h.elapse(14_999);
	assert.equal(h.awards.length, 0);
	h.elapse(1);
	assert.deepEqual(h.awards, [{ id: 2, milliTokens: 750 }]);
});

Deno.test("the third successful capture is the final chance and a fourth cannot win", () => {
	const h = harness();
	h.spawn();
	h.capture(1);
	h.elapse(1_000);
	h.capture(2);
	h.elapse(1_000);
	const third = h.capture(3);
	assert.equal(third.captures, 3);
	assert.equal(third.remainingMs, 15_000);
	h.elapse(1_000);
	h.capture(1);
	assert.equal(h.manager.getState().phase, "expired");
	assert.equal(h.manager.location, null);
	assert.deepEqual(h.awards, [], "losing the third hold ends the round without a reward");
	h.elapse(TERRITORY_TOKEN_RULES.respawnMs - 1);
	assert.equal(h.manager.location, null);
	h.elapse(1);
	assert.equal(h.manager.getState().phase, "available");
	assert.equal(h.manager.getState().captures, 0);
});

Deno.test("clearing territory interrupts the hold and a later claim is a new attempt", () => {
	const h = harness();
	h.spawn();
	h.capture(1);
	h.elapse(10_000);
	const neutral = h.capture(0);
	assert.equal(neutral.phase, "available");
	assert.equal(neutral.captures, 1);
	h.elapse(25_000);
	assert.deepEqual(h.awards, []);
	const next = h.capture(2);
	assert.equal(next.captures, 2);
	assert.equal(next.remainingMs, 15_000);
});

Deno.test("dead/spectator owners cannot hold or win and a solo arena cannot farm the token", () => {
	const h = harness();
	h.spawn();
	h.capture(1);
	h.players.get(1).dead = true;
	h.elapse(2_000);
	assert.equal(h.manager.getState().phase, "available");
	h.players.get(2).isSpectator = true;
	h.players.get(3).dead = true;
	h.elapse(1_000);
	assert.equal(h.manager.getState().phase, "expired");
	assert.deepEqual(h.awards, []);
	h.elapse(TERRITORY_TOKEN_RULES.respawnMs);
	assert.equal(h.manager.location, null, "only one eligible player remains");
});

Deno.test("no existing player territory is claimed automatically on spawn", () => {
	const h = harness(18, 18);
	for (let x = 3; x < 15; x++) {
		for (let y = 3; y < 15; y++) h.arena.set(x, y, 1);
	}
	h.manager.loop(h.now());
	assert.equal(h.manager.location, null);
	assert.deepEqual(h.awards, []);
});

Deno.test("late joiners receive the current token snapshot including remaining hold duration", () => {
	const h = harness();
	h.spawn();
	h.capture(1);
	h.elapse(7_000);
	const state = h.manager.getState();
	assert.equal(state.phase, "held");
	assert.equal(state.ownerId, 1);
	assert.equal(state.remainingMs, 23_000);
});
