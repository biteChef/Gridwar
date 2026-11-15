/**
 * Gridwar 2x2 territory booster. This module deliberately knows nothing about
 * transport/rendering; Game provides the authoritative arena and broadcasts.
 */
export const SPEED_BOOST = Object.freeze({
	size: 2,
	multiplier: 1.5,
	durationMs: 8_000,
	respawnMs: 20_000,
});

export function rectTouchesBoost(rect, boost) {
	if (!boost) return false;
	return rect.min.x < boost.x + SPEED_BOOST.size &&
		rect.max.x > boost.x &&
		rect.min.y < boost.y + SPEED_BOOST.size &&
		rect.max.y > boost.y;
}

export function getCompleteBoostOwner(arena, boost) {
	if (!boost) return 0;
	const owner = arena.getTileValue({ x: boost.x, y: boost.y });
	if (owner <= 0) return 0;
	for (let x = boost.x; x < boost.x + SPEED_BOOST.size; x++) {
		for (let y = boost.y; y < boost.y + SPEED_BOOST.size; y++) {
			if (arena.getTileValue({ x, y }) != owner) return 0;
		}
	}
	return owner;
}

export function isValidBoostPlacement(arena, x, y) {
	if (x < 3 || y < 3 || x + SPEED_BOOST.size >= arena.width - 2 ||
		y + SPEED_BOOST.size >= arena.height - 2) {
		return false;
	}
	for (let dx = 0; dx < SPEED_BOOST.size; dx++) {
		for (let dy = 0; dy < SPEED_BOOST.size; dy++) {
			if (arena.getTileValue({ x: x + dx, y: y + dy }) != 0) return false;
		}
	}
	return true;
}

/** Only the server chooses placements and awards boosts. */
export class SpeedBoostManager {
	#game;
	#boost = null;
	#spawnAt = 0;

	constructor(game) {
		this.#game = game;
	}

	get location() {
		return this.#boost ? { ...this.#boost } : null;
	}

	/** Run from the server's existing application loop. */
	loop(now) {
		if (!this.#boost && now >= this.#spawnAt) {
			this.#placeBoost(now);
		}
	}

	/**
	 * Arena worker has finished applying a tile-ownership rectangle.
	 * The patch activates ONLY when all four cells share the same owner.
	 */
	onRectFilled(rect) {
		if (!rectTouchesBoost(rect, this.#boost)) return;
		const ownerId = getCompleteBoostOwner(this.#game.arena, this.#boost);
		if (!ownerId) return;
		const player = this.#game.getPlayerById(ownerId);
		if (!player || player.dead || player.permanentlyDead || player.isSpectator) return;

		this.#boost = null;
		this.#spawnAt = this.#game.boostClock() + SPEED_BOOST.respawnMs;
		this.#game.broadcastBoostLocation(null);
		player.grantSpeedBoost(SPEED_BOOST.durationMs);
	}

	#placeBoost(now) {
		const arena = this.#game.arena;
		const maxX = arena.width - SPEED_BOOST.size - 3;
		const maxY = arena.height - SPEED_BOOST.size - 3;
		if (maxX <= 3 || maxY <= 3) {
			this.#spawnAt = now + SPEED_BOOST.respawnMs;
			return;
		}
		for (let attempt = 0; attempt < 160; attempt++) {
			const x = 3 + Math.floor(Math.random() * (maxX - 2));
			const y = 3 + Math.floor(Math.random() * (maxY - 2));
			if (!isValidBoostPlacement(arena, x, y)) continue;
			this.#boost = { x, y };
			this.#game.broadcastBoostLocation(this.#boost);
			return;
		}
		this.#spawnAt = now + SPEED_BOOST.respawnMs;
	}
}
