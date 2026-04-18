# AGENTS.md

## Project Overview

ComfyUI-Gallery is a ComfyUI custom node that adds a real-time image gallery to the ComfyUI
interface. It has two layers:

- **Python backend** — `aiohttp` route handlers, `watchdog`-based file monitor, and PNG metadata
  extraction, loaded directly by ComfyUI at startup.
- **React SPA** — TypeScript + Tailwind v4 + shadcn/ui + Radix UI frontend, compiled to a JS
  bundle and a CSS file in `web/dist/assets/`. Built with **Bun** (package manager + bundler).
  The gallery is injected into ComfyUI's DOM at `document.body` — **no iframe isolation**.

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
bun run build      # tsc -b && bun build (~300 ms)
```

**You must rebuild and commit both `web/dist/assets/comfy-ui-gallery.js` and
`web/dist/assets/comfy-ui-gallery.css` after every frontend change.**
ComfyUI loads the pre-built bundle directly; there is no hot-reload in production mode.

### Dev server (optional, for isolated UI work)

```bash
cd web
bun run dev        # Bun.serve() with HMR on localhost:5173 — not connected to ComfyUI backend
```

### Lint / Test

```bash
cd web
bun run lint       # ESLint with typescript-eslint + react-hooks rules
bun test           # metadata-parser unit tests (bun:test)
```

---

## Testing

`bun test` runs metadata-parser unit tests in `web/src/metadata-parser/`.
Type checking via `tsc -b` (run as part of `bun run build`) is the correctness gate for all
other code.

---

## Code Style

- **TypeScript strict mode** — `"strict": true` in `tsconfig.app.json`. `noUnusedLocals` and
  `noUnusedParameters` are currently disabled but should be respected in new code.
- **No `print()` in Python** — use `gallery_log()` from `gallery_config.py`.
- **Types first** — all shared TypeScript types live in `web/src/types.ts`. Add new fields there
  before using them elsewhere.
- **`metadataParser.ts` is the only public metadata API** — UI components call
  `parseComfyMetadata()` only; sub-parsers are internal implementation details.
- **React + shadcn/ui + Radix UI** — use shadcn components; icons from `lucide-react`.
  No Ant Design (`antd`) anywhere — it was replaced in the Bun migration.
- **Dark mode** — toggled via `.dark` class on `#comfy-gallery-root`. Use `dark:` Tailwind
  variants. CSS variables are scoped to `#comfy-gallery-root` and `#comfy-gallery-root.dark`.
- **Z-index** — always use `--cg-z-*` CSS custom properties (defined in `globals.css :root`).
  Never hardcode z-index numbers. Use `z-[var(--cg-z-*)]` in Tailwind or
  `style={{ zIndex: 'var(--cg-z-*)' }}` inline.
- **Modal dismiss** — use `useModalDismiss()` from `web/src/hooks/useModalDismiss.ts` for any
  new Radix dialog. Do not rely on Radix's default `onInteractOutside` dismiss behaviour.

---

## Architecture: DOM Isolation

> **Blast-radius rule:** Before adding any event listener, global CSS rule, or direct DOM
> mutation, ask: *what does this affect outside the gallery?* There is no iframe boundary.
> The gallery shares `document`, `window`, and `body` with ComfyUI's entire frontend.
> A `document.addEventListener` active while the gallery is open intercepts events for
> ComfyUI's canvas, menus, and every other component on the page.

> **Pre-implementation gate:** For any change touching focus ownership, keyboard events,
> event listeners, CSS scope, z-index, DOM structure, Radix components, or modal/dialog
> behavior — invoke the `comfyui-arch-review` skill before implementing. One rule, no exceptions
> regardless of apparent change size. The skill encodes the specific failure modes of this
> architecture as a structured checklist and outputs GO / CONDITIONAL GO / NO-GO.

The gallery mounts into ComfyUI's DOM without iframe isolation. Three sibling elements live at
`document.body`:

