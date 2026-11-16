import { AdminAuthService, isSafeAdminWrite } from "./AdminAuthService.js";

/** @param {unknown} data @param {number} status @param {Record<string, string>} headers */
function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
			...headers,
		},
	});
}

/** @param {unknown} value */
export function validateServerConfig(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const data = /** @type {Record<string, unknown>} */ (value);
	for (const flag of ["public", "official", "recommended", "needsControlSocket"]) {
		if (typeof data[flag] !== "boolean") return null;
	}
	if (typeof data.displayName !== "string" || typeof data.endpoint !== "string") return null;
	const displayName = data.displayName.trim();
	const endpoint = data.endpoint.trim();
	if (!displayName || displayName.length > 64 || endpoint.length > 512) return null;
	try {
		const url = new URL(endpoint);
		if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
		if (url.username || url.password || url.hash || !url.hostname) return null;
	} catch {
		return null;
	}
	return {
		public: data.public,
		official: data.official,
		recommended: data.recommended,
		needsControlSocket: data.needsControlSocket,
		displayName,
		endpoint,
	};
}

/** @param {Request} request */
async function jsonBody(request) {
	if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
	const length = Number(request.headers.get("content-length") || 0);
	if (length > 4096) return null;
	try {
		const raw = await request.text();
		if (raw.length > 4096) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export class AdminApiService {
	/** @type {import("./Main.js").Main} */
	#main;
	/** @type {AdminAuthService} */
	#auth;

	/** @param {import("./Main.js").Main} main */
	constructor(main) {
		this.#main = main;
		this.#auth = new AdminAuthService();
	}

	/** @returns {ReturnType<import("./ServerManager.js").ServerManager["getAdminServers"]>} */
	#getServers() {
		return this.#main.servermanager.getAdminServers();
	}

	#getOverview() {
		const servers = this.#getServers();
		const monitored = servers.filter((server) => server.status === "online");
		return {
			registeredServers: servers.length,
			onlineServers: monitored.length,
			offlineServers: servers.filter((server) => server.status === "offline").length,
			unmonitoredServers: servers.filter((server) => server.status === "unmonitored").length,
			joinableServers: servers.filter((server) => server.joinable).length,
			trackedPlayers: monitored.reduce((sum, server) => sum + (server.playerCount || 0), 0),
			playerCountNote: "Only online, monitored game-server instances report player counts.",
			sampledAt: Date.now(),
			servers,
		};
	}

	/**
	 * @param {Request} request
	 * @param {string} ip
	 * @returns {Promise<Response>}
	 */
	async handleRequest(request, ip = "unknown") {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/admin/")) return json({ error: "Not found" }, 404);
		const path = url.pathname.slice("/api/admin/".length);
		if (path === "me" && request.method === "GET") {
			if (!this.#auth.configured) return json({ authenticated: false, configured: false });
			const identity = await this.#auth.getSession(request);
			return json(identity ? { authenticated: true, configured: true, ...identity } : {
				authenticated: false,
				configured: true,
			});
		}
		if (!this.#auth.configured) return json({ error: "Admin credentials are not configured" }, 503);
		if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
			return json({ error: "Method not allowed" }, 405);
		}
		// All state-changing requests must originate from the admin's own site.
		if (request.method !== "GET" && !isSafeAdminWrite(request)) {
			return json({ error: "Invalid request origin" }, 403);
		}
		if (path === "login" && request.method === "POST") {
			if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
				return json({ error: "Expected application/json" }, 415);
			}
			const outcome = await this.#auth.login(request, ip);
			return json(outcome.data || { error: outcome.error }, outcome.status, outcome.headers || {});
		}
		const identity = await this.#auth.getSession(request);
		if (!identity) return json({ error: "Sign in required" }, 401);

		if (path === "logout" && request.method === "POST") {
			const result = await this.#auth.logout(request);
			return json(result.data, result.status, result.headers);
		}
		if (path === "overview" && request.method === "GET") {
			return json(this.#getOverview());
		}
		if (path === "servers" && request.method === "GET") {
			return json({ servers: this.#getServers() });
		}
		if (path === "audit" && request.method === "GET") {
			return json({ entries: await this.#auth.recentAudit() });
		}
		if (path === "servers" && request.method === "POST") {
			const id = this.#main.servermanager.createGameServer();
			await this.#auth.recordAudit(identity.username, "server.create", "Created server #" + id);
			return json({ id, servers: this.#getServers() }, 201);
		}

		const match = /^servers\/(\d+)$/.exec(path);
		if (match && (request.method === "PUT" || request.method === "DELETE")) {
			const id = Number(match[1]);
			if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Invalid server ID" }, 400);
			const exists = this.#main.servermanager.getServerConfigs().some((row) => row.id === id);
			if (!exists) return json({ error: "Unknown game server" }, 404);
			if (request.method === "DELETE") {
				this.#main.servermanager.deleteGameServer(id);
				await this.#auth.recordAudit(identity.username, "server.delete", "Deleted server #" + id);
				return json({ ok: true });
			}
			const parsed = await jsonBody(request);
			const config = validateServerConfig(parsed);
			if (!config) return json({ error: "Invalid server configuration" }, 400);
			this.#main.servermanager.setGameServerConfig(id, config);
			await this.#auth.recordAudit(identity.username, "server.update", "Updated server #" + id);
			return json({ ok: true });
		}
		return json({ error: "Not found" }, 404);
	}
}
