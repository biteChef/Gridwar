import assert from "node:assert/strict";
import { PowerUpState, POWER_UP_TYPES } from "../gameServer/src/gameplay/PowerUpState.js";

Deno.test("all six power-ups are defined with stable IDs and durations", () => {
	assert.deepEqual(POWER_UP_TYPES.map((p) => p.id), [1, 2, 3, 4, 5, 6]);
	assert.deepEqual(POWER_UP_TYPES.map((p) => p.durationMs), [8_000, 15_000, 5_000, 15_000, 0, 0]);
});

Deno.test("shield absorbs one strike and expires on time", () => {
	const state = new PowerUpState();
	state.grant("shield", 1_000);
	assert.equal(state.isActive("shield", 1_001), true);
	assert.equal(state.consumeTrailDefense(1_001), "shield");
	assert.equal(state.consumeTrailDefense(1_002), null);
	state.grant("shield", 2_000);
	state.expire(10_001);
	assert.equal(state.isActive("shield", 10_001), false);
});

Deno.test("repair is stored as one charge and consumed after shield", () => {
	const state = new PowerUpState();
	state.grant("repair", 0);
	state.grant("shield", 0);
	assert.equal(state.consumeTrailDefense(100), "shield");
	assert.equal(state.consumeTrailDefense(101), "repair");
	assert.equal(state.consumeTrailDefense(102), null);
});

Deno.test("ghost and radar have independent deadlines and cannot stack", () => {
	const state = new PowerUpState();
	state.grant("ghost", 100);
	state.grant("radar", 100);
	assert.equal(state.isActive("ghost", 5_099), true);
	assert.equal(state.isActive("ghost", 5_100), false);
	assert.equal(state.isActive("radar", 5_100), true);
	state.grant("ghost", 2_000);
	assert.equal(state.isActive("ghost", 6_999), true);
	state.expire(7_001);
	assert.equal(state.isActive("ghost", 7_001), false);
});

Deno.test("double score awards bonus points, not extra territory", () => {
	const state = new PowerUpState();
	assert.equal(state.captureBonus(24, 50), 0);
	state.grant("double", 100);
	assert.equal(state.captureBonus(24, 150), 24);
	assert.equal(state.captureBonus(-3, 200), 0);
	assert.equal(state.captureBonus(24, 15_101), 0);
});

Deno.test("clearing powers on death removes all timers and repair charges", () => {
	const state = new PowerUpState();
	for (const { type } of POWER_UP_TYPES) state.grant(type, 0);
	state.clear();
	assert.deepEqual(state.snapshot(1), [0, 0, 0, 0, 0, 0]);
	assert.equal(state.consumeTrailDefense(1), null);
});

Deno.test("wall shield is separate from trail shield, one use and nonstacking", () => {
	const state = new PowerUpState();
	assert.equal(state.consumeWallShield(), false);
	state.grant("wall", 0);
	assert.equal(state.isActive("wall", 60_000), true);
	assert.equal(state.remainingMs("wall", 60_000), 1);
	state.grant("wall", 0);
	assert.equal(state.consumeWallShield(), true);
	assert.equal(state.consumeWallShield(), false);
	state.grant("shield", 0);
	assert.equal(state.consumeWallShield(), false);
	assert.equal(state.consumeTrailDefense(100), "shield");
	state.grant("wall", 0);
	state.clear();
	assert.equal(state.consumeWallShield(), false);
});
