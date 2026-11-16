import { POWER_UP_TYPES, POWER_UP_RESPAWN_MS } from "./PowerUpState.js";
import { getCompleteBoostOwner, isValidBoostPlacement, rectTouchesBoost } from "./SpeedBoostManager.js";

/** @typedef {{x: number, y: number, typeId: number, owners: number[]}} Pickup */

/**
 * Server-authoritative pickup spawner. Each type has one independent 2x2
 * collectible; claiming it requires complete ownership or entering it when
 * the patch already belongs to your player.
 */
export class PowerUpManager {
	/** @type {import("./Game.js").Game} */
	#game;
	/** @type {Map<number, Pickup>} */
	#pickups = new Map();
	/** @type {Map<number, number>} */
	#nextSpawns = new Map();

	/** @param {import("./Game.js").Game} game */
	constructor(game) {
		this.#game = game;
		for (const { id } of POWER_UP_TYPES) this.#nextSpawns.set(id, (id - 1) * 2_000);
	}

	get locations() {
		return Array.from(this.#pickups.values(), ({ typeId, x, y }) => ({ typeId, x, y }));
	}

	/** @param {number} now */
	loop(now) {
		for (const { id } of POWER_UP_TYPES) {
			if (!this.#pickups.has(id) && now >= (this.#nextSpawns.get(id) || 0)) {
				this.#spawn(id, now);
			}
		}
	}

	/** @param {import("../util/util.js").Rect} rect */
	onRectFilled(rect) {
		for (const patch of [...this.#pickups.values()]) {
			if (!rectTouchesBoost(rect, patch)) continue;
			const currentOwners = this.#readOwners(patch);
			const changed = currentOwners.some((owner, index) => owner != patch.owners[index]);
			patch.owners = currentOwners;
			if (changed) this.#award(patch, getCompleteBoostOwner(this.#game.arena, patch));
		}
	}

	/**
	 * @param {import("./Player.js").Player} player
	 * @param {{x: number, y: number}} position
	 */
	onPlayerEnteredTile(player, position) {
		if (player.dead || player.permanentlyDead || player.isSpectator) return;
		for (const patch of [...this.#pickups.values()]) {
			if (position.x < patch.x || position.x >= patch.x + 2 ||
				position.y < patch.y || position.y >= patch.y + 2) continue;
			if (getCompleteBoostOwner(this.#game.arena, patch) != player.id) continue;
			this.#award(patch, player.id);
		}
	}

	/** @param {Pickup} patch */
	#readOwners(patch) {
		const owners = [];
		for (let dx = 0; dx < 2; dx++) {
			for (let dy = 0; dy < 2; dy++) {
				owners.push(this.#game.arena.getTileValue({ x: patch.x + dx, y: patch.y + dy }));
			}
		}
		return owners;
	}

	/** @param {Pickup} patch @param {number} ownerId */
	#award(patch, ownerId) {
		if (!ownerId || !this.#pickups.has(patch.typeId)) return;
		const player = this.#game.getPlayerById(ownerId);
		if (!player || player.dead || player.permanentlyDead || player.isSpectator) return;
		const def = POWER_UP_TYPES.find((p) => p.id === patch.typeId);
		if (!def) return;
		this.#pickups.delete(patch.typeId);
		this.#nextSpawns.set(patch.typeId, this.#game.boostClock() + POWER_UP_RESPAWN_MS);
		this.#game.broadcastPowerUpLocations(this.locations);
		player.grantPowerUp(def.type);
	}

	/** @param {number} x @param {number} y */
	#overlapsExisting(x, y) {
		const token = this.#game.territoryTokenManager?.location;
		if (token && token.x >= x && token.x < x + 2 && token.y >= y && token.y < y + 2) return true;
		const speed = this.#game.boostManager.location;
		if (speed && x < speed.x + 2 && x + 2 > speed.x &&
			y < speed.y + 2 && y + 2 > speed.y) return true;
		for (const patch of this.#pickups.values()) {
			if (x < patch.x + 2 && x + 2 > patch.x &&
				y < patch.y + 2 && y + 2 > patch.y) return true;
		}
		return false;
	}

	/** @param {number} typeId @param {number} now */
	#spawn(typeId, now) {
		const arena = this.#game.arena;
		const maxX = arena.width - 5;
		const maxY = arena.height - 5;
		if (maxX < 3 || maxY < 3) {
			this.#nextSpawns.set(typeId, now + POWER_UP_RESPAWN_MS);
			return;
		}
		/** @type {{x: number, y: number}?} */
		let chosen = null;
		// Half the time prefer fully claimed land, otherwise any safe cells.
		if (Math.random() < 0.5) {
			let count = 0;
			for (let x = 3; x <= maxX; x++) {
				for (let y = 3; y <= maxY; y++) {
					if (this.#overlapsExisting(x, y) ||
						getCompleteBoostOwner(arena, { x, y }) <= 0) continue;
					count++;
					if (Math.random() * count < 1) chosen = { x, y };
				}
			}
		}
		if (!chosen) {
			for (let attempt = 0; attempt < 150; attempt++) {
				const x = 3 + Math.floor(Math.random() * (maxX - 2));
				const y = 3 + Math.floor(Math.random() * (maxY - 2));
				if (!isValidBoostPlacement(arena, x, y) || this.#overlapsExisting(x, y)) continue;
				chosen = { x, y };
				break;
			}
		}
		if (!chosen) {
			this.#nextSpawns.set(typeId, now + 5_000);
			return;
		}
		/** @type {Pickup} */
		const patch = { typeId, ...chosen, owners: [] };
		patch.owners = this.#readOwners(patch);
		this.#pickups.set(typeId, patch);
		this.#game.broadcastPowerUpLocations(this.locations);
	}
}
