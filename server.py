from aiohttp import web
import os
import sys
import re
import time
import hashlib
from datetime import datetime
import json
import math
import pathlib
import threading
import queue
import asyncio
import shutil

# ---------------------------------------------------------------------------
# ComfyUI adapter — zero changes to route handlers regardless of runtime
# ---------------------------------------------------------------------------
_IS_STANDALONE = False
_folder_paths = None

try:
    from server import PromptServer  # ComfyUI provides this at runtime
    import folder_paths as _folder_paths  # type: ignore[import-not-found]
    comfy_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.append(comfy_path)
except ImportError:
    _IS_STANDALONE = True
    comfy_path = os.path.dirname(os.path.abspath(__file__))  # gallery dir is the boundary

    class _StandalonePromptServer:
        """Minimal shim matching PromptServer's aiohttp-based interface."""
        routes: web.RouteTableDef = web.RouteTableDef()
        scan_lock: threading.Lock = threading.Lock()
        app: web.Application = web.Application()

        def send_sync(self, event: str, data: dict) -> None:
            pass  # no WebSocket in standalone mode

    class PromptServer:  # type: ignore[no-redef]  # mirrors ComfyUI class name
        instance = _StandalonePromptServer()

from .folder_monitor import FileSystemMonitor
from .folder_scanner import _scan_for_images, DEFAULT_EXTENSIONS
from .gallery_config import disable_logs, gallery_log
from .gallery_db import open_gallery_db
from .metadata_parser._extractor import buildMetadata


def _get_output_directory() -> str:
    """Return the gallery output directory regardless of runtime context."""
    if not _IS_STANDALONE and _folder_paths is not None:
        return _folder_paths.get_output_directory()
    env_dir = os.environ.get("GALLERY_OUTPUT_DIR", "")
    if env_dir:
        return env_dir
    default = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
    os.makedirs(default, exist_ok=True)
    return default


monitor = None  # kept for legacy compat; multi-source uses _monitors below
_monitors: dict = {}  # keyed by source_id
_active_sources: list = []  # list of {source_id, abs_path, label}

# Placeholder directory — must exist even if empty.
PLACEHOLDER_DIR = _get_output_directory()
os.makedirs(PLACEHOLDER_DIR, exist_ok=True)

# Current gallery root directory — legacy compat shim (first active source or PLACEHOLDER_DIR).
_current_gallery_dir: str = PLACEHOLDER_DIR

# Add a *placeholder* static route.  This gets modified later.
PromptServer.instance.routes.static('/static_gallery', PLACEHOLDER_DIR, follow_symlinks=True, name='static_gallery_placeholder') #give a name to the route

# Initialize scan_lock here
PromptServer.instance.scan_lock = threading.Lock()

# Gallery database — opened once, shared across requests via thread-local connections
_ext_dir = os.path.dirname(os.path.abspath(__file__))
_gallery_db = open_gallery_db(_ext_dir)

# Settings file for persistent user settings
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_settings.json")

# Applied to all Gallery API responses that return live data — prevents browsers
# from caching responses across DB resets/rescans.
_NO_CACHE = {"Cache-Control": "no-store"}


def _is_within_directory(file_path: str, base_dir: str) -> bool:
    """Return True if file_path is inside base_dir (cross-platform safe).

    Uses os.path.commonpath() instead of startswith() to avoid the classic
    prefix bypass where '/output_backup' starts with '/output'.
    Raises no exception; returns False on any OS error or different-drive paths.
    """
    try:
        real_file = os.path.realpath(file_path)
        real_base = os.path.realpath(base_dir)
        return os.path.commonpath([real_file, real_base]) == real_base
    except (ValueError, OSError):
        # ValueError on Windows when paths are on different drives
        return False


def _get_static_dir() -> str:
    """Return the current static gallery root directory (legacy compat)."""
    return _current_gallery_dir


# ---------------------------------------------------------------------------
# Multi-source path helpers
# ---------------------------------------------------------------------------

_DEFAULT_SOURCE_PATHS = [
    {"source_id": "output", "path": "{output}", "label": "Output", "enabled": True},
    {"source_id": "input",  "path": "{input}",  "label": "Input",  "enabled": True},
]