```
document.body
  ├─ #comfy-gallery-root        React root (createRoot target)
  │   └─ React tree
  │       └─ #comfy-gallery-portals  Radix portal target (via PortalContext)
  │           ├─ Dialogs, AlertDialogs, Selects, Tooltips
  │           └─ (toolbar + MetadataPanel no longer portaled here — moved to yarl plugin)
  └─ #comfy-gallery-yarl-root   yet-another-react-lightbox portal target
      └─ yarl Lightbox (full-screen)
          └─ GalleryOverlayPlugin (GalleryLightboxPlugin.tsx)
              ├─ Left: yarl carousel (MODULE_CONTROLLER) + bottom toolbar
              └─ Right: MetadataPanel (when open, in-place in plugin)
                  └─ #lbPortalContainer  Radix portal target override (inside yarl root)
                      └─ Tooltips from toolbar / metadata panel
```

**Invariants** (see also the comment block at the top of `main.tsx`):

1. **Never put non-React DOM inside `#comfy-gallery-root`.** React 18 clears its container's
   children on reconciliation; companion elements are siblings, not children.
2. **Each third-party modal library gets its own root.** yarl's `Portal.handleEnter()` marks
   all siblings as `inert` (standard a11y). Without its own root, yarl would inert
   `#comfy-gallery-root` and make everything non-interactive.
3. **All Radix portals target `#comfy-gallery-portals`**, never `document.body`, so they stay
   inside the CSS-scoped subtree for dark mode and Tailwind utilities.  
   **Exception:** inside `GalleryLightboxPlugin`, Radix portals target a local `lbPortalContainer`
   div (created via `useState` ref) inside `#comfy-gallery-yarl-root`, overriding `PortalContext`.
   This is necessary because `#comfy-gallery-portals` is inside the inert `#comfy-gallery-root`
   while yarl is open.
4. **Z-index from `--cg-z-*` vars only.** See `globals.css` `:root` block.

### CSS Isolation

ComfyUI's CSS is unlayered; Tailwind utilities are in `@layer utilities` → unlayered always
wins for normal declarations. Defence:

- All Tailwind utilities are scoped to **both gallery roots** via
  `important: ':is(#comfy-gallery-root, #comfy-gallery-yarl-root)'` in `tailwind.config.js`.
  ID specificity (1,1,0) beats ComfyUI's element selectors (0,0,1). Both roots are covered
  because plugin content renders inside `#comfy-gallery-yarl-root`.
- CSS color variables, `.dark` variables, `.lb-btn` classes, and baseline element reset are
  all scoped to `:is(#comfy-gallery-root, #comfy-gallery-yarl-root)` in `globals.css`.
- `@custom-variant dark` covers `#comfy-gallery-root.dark` and `#comfy-gallery-yarl-root.dark`.
  Both roots get `.dark` toggled in sync by `GalleryContext`.
- `!important` is reserved for externally-rendered native buttons (`.comfy-gallery-primary-btn`,
  `.comfy-gallery-icon-btn`) that live outside the ID scope.

---

## Architecture: Metadata Extraction Pipeline

Metadata is extracted in four passes (first non-null value wins per field):

1. **`extractByA1111`** — reads `metadata.parameters` (A1111-format PNG text chunk).
2. **`extractByPrompt`** — parses `metadata.prompt` (ComfyUI node graph JSON). Uses a 3-pass
   BFS: known class-type fast path → hub-first BFS → global scored BFS.
3. **`extractByWorkflow`** — same idea using `metadata.workflow` JSON (fallback).
4. **`extractPlaceholders`** — fills remaining fields with `null`.

