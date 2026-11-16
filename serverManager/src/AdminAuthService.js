/**
 * Gridwar admin-only credential + session service.
 *
 * This is intentionally separate from player accounts. The single initial
 * owner account is configured with an environment-stored PBKDF2 verifier;
 * sessions and audit events are stored in a dedicated Deno KV file.
 * No privileged API works until the owner credentials are configured.
 */
const ADMIN_COOKIE = "gridwar_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;
const HASH_ITERATIONS = 310_000;
const encoder = new TextEncoder();

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** @param {string} text */
function fromBase64Url(text) {
	if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Malformed verifier");
	const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
	return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
	return difference === 0;
}

/** @param {string} password @param {Uint8Array} salt @param {number} iterations */
async function derive(password, salt, iterations) {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
	const result = await crypto.subtle.deriveBits({
		name: "PBKDF2",
		hash: "SHA-256",
		salt,
		iterations,
	}, key, 256);
	return new Uint8Array(result);
}

/** @param {string} password */
export async function makeAdminPasswordHash(password) {
	if (typeof password !== "string" || password.length < 16 || password.length > 128) {
		throw new Error("Admin password must be between 16 and 128 characters.");
	}
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const bytes = await derive(password, salt, HASH_ITERATIONS);
	return "pbkdf2$" + HASH_ITERATIONS + "$" + toBase64Url(salt) + "$" + toBase64Url(bytes);
}

/** @param {string | null | undefined} encoded */
export function parseAdminPasswordHash(encoded) {
	if (typeof encoded !== "string") return null;
	const match = /^pbkdf2\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
	if (!match) return null;
	const iterations = Number(match[1]);
	if (!Number.isSafeInteger(iterations) || iterations < 200_000 || iterations > 1_000_000) return null;
	try {
		const salt = fromBase64Url(match[2]);
		const verifier = fromBase64Url(match[3]);
		if (salt.length !== 16 || verifier.length !== 32) return null;
		return { iterations, salt, verifier };
	} catch {
		return null;
	}
}

/** @param {string} password @param {string} encoded */
export async function verifyAdminPassword(password, encoded) {
	const parsed = parseAdminPasswordHash(encoded);
	if (!parsed || typeof password !== "string") return false;
	const actual = await derive(password, parsed.salt, parsed.iterations);
	return sameBytes(actual, parsed.verifier);
}

/** @param {string} raw */
async function hashSession(raw) {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
	return toBase64Url(new Uint8Array(digest));
}

