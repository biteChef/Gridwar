/**
 * Gridwar account endpoints, usable without an external auth provider.
 * The game remains playable as a guest; accounts are optional.
 *
 * Deno KV persists username/password verifiers and expiring sessions.
 * Start Deno with --unstable-kv (Deno 2.4.x).
 */
/** @typedef {{username: string, salt: number[], verifier: number[], createdAt: number}} AccountRecord */
const COOKIE_NAME = "gridwar_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 310_000;
const textEncoder = new TextEncoder();
const loginError = "Invalid username or password.";

/** @param {Uint8Array} bytes */
function base64Url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** @param {unknown} value */
function normalizeUsername(value) {
	return typeof value == "string" ? value.trim().toLowerCase() : "";
}

/** @param {unknown} value */
function isValidUsername(value) {
	return typeof value == "string" && /^[a-zA-Z0-9_]{3,20}$/.test(value);
}

/** @param {unknown} value */
function isValidPassword(value) {
	return typeof value == "string" && value.length >= 12 && value.length <= 128;
}

/** @param {string} password @param {Uint8Array} salt */
async function derivePassword(password, salt) {
	const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
		key,
		256,
	);
	return new Uint8Array(bits);
}

/** @param {string} token */
async function hashSession(token) {
	const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
	return base64Url(new Uint8Array(digest));
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function constantTimeEqual(a, b) {
	if (a.length != b.length) return false;
	let different = 0;
	for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
	return different === 0;
}

/** @param {Request} req */
function getCookieToken(req) {
	const parts = (req.headers.get("cookie") || "").split(";");
	const part = parts.find((value) => value.trim().startsWith(COOKIE_NAME + "="));
	if (!part) return null;
	const token = part.trim().slice(COOKIE_NAME.length + 1);
	return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** @param {Request} request @param {string} token @param {number} maxAge */
function cookieHeader(request, token, maxAge) {
	const secure = Deno.env.get("GRIDWAR_SECURE_COOKIES") == "1" || new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return COOKIE_NAME + "=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + maxAge + secure;
}

/** @param {unknown} data @param {number} status @param {Record<string, string>} extraHeaders */
function json(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			...extraHeaders,
		},
	});
}

export class AccountService {
	/** @type {Promise<Deno.Kv>?} */
	#dbPromise = null;
	/** @type {Map<string, {started: number, count: number}>} */
	#attempts = new Map();

	#db() {
		this.#dbPromise ||= Deno.openKv(Deno.env.get("GRIDWAR_KV_PATH") || "./gridwar-accounts.kv");
		return this.#dbPromise;
	}

	/** @param {string} ip */
	#rateLimit(ip) {
		const now = Date.now();
		const current = this.#attempts.get(ip);
		if (!current || now - current.started > 15 * 60_000) {
			this.#attempts.set(ip, { started: now, count: 1 });
			return false;
		}
		current.count++;
		return current.count > 8;
	}

	/** @param {Deno.Kv} db @param {Request} request @param {string} username */
	async #createSession(db, request, username) {
		const rawToken = base64Url(crypto.getRandomValues(new Uint8Array(32)));
		const sessionKey = await hashSession(rawToken);
		await db.set(["gridwar", "session", sessionKey], { username }, { expireIn: SESSION_MS });
		return json({ authenticated: true, username }, 200, {
			"Set-Cookie": cookieHeader(request, rawToken, Math.floor(SESSION_MS / 1000)),
		});
	}

	/** Returns only public identity information, never a password hash or session token. */
	/** @param {Request} request */
	async getAccount(request) {
		const token = getCookieToken(request);
		if (!token) return null;
		const db = await this.#db();
		const session = await db.get(["gridwar", "session", await hashSession(token)]);
		const identity = /** @type {{username: string}?} */ (session.value);
		if (!identity?.username) return null;
		return { username: identity.username };
	}

	/** An origin/JSON request check to guard the cookie-based write endpoints. */
	/** @param {Request} request */
	#isSafeWriteRequest(request) {
		if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
		const origin = request.headers.get("origin");
		if (!origin) return false;
		try {
			const publicOrigin = Deno.env.get("GRIDWAR_PUBLIC_ORIGIN") || new URL(request.url).origin;
			return new URL(origin).origin == new URL(publicOrigin).origin;
		} catch {
			return false;
		}
	}

	/**
	 * HTTP API for /api/account/{me,register,login,logout}.
	 * @param {Request} request
	 * @param {string} ip
	 * @returns {Promise<Response?>}
	 */
	async handleRequest(request, ip = "unknown") {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/account/")) return null;
		const action = url.pathname.slice("/api/account/".length);
		if (action == "me" && request.method == "GET") {
			const account = await this.getAccount(request);
			return json(account ? { authenticated: true, ...account } : { authenticated: false });
		}
		if (!["register", "login", "logout"].includes(action) || request.method != "POST") {
			return json({ error: "Not found" }, 404);
		}
		if (!this.#isSafeWriteRequest(request)) {
			return json({ error: "Invalid request origin or content type" }, 403);
		}
		if (action == "logout") {
			const token = getCookieToken(request);
			if (token) {
				const db = await this.#db();
				await db.delete(["gridwar", "session", await hashSession(token)]);
			}
			return json({ authenticated: false }, 200, {
				"Set-Cookie": cookieHeader(request, "", 0),
			});
		}
		if (this.#rateLimit(ip)) return json({ error: "Too many attempts. Try again later." }, 429);

		const bodyText = await request.text();
		if (bodyText.length > 1024) return json({ error: "Request too large." }, 413);
		/** @type {{username?: unknown, password?: unknown} | null} */
		let credentials;
		try {
			credentials = JSON.parse(bodyText);
		} catch {
			return json({ error: "Invalid JSON" }, 400);
		}
		const username = credentials?.username;
		const password = credentials?.password;
		if (typeof username != "string" || !isValidUsername(username)) {
			return json({ error: "Username must contain 3–20 letters, numbers or underscores." }, 400);
		}
		if (typeof password != "string") return json({ error: loginError }, 401);
		const nameKey = normalizeUsername(username);
		const db = await this.#db();
		const userKey = ["gridwar", "user", nameKey];
		if (action == "register") {
			if (!isValidPassword(password)) {
				return json({ error: "Use a password of at least 12 characters (maximum 128)." }, 400);
			}
			const salt = crypto.getRandomValues(new Uint8Array(16));
			const verifier = await derivePassword(password, salt);
			const result = await db.atomic()
				.check({ key: userKey, versionstamp: null })
				.set(userKey, {
					username: username.trim(),
					salt: Array.from(salt),
					verifier: Array.from(verifier),
					createdAt: Date.now(),
				}).commit();
			if (!result.ok) return json({ error: "Username already taken." }, 409);
			return this.#createSession(db, request, username.trim());
		}
		const record = await db.get(userKey);
		// Use a dummy verifier to reduce account-existence timing differences.
		const user = /** @type {AccountRecord?} */ (record.value);
		const salt = new Uint8Array(user?.salt || new Array(16).fill(0));
		const expected = new Uint8Array(user?.verifier || new Array(32).fill(0));
		const actual = await derivePassword(password, salt);
		if (!user || !constantTimeEqual(actual, expected)) return json({ error: loginError }, 401);
		return this.#createSession(db, request, user.username);
	}
}
