import { resolve } from "$std/path/mod.ts";
import { buildExecutable } from "../shared/buildExecutable.js";
import { setCwd } from "chdir-anywhere";
setCwd();
Deno.chdir("..");

await buildExecutable({
	outputDir: resolve("gameServer/out"),
	outputFileName: "splixGameServer",
	entryPoint: resolve("gameServer/src/mainInstance.js"),
	permissionFlags: [
		"--allow-net",
		"--allow-read",
		"--allow-write", // Deno KV persists accounts locally
		"--allow-env", // optional GRIDWAR_KV_PATH
		"--unstable-kv",
	],
	include: [
		resolve("gameServer/src/gameplay/arenaWorker/mod.js"),
	],
});
