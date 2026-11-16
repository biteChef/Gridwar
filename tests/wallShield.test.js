import assert from "node:assert/strict";
import { chooseWallShieldDeflection } from "../gameServer/src/gameplay/WallShield.js";

const arena = { width: 40, height: 40 };
const safe = ({ x, y }) => x > 0 && y > 0 && x < arena.width - 1 && y < arena.height - 1;

Deno.test("approaching top wall deflects one tile left by default", () => {
	assert.deepEqual(chooseWallShieldDeflection({ x: 10, y: 1 }, "up", safe), {
		direction: "left", position: { x: 9, y: 1 },
	});
});

Deno.test("rightward side can be chosen instead of left", () => {
	assert.deepEqual(chooseWallShieldDeflection({ x: 10, y: 1 }, "up", safe, false), {
		direction: "right", position: { x: 11, y: 1 },
	});
});

Deno.test("approaching left wall deflects down along the wall", () => {
	assert.deepEqual(chooseWallShieldDeflection({ x: 1, y: 15 }, "left", safe), {
		direction: "down", position: { x: 1, y: 16 },
	});
});

Deno.test("approaching right wall deflects up along the wall", () => {
	assert.deepEqual(chooseWallShieldDeflection({ x: 38, y: 15 }, "right", safe), {
		direction: "up", position: { x: 38, y: 14 },
	});
});

Deno.test("approaching bottom wall deflects sideways", () => {
	assert.deepEqual(chooseWallShieldDeflection({ x: 18, y: 38 }, "down", safe), {
		direction: "right", position: { x: 19, y: 38 },
	});
});

Deno.test("blocked first side chooses the second safe path", () => {
	const avoid = (pos) => safe(pos) && !(pos.x === 9 && pos.y === 1);
	assert.deepEqual(chooseWallShieldDeflection({ x: 10, y: 1 }, "up", avoid), {
		direction: "right", position: { x: 11, y: 1 },
	});
});

Deno.test("no available sideways path means no deflection", () => {
	const blocked = ({ x, y }) => safe({ x, y }) && x !== 9 && x !== 11;
	assert.equal(chooseWallShieldDeflection({ x: 10, y: 1 }, "up", blocked), null);
});

Deno.test("does not move paused players or guess invalid directions", () => {
	assert.equal(chooseWallShieldDeflection({ x: 10, y: 1 }, "paused", safe), null);
});

Deno.test("a corner with only one safe side takes that side", () => {
	assert.deepEqual(chooseWallShieldDeflection({ x: 1, y: 1 }, "up", safe), {
		direction: "right", position: { x: 2, y: 1 },
	});
});