**Source toggle** in `MetadataPanel.tsx`: `'auto' | 'civitai' | 'comfyui'`, passed to
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
| `web/src/main.tsx` | Entry point; mounts React root + yarl root; DOM topology documented here |
| `web/src/globals.css` | Tailwind entry; CSS variables; `--cg-z-*` z-index system; CSS isolation |
| `web/src/Gallery.tsx` | Top-level React wrapper; `<GalleryProvider>` + entry buttons + modal |
| `web/src/GalleryContext.tsx` | Central state context (30+ fields: open, viewMode, data, settings, …) |
| `web/src/GalleryModal.tsx` | Radix Dialog shell; renders GalleryHeader + GalleryGrid + GalleryLightbox (as siblings) or GroupView |
| `web/src/GalleryHeader.tsx` | Toolbar: search, folder select, view modes, sort, bulk actions |
| `web/src/GalleryGrid.tsx` | Virtualized image grid (react-window); pure display, calls `context.openLightbox()` |
| `web/src/GalleryLightbox.tsx` | yarl `<Lightbox>` wrapper; uses context lightbox state; includes `GalleryOverlayPlugin` |
| `web/src/GalleryLightboxPlugin.tsx` | yarl plugin: `GalleryOverlayWrapper` wraps `MODULE_CONTROLLER`; renders split-panel layout (carousel left, MetadataPanel right), bottom toolbar with inline delete confirm, PortalContext override for Tooltips |
| `web/src/GalleryOpenButton.tsx` | Floating draggable button (position:fixed) or hidden embedded trigger |
| `web/src/GallerySettingsModal.tsx` | Settings dialog (path, dark mode, extensions, polling, …) |
| `web/src/GroupView.tsx` | Model/Prompt group browsing tabs |
| `web/src/ImageCard.tsx` | Grid cell: thumbnail, drag, ctrl-click select, delete confirm |
| `web/src/MetadataPanel.tsx` | Side panel: parsed metadata table, raw JSON, copy/download/delete. Renders in-place (normal flow) inside yarl plugin's right section. Accepts `onDeleteRequest` prop; when provided, calls it instead of opening its own AlertDialog |
| `web/src/PortalContext.tsx` | Context providing `#comfy-gallery-portals` to all Radix portals |
| `web/src/hooks/useModalDismiss.ts` | Encapsulates Radix dialog dismiss: prevent auto-close, explicit handlers |
| `web/src/hooks/useGalleryGroups.ts` | Fetches/processes model + prompt groups |
| `web/src/metadata-parser/metadataParser.ts` | Orchestrates extraction passes (public API) |
| `web/dist/assets/comfy-ui-gallery.js` | **Committed build artefact — rebuild on every change** |
| `web/dist/assets/comfy-ui-gallery.css` | **Committed build artefact — rebuild on every change** |

---

## Common Gotchas

- **Rebuild the bundle.** The most common mistake — frontend changes have no effect until
  `bun run build` is run in `web/` and **both** `comfy-ui-gallery.js` and `comfy-ui-gallery.css`
  are committed.
- **String vs integer node IDs.** `prompt` JSON uses string IDs; `workflow` JSON uses integers.
  Mixing them up causes silent lookup failures.
- **Compound node IDs** like `"752:753"` (subgraph-internal nodes) only appear in `prompt` JSON,
  never in `workflow` JSON. The BFS in `promptMetadataParser.ts` handles them transparently.
- **Bundle output path.** Both artefacts are in `web/dist/assets/`. `WEB_DIRECTORY` in
  `__init__.py` must be `"./web/dist/assets"` exactly.
- **`set_generation_metadata()` API** (ComfyUI side). If working on the ComfyUI repo companion
  changes, this must be called from inside a node's `execute()` while the generation context is
  active. See `ComfyUI/comfy_execution/generation_context.py`.
- **`rel_path` must be in the scanner output.** `folder_content[entry.name]` in `folder_scanner.py`
  must include `"rel_path": rel_path`. It is the identity key linking DB records to frontend items.
  Without it, any feature that filters `imagesDetailsList` by `item.rel_path` silently produces nothing.
- **Group filters span all folders.** When `filteredRelPaths` is active (group drill-down), search
  across `data.folders` (all subfolders), not just `data.folders[currentFolder]`. The DB returns
  rel_paths from every subfolder under the monitor root; scoping to one folder yields zero matches.
- **`GROUP_CONCAT` for file paths: use `'|||'` separator, not `,`.** A1111-generated filenames
  embed the positive prompt (e.g. `00012-seed-ultra detailed, nsfw, best quality.png`), so commas
  appear inside rel_paths. Splitting `GROUP_CONCAT(rel_path)` on `,` shreds these into garbage paths.
  Use `GROUP_CONCAT(rel_path, '|||')` and split on `'|||'` in Python.
- **SQLite `GROUP_CONCAT(DISTINCT x, sep)` is not valid.** `DISTINCT` inside `group_concat` only
  accepts one argument. Use `GROUP_CONCAT(DISTINCT x)` (default comma separator) for values that
  don't contain commas (e.g. model names). The `'|||'` separator is only available in the non-DISTINCT form.
- **Never append non-React DOM inside `#comfy-gallery-root`.** React 18 clears its container's
  children during reconciliation. New companion elements (e.g. a portal root for a new modal
  library) must be appended as siblings of `#comfy-gallery-root` in `main.tsx`.
