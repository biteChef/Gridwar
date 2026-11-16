import assert from "node:assert/strict";
import {
	AdminAuthService,
	isSafeAdminWrite,
	makeAdminPasswordHash,
	parseAdminPasswordHash,
	verifyAdminPassword,
} from "../serverManager/src/AdminAuthService.js";
import { AdminApiService, validateServerConfig } from "../serverManager/src/AdminApiService.js";

Deno.test("password verifiers use salted PBKDF2 and reject incorrect passwords", async () => {
	const hash1 = await makeAdminPasswordHash("A secure testing password with length 32");
	const hash2 = await makeAdminPasswordHash("A secure testing password with length 32");
	assert.notEqual(hash1, hash2, "independent random salt per credential");
	assert.ok(parseAdminPasswordHash(hash1));
	assert.equal(await verifyAdminPassword("A secure testing password with length 32", hash1), true);
	assert.equal(await verifyAdminPassword("not the password", hash1), false);
	assert.equal(parseAdminPasswordHash("not-a-hash"), null);
	await assert.rejects(() => makeAdminPasswordHash("short"));
});

Deno.test("server settings require an actual WebSocket endpoint and explicit flags", () => {
	const valid = {
		displayName: " US East #1 ",
		endpoint: "wss://example.net/ws",
		public: true,
		official: false,
		recommended: true,
		needsControlSocket: true,
	};
	assert.deepEqual(validateServerConfig(valid), { ...valid, displayName: "US East #1" });
	assert.equal(validateServerConfig({ ...valid, endpoint: "https://example.net/" }), null);
	assert.equal(validateServerConfig({ ...valid, endpoint: "javascript:alert(1)" }), null);
	assert.equal(validateServerConfig({ ...valid, endpoint: "wss://user:pass@example.net" }), null);
	assert.equal(validateServerConfig({ ...valid, public: "yes" }), null);
	assert.equal(validateServerConfig({ ...valid, displayName: "" }), null);
	assert.equal(validateServerConfig(null), null);
});

Deno.test("admin writes need a matching Origin header", () => {
	const url = "http://localhost:8080/api/admin/servers";
	assert.equal(isSafeAdminWrite(new Request(url, { method: "POST", headers: { origin: "http://localhost:8080" } })), true);
	assert.equal(isSafeAdminWrite(new Request(url, { method: "POST" })), false);
	assert.equal(isSafeAdminWrite(new Request(url, { method: "POST", headers: { origin: "https://evil.example" } })), false);
});

Deno.test("admin API requires login, logs server changes, and revokes logout sessions", async () => {
	const settings = ["GRIDWAR_ADMIN_USERNAME", "GRIDWAR_ADMIN_PASSWORD_HASH", "GRIDWAR_ADMIN_KV_PATH"];
	const previous = Object.fromEntries(settings.map((key) => [key, Deno.env.get(key)]));
	const adminDir = await Deno.makeTempDir({ prefix: "gridwar-admin-test-" });
	const username = "admin_test";
	const password = "A long password for the admin dashboard!";
	Deno.env.set("GRIDWAR_ADMIN_USERNAME", username);
	Deno.env.set("GRIDWAR_ADMIN_PASSWORD_HASH", await makeAdminPasswordHash(password));
	Deno.env.set("GRIDWAR_ADMIN_KV_PATH", adminDir + "/admin.kv");
	try {
		const servers = [{
			id: 1,
			config: {
				displayName: "US Test",
				endpoint: "ws://127.0.0.1:8080/gameserver",
				public: true,
				official: true,
				recommended: false,
				needsControlSocket: true,
			},
			playerCount: 18,
			status: "online",
			joinable: true,
		}, {
			id: 2,
			config: {
				displayName: "Europe Test",
				endpoint: "wss://example.test/game",
				public: false,
				official: false,
				recommended: false,
				needsControlSocket: false,
			},
			playerCount: null,
			status: "unmonitored",
			joinable: false,
		}];
		const servermanager = {
			getAdminServers: () => servers,
			getServerConfigs: () => servers.map(({ id, config }) => ({ id, config })),
			createGameServer() {
				const id = 3;
				servers.push({ id, config: { ...servers[1].config, displayName: "" }, playerCount: null, status: "offline", joinable: false });
				return id;
			},
			deleteGameServer(id) { servers.splice(servers.findIndex((server) => server.id === id), 1); },
			setGameServerConfig(id, config) { servers.find((server) => server.id === id).config = config; },
		};
		const api = new AdminApiService(/** @type {any} */ ({ servermanager }));
		const base = "http://localhost:8080/api/admin/";
		const req = (path, method = "GET", body, cookie = "", origin = "http://localhost:8080") =>
			new Request(base + path, {
				method,
				headers: {
					...(cookie ? { Cookie: cookie } : {}),
					...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
		assert.equal((await api.handleRequest(req("overview"))).status, 401);
		assert.equal((await api.handleRequest(req("servers", "POST", {}, "", "https://evil.example"))).status, 403);
		assert.equal((await api.handleRequest(req("login", "POST", { username, password: "wrong" }))).status, 401);
		const response = await api.handleRequest(req("login", "POST", { username, password }));
		assert.equal(response.status, 200);
		const cookie = response.headers.get("set-cookie").split(";")[0];
		assert.match(response.headers.get("set-cookie"), /HttpOnly/);
		assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
		const overviewResp = await api.handleRequest(req("overview", "GET", undefined, cookie));
		const overview = await overviewResp.json();
		assert.equal(overview.trackedPlayers, 18);
		assert.equal(overview.unmonitoredServers, 1);
		assert.equal(overview.registeredServers, 2);
		assert.equal((await api.handleRequest(req("servers", "POST", {
			displayName: "New Arena",
			endpoint: "wss://example.test/new",
			public: false,
			official: false,
			recommended: false,
			needsControlSocket: true,
		}, cookie))).status, 201);
		assert.equal((await api.handleRequest(req("servers/1", "PUT", {
			...servers[0].config, displayName: "New name",
		}, cookie))).status, 200);
		assert.equal(servers[0].config.displayName, "New name");
		assert.equal((await api.handleRequest(req("servers/2", "DELETE", {}, cookie))).status, 200);
		const audit = await (await api.handleRequest(req("audit", "GET", undefined, cookie))).json();
		assert.ok(audit.entries.some((event) => event.action === "server.create"));
		assert.ok(audit.entries.some((event) => event.action === "server.update"));
		assert.ok(audit.entries.some((event) => event.action === "server.delete"));
		const logout = await api.handleRequest(req("logout", "POST", {}, cookie));
		assert.equal(logout.status, 200);
		assert.equal((await api.handleRequest(req("overview", "GET", undefined, cookie))).status, 401);
	} finally {
		for (const key of settings) {
			if (previous[key] === undefined) Deno.env.delete(key);
			else Deno.env.set(key, previous[key]);
		}
		// Do not delete a Deno KV database while its connection is still open.
		// The temporary test directory can be removed after the process exits.
	}
});
