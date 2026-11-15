/**
 * Basic wrapper around the Deno apis used for hosting a websocket.
 * This takes care of all of the error handling in case of network errors.
 */
export class WebSocketHoster {
	#onConnectionCb;
	#overrideRequestHandler;
	#resolveAccount;

	/**
	 * @param {(socket: WebSocket, ip: string, account: {username: string}? ) => void} onConnection A callback that fires when a new connection
	 * is opened. The websocket passed as argument is guaranteed to be open.
	 * @param {Object} options
	 * @param {(req: Request, ip: string) => Promise<Response?>} [options.overrideRequestHandler] A callback that allows you to override requests. When the callback
	 * returns a value it will be used as response instead of creating a new connection to the websocket.
	 * For more complex situations you should probably use "std/http/mod.ts" instead of this.
	 */
	constructor(onConnection, { overrideRequestHandler, resolveAccount } = {}) {
		this.#onConnectionCb = onConnection;
		this.#overrideRequestHandler = overrideRequestHandler;
		this.#resolveAccount = resolveAccount;
	}

	/**
	 * @param {number} port
	 * @param {string} hostname
	 */
	async startServer(port, hostname) {
		Deno.serve({
			port,
			hostname,
		}, (request, info) => {
			return this.handleRequest(request, info);
		});
	}

	/**
	 * @param {Request} request
	 * @param {Deno.ServeHandlerInfo<Deno.NetAddr>} info
	 */
	async handleRequest(request, { remoteAddr }) {
		const ip = remoteAddr?.transport == "tcp" ? remoteAddr.hostname : "unknown";
		if (this.#overrideRequestHandler) {
			const response = await this.#overrideRequestHandler(request, ip);
			if (response) return response;
		}
		if (request.method != "GET") {
			return new Response("Endpoint is a websocket", {
				status: 405,
			});
		}
		if (request.headers.get("upgrade") != "websocket") {
			return new Response("Endpoint is a websocket", {
				status: 426,
				headers: {
					upgrade: "websocket",
				},
			});
		}
		// Do not trust client-provided X-Real-IP for authentication rate limits.
		let account = null;
		if (this.#resolveAccount) {
			try {
				account = await this.#resolveAccount(request);
			} catch (error) {
				console.warn("Could not resolve optional account session", error);
			}
		}
		const { socket, response } = Deno.upgradeWebSocket(request);
		socket.addEventListener("open", () => {
			this.#onConnectionCb(socket, ip, account);
		});
		return response;
	}
}
