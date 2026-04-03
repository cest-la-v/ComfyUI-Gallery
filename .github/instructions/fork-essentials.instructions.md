---
applyTo: "**"
---
# ComfyUI Gallery — Fork-Specific Essentials

Read `AGENTS.md` for full conventions. This file contains only what must survive compaction.

## Critical Gotchas
- **REBUILD AND COMMIT BUNDLE**: After EVERY frontend change — `bun run build` then `git add -f web/dist/assets/comfy-ui-gallery.js`. No effect until rebuilt and committed.
- **String vs integer node IDs**: `prompt` JSON uses string IDs; `workflow` JSON uses integers. Compound IDs like `"752:753"` only appear in `prompt` JSON.
- **`WEB_DIRECTORY`** in `__init__.py` must match `"./web/dist/assets"` exactly.
- **Metadata API**: `metadataParser.ts` is the only public API — UI calls `parseComfyMetadata()` only, never sub-parsers directly.