def _resolve_token(raw: str) -> str:
    """Resolve magic tokens and relative paths to absolute paths."""
    if raw == "{output}":
        return _get_output_directory()
    if raw == "{input}":
        if _folder_paths is not None:
            return _folder_paths.get_input_directory()
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "input")
    if not raw or raw.strip() in ("", "null"):
        return _get_output_directory()
    if os.path.isabs(raw):
        return os.path.normpath(raw)
    if raw in ("./", "."):
        return _get_output_directory()
    return os.path.normpath(os.path.join(_get_output_directory(), raw))


def _generate_source_id(label: str) -> str:
    """Slugify label to a URL-safe source_id ([a-z0-9][a-z0-9\\-_]*)."""
    slug = re.sub(r'[^a-z0-9\-_]', '-', label.lower().strip())
    slug = re.sub(r'-+', '-', slug).strip('-')
    return slug or 'source'


def _load_active_sources() -> list:
    """Return validated list of {source_id, abs_path, label} for enabled sources."""
    saved = load_settings()
    source_paths = saved.get("sourcePaths") or _DEFAULT_SOURCE_PATHS
    sources = []
    seen_ids: set = set()
    seen_realpaths: set = set()
    for sp in source_paths:
        if not sp.get("enabled", True):
            continue
        source_id = sp.get("source_id") or _generate_source_id(sp.get("label", "source"))
        raw_path = sp.get("path", "")
        abs_path = _resolve_token(raw_path)
        if not abs_path or not os.path.isdir(abs_path):
            gallery_log(f"Source '{source_id}' path '{raw_path}' not found, skipping")
            continue
        real = os.path.realpath(abs_path)
        if source_id in seen_ids:
            gallery_log(f"Duplicate source_id '{source_id}', skipping")
            continue
        if real in seen_realpaths:
            gallery_log(f"Duplicate realpath '{real}' for source '{source_id}', skipping")
            continue
        # Check containment with already-registered sources
        contained = False
        for other_real in seen_realpaths:
            if os.path.commonpath([real, other_real]) in (real, other_real):
                gallery_log(f"Source '{source_id}' overlaps with existing source, skipping")
                contained = True
                break
        if contained:
            continue
        seen_ids.add(source_id)
        seen_realpaths.add(real)
        sources.append({"source_id": source_id, "abs_path": abs_path, "label": sp.get("label", source_id)})
    return sources


def _get_source_dir(source_id: str) -> str | None:
    """Return abs_path for a given source_id from the active sources list."""
    for s in _active_sources:
        if s["source_id"] == source_id:
            return s["abs_path"]
    return None


def _resolve_rel_path(rel_path: str) -> str | None:
    """Resolve a multi-source rel_path (source_id/file_rel) to an absolute path.

    Returns None if source not found, path doesn't exist, or it's a path traversal.
    """
    if not rel_path or "/" not in rel_path:
        return None
    source_id, _, file_rel = rel_path.partition("/")
    abs_source = _get_source_dir(source_id)
    if abs_source is None:
        return None
    full_path = os.path.realpath(os.path.join(abs_source, file_rel))
    if not _is_within_directory(full_path, abs_source):
        return None
    return full_path


