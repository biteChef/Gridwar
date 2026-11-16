/**
 * Optional Gridwar accounts. Guest gameplay is the default and never blocked.
 * Passwords are submitted to same-origin HTTP endpoints; no access tokens are
 * kept in localStorage or exposed to the game.
 */
export async function initAccountUI() {
	const controls = document.getElementById("accountControls");
	if (!controls) return;
	const status = document.getElementById("accountStatus");
	const login = document.getElementById("accountLogin");
	const register = document.getElementById("accountRegister");
	const logout = document.getElementById("accountLogout");
	const dialog = document.getElementById("accountDialog");
	const form = document.getElementById("accountForm");
	const title = document.getElementById("accountDialogHeading");
	const username = document.getElementById("accountUsername");
	const password = document.getElementById("accountPassword");
	const error = document.getElementById("accountError");
	const submit = document.getElementById("accountSubmit");
	const cancel = document.getElementById("accountCancel");
	const nickname = document.getElementById("nameInput");
	let mode = "register";
	let busy = false;

	function render(account) {
		const authenticated = Boolean(account?.authenticated);
		status.textContent = authenticated
			? "Signed in as " + account.username
			: "Playing as a guest — no account needed.";
		login.hidden = authenticated;
		register.hidden = authenticated;
		logout.hidden = !authenticated;
		nickname.readOnly = authenticated;
		if (authenticated) nickname.value = account.username;
	}

	async function request(path, options) {
		const response = await fetch("/api/account/" + path, {
			credentials: "same-origin",
			cache: "no-store",
			...options,
		});
		let data = {};
		try {
			data = await response.json();
		} catch {
			throw new Error("The account server is unavailable.");
		}
		if (!response.ok) throw new Error(data.error || "Account request failed.");
		return data;
	}

	function open(nextMode) {
		mode = nextMode;
		form.reset();
		error.textContent = "";
		title.textContent = mode === "login" ? "Log in" : "Create account";
		submit.textContent = title.textContent;
		password.autocomplete = mode === "login" ? "current-password" : "new-password";
		dialog.showModal();
		username.focus();
	}

	login.addEventListener("click", () => open("login"));
	register.addEventListener("click", () => open("register"));
	cancel.addEventListener("click", () => dialog.close());

	logout.addEventListener("click", async () => {
		if (busy) return;
		busy = true;
		try {
			await request("logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
			render({ authenticated: false });
		} catch (err) {
			status.textContent = err instanceof Error ? err.message : "Couldn't log out.";
		} finally {
			busy = false;
		}
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (busy) return;
		busy = true;
		submit.disabled = true;
		error.textContent = "";
		try {
			const account = await request(mode, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: username.value.trim(), password: password.value }),
			});
			password.value = "";
			dialog.close();
			render(account);
		} catch (err) {
			error.textContent = err instanceof Error ? err.message : "Unable to sign in.";
		} finally {
			busy = false;
			submit.disabled = false;
		}
	});

	// A non-Gridwar server must not prevent a user from joining the game.
	try {
		render(await request("me"));
	} catch {
		render({ authenticated: false });
		login.hidden = true;
		register.hidden = true;
		status.textContent = "Play as guest. Accounts are unavailable on this server.";
	}
}
