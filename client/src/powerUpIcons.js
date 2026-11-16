/**
 * Gridwar power-up artwork.
 *
 * Assets are scalable SVGs with transparent backgrounds. Image objects are
 * loaded once; drawing them on the game canvas never triggers per-frame fetches.
 * This is strictly visual: game logic and wire protocol remain untouched.
 */
export const POWER_UP_ART = Object.freeze({
	speed: Object.freeze({ name: "Speed Boost", color: "#F6C451", src: "./static/img/powerups/speed.svg" }),
	shield: Object.freeze({ name: "Shield", color: "#4BBAF0", src: "./static/img/powerups/shield.svg" }),
	radar: Object.freeze({ name: "Radar", color: "#AB8CF3", src: "./static/img/powerups/radar.svg" }),
	ghost: Object.freeze({ name: "Ghost Mode", color: "#BCE9FF", src: "./static/img/powerups/ghost.svg" }),
	double: Object.freeze({ name: "Double Score", color: "#EEBF47", src: "./static/img/powerups/double.svg" }),
	repair: Object.freeze({ name: "Trail Repair", color: "#6EDF9C", src: "./static/img/powerups/repair.svg" }),
});

/** Exact ID ordering is defined by server PowerUpState.POWER_UP_TYPES. */
export const MAP_POWER_UP_TYPES = Object.freeze([
	"shield", "radar", "ghost", "double", "repair",
]);

/** @type {Map<string, HTMLImageElement>} */
const cachedImages = new Map();

/** Call once on page load; SVGs are cached and reused in every rendered frame. */
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
	// Four light squares preserve the readable 2x2 territory footprint.
	ctx.fillStyle = def.color;
	ctx.globalAlpha = 0.20 + pulse * 0.22;
	for (let dx = 0; dx < 2; dx++) {
		for (let dy = 0; dy < 2; dy++) {
			ctx.fillRect(x + 0.8 + dx * 10, y + 0.8 + dy * 10, 8.4, 8.4);
		}
	}
	ctx.globalAlpha = 0.96;
	ctx.lineWidth = 1;
	ctx.strokeStyle = def.color;
	ctx.strokeRect(x + 0.6, y + 0.6, 18.8, 18.8);
	// Dark center provides consistent contrast above any player's territory.
	ctx.fillStyle = "rgba(22, 37, 36, 0.89)";
	ctx.beginPath();
	ctx.arc(x + 10, y + 10, 8.15, 0, Math.PI * 2);
	ctx.fill();
	ctx.lineWidth = 0.75;
	ctx.strokeStyle = def.color;
	ctx.stroke();

	const img = cachedImages.get(type);
	if (img?.complete && img.naturalWidth > 0) {
		ctx.drawImage(img, x + 3, y + 3, 14, 14);
	} else {
		// Brief loading/offline fallback: recognizable neutral glint, not a letter.
		ctx.fillStyle = "#F4FBF4";
		ctx.beginPath();
		ctx.arc(x + 10, y + 10, 3, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}
