/**
 * Gridwar power-up artwork.
 *
 * Assets are lightweight transparent WebP images from the approved first icon set. Image objects are
 * loaded once; drawing them on the game canvas never triggers per-frame fetches.
 * This is strictly visual: game logic and wire protocol remain untouched.
 */
export const POWER_UP_ART = Object.freeze({
	speed: Object.freeze({ name: "Speed Boost", color: "#FFD149", src: "./static/img/powerups/speed.webp" }),
	shield: Object.freeze({ name: "Shield", color: "#F7C33D", src: "./static/img/powerups/shield.webp" }),
	radar: Object.freeze({ name: "Radar", color: "#66ED60", src: "./static/img/powerups/radar.webp" }),
	ghost: Object.freeze({ name: "Ghost Mode", color: "#D8EDFF", src: "./static/img/powerups/ghost.webp" }),
	double: Object.freeze({ name: "Double Score", color: "#F6C849", src: "./static/img/powerups/double.webp" }),
	repair: Object.freeze({ name: "Trail Repair", color: "#F8C23A", src: "./static/img/powerups/repair.webp" }),
});

/** Exact ID ordering is defined by server PowerUpState.POWER_UP_TYPES. */
export const MAP_POWER_UP_TYPES = Object.freeze([
	"shield", "radar", "ghost", "double", "repair",
]);

/** @type {Map<string, HTMLImageElement>} */
const cachedImages = new Map();

/** Call once on page load; images are cached and reused in every rendered frame. */
export function preloadPowerUpIcons() {
	if (typeof Image == "undefined") return;
	for (const [key, def] of Object.entries(POWER_UP_ART)) {
		if (cachedImages.has(key)) continue;
		const img = new Image();
		img.decoding = "async";
		img.src = def.src;
		cachedImages.set(key, img);
	}
}

/** @param {string} type */
export function getPowerUpIconPath(type) {
	return POWER_UP_ART[type]?.src || "";
}

/**
 * Draw a readable icon on top of a highlighted 2x2 area (20 world units).
 * No permanent tile coloring is changed, and no network state is modified.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} type
 * @param {number} now
 */
export function drawPowerUpIconOnMap(ctx, tileX, tileY, type, now) {
	const def = POWER_UP_ART[type];
	if (!def) return;
	const x = tileX * 10;
	const y = tileY * 10;
	const pulse = 0.70 + 0.15 * Math.sin(now * 0.004 + tileX * 0.3 + tileY * 0.2);

	ctx.save();
	// Keep the 2x2 territory footprint, but remove the former circular badge.
	// The approved icons already have their own bold, dark outlines.
	ctx.fillStyle = def.color;
	ctx.globalAlpha = 0.10 + pulse * 0.11;
	for (let dx = 0; dx < 2; dx++) {
		for (let dy = 0; dy < 2; dy++) {
			ctx.fillRect(x + 0.8 + dx * 10, y + 0.8 + dy * 10, 8.4, 8.4);
		}
	}
	ctx.globalAlpha = 0.58;
	ctx.lineWidth = 0.75;
	ctx.strokeStyle = def.color;
	ctx.strokeRect(x + 0.5, y + 0.5, 19, 19);
	ctx.globalAlpha = 1;

	const img = cachedImages.get(type);
	if (img?.complete && img.naturalWidth > 0) {
		// Show the actual generated artwork without enclosing it in a circle.
		ctx.drawImage(img, x + 0.25, y + 0.25, 19.5, 19.5);
	} else {
		// Loading/offline fallback stays square, never a letter or a circle.
		ctx.fillStyle = def.color;
		ctx.fillRect(x + 7, y + 7, 6, 6);
	}
	ctx.restore();
}
