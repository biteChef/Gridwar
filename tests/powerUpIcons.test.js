import assert from "node:assert/strict";
import { POWER_UP_TYPES } from "../gameServer/src/gameplay/PowerUpState.js";
import {
	POWER_UP_ART,
	MAP_POWER_UP_TYPES,
	drawPowerUpIconOnMap,
	getPowerUpIconPath,
} from "../client/src/powerUpIcons.js";

Deno.test("SVG artwork maps exactly to the five stable server power-up IDs", () => {
	assert.deepEqual(POWER_UP_TYPES.map((definition) => definition.type), MAP_POWER_UP_TYPES);
	assert.deepEqual(Object.keys(POWER_UP_ART), ["speed", ...MAP_POWER_UP_TYPES]);
	for (const [name, artwork] of Object.entries(POWER_UP_ART)) {
		assert.ok(artwork.name.length > 0, name);
		assert.match(artwork.color, /^#[0-9A-Fa-f]{6}$/, name);
		assert.equal(getPowerUpIconPath(name), "./static/img/powerups/" + name + ".svg");
	}
	assert.equal(getPowerUpIconPath("unknown"), "");
});

Deno.test("all six SVG assets exist and are scalable and transparent", async () => {
	for (const name of Object.keys(POWER_UP_ART)) {
		const file = "client/static/img/powerups/" + name + ".svg";
		const svg = await Deno.readTextFile(file);
		assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, file);
		assert.match(svg, /viewBox="0 0 64 64"/, file);
		assert.match(svg, /<title>[^<]+<\/title>/, file);
		assert.match(svg, /<\/svg>\s*$/, file);
		assert.ok(!svg.includes("<image"), file + " should be fully vector, not embedded bitmap");
	}
});

Deno.test("drawing a 2x2 SVG pickup uses only canvas operations", () => {
	const calls = [];
	const ctx = {
		save() { calls.push("save"); },
		restore() { calls.push("restore"); },
		fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h]); },
		strokeRect(x, y, w, h) { calls.push(["strokeRect", x, y, w, h]); },
		beginPath() { calls.push("beginPath"); },
		arc() { calls.push("arc"); },
		fill() { calls.push("fill"); },
		stroke() { calls.push("stroke"); },
		drawImage() { calls.push("drawImage"); },
	};
	drawPowerUpIconOnMap(ctx, 12, 20, "speed", 1000);
	assert.equal(calls[0], "save");
	assert.equal(calls.at(-1), "restore");
	assert.equal(calls.filter((x) => Array.isArray(x) && x[0] === "fillRect").length, 4);
	assert.ok(calls.some((x) => Array.isArray(x) && x[0] === "strokeRect"));
	// Invalid packets/types must not draw to the arena.
	const before = calls.length;
	drawPowerUpIconOnMap(ctx, 12, 20, "unknown", 1000);
	assert.equal(calls.length, before);
});
