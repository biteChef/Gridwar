/**
 * Gridwar Admin v1 — intentionally dependency-light, using same-origin
 * authenticated JSON APIs. All dynamic server data is rendered as text.
 * No management token is ever fetched or stored by the browser.
 */
const byId = (id) => document.getElementById(id);
const state = {
	identity: null,
	overview: null,
	view: "overview",
	editingServerId: null,
	busy: false,
};

async function api(path, options = {}) {
	const method = options.method || "GET";
	const headers = method === "GET" ? {} : { "Content-Type": "application/json" };
	const response = await fetch("/api/admin/" + path, {
		method,
		credentials: "same-origin",
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		cache: "no-store",
	});
	let data;
	try {
		data = await response.json();
	} catch {
		data = {};
	}
	if (!response.ok) {
		const error = new Error(data.error || "Request failed (" + response.status + ")");
		// @ts-ignore Custom property for API error handling.
		error.status = response.status;
		throw error;
	}
	return data;
}

function showError(message) {
	const box = byId("globalError");
	box.textContent = message;
	box.hidden = !message;
}

function renderSignedOut(configured = true) {
	state.identity = null;
	state.overview = null;
	byId("dashboardApp").hidden = true;
	byId("authScreen").hidden = false;
	byId("setupNotice").hidden = configured;
	byId("loginForm").hidden = !configured;
	byId("adminPassword").value = "";
}

function renderSignedIn(identity) {
	state.identity = identity;
	byId("authScreen").hidden = true;
	byId("dashboardApp").hidden = false;
	byId("sidebarUsername").textContent = identity.username;
	navigate("overview");
}

function navigate(view) {
	state.view = view;
	for (const page of ["overview", "servers", "audit"]) {
		const active = view === page;
		byId("page" + page[0].toUpperCase() + page.slice(1)).hidden = !active;
		const button = document.querySelector('[data-page="' + page + '"]');
		button?.classList.toggle("active", active);
		if (button) button.setAttribute("aria-current", active ? "page" : "false");
	}
	if (view === "audit") refreshAudit();
	else if (view === "servers" && !state.overview) refreshOverview();
}

function appendCell(row, text, className = "") {
	const cell = document.createElement("td");
	cell.textContent = String(text);
	if (className) cell.className = className;
	row.appendChild(cell);
	return cell;
}

function statusPill(status) {
	const badge = document.createElement("span");
	badge.className = "status-chip " + (status === "offline" || status === "unmonitored" ? status : "");
	badge.textContent = status;
	return badge;
}

function emptyTable(body, columns, message) {
	const row = document.createElement("tr");
	const cell = document.createElement("td");
	cell.colSpan = columns;
	cell.className = "empty-row";
	cell.textContent = message;
	row.appendChild(cell);
	body.replaceChildren(row);
}

function renderOverview(data) {
	state.overview = data;
	byId("metricPlayers").textContent = data.trackedPlayers.toLocaleString();
	byId("metricServers").textContent = data.registeredServers.toLocaleString();
	byId("metricOnline").textContent = data.onlineServers.toLocaleString();
	byId("metricJoinable").textContent = data.joinableServers.toLocaleString();
	byId("summaryOnline").textContent = data.onlineServers.toLocaleString();
	byId("summaryOffline").textContent = data.offlineServers.toLocaleString();
	byId("summaryUnmonitored").textContent = data.unmonitoredServers.toLocaleString();
	byId("lastUpdated").textContent = "Updated " + new Date(data.sampledAt).toLocaleTimeString();

	const summary = byId("overviewServerRows");
	summary.replaceChildren();
	for (const server of data.servers) {
		const row = document.createElement("tr");
		appendCell(row, server.config.displayName || "Unnamed server", "server-name");
		appendCell(row, "").appendChild(statusPill(server.status));
		appendCell(row, server.playerCount === null ? "—" : server.playerCount);
		appendCell(row, server.joinable ? "Yes" : "No");
		summary.appendChild(row);
	}
	if (!data.servers.length) emptyTable(summary, 4, "No servers registered yet. Add one from Game servers.");

	const rows = byId("serverRows");
	rows.replaceChildren();
	for (const server of data.servers) {
		const row = document.createElement("tr");
		const nameCell = appendCell(row, "");
		const serverName = document.createElement("span");
		serverName.className = "server-name";
		serverName.textContent = server.config.displayName || "Unnamed server";
		nameCell.appendChild(serverName);
		const endpointCell = appendCell(row, "", "server-endpoint");
		endpointCell.textContent = server.config.endpoint || "No endpoint configured";
		appendCell(row, "").appendChild(statusPill(server.status));
		appendCell(row, server.playerCount === null ? "—" : server.playerCount);
		const actions = appendCell(row, "");
		const group = document.createElement("div");
		group.className = "row-actions";
		const edit = document.createElement("button");
		edit.className = "button secondary";
		edit.type = "button";
		edit.textContent = "Edit";
		edit.addEventListener("click", () => openServerDialog(server));
		const remove = document.createElement("button");
		remove.className = "button danger";
		remove.type = "button";
		remove.textContent = "Delete";
		remove.addEventListener("click", () => deleteServer(server));
		group.append(edit, remove);
		actions.append(group);
		rows.append(row);
	}
	if (!data.servers.length) emptyTable(rows, 5, "No game-server endpoints are configured.");
}