/** @param {Request} request */
function getCookie(request) {
	const cookies = (request.headers.get("cookie") || "").split(";");
	const cookie = cookies.find((entry) => entry.trim().startsWith(ADMIN_COOKIE + "="));
	const token = cookie?.trim().slice(ADMIN_COOKIE.length + 1) || "";
	return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** @param {Request} request @param {string} token @param {number} maxAge */
function sessionCookie(request, token, maxAge) {
	const publicOrigin = Deno.env.get("GRIDWAR_ADMIN_PUBLIC_ORIGIN") || new URL(request.url).origin;
	const secure = Deno.env.get("GRIDWAR_SECURE_COOKIES") === "1" || new URL(publicOrigin).protocol === "https:";
	return ADMIN_COOKIE + "=" + token + "; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=" + maxAge +
		(secure ? "; Secure" : "");
}

/** @param {Request} request */
export function isSafeAdminWrite(request) {
	const origin = request.headers.get("origin");
	if (!origin) return false;
	try {
		const expected = Deno.env.get("GRIDWAR_ADMIN_PUBLIC_ORIGIN") || new URL(request.url).origin;
		return new URL(origin).origin === new URL(expected).origin;
	} catch {
		return false;
	}
}

export class AdminAuthService {
	/** @type {Promise<Deno.Kv>?} */
	#dbPromise = null;
	/** @type {Map<string, {start: number, failures: number}>} */
	#attempts = new Map();

	get configured() {
		return Boolean(Deno.env.get("GRIDWAR_ADMIN_USERNAME") && parseAdminPasswordHash(Deno.env.get("GRIDWAR_ADMIN_PASSWORD_HASH")));
	}

	#db() {
		this.#dbPromise ||= Deno.openKv(Deno.env.get("GRIDWAR_ADMIN_KV_PATH") || "./gridwar-admin.kv");
		return this.#dbPromise;
	}

	/** @param {string} ip */
	#canAttempt(ip) {
		const now = Date.now();
		const state = this.#attempts.get(ip);
		if (!state || now - state.start > 15 * 60_000) {
			this.#attempts.set(ip, { start: now, failures: 0 });
			// Keep memory bounded even when many different IPs are seen.
			if (this.#attempts.size > 10_000) this.#attempts.clear();
			return true;
		}
		return state.failures < 6;
	}

	/** @param {string} ip */
	#markFailure(ip) {
		const current = this.#attempts.get(ip);
		if (current) current.failures++;
	}

	/**
	 * @param {Request} request
	 * @param {string} ip
	 * @returns {Promise<{status: number, data?: Record<string, unknown>, error?: string, headers?: Record<string, string>}>}
	 */
	async login(request, ip) {
		if (!this.configured) return { error: "Admin account not configured", status: 503 };
		if (!this.#canAttempt(ip)) return { error: "Too many sign-in attempts. Try again later.", status: 429 };
		const length = Number(request.headers.get("content-length") || 0);
		if (length > 2048) return { error: "Request too large", status: 413 };
		let data;
		try {
			const text = await request.text();
			if (text.length > 2048) return { error: "Request too large", status: 413 };
			data = JSON.parse(text);
		} catch {
			return { error: "Invalid request", status: 400 };
		}
		const user = data?.username;
		const password = data?.password;
		if (typeof user !== "string" || typeof password !== "string" || password.length > 128) {
			return { error: "Invalid credentials", status: 401 };
		}
		const matchedPassword = await verifyAdminPassword(password, Deno.env.get("GRIDWAR_ADMIN_PASSWORD_HASH") || "");
		if (!matchedPassword || user !== Deno.env.get("GRIDWAR_ADMIN_USERNAME")) {
			this.#markFailure(ip);
			return { error: "Invalid credentials", status: 401 };
		}

		this.#attempts.delete(ip);
		const raw = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
		const key = await hashSession(raw);
		const db = await this.#db();
		await db.set(["gridwar", "admin", "session", key], {
			username: user, role: "owner",
			passwordHash: Deno.env.get("GRIDWAR_ADMIN_PASSWORD_HASH"),
		}, { expireIn: SESSION_MS });
		await this.recordAudit(user, "admin.login", "Session started");
		return {
			status: 200,
			data: { authenticated: true, username: user, role: "owner" },
			headers: { "Set-Cookie": sessionCookie(request, raw, Math.floor(SESSION_MS / 1000)) },
		};
	}

	/** @param {Request} request */
	async getSession(request) {
		const token = getCookie(request);
		if (!token) return null;
		const db = await this.#db();
		const stored = await db.get(["gridwar", "admin", "session", await hashSession(token)]);
		const user = /** @type {{username: string, role: string, passwordHash?: string}?} */ (stored.value);
		if (!user || user.role !== "owner" || user.username !== Deno.env.get("GRIDWAR_ADMIN_USERNAME") ||
			user.passwordHash !== Deno.env.get("GRIDWAR_ADMIN_PASSWORD_HASH")) return null;
		return { username: user.username, role: "owner" };
	}

	/** @param {Request} request */
	async logout(request) {
		const identity = await this.getSession(request);
		const token = getCookie(request);
		if (token) {
			const db = await this.#db();
			await db.delete(["gridwar", "admin", "session", await hashSession(token)]);
		}
		if (identity) await this.recordAudit(identity.username, "admin.logout", "Session ended");
		return { status: 200, data: { authenticated: false }, headers: { "Set-Cookie": sessionCookie(request, "", 0) } };
	}

	/** @param {string} actor @param {string} action @param {string} summary */
	async recordAudit(actor, action, summary) {
		const db = await this.#db();
		const at = Date.now();
		await db.set(["gridwar", "admin", "audit", at, crypto.randomUUID()], { at, actor, action, summary });
	}

	async recentAudit() {
		const db = await this.#db();
		const entries = db.list({ prefix: ["gridwar", "admin", "audit"] }, { reverse: true, limit: 30 });
		const items = [];
		for await (const entry of entries) items.push(entry.value);
		return items;
	}

	/** Close the dedicated KV handle during tests or graceful service shutdown. */
	async close() {
		if (this.#dbPromise) {
			const db = await this.#dbPromise;
			db.close();
			this.#dbPromise = null;
		}
	}
}