- **New modal dialogs must use `useModalDismiss`.** Radix's default `onInteractOutside` fires on
  any pointer-down outside `DialogContent` — including on portaled toolbar/panel elements that are
  DOM-outside even if visually inside. Without the hook, clicking portaled UI closes the modal.
- **`--cg-z-*` vars for all z-index values.** Defined on `:root` in `globals.css` so both
  `#comfy-gallery-root` and `#comfy-gallery-yarl-root` (siblings) can inherit them. Never
  hardcode z-index numbers in components.
- **Never use `portalTarget ?? document.body` as a portal fallback.** If the portal target is
  null and a modal library is open, falling back to `document.body` causes that library to mark
  `#comfy-gallery-root` as `inert`. Guard portals with a null check instead.
- **AlertDialog / Radix portals inside yarl plugin must use the local PortalContext override.**
  `#comfy-gallery-portals` is inside inert `#comfy-gallery-root` while yarl is open → any Radix
  component portaling there is non-interactive. `GalleryLightboxPlugin` creates a local
  `lbPortalContainer` div (via `useState`, not `useRef` — so a re-render occurs when it mounts)
  inside `#comfy-gallery-yarl-root` and wraps its tree in `<PortalProvider value={lbPortalContainer}>`.
  Do NOT use `AlertDialog` directly in yarl plugins — use inline confirmation UI instead.
- **CSS scope covers both gallery roots.** `tailwind.config.js` uses
  `important: ':is(#comfy-gallery-root, #comfy-gallery-yarl-root)'`. CSS vars, `.dark` variants,
  `.lb-btn`, and the baseline element reset are all `:is(...)`-scoped in `globals.css`.
  If you add a new CSS root for a third-party library, add it to these selectors too.
- **Never hardcode colors in inline `style={}`.** Use CSS-variable-backed Tailwind classes
  (`bg-background`, `text-foreground`, `bg-card`, `bg-muted`, `border-border`,
  `text-muted-foreground`, etc.). Hardcoded `rgba()` or hex values never respond to the
  `.dark` class toggle and break light mode silently.
- **Never add `document` or `window` event listeners in component code.** The gallery
  shares `document` with ComfyUI's entire frontend — global listeners fire for every
  ComfyUI interaction, not just gallery ones. Any listener that must be global must be
  scoped to `#comfy-gallery-root` or `#comfy-gallery-yarl-root` (attach to the element,
  not to `document`/`window`). Clean up in the `useEffect` return.
- **Interactive elements inside the yarl plugin must not steal keyboard focus.** When a
  button or interactive element inside `GalleryLightboxPlugin` is clicked and retains
  focus, yarl loses arrow-key navigation. Use `onMouseDown={e => e.preventDefault()}` on
  toolbar/panel buttons that should not hold focus, or call `.blur()` immediately after
  the click handler. Existing toggle buttons already do this.

### Cross-platform (macOS / Linux / Windows)

- **Path containment: never use `startswith()`** to check if a file is inside a directory.
  Use `_is_within_directory()` (defined in `server.py`) which uses `os.path.commonpath()`.
  Reason: `"/output_backup/img"` starts with `"/output"` → security bypass.
- **Windows inode is unreliable.** `os.stat().st_ino` is often `0` on NTFS.
  The file cache hit check in `folder_scanner.py` skips the inode comparison on `sys.platform == "win32"`.
  Never add inode to a cache key without this guard.
- **`os.path.relpath()` raises `ValueError` on Windows** when the two paths are on different drives
  (e.g. scanning `D:\images` with ComfyUI on `C:\`). Always wrap in `try/except ValueError`.
- **`rel_path` in the DB always uses `/`.** The scanner normalizes with `.replace("\\", "/")`.
  Any endpoint that receives a `rel_path` from the network must apply the same normalization.
- **Model name normalization: use `os.path.basename()`**, not `split('/').pop()`.
  `os.path.basename()` handles both `/` and `\`; `split('/').pop()` silently fails on Windows paths.
  (The TS `normalizeModelName` uses `split('/').pop()` — acceptable because ComfyUI normalizes
  prompt JSON paths to `/`, but A1111 text may carry OS-native backslashes.)

---

## Pull Request Guidelines

- Run `bun run build` in `web/` before every commit touching frontend files — commit the rebuilt
  `comfy-ui-gallery.js` **and** `comfy-ui-gallery.css` in the same PR.
- Run `bun run lint` and ensure no new ESLint errors.
- Commit message trailer:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```


