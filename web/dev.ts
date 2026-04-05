// @ts-nocheck — run with `bun run dev.ts`; Bun's built-in types are not in tsconfig.app.json
import index from "./index.html";

const BACKEND = "http://127.0.0.1:8188";

/** Proxy a request path to the standalone Python backend. */
function proxyTo(req: Request, base: string): Promise<Response> {
  const url = new URL(req.url);
  const target = base + url.pathname + url.search;
  return fetch(target, {
    method: req.method,
    headers: req.headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  });
}

Bun.serve({
  routes: {
    "/": index,
    // Mock API used by dev UI (falls back to static JSON when backend is offline)
    "/api.json": () => new Response(Bun.file("./public/api.json"), {
      headers: { "Content-Type": "application/json" },
    }),
    // Proxy gallery API and static images to the standalone Python backend
    "/Gallery/*": (req) => proxyTo(req, BACKEND),
    "/static_gallery/*": (req) => proxyTo(req, BACKEND),
  },
  development: {
    hmr: true,
    console: true,
  },
  port: 5173,
});

console.log("ComfyUI Gallery dev server running at http://localhost:5173");
console.log(`  API proxy: /Gallery/* → ${BACKEND}`);
console.log(`  Start backend: python standalone.py  (from ComfyUI-Gallery/)`);
