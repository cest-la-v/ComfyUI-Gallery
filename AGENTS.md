# AGENTS.md

## Project Overview

ComfyUI-Gallery is a ComfyUI custom node that adds a real-time image gallery to the ComfyUI
interface. It has two layers:

- **Python backend** — `aiohttp` route handlers, `watchdog`-based file monitor, and PNG metadata
  extraction, loaded directly by ComfyUI at startup.
- **React SPA** — TypeScript + Vite + Ant Design 5 frontend, compiled to a single JS bundle
  (`web/dist/assets/comfy-ui-gallery.js`) that ComfyUI serves as a static file. Built with
  **Bun** (package manager + bundler); Vite is kept only for the `build:vite` fallback script.

The repo lives inside the monorepo at `comfyui-monorepo/ComfyUI-Gallery/` alongside
`ComfyUI` and `ComfyUI_frontend`.

---

## Setup

### Python backend

```bash
pip install -r requirements.txt    # watchdog, Pillow
```

No separate server to start — ComfyUI loads `__init__.py` automatically when the node is placed
in `ComfyUI/custom_nodes/`.

### Frontend

```bash
cd web
bun install
```

---

## Development Workflow

### Build the frontend

```bash
cd web
bun run build      # tsc -b && bun build (Bun native bundler, ~260 ms)
# fallback: bun run build:vite   # uses Vite/Rollup — smaller bundle but slower
```

**You must rebuild and commit `web/dist/assets/comfy-ui-gallery.js` after every frontend change.**
ComfyUI loads the pre-built bundle directly; there is no hot-reload in production mode.

### Dev server (optional, for isolated UI work)

```bash
cd web
bun run dev        # Bun.serve() with HMR on localhost:5173 — not connected to ComfyUI backend
```

### Lint

```bash
cd web
bun run lint       # ESLint with typescript-eslint + react-hooks rules
```

---

## Testing

There is no test runner. Type checking via `tsc -b` (run as part of `bun run build`) is the
primary correctness gate.

```bash
cd web
bun run build      # catches all TypeScript errors
```

---

## Code Style

- **TypeScript strict mode** — `"strict": true` in `tsconfig.app.json`. `noUnusedLocals` and
  `noUnusedParameters` are currently disabled but should be respected in new code.
- **No `print()` in Python** — use `gallery_log()` from `gallery_config.py`.
- **Types first** — all shared TypeScript types live in `web/src/types.ts`. Add new fields there
  before using them elsewhere.
- **`metadataParser.ts` is the only public metadata API** — UI components call
  `parseComfyMetadata()` only; sub-parsers are internal implementation details.
- **React + Ant Design 5** — use `antd` components; icons from `@ant-design/icons`.

---

## Architecture: Metadata Extraction Pipeline

Metadata is extracted in four passes (first non-null value wins per field):

1. **`extractByA1111`** — reads `metadata.parameters` (A1111-format PNG text chunk).
2. **`extractByPrompt`** — parses `metadata.prompt` (ComfyUI node graph JSON). Uses a 3-pass
   BFS: known class-type fast path → hub-first BFS → global scored BFS.
3. **`extractByWorkflow`** — same idea using `metadata.workflow` JSON (fallback).
4. **`extractPlaceholders`** — fills remaining fields with `null`.

**Source toggle** in `MetadataView.tsx`: `'auto' | 'civitai' | 'comfyui'`, passed to
`parseComfyMetadata(metadata, source)`.

### `prompt` JSON link format

Node IDs are **strings** (e.g. `"733"`, or `"752:753"` for subgraph-internal nodes).
Links in inputs appear as `[nodeId: string, outputIndex: number]` — use `isLink(v)` from
`promptMetadataParser.ts` to detect them.

### `workflow` JSON link format

Node IDs are **integers**. `inp.link` is a numeric link ID; resolve via `buildWorkflowLinkMap()`.

### A1111 sampler + scheduler

A1111 writes one combined field: `Sampler: DPM++ 3M SDE Karras`.
`splitA1111SamplerScheduler()` in `a1111MetadataParser.ts` splits these using `SCHEDULER_SUFFIX_MAP`
(multi-word suffixes are checked before single-word).

---

## Key Files

| File | Purpose |
|---|---|
| `__init__.py` | Python entry point; sets `WEB_DIRECTORY = "./web/dist/assets"` |
| `server.py` | All aiohttp route handlers (`/gallery/images`, `/gallery/move`, etc.) |
| `folder_monitor.py` | `watchdog`-based file watcher; emits `gallery_image_added` events |
| `folder_scanner.py` | Recursive scan for images/video/audio by extension |
| `metadata_extractor.py` | Reads PNG text chunks (`parameters`, `prompt`, `workflow`) |
| `gallery_node.py` | ComfyUI node declaration |
| `gallery_config.py` | `disable_logs` flag + `gallery_log()` |
| `user_settings.json` | Persisted user settings (read/written at runtime) |
| `web/src/types.ts` | All shared TypeScript types |
| `web/src/metadata-parser/metadataParser.ts` | Orchestrates extraction passes |
| `web/src/MetadataView.tsx` | Metadata panel UI + source toggle |
| `web/dist/assets/comfy-ui-gallery.js` | **Committed build artefact — must be rebuilt on change** |

---

## Common Gotchas

- **Rebuild the bundle.** The most common mistake — frontend changes have no effect until
  `bun run build` is run in `web/` and the new `comfy-ui-gallery.js` is committed.
- **String vs integer node IDs.** `prompt` JSON uses string IDs; `workflow` JSON uses integers.
  Mixing them up causes silent lookup failures.
- **Compound node IDs** like `"752:753"` (subgraph-internal nodes) only appear in `prompt` JSON,
  never in `workflow` JSON. The BFS in `promptMetadataParser.ts` handles them transparently.
- **Bundle output path.** The bundle is at `web/dist/assets/` (configured in both `vite.config.ts`
  and the `bun build` flags in `package.json`). `WEB_DIRECTORY` in `__init__.py` must match exactly.
- **`set_generation_metadata()` API** (ComfyUI side). If working on the ComfyUI repo companion
  changes, this must be called from inside a node's `execute()` while the generation context is
  active. See `ComfyUI/comfy_execution/generation_context.py`.

---

## Pull Request Guidelines

- Run `bun run build` in `web/` before every commit touching frontend files — commit the rebuilt
  `comfy-ui-gallery.js` in the same PR.
- Run `bun run lint` and ensure no new ESLint errors.
- Commit message trailer:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
