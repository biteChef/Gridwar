/**
 * Gridwar 2x2 territory booster. This module deliberately knows nothing about
 * transport/rendering; Game provides the authoritative arena and broadcasts.
 */
export const SPEED_BOOST = Object.freeze({
	size: 2,
	multiplier: 1.5,
	durationMs: 10_000,
	respawnMs: 20_000,
});

/** @param {import("../util/util.js").Rect} rect @param {{x: number, y: number}?} boost */
export function rectTouchesBoost(rect, boost) {
	if (!boost) return false;
	return rect.min.x < boost.x + SPEED_BOOST.size &&
		rect.max.x > boost.x &&
		rect.min.y < boost.y + SPEED_BOOST.size &&
		rect.max.y > boost.y;
}

/** @param {import("./Arena.js").Arena} arena @param {{x: number, y: number}?} boost */
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

/**
 * A patch can appear on neutral land, claimed territory, or across ownership
 * boundaries. It must never overlap a wall or a game-mode pit.
 * @param {import("./Arena.js").Arena} arena
 * @param {number} x
 * @param {number} y
 */
export function isValidBoostPlacement(arena, x, y) {
	if (x < 3 || y < 3 || x + SPEED_BOOST.size >= arena.width - 2 ||
		y + SPEED_BOOST.size >= arena.height - 2) {
		return false;
	}
	for (let dx = 0; dx < SPEED_BOOST.size; dx++) {
		for (let dy = 0; dy < SPEED_BOOST.size; dy++) {
			if (arena.getTileValue({ x: x + dx, y: y + dy }) == -1) return false;
		}
	}
	return true;
}

/** Only the server chooses placements and awards boosts. */
export class SpeedBoostManager {
	/** @type {import("./Game.js").Game} */
	#game;
	/** @type {{x: number, y: number}?} */
	#boost = null;
	/** @type {number[]?} */
	#lastPatchOwners = null;
	#spawnAt = 0;

	/** @param {import("./Game.js").Game} game */
	constructor(game) {
		this.#game = game;
	}

	get location() {
		return this.#boost ? { ...this.#boost } : null;
	}

	/** Run from the server's existing application loop. */
	/** @param {number} now */
	loop(now) {
		if (!this.#boost && now >= this.#spawnAt) {
			this.#placeBoost(now);
		}
	}