def _compute_source_hash(sources: list) -> str:
    """Stable sha256 hash of the {source_id: realpath} mapping."""
    mapping = {s["source_id"]: os.path.realpath(s["abs_path"]) for s in sources}
    payload = json.dumps(sorted(mapping.items()), sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def _build_civitai_text(params: dict) -> str:
    """Reconstruct A1111/CivitAI-style parameters text from merged DB params."""
    import json as _json
    parts: list[str] = []

    pos = (params.get("positive_prompt") or "").strip()
    neg = (params.get("negative_prompt") or "").strip()
    if pos:
        parts.append(pos)
    if neg:
        parts.append(f"Negative prompt: {neg}")

    kv: list[str] = []
    if params.get("steps") is not None:
        kv.append(f"Steps: {params['steps']}")
    sampler = (params.get("sampler") or "").strip()
    scheduler = (params.get("scheduler") or "").strip()
    if sampler:
        combined = f"{sampler} {scheduler}".strip() if scheduler and scheduler.lower() not in ("normal", "none") else sampler
        kv.append(f"Sampler: {combined}")
    if params.get("cfg_scale") is not None:
        kv.append(f"CFG scale: {params['cfg_scale']}")
    if params.get("seed") is not None:
        kv.append(f"Seed: {params['seed']}")
    fi = params.get("fileinfo") or {}
    if fi.get("resolution"):
        kv.append(f"Size: {fi['resolution']}")
    if params.get("model_hash"):
        kv.append(f"Model hash: {params['model_hash']}")
    if params.get("model"):
        kv.append(f"Model: {params['model']}")
    if params.get("vae"):
        kv.append(f"VAE: {params['vae']}")
    if params.get("clip_skip") is not None:
        kv.append(f"Clip skip: {params['clip_skip']}")
    if params.get("denoise_strength") is not None:
        kv.append(f"Denoising strength: {params['denoise_strength']}")
    loras = params.get("loras") or []
    if isinstance(loras, str):
        try:
            loras = _json.loads(loras)
        except Exception:
            loras = []
    for lora in loras:
        name = lora.get("name", "")
        ms = lora.get("model_strength")
        kv.append(f"Lora hashes: \"{name}: {ms}\"" if ms is not None else f"Lora hashes: \"{name}\"")
    extras = params.get("extras") or {}
    if isinstance(extras, str):
        try:
            extras = _json.loads(extras)
        except Exception:
            extras = {}
    for k, v in extras.items():
        kv.append(f"{k}: {v}")

    if kv:
        parts.append(", ".join(kv))
    return "\n".join(parts)


def load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
        except Exception as e:
            gallery_log(f"Error loading settings: {e}")
            return {}
    else:
        return {}

    # v5 → v6 migration: convert relativePath to sourcePaths
    version = settings.get("_settingsVersion", 1)
    if version <= 5 and "sourcePaths" not in settings:
        source_paths = list(_DEFAULT_SOURCE_PATHS)
        old_rel = settings.get("relativePath")
        if old_rel and str(old_rel).lower() not in ("", "null", "./", "."):
            resolved = _resolve_path(old_rel)
            if resolved != _get_output_directory():
                source_paths.append({
                    "source_id": _generate_source_id("custom"),
                    "path": resolved,
                    "label": "Custom",
                    "enabled": True,
                })
        settings["sourcePaths"] = source_paths
        settings["_settingsVersion"] = 6
        save_settings_to_file(settings)

    return settings


def save_settings_to_file(settings):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=4)
    except Exception as e:
        gallery_log(f"Error saving settings: {e}")

def sanitize_json_data(data):
    """Recursively sanitizes data to be JSON serializable."""
    if isinstance(data, dict):
        return {k: sanitize_json_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_json_data(item) for item in data]
    elif isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return None
        return data
    elif isinstance(data, (int, str, bool, type(None))):
        return data
    else:
        return str(data)


@PromptServer.instance.routes.get("/Gallery/settings")
async def get_settings(request):
    return web.json_response(load_settings(), headers=_NO_CACHE)


@PromptServer.instance.routes.post("/Gallery/settings")
async def save_settings(request):
    try:
        data = await request.json()
        save_settings_to_file(data)
        return web.Response(text="Settings saved")
    except Exception as e:
        return web.Response(status=500, text=str(e))


def _resolve_path(raw: str) -> str:
    """Resolve a raw path string to an absolute path using the same logic as monitor/start."""
    base = _get_output_directory()
    if not raw or raw.strip() in ("", "null"):
        return base
    if os.path.isabs(raw):
        return os.path.normpath(raw)
    if raw in ("./", ".", ""):
        return base
    return os.path.normpath(os.path.join(base, raw))


@PromptServer.instance.routes.get("/Gallery/resolve_path")
async def resolve_path(request):
    """Return the resolved absolute path and whether it exists on disk.

    Query params:
      path=<raw>  — the path string as typed by the user (relative or absolute)

    Response: { "resolved": "/abs/path", "exists": true|false }
    No side effects.
    """
    raw = request.rel_url.query.get("path", "./")
    resolved = _resolve_path(raw)
    return web.json_response(
        {"resolved": resolved, "exists": os.path.isdir(resolved)},
        headers=_NO_CACHE,
    )


