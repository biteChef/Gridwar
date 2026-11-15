import assert from "node:assert/strict";
import { AccountService } from "../gameServer/src/auth/AccountService.js";

Deno.test("guest, registration, login, logout and protected requests", async () => {
	const previousPath = Deno.env.get("GRIDWAR_KV_PATH");
	const tempDir = await Deno.makeTempDir({ prefix: "gridwar-accounts-test-" });
	Deno.env.set("GRIDWAR_KV_PATH", tempDir + "/accounts.kv");
	const account = new AccountService();
	const username = "tester_" + crypto.randomUUID().slice(0, 10).replaceAll("-", "");
	const password = "A_long_test_password_2026!";
	const endpoint = "https://gridwar.test/api/account/";
	const ip = "127.0.0.1";

	function request(action, method = "GET", data = null, cookie = "", origin = "https://gridwar.test") {
		const headers = new Headers();
		if (method == "POST") {
			headers.set("Content-Type", "application/json");
			headers.set("Origin", origin);
		}
		if (cookie) headers.set("Cookie", cookie);
		return new Request(endpoint + action, {
			method,
			headers,
			body: method == "POST" ? JSON.stringify(data || {}) : undefined,
		});
	}

	try {
		const guest = await account.handleRequest(request("me"), ip);
		assert.equal(guest.status, 200);
		assert.deepEqual(await guest.json(), { authenticated: false });

		const forgedOrigin = await account.handleRequest(
			request("register", "POST", { username, password }, "", "https://malicious.test"),
			ip,
		);
		assert.equal(forgedOrigin.status, 403);

		const tooShort = await account.handleRequest(
			request("register", "POST", { username, password: "short" }), ip,
		);
		assert.equal(tooShort.status, 400);

		const registered = await account.handleRequest(
			request("register", "POST", { username, password }), ip,
		);
		assert.equal(registered.status, 200);
		const cookie = registered.headers.get("set-cookie");
		assert.ok(cookie?.includes("HttpOnly"));
		assert.ok(cookie?.includes("SameSite=Strict"));
		assert.ok(cookie?.includes("Secure"));
		const tokenCookie = cookie.split(";")[0];
		const publicAccount = await registered.json();
		assert.deepEqual(publicAccount, { authenticated: true, username });
		assert.equal(JSON.stringify(publicAccount).includes("password"), false);

		const authenticated = await account.handleRequest(request("me", "GET", null, tokenCookie), ip);
		assert.deepEqual(await authenticated.json(), { authenticated: true, username });

		const duplicate = await account.handleRequest(
			request("register", "POST", { username: username.toUpperCase(), password }), ip,
		);
		assert.equal(duplicate.status, 409);

		const invalidPassword = await account.handleRequest(
			request("login", "POST", { username, password: "incorrect_password" }), ip,
		);
		assert.equal(invalidPassword.status, 401);

		const login = await account.handleRequest(
			request("login", "POST", { username, password }), ip,
		);
		assert.equal(login.status, 200);
		assert.equal((await login.json()).authenticated, true);

		const logout = await account.handleRequest(request("logout", "POST", {}, tokenCookie), ip);
		assert.equal(logout.status, 200);
		assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));

		const afterLogout = await account.handleRequest(request("me", "GET", null, tokenCookie), ip);
		assert.deepEqual(await afterLogout.json(), { authenticated: false });
	} finally {
		if (previousPath == null) Deno.env.delete("GRIDWAR_KV_PATH");
		else Deno.env.set("GRIDWAR_KV_PATH", previousPath);
	}
});
