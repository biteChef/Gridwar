import { makeAdminPasswordHash } from "../serverManager/src/AdminAuthService.js";

// Use a temporary environment variable set from an interactive shell read.
// Never pass the admin password as a CLI argument (shell history/process list).
const password = Deno.env.get("GRIDWAR_ADMIN_PASSWORD");
if (!password) {
	console.error("Set GRIDWAR_ADMIN_PASSWORD in your environment before running this script.");
	Deno.exit(1);
}
try {
	const hash = await makeAdminPasswordHash(password);
	console.log("GRIDWAR_ADMIN_PASSWORD_HASH=" + hash);
} catch (error) {
	console.error(error instanceof Error ? error.message : "Failed to hash admin password");
	Deno.exit(1);
}