@PromptServer.instance.routes.post("/Gallery/resolve_source_path")
async def resolve_source_path(request):
    """Resolve a source path string (may include tokens) to an absolute path.

    Body JSON:
      path — raw path string (e.g. "{output}", "/abs/path", "relative/path")

    Response: { "resolved": "/abs/path", "exists": true|false }
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    raw = data.get("path", "")
    resolved = _resolve_token(raw)
    return web.json_response(
        {"resolved": resolved, "exists": os.path.isdir(resolved)},
        headers=_NO_CACHE,
    )


@PromptServer.instance.routes.get("/Gallery/file/{source_id}/{path:.*}")
async def serve_gallery_file(request):
    """Serve a file from a gallery source directory.

    Security: resolved path must be within the source's abs_path.
    Uses web.FileResponse to support range requests (video/audio seeking).
    """
    source_id = request.match_info["source_id"]
    file_rel = request.match_info["path"].replace("\\", "/")
    abs_source = _get_source_dir(source_id)
    if abs_source is None:
        return web.Response(status=404, text=f"Source '{source_id}' not found")
    full_path = os.path.realpath(os.path.join(abs_source, file_rel))
    if not _is_within_directory(full_path, abs_source):
        return web.Response(status=403, text="Access denied")
    if not os.path.isfile(full_path):
        return web.Response(status=404, text="File not found")
    return web.FileResponse(full_path)

@PromptServer.instance.routes.post("/Gallery/copy_to_input")
async def copy_to_input(request):
    """Copy a gallery image into ComfyUI's input directory.

    Mirrors what the native image upload widget does, making the file a valid
    COMBO option that ComfyUI can resolve via get_annotated_filepath().

    Body JSON:
      rel_path — multi-source rel_path (source_id/file_rel)

    Response: { "filename": "image.png" }
    """
    if _folder_paths is None:
        return web.json_response({"error": "folder_paths not available"}, status=503, headers=_NO_CACHE)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400, headers=_NO_CACHE)

    rel_path = (data.get("rel_path") or "").replace("\\", "/")
    if not rel_path:
        return web.json_response({"error": "rel_path is required"}, status=400, headers=_NO_CACHE)

    src = _resolve_rel_path(rel_path)
    if src is None:
        return web.json_response({"error": "Path outside all gallery sources"}, status=400, headers=_NO_CACHE)
    if not os.path.isfile(src):
        return web.json_response({"error": "File not found"}, status=404, headers=_NO_CACHE)

    input_dir = _folder_paths.get_input_directory()
    os.makedirs(input_dir, exist_ok=True)
    filename = os.path.basename(src)
    dest = os.path.join(input_dir, filename)

    # Skip copy if src already resolves to dest (e.g. file is already in input/).
    # Uses realpath comparison to handle symlinks; avoids os.path.samefile which
    # relies on inodes that are unreliable on Windows/NTFS.
    if os.path.realpath(src) != os.path.realpath(dest):
        shutil.copy2(src, dest)

    return web.json_response({"filename": filename}, headers=_NO_CACHE)


@PromptServer.instance.routes.get("/Gallery/images")
async def get_gallery_images(request):
    """Scan all active sources and return merged folder tree."""
    # Use a thread-safe queue to communicate between threads.
    result_queue = queue.Queue()

    def thread_target():
        """Target function for the scanning thread."""
        with PromptServer.instance.scan_lock:
            try:
                saved = load_settings()
                scan_extensions = saved.get('scanExtensions', DEFAULT_EXTENSIONS)
                sources = _active_sources if _active_sources else _load_active_sources()
                merged_folders: dict = {}
                for source in sources:
                    sid = source["source_id"]
                    abs_path = source["abs_path"]
                    folders, _ = _scan_for_images(
                        abs_path, sid, True, scan_extensions,
                        db=_gallery_db, source_id=sid,
                    )
                    merged_folders.update(folders)
                result_queue.put(merged_folders)
            except Exception as e:
                result_queue.put(e)

    def on_scan_complete(folders_with_metadata):
            """Callback executed in the main thread to send the response."""

            try:
                if isinstance(folders_with_metadata, Exception):
                    gallery_log(f"Error in /Gallery/images: {folders_with_metadata}")
                    import traceback
                    traceback.print_exc()
                    return web.Response(status=500, text=str(folders_with_metadata))

                # Enrich each file entry with model/prompt metadata from the DB.
                if _gallery_db:
                    all_rel_paths = [
                        item["rel_path"]
                        for folder_items in folders_with_metadata.values()
                        for item in folder_items.values()
                        if isinstance(item, dict) and item.get("rel_path")
                    ]
                    params_map = _gallery_db.get_params_batch(all_rel_paths)
                    for folder_items in folders_with_metadata.values():
                        for item in folder_items.values():
                            if not isinstance(item, dict):
                                continue
                            p = params_map.get(item.get("rel_path", ""))
                            if p:
                                item["model"] = p.get("model")
                                item["positive_prompt"] = p.get("positive_prompt")
                                item["prompt_only_fp"] = p.get("prompt_only_fp")

                sanitized_folders = sanitize_json_data(folders_with_metadata)
                json_string = json.dumps({"folders": sanitized_folders})
                return web.Response(text=json_string, content_type="application/json", headers=_NO_CACHE)
            except Exception as e:
                    gallery_log(f"Error in on_scan_complete: {e}")
                    return web.Response(status=500, text=str(e))


    # Start the scanning in a separate thread.
    scan_thread = threading.Thread(target=thread_target)
    scan_thread.start()
    # Wait result and process it.
    result = result_queue.get() # BLOCKING call
    return on_scan_complete(result)


@PromptServer.instance.routes.get("/Gallery/metadata/{path:.*}")
async def get_file_metadata(request):
    """Lazy metadata endpoint. Returns parsed params or alternative representations.

    ?format=         (omit, default) — merged image_params from DB as JSON (no file I/O)
    ?format=raw      — raw PNG metadata chunks from file as JSON
    ?format=civitai  — A1111/CivitAI-style parameters text, reconstructed from merged params
    """
    # Normalize rel_path: Windows clients may send backslashes
    rel_path = request.match_info["path"].replace("\\", "/")
    fmt = request.rel_url.query.get("format", "parsed")

    if fmt == "raw":
        full_path = _resolve_rel_path(rel_path)
        if not full_path or not os.path.isfile(full_path):
            return web.Response(status=404, text=f"File not found: {rel_path}")
        try:
            _, _, metadata = buildMetadata(full_path)
            return web.json_response({"metadata": sanitize_json_data(metadata)}, headers=_NO_CACHE)
        except Exception as e:
            gallery_log(f"Error reading metadata for {rel_path}: {e}")
            return web.Response(status=500, text=str(e))

    # DB path — no file I/O
    params = _gallery_db.get_params_by_rel_path(rel_path)

    if fmt == "civitai":
        text = _build_civitai_text(params) if params else ""
        return web.Response(text=text, content_type="text/plain", headers=_NO_CACHE)

    return web.json_response({"params": params}, headers=_NO_CACHE)


@PromptServer.instance.routes.get("/Gallery/groups")
async def get_gallery_groups(request):
    """Return image counts grouped by model or prompt fingerprint.

    Query params:
      by=model   (default) — group by normalized checkpoint name
      by=prompt  — group by prompt fingerprint (pos+neg+model combo)
    """
    by = request.rel_url.query.get("by", "model")
    try:
        if by == "prompt":
            groups = _gallery_db.get_groups_by_prompt()
        else:
            groups = _gallery_db.get_groups_by_model()
        return web.json_response({"by": by, "groups": groups}, headers=_NO_CACHE)
    except Exception as e:
        gallery_log(f"Error in /Gallery/groups: {e}")
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.get("/Gallery/groups/files")
async def get_group_files(request):
    """Return all file rel_paths belonging to a model or prompt group.

    Query params:
      by=model   — group by model name (value = model name string)
      by=prompt  — group by prompt fingerprint (value = fingerprint hex string)
      value=X    — the group value to look up
    """
    by = request.rel_url.query.get("by", "model")
    value = request.rel_url.query.get("value", "")
    if not value:
        return web.json_response({"rel_paths": []}, headers=_NO_CACHE)
    try:
        if by == "prompt":
            rel_paths = _gallery_db.get_files_by_fingerprint(value)
        else:
            rel_paths = _gallery_db.get_files_by_model(value)
        return web.json_response({"rel_paths": rel_paths}, headers=_NO_CACHE)
    except Exception as e:
        gallery_log(f"Error in /Gallery/groups/files: {e}")
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/Gallery/db/reset")
async def reset_gallery_db(request):
    """Reset (wipe and rebuild) the gallery database.

    Deletes the SQLite file, re-initializes the schema, and returns ok=true.
    The next GET /Gallery/images call will trigger a full re-scan and cache rebuild.
    """
    try:
        _gallery_db.reset()
        gallery_log("Gallery DB: reset via API")
        return web.json_response({"ok": True})
    except Exception as e:
        gallery_log(f"Error resetting gallery DB: {e}")
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.get("/Gallery/db/status")
async def get_gallery_db_status(request):
    """Return diagnostic info about the gallery cache database."""
    try:
        status = _gallery_db.get_status()
        return web.json_response(status, headers=_NO_CACHE)
    except Exception as e:
        gallery_log(f"Error getting gallery DB status: {e}")
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/Gallery/monitor/start")
async def start_gallery_monitor(request):
    """Start file system monitors for all active sources.

    Body JSON:
      source_paths    — array of SourcePath objects from frontend settings
      disable_logs    — bool
      use_polling_observer — bool
      scan_extensions — list[str] | null
    """
    global _monitors, _active_sources, _current_gallery_dir
    from . import gallery_config
    try:
        data = await request.json()
        gallery_config.disable_logs = data.get("disable_logs", False)
        gallery_config.use_polling_observer = data.get("use_polling_observer", False)
        scan_extensions = data.get("scan_extensions", DEFAULT_EXTENSIONS)
        use_polling_observer = gallery_config.use_polling_observer

        # Persist incoming source_paths so load_settings() sees them immediately
        incoming_source_paths = data.get("source_paths")
        if incoming_source_paths is not None:
            saved = load_settings()
            saved["sourcePaths"] = incoming_source_paths
            saved["_settingsVersion"] = 6
            save_settings_to_file(saved)

        new_sources = _load_active_sources()
        if not new_sources:
            gallery_log("No valid source paths configured")
            return web.Response(status=400, text="No valid source paths configured")

        # Source-hash check — clear DB if source list changed
        new_hash = _compute_source_hash(new_sources)
        stored_hash = _gallery_db.get_meta("source_hash") if _gallery_db else None
        if stored_hash != new_hash:
            gallery_log("Gallery DB: source list changed, clearing cache")
            if _gallery_db:
                _gallery_db.clear_cache()
                _gallery_db.set_meta("source_hash", new_hash)

        _active_sources = new_sources
        # Update legacy compat shim
        _current_gallery_dir = new_sources[0]["abs_path"] if new_sources else PLACEHOLDER_DIR

        new_source_ids = {s["source_id"] for s in new_sources}
        old_source_ids = set(_monitors.keys())

        # Stop monitors for removed sources
        for sid in old_source_ids - new_source_ids:
            m = _monitors.pop(sid, None)
            if m and m.thread and m.thread.is_alive():
                m.stop_monitoring()

        # Start new monitors / restart changed ones
        for source in new_sources:
            sid = source["source_id"]
            abs_path = source["abs_path"]
            existing = _monitors.get(sid)
            if existing and existing.thread and existing.thread.is_alive():
                if os.path.normpath(str(existing.base_path)) == abs_path:
                    continue  # unchanged path — keep running
                existing.stop_monitoring()
            new_monitor = FileSystemMonitor(
                abs_path, interval=1.0,
                use_polling_observer=use_polling_observer,
                extensions=scan_extensions,
            )
            new_monitor.start_monitoring()
            _monitors[sid] = new_monitor

        gallery_log(f"Gallery monitors active for: {list(_monitors.keys())}")
        return web.Response(text="Gallery monitor started", content_type="text/plain")
    except Exception as e:
        gallery_log(f"Error starting gallery monitor: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.post("/Gallery/monitor/stop")
async def stop_gallery_monitor(request):
    """Stop all active gallery monitors."""
    global _monitors, _active_sources, _current_gallery_dir
    from .gallery_config import gallery_log
    for m in _monitors.values():
        if m and m.thread and m.thread.is_alive():
            m.stop_monitoring()
    _monitors = {}
    _active_sources = []
    _current_gallery_dir = PLACEHOLDER_DIR
    return web.Response(text="Gallery monitor stopped", content_type="text/plain")

@PromptServer.instance.routes.patch("/Gallery/updateImages")
async def newSettings(request):
    # This route is no longer used
    return web.Response(status=200)

@PromptServer.instance.routes.post("/Gallery/delete")
async def delete_image(request):
    """Endpoint to delete an image."""
    from .gallery_config import gallery_log
    try:
        data = await request.json()
        image_url = data.get("image_path")
        if not image_url:
            return web.Response(status=400, text="image_path is required")

        _FILE_PREFIX = "/Gallery/file/"
        full_image_path: str | None = None

        if image_url.startswith(_FILE_PREFIX):
            # Multi-source format: /Gallery/file/{source_id}/{rel_path}
            rel_path = image_url[len(_FILE_PREFIX):]
            full_image_path = _resolve_rel_path(rel_path)
        elif image_url.startswith("/static_gallery/"):
            # Legacy single-source format
            relative_path = image_url[len("/static_gallery/"):]
            static_dir = _get_static_dir()
            candidate = os.path.realpath(os.path.join(static_dir, relative_path))
            if _is_within_directory(candidate, static_dir):
                full_image_path = candidate
        else:
            return web.Response(status=400, text="Invalid image_path format")

        if not full_image_path or not os.path.exists(full_image_path):
            return web.Response(status=404, text=f"File not found: {image_url}")

        try:
            from send2trash import send2trash
            send2trash(full_image_path)
            gallery_log(f"Image moved to trash: {full_image_path}")
        except Exception as e:
            gallery_log(f"send2trash unavailable or failed ({type(e).__name__}: {e}), "
                        "falling back to permanent deletion.")
            os.remove(full_image_path)
            gallery_log(f"Image permanently deleted: {full_image_path}")
        return web.Response(text=f"Image deleted: {image_url}")
    except Exception as e:
        gallery_log(f"Error deleting image: {e}")
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.post("/Gallery/move")
async def move_image(request):
    """Move an image to a new location within the same source.

    Body JSON:
      source_path — multi-source rel_path of the file to move (source_id/file_rel)
      target_path — destination rel_path (source_id/new_rel or absolute path within source)
    """
    from .gallery_config import disable_logs, gallery_log
    try:
        data = await request.json()
        source_path = data.get("source_path")
        target_path = data.get("target_path")
        gallery_log(f"source_path: {source_path}")
        gallery_log(f"target_path: {target_path}")
        if not source_path or not target_path:
            return web.Response(status=400, text="source_path and target_path are required")

        # Resolve source via multi-source rel_path
        full_source_path = _resolve_rel_path(source_path)
        if not full_source_path or not os.path.exists(full_source_path):
            return web.Response(status=404, text=f"Source file not found: {source_path}")

        # Target may be a rel_path within the same source, or an absolute path
        full_target_path = _resolve_rel_path(target_path)
        if full_target_path is None:
            # Try as absolute path within any active source
            if os.path.isabs(target_path):
                candidate = os.path.normpath(target_path)
                for s in _active_sources:
                    if _is_within_directory(candidate, s["abs_path"]):
                        full_target_path = candidate
                        break
            if full_target_path is None:
                return web.Response(status=400, text=f"Invalid target_path: {target_path}")

        gallery_log(f"full_source_path: {full_source_path}")
        gallery_log(f"full_target_path: {full_target_path}")

        if os.path.isdir(full_target_path):
            full_target_path = os.path.join(full_target_path, os.path.basename(full_source_path))
        target_dir = os.path.dirname(full_target_path)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)
        shutil.move(full_source_path, full_target_path)
        return web.Response(text=f"Image moved from {source_path} to {target_path}")
    except Exception as e:
        gallery_log(f"Error moving image: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))