async function refreshOverview() {
	if (!state.identity || state.busy) return;
	try {
		const overview = await api("overview");
		renderOverview(overview);
		showError("");
	} catch (error) {
		if (/** @type {any} */ (error).status === 401) return renderSignedOut();
		showError(error.message);
	}
}

async function refreshAudit() {
	if (!state.identity) return;
	try {
		const data = await api("audit");
		const table = byId("auditRows");
		table.replaceChildren();
		for (const event of data.entries) {
			const row = document.createElement("tr");
			appendCell(row, new Date(event.at).toLocaleString());
			appendCell(row, event.actor);
			appendCell(row, event.action);
			appendCell(row, event.summary);
			table.appendChild(row);
		}
		if (!data.entries.length) emptyTable(table, 4, "No activity recorded.");
	} catch (error) {
		if (/** @type {any} */ (error).status === 401) return renderSignedOut();
		showError(error.message);
	}
}

function openServerDialog(server) {
	state.editingServerId = server.id;
	byId("serverDialogTitle").textContent = "Edit " + (server.config.displayName || "server #" + server.id);
	byId("serverName").value = server.config.displayName;
	byId("serverEndpoint").value = server.config.endpoint;
	byId("serverPublic").checked = server.config.public;
	byId("serverOfficial").checked = server.config.official;
	byId("serverRecommended").checked = server.config.recommended;
	byId("serverMonitor").checked = server.config.needsControlSocket;
	byId("serverFormError").hidden = true;
	byId("serverDialog").showModal();
}

async function deleteServer(server) {
	if (!confirm("Delete registration for " + (server.config.displayName || "server #" + server.id) +
		"? The game-server process itself will not be stopped.")) return;
	try {
		await api("servers/" + server.id, { method: "DELETE" });
		await refreshOverview();
		if (state.view === "audit") await refreshAudit();
	} catch (error) {
		showError(error.message);
	}
}

async function onSaveServer(event) {
	event.preventDefault();
	if (state.busy || state.editingServerId === null) return;
	const errorBox = byId("serverFormError");
	const config = {
		displayName: byId("serverName").value.trim(),
		endpoint: byId("serverEndpoint").value.trim(),
		public: byId("serverPublic").checked,
		official: byId("serverOfficial").checked,
		recommended: byId("serverRecommended").checked,
		needsControlSocket: byId("serverMonitor").checked,
	};
	state.busy = true;
	byId("saveServerButton").disabled = true;
	try {
		await api("servers/" + state.editingServerId, { method: "PUT", body: config });
		byId("serverDialog").close();
		await refreshOverview();
	} catch (error) {
		errorBox.hidden = false;
		errorBox.textContent = error.message;
	} finally {
		state.busy = false;
		byId("saveServerButton").disabled = false;
	}
}

async function onAddServer() {
	if (state.busy) return;
	state.busy = true;
	try {
		const created = await api("servers", { method: "POST", body: {} });
		const overview = await api("overview");
		renderOverview(overview);
		const server = overview.servers.find((item) => item.id === created.id);
		if (server) openServerDialog(server);
		showError("");
	} catch (error) {
		showError(error.message);
	} finally {
		state.busy = false;
	}
}

async function onLogin(event) {
	event.preventDefault();
	byId("loginError").hidden = true;
	byId("loginSubmit").disabled = true;
	try {
		const identity = await api("login", {
			method: "POST",
			body: {
				username: byId("adminUsername").value,
				password: byId("adminPassword").value,
			},
		});
		renderSignedIn(identity);
		await refreshOverview();
	} catch (error) {
		byId("loginError").textContent = error.message;
		byId("loginError").hidden = false;
	} finally {
		byId("adminPassword").value = "";
		byId("loginSubmit").disabled = false;
	}
}

async function onLogout() {
	try {
		await api("logout", { method: "POST", body: {} });
	} catch (error) {
		showError(error.message);
	}
	renderSignedOut();
}

async function init() {
	byId("loginForm").addEventListener("submit", onLogin);
	byId("logoutButton").addEventListener("click", onLogout);
	byId("refreshButton").addEventListener("click", async () => {
		await refreshOverview();
		if (state.view === "audit") await refreshAudit();
	});
	document.querySelectorAll("[data-page]").forEach((button) => {
		button.addEventListener("click", () => navigate(button.dataset.page));
	});
	document.querySelectorAll("[data-go]").forEach((button) => {
		button.addEventListener("click", () => navigate(button.dataset.go));
	});
	byId("addServerButton").addEventListener("click", onAddServer);
	byId("serverForm").addEventListener("submit", onSaveServer);
	byId("closeServerDialog").addEventListener("click", () => byId("serverDialog").close());
	byId("cancelServerDialog").addEventListener("click", () => byId("serverDialog").close());
	try {
		const identity = await api("me");
		if (identity.authenticated) {
			renderSignedIn(identity);
			await refreshOverview();
		} else {
			renderSignedOut(identity.configured);
		}
	} catch (error) {
		renderSignedOut();
		byId("loginError").hidden = false;
		byId("loginError").textContent = "Could not connect to the admin API: " + error.message;
	}
	setInterval(() => {
		if (state.identity && !document.hidden) refreshOverview();
	}, 10_000);
}
init();
