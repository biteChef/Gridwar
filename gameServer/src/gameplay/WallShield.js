/**
 * Turn a player sideways by one safe tile when an active Wall Shield would
 * otherwise let them hit a solid boundary. Geometry is independent of Splix
 * networking and is testable without a running Deno server.
 */

/** @typedef {"up"|"down"|"left"|"right"} WallDirection */

/** @type {Record<WallDirection, [WallDirection, WallDirection]>} */
const SIDES = {
	up: ["left", "right"],
	down: ["right", "left"],
	left: ["down", "up"],
	right: ["up", "down"],
};

const MOVE = {
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
};

/**
 * First side in each pair is a left turn relative to the player's heading.
 * Only a one-tile orthogonal shove is allowed; never teleport across an
 * obstacle or bounce directly backward.
 * @param {{x: number, y: number}} previousPosition
 * @param {string} incomingDirection
 * @param {(pos: {x: number, y: number}) => boolean} safeTile
 * @param {boolean} preferLeft
 * @returns {{direction: WallDirection, position: {x: number, y: number}}?}
 */
export function chooseWallShieldDeflection(previousPosition, incomingDirection, safeTile, preferLeft = true) {
	if (!["up", "down", "left", "right"].includes(incomingDirection)) return null;
	const choices = SIDES[/** @type {WallDirection} */ (incomingDirection)];
	for (const dir of preferLeft ? choices : [choices[1], choices[0]]) {
		const vector = MOVE[dir];
		const position = { x: previousPosition.x + vector.x, y: previousPosition.y + vector.y };
		if (!safeTile(position)) continue;
		return { direction: dir, position };
	}
	return null;
}
