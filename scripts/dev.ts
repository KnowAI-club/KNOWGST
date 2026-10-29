import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createApi } from "../apps/api/src/server.js";
import { Store } from "../apps/api/src/store.js";

const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, ".local"), { recursive: true, mode: 0o700 });
const store = new Store(
  process.env.KNOWGST_DB ?? resolve(root, ".local/knowgst.sqlite"),
);
const secret = randomBytes(32).toString("hex");
const api = createApi(store, secret);
await api.listen({ host: "127.0.0.1", port: 0 });
const address = api.server.address();
if (!address || typeof address === "string")
  throw new Error("API listener unavailable");
const web = await createServer({
  root: resolve(root, "apps/web"),
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${address.port}`,
        headers: { "x-knowgst-key": secret },
      },
    },
  },
  plugins: [
    {
      name: "local-origin-guard",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/api")) return next();
          const origin = req.headers.origin;
          const host = req.headers.host;
          if (
            host !== "127.0.0.1:4173" ||
            (origin && origin !== "http://127.0.0.1:4173") ||
            req.headers["sec-fetch-site"] === "cross-site"
          ) {
            res.statusCode = 403;
            res.end("Origin not allowed");
            return;
          }
          next();
        });
      },
    },
  ],
});
await web.listen();
console.log("KNOWGST development workspace: http://127.0.0.1:4173");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await web.close();
  await api.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
