/**
 * One shared territory-token objective per game arena.
 *
 * Rules: claim the tile using normal Splix territory mechanics, hold the
 * first capture for 30s or a takeover for 15s, and stop after three total
 * successful captures. Only a completed hold awards 0.75 *virtual* game token.
 *
 * Financial/persistent token crediting is deliberately not implemented here.
 * The server is authoritative; clients only display the state broadcast.
 */
export const TERRITORY_TOKEN_RULES = Object.freeze({
	firstHoldMs: 30_000,
	stealHoldMs: 15_000,
	maxCaptures: 3,
	rewardMilliTokens: 750,
	respawnMs: 45_000,
	minActivePlayers: 2,
	margin: 3,
});

/**
 * @typedef TokenRoundState
 * @property {"inactive" | "available" | "held" | "won" | "expired"} phase
 * @property {number} x
 * @property {number} y
 * @property {number} ownerId
 * @property {number} captures
 * @property {number} remainingMs
 */

/**
 * @param {import("./Arena.js").Arena} arena
 * @param {number} x
 * @param {number} y
 */
function isValidTokenTile(arena, x, y) {
	const margin = TERRITORY_TOKEN_RULES.margin;
	return x >= margin && x < arena.width - margin &&
		y >= margin && y < arena.height - margin &&
		arena.getTileValue({ x, y }) === 0;
}

/**
 * @param {{x: number, y: number}} location
 * @param {{x: number, y: number}?} patch
 */
function touchesTwoByTwo(location, patch) {
	return Boolean(patch) && location.x >= patch.x && location.x < patch.x + 2 &&
		location.y >= patch.y && location.y < patch.y + 2;
}

export class TerritoryTokenManager {
	/** @type {import("./Game.js").Game} */
	#game;
	/** @type {{x: number, y: number, ownerId: number, captures: number, holdEndsAt: number}?} */
	#token = null;
	/** @type {TokenRoundState} */
	#lastState = { phase: "inactive", x: 0, y: 0, ownerId: 0, captures: 0, remainingMs: 0 };
	#nextSpawnAt = 0;

	/** @param {import("./Game.js").Game} game */
	constructor(game) {
		this.#game = game;
	}

