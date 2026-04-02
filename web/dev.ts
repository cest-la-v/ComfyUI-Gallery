// @ts-nocheck — run with `bun run dev.ts`; Bun's built-in types are not in tsconfig.app.json
import index from "./index.html";

Bun.serve({
  routes: {
    "/": index,
    // Serve the mock API used by the dev UI (proxied from public/)
    "/api.json": () => new Response(Bun.file("./public/api.json"), {
      headers: { "Content-Type": "application/json" },
    }),
  },
  development: {
    hmr: true,
    console: true,
  },
  port: 5173,
});

console.log("ComfyUI Gallery dev server running at http://localhost:5173");
