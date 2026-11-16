/**
 * All five additional pickups use the original Splix territory rules.
 * IDs are stable on the wire; don't reorder them without changing the client.
 */
export const POWER_UP_TYPES = Object.freeze([
	{ id: 1, type: "shield", title: "Shield", durationMs: 8_000 },
	{ id: 2, type: "radar", title: "Radar", durationMs: 15_000 },
	{ id: 3, type: "ghost", title: "Ghost Mode", durationMs: 5_000 },
	{ id: 4, type: "double", title: "Double Score", durationMs: 15_000 },
	{ id: 5, type: "repair", title: "Trail Repair", durationMs: 0 },
]);

export const POWER_UP_RESPAWN_MS = 35_000;

/** Server-authoritative per-player timers and one-use charges. */
export class PowerUpState {
	/** @type {Record<string, number>} */
	#expires = { shield: 0, radar: 0, ghost: 0, double: 0 };
	#shieldCharges = 0;
	#repairCharges = 0;

	/** @param {string} type @param {number} now */
	grant(type, now) {
		const def = POWER_UP_TYPES.find((item) => item.type == type);
		if (!def) return false;
		if (type == "repair") {
			this.#repairCharges = 1; // No stacking.
		} else {
			this.#expires[type] = now + def.durationMs;
			if (type == "shield") this.#shieldCharges = 1;
		}
		return true;
	}

	/** @param {string} type @param {number} now */
	isActive(type, now) {
		if (type == "repair") return this.#repairCharges > 0;
		if (type == "shield") return this.#shieldCharges > 0 && this.#expires.shield > now;
		return (this.#expires[type] || 0) > now;
	}

	/** @param {string} type @param {number} now */
	remainingMs(type, now) {
		if (type == "repair") return this.#repairCharges > 0 ? 1 : 0;
		if (!this.isActive(type, now)) return 0;
		return Math.max(0, Math.ceil(this.#expires[type] - now));
	}

	/**
	 * Shield blocks one enemy strike, leaving the trail in place.
	 * Trail Repair is the fallback: it saves a hit but erases the exposed trail.
	 * @param {number} now
	 * @returns {"shield" | "repair" | null}
	 */
	consumeTrailDefense(now) {
		if (this.isActive("shield", now)) {
			this.#shieldCharges = 0;
			this.#expires.shield = 0;
			return "shield";
		}
		if (this.#repairCharges > 0) {
			this.#repairCharges = 0;
			return "repair";
		}
		return null;
	}

	/**
	 * Accrue bonus points only on new successful captures. Never mutate arena
	 * tile ownership or the original captured-tile count.
	 * @param {number} newlyCapturedTiles
	 * @param {number} now
	 */
	captureBonus(newlyCapturedTiles, now) {
		if (!this.isActive("double", now)) return 0;
		return Math.max(0, Math.floor(newlyCapturedTiles));
	}

	/** @param {number} now */
	expire(now) {
		let changed = false;
		for (const type of ["shield", "radar", "ghost", "double"]) {
			const until = this.#expires[type];
			if (until && until <= now) {
				this.#expires[type] = 0;
				changed = true;
				if (type == "shield") this.#shieldCharges = 0;
			}
		}
		return changed;
	}

	/** @param {number} now */
	snapshot(now) {
		return POWER_UP_TYPES.map(({ type }) => this.remainingMs(type, now));
	}

	clear() {
		for (const type of ["shield", "radar", "ghost", "double"]) this.#expires[type] = 0;
		this.#shieldCharges = 0;
		this.#repairCharges = 0;
	}
}
