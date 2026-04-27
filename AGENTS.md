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

## Architecture: Multi-Source Monitoring

The gallery monitors **multiple source paths** simultaneously. Each source is identified by a
stable `source_id` slug and a filesystem path (may include magic tokens).

### SourcePath schema (`user_settings.json`)

```json
{
  "sourcePaths": [
    { "source_id": "output", "path": "{output}", "label": "Output",  "enabled": true },
    { "source_id": "input",  "path": "{input}",  "label": "Input",   "enabled": true }
  ]
}
```

- `source_id` — immutable URL-safe slug (`[a-z0-9][a-z0-9\-_]*`). Renaming the `label` is safe;
  changing `source_id` clears the DB cache for that source.
- `path` — filesystem path or magic token. Supported tokens: `{output}`, `{input}` (resolved via
  ComfyUI's `folder_paths`).
- `label` — display name only (shown in settings UI, not used in DB keys or URLs).
- `enabled` — if false, the source is skipped during monitoring.

Default sources (`DEFAULT_SOURCE_PATHS` in `GalleryContext.tsx`): `output` and `input`.

### `rel_path` format

All DB entries use `{source_id}/{file_rel}` as the global identity key (e.g.
`output/2025-01/image.png`). This is stable across folder renames and avoids cross-source
collisions without any DB schema change.

Folder keys in the folder dict follow the same pattern: `{source_id}/{folder_rel}`.

### File serving

`GET /Gallery/file/{source_id}/{path:.*}` — serves files from any active source using
`web.FileResponse` (supports range requests). The legacy `/static_gallery` static route is still
registered (required at module load time) but no longer updated; it serves a PLACEHOLDER_DIR.

### DB auto-clear on source change

On `POST /Gallery/monitor/start`, `server.py` computes a SHA-256 hash of the `{source_id: realpath}`
mapping and stores it in the `_metadata` KV table. If the hash changes (source added, removed, or
path changed), all `files` rows are cleared and the DB is rebuilt from scratch.

### Settings migration

Settings schema is at **v6** (was v5 before multi-source). The v5→v6 migration in both
`GalleryContext.tsx` and `server.py` preserves a non-default old `relativePath` value as a custom
source entry; default paths are silently replaced with the `sourcePaths` array.

### `copy_to_input` annotated path logic

`POST /Gallery/copy_to_input` decides what to return based on where the source file lives:

| Source location | Action | Return value |
|---|---|---|
| Inside `input/` dir | No copy | plain filename (e.g. `"foo.png"`) |
| Inside `output/` dir | No copy | annotated ref (e.g. `"foo.png [output]"`) |
| Custom source | Copy to `input/` (skip if dest exists) | plain filename |

ComfyUI's `get_annotated_filepath("foo.png [output]")` resolves the annotated ref to
`output_dir/foo.png`. The `[output]` suffix is the standard ComfyUI COMBO widget annotation —
no copy is needed for output files, and the COMBO widget previews them correctly.

**Always use `os.path.realpath()` before any `relpath` or containment check** — `input/` and
`output/` may be symlinks. Use `real_input_dir = os.path.realpath(input_dir)` as the relpath base.
See the Symlinks gotcha below.

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
| `server.py` | All aiohttp route handlers (`/Gallery/images`, `/Gallery/file/`, `/Gallery/monitor/start`, etc.) |
| `gallery_db.py` | SQLite cache; `files` table + `_metadata` KV table (survives schema wipes) |
| `folder_monitor.py` | `watchdog`-based file watcher; emits `gallery_image_added` events |
| `folder_scanner.py` | Recursive scan for images/video/audio by extension; `source_id` param prefixes `rel_path` and `url` |
| `metadata_extractor.py` | Reads PNG text chunks (`parameters`, `prompt`, `workflow`) |
| `gallery_node.py` | ComfyUI node declaration; `_image_combo_input()` lists both input/ and output/ files |
| `gallery_config.py` | `disable_logs` flag + `gallery_log()` |
| `user_settings.json` | Persisted user settings (read/written at runtime) |
| `user_settings-example.json` | Reference for available settings fields |
| `web/src/types.ts` | All shared TypeScript types including `SourcePath` |
| `web/src/main.tsx` | Entry point; mounts React root + yarl root; DOM topology documented here |
| `web/src/globals.css` | Tailwind entry; CSS variables; `--cg-z-*` z-index system; CSS isolation |
| `web/src/Gallery.tsx` | Top-level React wrapper; `<GalleryProvider>` + entry buttons + modal |
| `web/src/GalleryContext.tsx` | Central state context; `SettingsState.sourcePaths`, `DEFAULT_SOURCE_PATHS`, v5→v6 migration |
| `web/src/GalleryModal.tsx` | Radix Dialog shell; renders GalleryHeader + GalleryGrid + GalleryLightbox (as siblings) or GroupView |
| `web/src/GalleryHeader.tsx` | Toolbar: search, folder select, view modes, sort, bulk actions |
| `web/src/GalleryGrid.tsx` | Virtualized image grid (react-window); pure display, calls `context.openLightbox()` |
| `web/src/GalleryLightbox.tsx` | yarl `<Lightbox>` wrapper; uses context lightbox state; includes `GalleryOverlayPlugin` |
| `web/src/GalleryLightboxPlugin.tsx` | yarl plugin: `GalleryOverlayWrapper` wraps `MODULE_CONTROLLER`; renders split-panel layout (carousel left, MetadataPanel right), bottom toolbar with inline delete confirm, PortalContext override for Tooltips |
| `web/src/GalleryOpenButton.tsx` | Floating draggable button (position:fixed) or hidden embedded trigger |
| `web/src/GallerySettingsModal.tsx` | Settings dialog; `SourcePathList` component for multi-source paths; dark mode, extensions, polling |
| `web/src/GroupView.tsx` | Model/Prompt group browsing tabs |
| `web/src/ImageCard.tsx` | Grid cell: thumbnail, drag, ctrl-click select, delete confirm |
| `web/src/MetadataPanel.tsx` | Side panel: parsed metadata table, raw JSON, copy/download/delete. Uses `image.rel_path` directly (not URL parsing) |
| `web/src/PortalContext.tsx` | Context providing `#comfy-gallery-portals` to all Radix portals |
| `web/src/ComfyAppApi.ts` | API client; `startMonitoring(sourcePaths: SourcePath[])`, `fetchImages()`, `resolveSourcePath()` |
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
- **Never call `gc_dead_entries()` (global GC) with a single-source scan result.** `gc_dead_entries`
  removes ALL DB entries not in the provided set. Calling it with a partial (one-source) scan
  deletes every entry from other sources. Always use `gc_dead_entries_for_source(source_id, paths)`
  which scopes deletion to one source. The only safe caller of the global variant is a full
  all-sources rescan.
- **`FileSystemMonitor` must receive `source_id`.** When creating a `FileSystemMonitor` in
  `server.py`, always pass `source_id=sid`. The `source_id` flows to `GalleryEventHandler` and
  then to `_scan_for_images`, which uses it to (a) prefix `rel_path` values and (b) choose the
  scoped `gc_dead_entries_for_source` path. Omitting it causes global GC to corrupt the DB on
  every watchdog file event.
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
- **React components with async fetch: initialize loading state to `true`, not `false`.**
  If `useState(false)` is used for a loading flag and a `useEffect` fires the fetch, the
  component renders one frame with `loading=false, data=null` → shows the empty/error state
  before the fetch starts. Initialize to `true` when a fetch is guaranteed on mount. Use a
  `key` prop on the component to reset this state cleanly when the subject changes (e.g.
  `<MetadataPanel key={image.url} image={image} />` so state doesn't carry over between images).

- **`source_id` is immutable.** Changing a `source_id` in settings drops all cached DB entries
  for that source (hash mismatch triggers full clear). Only change `label` when renaming a source
  in the UI — never change `source_id`.
- **`rel_path` encodes the source.** It is always `{source_id}/{file_rel}` (forward slashes, even
  on Windows). Never strip or reparse the `source_id` prefix — use it as an opaque key. For
  display, split on the first `/` to get source_id and file_rel.
- **Symlinks in `input/` or `output/` break `relpath`.** `_resolve_rel_path` always returns a
  `realpath`-resolved path. If you compute `os.path.relpath(src, input_dir)` and `input_dir` is a
  symlink, the result is wrong (e.g. `../../real/input/foo.png` instead of `foo.png`). Always use
  `os.path.realpath(input_dir)` as the base for `relpath`. Same applies to `_image_combo_input()`
  in `gallery_node.py`.
- **`_is_within_directory()` is the only safe containment check.** Uses `os.path.commonpath()` on
  both `realpath`-resolved sides. Never use `startswith()` or manual path prefix checks.
- **`output/` files in the COMBO widget use `[output]` annotation.** `_image_combo_input()` lists
  output files as `"rel_path [output]"`. ComfyUI resolves these via `get_annotated_filepath()`.
  Do not strip the annotation before passing to execution — `_resolve_image()` calls
  `get_annotated_filepath()` which handles both forms.
- **`_metadata` table is outside the schema wipe block.** It stores KV pairs (settings hash,
  schema version markers) that must survive DB resets. Do not add it inside the schema wipe
  `CREATE TABLE` block — it is created unconditionally at import time alongside `schema_version`.
- **ComfyUI freezes the `prompt` dict at queue-submit time.** `onExecuted` fires asynchronously
  *after* execution, so widget values in the embedded `prompt` JSON are always **one run behind**.
  Any node that needs its own current-execution values in the saved file must use the
  `_extractor_runtime_cache` + `_patch_prompt()` pattern — never assume the embedded `prompt` dict
  reflects the current run. Without this, `comfyui` and `both` metadata_format modes will embed
  stale (e.g. seed=0) values.
- **`_score_node_params` silently skips type mismatches.** It uses `isinstance(val, (int, float))`
  to gate int/float fields — a `str`-encoded number like `"1568179555"` passes no exception but is
  quietly dropped. Any code that writes into the prompt dict for BFS consumption (e.g.
  `_patch_prompt`) must store native Python `int`/`float`, not `str(val)`. If you add a new field
  type to `_SAMPLER_FIELD_SPECS`, verify the corresponding value type is native before BFS can
  read it.

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


