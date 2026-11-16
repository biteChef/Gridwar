import assert from "node:assert/strict";
import { PowerUpManager } from "../gameServer/src/gameplay/PowerUpManager.js";
import { POWER_UP_TYPES, POWER_UP_RESPAWN_MS } from "../gameServer/src/gameplay/PowerUpState.js";

function harness(width = 40, height = 40) {
	const data = new Map();
	const arena = {
		width, height,
		getTileValue({ x, y }) { return data.get(x + "," + y) || 0; },
		set(x, y, value) { data.set(x + "," + y, value); },
	};
	const events = [];
	const grants = [];
	const players = new Map();
	let now = 20_000;
	const game = {
		arena,
		boostManager: { location: { x: 4, y: 4 } },
		boostClock: () => now,
		broadcastPowerUpLocations: (patches) => events.push(patches.map((p) => ({ ...p }))),
		getPlayerById: (id) => players.get(id) || null,
	};
	const manager = new PowerUpManager(game);
	return {
		arena, manager, events, grants, players, game,
		setNow(value) { now = value; },
		addPlayer(id, flags = {}) {
			const player = {
				id, dead: false, permanentlyDead: false, isSpectator: false,
				...flags,
				grantPowerUp(type) { grants.push({ id, type }); },
			};
			players.set(id, player);
			return player;
		},
		fill(patch, ownerId) {
			for (let dx = 0; dx < 2; dx++) {
				for (let dy = 0; dy < 2; dy++) arena.set(patch.x + dx, patch.y + dy, ownerId);
			}
		},
	};
}

Deno.test("all five special pickups appear and do not overlap each other or speed", () => {
	const h = harness();
	h.manager.loop(20_000);
	const patches = h.manager.locations;
	assert.equal(patches.length, 5);
	assert.deepEqual(new Set(patches.map((p) => p.typeId)), new Set(POWER_UP_TYPES.map((p) => p.id)));
	for (const p of patches) {
		assert.ok(!(p.x < 6 && p.x + 2 > 4 && p.y < 6 && p.y + 2 > 4));
		for (const q of patches) {
			if (p === q) continue;
			assert.ok(!(p.x < q.x + 2 && p.x + 2 > q.x && p.y < q.y + 2 && p.y + 2 > q.y));
		}
	}
});

Deno.test("owned patch requires owner to step onto it; opponents cannot steal without capturing", () => {
	const h = harness();
	const owner = h.addPlayer(7);
	const opponent = h.addPlayer(8);
	h.manager.loop(20_000);
	const patch = h.manager.locations.find((p) => p.typeId == 1);
	assert.ok(patch);
	h.fill(patch, 7);
	h.manager.onPlayerEnteredTile(opponent, patch);
	assert.deepEqual(h.grants, []);
	h.manager.onPlayerEnteredTile(owner, { x: patch.x + 1, y: patch.y + 1 });
	assert.deepEqual(h.grants, [{ id: 7, type: "shield" }]);
	assert.ok(!h.manager.locations.some((p) => p.typeId == 1));
	h.manager.onPlayerEnteredTile(owner, patch);
	assert.equal(h.grants.length, 1);
	h.setNow(20_000 + POWER_UP_RESPAWN_MS - 1);
	h.manager.loop(20_000 + POWER_UP_RESPAWN_MS - 1);
	assert.ok(!h.manager.locations.some((p) => p.typeId == 1));
	h.manager.loop(20_000 + POWER_UP_RESPAWN_MS);
	assert.ok(h.manager.locations.some((p) => p.typeId == 1));
});

Deno.test("capture activates pickup only after all four tiles change ownership", () => {
	const h = harness();
	const opponent = h.addPlayer(8);
	h.manager.loop(20_000);
	const patch = h.manager.locations.find((p) => p.typeId == 3);
	assert.ok(patch);
	h.fill(patch, 4);
	h.manager.onRectFilled({ min: { x: patch.x, y: patch.y }, max: { x: patch.x + 2, y: patch.y + 2 } });
	assert.deepEqual(h.grants, []);
	h.arena.set(patch.x, patch.y, 8);
	h.arena.set(patch.x + 1, patch.y, 8);
	h.arena.set(patch.x, patch.y + 1, 8);
	const rect = { min: { x: patch.x, y: patch.y }, max: { x: patch.x + 2, y: patch.y + 2 } };
	h.manager.onRectFilled(rect);
	assert.deepEqual(h.grants, []);
	h.arena.set(patch.x + 1, patch.y + 1, 8);
	h.manager.onRectFilled(rect);
	assert.deepEqual(h.grants, [{ id: opponent.id, type: "ghost" }]);
});

Deno.test("no pickup is awarded to a spectator or dead player", () => {
	const h = harness();
	const spectator = h.addPlayer(5, { isSpectator: true });
	const dead = h.addPlayer(6, { dead: true });
	h.manager.loop(20_000);
	const shield = h.manager.locations.find((p) => p.typeId == 1);
	const radar = h.manager.locations.find((p) => p.typeId == 2);
	assert.ok(shield && radar);
	h.fill(shield, spectator.id);
	h.fill(radar, dead.id);
	h.manager.onPlayerEnteredTile(spectator, shield);
	h.manager.onPlayerEnteredTile(dead, radar);
	assert.deepEqual(h.grants, []);
});