	/** @returns {number[]} */
	#readPatchOwners() {
		if (!this.#boost) return [];
		const owners = [];
		for (let dx = 0; dx < SPEED_BOOST.size; dx++) {
			for (let dy = 0; dy < SPEED_BOOST.size; dy++) {
				owners.push(this.#game.arena.getTileValue({
					x: this.#boost.x + dx,
					y: this.#boost.y + dy,
				}));
			}
		}
		return owners;
	}

	/**
	 * A new booster on already-owned land must not activate just because the
	 * ownership callback is called. A new capture must actually change a cell.
	 * @param {import("../util/util.js").Rect} rect
	 */
	onRectFilled(rect) {
		if (!rectTouchesBoost(rect, this.#boost)) return;
		const owners = this.#readPatchOwners();
		const changed = owners.some((owner, i) => owner != this.#lastPatchOwners?.[i]);
		this.#lastPatchOwners = owners;
		if (!changed) return;
		this.#awardIfOwnedBy(getCompleteBoostOwner(this.#game.arena, this.#boost));
	}

	/**
	 * When a booster appears in territory already owned by a player, that
	 * player must actively move onto one of its four tiles to collect it.
	 * Walking onto an opponent's booster does not bypass territory ownership.
	 * @param {{id: number, dead: boolean, permanentlyDead: boolean, isSpectator: boolean}} player
	 * @param {{x: number, y: number}} position
	 */
	onPlayerEnteredTile(player, position) {
		if (!this.#boost || !player || player.dead || player.permanentlyDead || player.isSpectator) return;
		if (position.x < this.#boost.x || position.x >= this.#boost.x + SPEED_BOOST.size ||
			position.y < this.#boost.y || position.y >= this.#boost.y + SPEED_BOOST.size) return;
		const ownerId = getCompleteBoostOwner(this.#game.arena, this.#boost);
		if (ownerId != player.id) return;
		this.#awardIfOwnedBy(player.id);
	}

	/** @param {number} ownerId */
	#awardIfOwnedBy(ownerId) {
		if (ownerId <= 0 || !this.#boost) return;
		const player = this.#game.getPlayerById(ownerId);
		if (!player || player.dead || player.permanentlyDead || player.isSpectator) return;

		this.#boost = null;
		this.#lastPatchOwners = null;
		this.#spawnAt = this.#game.boostClock() + SPEED_BOOST.respawnMs;
		this.#game.broadcastBoostLocation(null);
		player.grantSpeedBoost(SPEED_BOOST.durationMs);
	}

	/**
	 * Randomly select a complete existing 2x2 player territory.
	 * Reservoir sampling finds claimed land even when it covers only a tiny
	 * proportion of a large map. Run only at respawn, not each game tick.
	 * @returns {{x: number, y: number}?}
	 */
	#sampleCapturedPatch() {
		const arena = this.#game.arena;
		let chosen = null;
		let count = 0;
		for (let x = 3; x <= arena.width - SPEED_BOOST.size - 3; x++) {
			for (let y = 3; y <= arena.height - SPEED_BOOST.size - 3; y++) {
				if (getCompleteBoostOwner(arena, { x, y }) <= 0) continue;
				count++;
				if (Math.random() * count < 1) chosen = { x, y };
			}
		}
		return chosen;
	}

	/** @param {number} x @param {number} y */
	#overlapsPowerUps(x, y) {
		const token = this.#game.territoryTokenManager?.location;
		if (token && token.x >= x && token.x < x + 2 && token.y >= y && token.y < y + 2) return true;
		for (const patch of this.#game.powerUpManager?.locations || []) {
			if (x < patch.x + 2 && x + 2 > patch.x &&
				y < patch.y + 2 && y + 2 > patch.y) return true;
		}
		return false;
	}

	/** @param {number} now */
	#placeBoost(now) {
		const arena = this.#game.arena;
		const maxX = arena.width - SPEED_BOOST.size - 3;
		const maxY = arena.height - SPEED_BOOST.size - 3;
		if (maxX < 3 || maxY < 3) {
			this.#spawnAt = now + SPEED_BOOST.respawnMs;
			return;
		}

		// Prefer existing claimed land in roughly half of the spawns; if there
		// is none, fall back to all walkable parts of the map.
		let location = Math.random() < 0.5 ? this.#sampleCapturedPatch() : null;
		// Avoid placing the original speed boost on top of another power-up.
		if (location && this.#overlapsPowerUps(location.x, location.y)) location = null;
		if (!location) {
			for (let attempt = 0; attempt < 160; attempt++) {
				const x = 3 + Math.floor(Math.random() * (maxX - 2));
				const y = 3 + Math.floor(Math.random() * (maxY - 2));
				if (!isValidBoostPlacement(arena, x, y) || this.#overlapsPowerUps(x, y)) continue;
				location = { x, y };
				break;
			}
		}
		// A heavily occupied/obstructed arena may have no lucky random sample.
		if (!location) {
			for (let x = 3; x <= maxX && !location; x++) {
				for (let y = 3; y <= maxY; y++) {
					if (!isValidBoostPlacement(arena, x, y) || this.#overlapsPowerUps(x, y)) continue;
					location = { x, y };
					break;
				}
			}
		}
		if (!location) {
			this.#spawnAt = now + SPEED_BOOST.respawnMs;
			return;
		}
		this.#boost = location;
		this.#lastPatchOwners = this.#readPatchOwners();
		// Spawning never awards a boost: current owner must visit it, or another
		// player must capture the complete 2x2 patch.
		this.#game.broadcastBoostLocation(this.#boost);
	}
}