	/** @returns {TokenRoundState} */
	getState() {
		const token = this.#token;
		if (!token) return { ...this.#lastState };
		return {
			phase: token.ownerId ? "held" : "available",
			x: token.x,
			y: token.y,
			ownerId: token.ownerId,
			captures: token.captures,
			remainingMs: token.ownerId ? Math.max(0, Math.ceil(token.holdEndsAt - this.#game.boostClock())) : 0,
		};
	}

	/** @returns {{x: number, y: number}?} */
	get location() {
		return this.#token ? { x: this.#token.x, y: this.#token.y } : null;
	}

	/**
	 * Call after a territory fill, including an ownership reset after death.
	 * @param {import("../util/util.js").Rect} rect
	 */
	onRectFilled(rect) {
		const token = this.#token;
		if (!token) return;
		if (token.x < rect.min.x || token.y < rect.min.y ||
			token.x >= rect.max.x || token.y >= rect.max.y) return;
		this.#syncOwnership(this.#game.boostClock());
	}

	/** @param {number} now */
	loop(now) {
		if (!this.#token) {
			if (now >= this.#nextSpawnAt && this.#canPlay()) this.#spawn(now);
			return;
		}
		if (!this.#canPlay()) {
			this.#finishRound(now, null);
			return;
		}
		this.#syncOwnership(now);
		const token = this.#token;
		if (!token) return;
		if (token.ownerId && now >= token.holdEndsAt) {
			// Recheck immediately before awarding; all prize decisions are server-side.
			const holder = this.#validOwnerId(token.x, token.y);
			if (holder === token.ownerId) {
				this.#finishRound(now, this.#game.getPlayerById(holder));
			}
		}
	}

	/** @returns {boolean} */
	#canPlay() {
		return this.#game.getEligibleTokenPlayerCount() >= TERRITORY_TOKEN_RULES.minActivePlayers;
	}

	/** @param {number} x @param {number} y @returns {number} */
	#validOwnerId(x, y) {
		const id = this.#game.arena.getTileValue({ x, y });
		if (!id || id <= 0) return 0;
		const player = this.#game.getPlayerById(id);
		if (!player || player.dead || player.permanentlyDead || player.isSpectator) return 0;
		return id;
	}

	/** @param {number} now */
	#syncOwnership(now) {
		const token = this.#token;
		if (!token) return;
		const ownerId = this.#validOwnerId(token.x, token.y);
		if (ownerId === token.ownerId) return;

		// The third successful claim is the last chance. If that holder loses
		// the tile, do not allow a fourth player to win the same round.
		if (token.captures >= TERRITORY_TOKEN_RULES.maxCaptures) {
			this.#finishRound(now, null);
			return;
		}

		token.ownerId = ownerId;
		if (ownerId) {
			token.captures++;
			const duration = token.captures === 1
				? TERRITORY_TOKEN_RULES.firstHoldMs
				: TERRITORY_TOKEN_RULES.stealHoldMs;
			token.holdEndsAt = now + duration;
		} else {
			token.holdEndsAt = 0;
		}
		this.#broadcast();
	}

	/** @param {number} now @param {import("./Player.js").Player?} winner */
	#finishRound(now, winner) {
		const token = this.#token;
		if (!token) return;
		this.#token = null;
		this.#nextSpawnAt = now + TERRITORY_TOKEN_RULES.respawnMs;
		this.#lastState = {
			phase: winner ? "won" : "expired",
			x: token.x,
			y: token.y,
			ownerId: winner ? winner.id : 0,
			captures: token.captures,
			remainingMs: 0,
		};
		// Clear the objective before the award, so duplicate callbacks cannot
		// credit the same winning round twice.
		if (winner) {
			winner.grantTerritoryTokenReward(TERRITORY_TOKEN_RULES.rewardMilliTokens);
		}
		this.#broadcast();
	}

	/** @param {{x: number, y: number}} location */
	#overlapsOtherPickup(location) {
		if (touchesTwoByTwo(location, this.#game.boostManager?.location)) return true;
		for (const patch of this.#game.powerUpManager?.locations || []) {
			if (touchesTwoByTwo(location, patch)) return true;
		}
		return false;
	}

	/** @param {number} now */
	#spawn(now) {
		const arena = this.#game.arena;
		const margin = TERRITORY_TOKEN_RULES.margin;
		const spanX = arena.width - margin * 2;
		const spanY = arena.height - margin * 2;
		if (spanX <= 0 || spanY <= 0) {
			this.#nextSpawnAt = now + 5_000;
			return;
		}

		/** @type {{x: number, y: number}?} */
		let location = null;
		for (let i = 0; i < 180; i++) {
			const candidate = {
				x: margin + Math.floor(Math.random() * spanX),
				y: margin + Math.floor(Math.random() * spanY),
			};
			if (!isValidTokenTile(arena, candidate.x, candidate.y) ||
				this.#overlapsOtherPickup(candidate)) continue;
			location = candidate;
			break;
		}

		// Fallback for very full maps: avoid endless random retries.
		if (!location) {
			for (let x = margin; x < arena.width - margin && !location; x++) {
				for (let y = margin; y < arena.height - margin; y++) {
					const candidate = { x, y };
					if (!isValidTokenTile(arena, x, y) || this.#overlapsOtherPickup(candidate)) continue;
					location = candidate;
					break;
				}
			}
		}
		if (!location) {
			this.#nextSpawnAt = now + 5_000;
			return;
		}
		this.#token = { ...location, ownerId: 0, captures: 0, holdEndsAt: 0 };
		this.#broadcast();
	}

	#broadcast() {
		this.#game.broadcastTerritoryTokenState(this.getState());
	}
}
