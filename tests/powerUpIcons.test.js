import assert from "node:assert/strict";
import { POWER_UP_TYPES } from "../gameServer/src/gameplay/PowerUpState.js";
import {
	POWER_UP_ART,
	MAP_POWER_UP_TYPES,
	drawPowerUpIconOnMap,
	getPowerUpIconPath,
} from "../client/src/powerUpIcons.js";

Deno.test("first-generation power-up images match existing game IDs", () => {
	assert.deepEqual(POWER_UP_TYPES.map((definition) => definition.type), MAP_POWER_UP_TYPES);
	assert.deepEqual(Object.keys(POWER_UP_ART), ["speed", ...MAP_POWER_UP_TYPES]);
	for (const [name, artwork] of Object.entries(POWER_UP_ART)) {
		assert.ok(artwork.name.length > 0);
		assert.match(artwork.color, /^#[0-9A-Fa-f]{6}$/);
		assert.equal(getPowerUpIconPath(name), "./static/img/powerups/" + name + ".webp");
	}
	assert.equal(getPowerUpIconPath("unknown"), "");
});

Deno.test("all six approved icons are small transparent WebP images", async () => {
	const encoder = new TextDecoder("ascii");
	for (const name of Object.keys(POWER_UP_ART)) {
		const path = "client/static/img/powerups/" + name + ".webp";
		const bytes = await Deno.readFile(path);
		assert.ok(bytes.length > 300 && bytes.length < 15_000, path);
		assert.equal(encoder.decode(bytes.subarray(0, 4)), "RIFF", path);
		assert.equal(encoder.decode(bytes.subarray(8, 12)), "WEBP", path);
		assert.equal(encoder.decode(bytes.subarray(12, 16)), "VP8X", path);
		// The first generated icons have transparent, not opaque, backgrounds.
		assert.ok((bytes[20] & 0x10) !== 0, path + " must include an alpha channel");
	}
});

Deno.test("map icons retain the 2x2 tile footprint, with no extra circular badge", () => {
	const calls = [];
	const ctx = {
		save() { calls.push("save"); },
		restore() { calls.push("restore"); },
		fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h]); },
		strokeRect(x, y, w, h) { calls.push(["strokeRect", x, y, w, h]); },
		beginPath() { throw new Error("Do not draw an enclosing circle"); },
		arc() { throw new Error("Do not draw an enclosing circle"); },
		drawImage() { calls.push("drawImage"); },
	};
	drawPowerUpIconOnMap(ctx, 12, 20, "speed", 1000);
	assert.equal(calls[0], "save");
	assert.equal(calls.at(-1), "restore");
	assert.ok(calls.some((x) => Array.isArray(x) && x[0] === "strokeRect"));
	assert.equal(calls.filter((x) => Array.isArray(x) && x[0] === "fillRect").length, 5);
	const before = calls.length;
	drawPowerUpIconOnMap(ctx, 12, 20, "unknown", 1000);
	assert.equal(calls.length, before);
});
