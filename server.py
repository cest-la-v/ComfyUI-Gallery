from server import PromptServer
from aiohttp import web
import os
import sys
import folder_paths
import time
from datetime import datetime
import json
import math
import pathlib
import threading
import queue
import asyncio
import shutil

from .folder_monitor import FileSystemMonitor
from .folder_scanner import _scan_for_images, DEFAULT_EXTENSIONS
from .gallery_config import disable_logs, gallery_log
from .gallery_db import open_gallery_db
from .metadata_parser._extractor import buildMetadata

# Add ComfyUI root to sys.path HERE
import sys
comfy_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(comfy_path)

monitor = None
# Placeholder directory.  This *must* exist, even if it's empty.
PLACEHOLDER_DIR = os.path.join(comfy_path, "output")  # os.path.abspath("./placeholder_static")
if not os.path.exists(PLACEHOLDER_DIR):
    os.makedirs(PLACEHOLDER_DIR)

# Current gallery root directory — updated when monitor starts/stops.
# This avoids reading the private aiohttp _directory attribute which can change across versions.
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
    """Return the current static gallery root directory."""
    return _current_gallery_dir


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
                return json.load(f)
        except Exception as e:
            gallery_log(f"Error loading settings: {e}")
            return {}
    return {}


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

@PromptServer.instance.routes.get("/Gallery/images")
async def get_gallery_images(request):
    """Endpoint to get gallery images, accepts relative_path."""
    raw_rel = request.rel_url.query.get("relative_path", "./")
    # Normalize query value: treat null/None/empty as root
    if raw_rel is None or str(raw_rel).lower() == 'null' or str(raw_rel).strip() == "":
        relative_path = "./"
    else:
        relative_path = raw_rel

    # Fix: Only join if relative_path is not absolute or '.'
    base_output_dir = folder_paths.get_output_directory()
    if os.path.isabs(relative_path):
        full_monitor_path = os.path.normpath(relative_path)
    elif relative_path in ("./", ".", ""):  # treat as root
        full_monitor_path = base_output_dir
    else:
        full_monitor_path = os.path.normpath(os.path.join(base_output_dir, relative_path))

    # Use a thread-safe queue to communicate between threads.
    result_queue = queue.Queue()

    def thread_target():
        """Target function for the scanning thread."""
        with PromptServer.instance.scan_lock:
            try:
                # Load saved settings to determine extensions
                saved = load_settings()
                scan_extensions = saved.get('scanExtensions', DEFAULT_EXTENSIONS)
                # Use the actual folder name as the root key
                folder_name = os.path.basename(full_monitor_path)
                folders_with_metadata, _ = _scan_for_images(
                    full_monitor_path, folder_name, True, scan_extensions, db=_gallery_db
                )
                result_queue.put(folders_with_metadata)  # Put the result in the queue
            except Exception as e:
                result_queue.put(e)  # Put the exception in the queue

    def on_scan_complete(folders_with_metadata):
            """Callback executed in the main thread to send the response."""

            try:
                if isinstance(folders_with_metadata, Exception):
                    gallery_log(f"Error in /Gallery/images: {folders_with_metadata}")
                    import traceback
                    traceback.print_exc()
                    return web.Response(status=500, text=str(folders_with_metadata))

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

    static_dir = _get_static_dir()
    full_path = os.path.realpath(os.path.join(static_dir, rel_path))

    if not _is_within_directory(full_path, static_dir):
        return web.Response(status=403, text="Access denied: path outside gallery root")

    if fmt == "raw":
        if not os.path.isfile(full_path):
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
    """Endpoint to start gallery monitoring, accepts relative_path."""
    global monitor
    from . import gallery_config
    try:
        data = await request.json()
        # Normalize relative_path: if missing, null, or literal 'null', treat as root
        relative_path = data.get("relative_path", "./")
        if relative_path is None or str(relative_path).lower() == 'null' or str(relative_path).strip() == "":
            relative_path = "./"
        gallery_config.disable_logs = data.get("disable_logs", False)
        gallery_config.use_polling_observer = data.get("use_polling_observer", False)
        scan_extensions = data.get("scan_extensions", DEFAULT_EXTENSIONS)
        disable_logs = gallery_config.disable_logs
        use_polling_observer = gallery_config.use_polling_observer
        # Build full monitor path: absolute paths are used as-is, relative ones are joined to output dir
        base_output_dir = folder_paths.get_output_directory()
        if relative_path and os.path.isabs(relative_path):
            full_monitor_path = os.path.normpath(relative_path)
        elif relative_path in ("./", ".", ""):
            full_monitor_path = base_output_dir
        else:
            full_monitor_path = os.path.normpath(os.path.join(base_output_dir, relative_path))
        gallery_log("disable_logs", disable_logs)
        gallery_log("use_polling_observer", use_polling_observer)
        if monitor and monitor.thread and monitor.thread.is_alive():
            # Monitor is healthy — only restart if the path or settings changed.
            current_path = os.path.normpath(str(monitor.base_path)) if monitor else None
            settings_unchanged = (
                current_path == full_monitor_path
                and gallery_config.disable_logs == disable_logs
                and gallery_config.use_polling_observer == use_polling_observer
            )
            if settings_unchanged:
                gallery_log("FileSystemMonitor: Monitor already running with same settings, skipping restart.")
                return web.Response(text="Gallery monitor already running", content_type="text/plain")
            gallery_log("FileSystemMonitor: Settings changed, stopping previous monitor.")
            monitor.stop_monitoring()
        if not os.path.isdir(full_monitor_path):
            return web.Response(status=400, text=f"Invalid relative_path: {relative_path}, path not found")
        for route in PromptServer.instance.app.router.routes():
            if route.name == 'static_gallery_placeholder':
                route.resource._directory = pathlib.Path(full_monitor_path)
                gallery_log(f"Serving static files from {full_monitor_path} at /static_gallery")
                break
        else:
            gallery_log("Error: Placeholder static route not found!")
            return web.Response(status=500, text="Placeholder route not found.")
        global _current_gallery_dir
        _current_gallery_dir = full_monitor_path
        monitor = FileSystemMonitor(full_monitor_path, interval=1.0, use_polling_observer=use_polling_observer, extensions=scan_extensions)
        monitor.start_monitoring()
        return web.Response(text="Gallery monitor started", content_type="text/plain")
    except Exception as e:
        gallery_log(f"Error starting gallery monitor: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.post("/Gallery/monitor/stop")
async def stop_gallery_monitor(request):
    """Endpoint to stop gallery monitoring."""
    global monitor, _current_gallery_dir
    from .gallery_config import gallery_log
    if monitor and monitor.thread and monitor.thread.is_alive():
        monitor.stop_monitoring()
        monitor = None
    _current_gallery_dir = PLACEHOLDER_DIR
    for route in PromptServer.instance.app.router.routes():
        if route.name == 'static_gallery_placeholder':
            route.resource._directory = pathlib.Path(PLACEHOLDER_DIR)
            gallery_log(f"Serving static files from {PLACEHOLDER_DIR} at /static_gallery")
            break
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
        if image_url.startswith("/static_gallery/"):
            relative_path = image_url[len("/static_gallery/"):]

        else:
            return web.Response(status=400, text="Invalid image_path format")
        static_dir = _get_static_dir()
        full_image_path = os.path.realpath(os.path.join(static_dir, relative_path))
        if not os.path.exists(full_image_path):
            return web.Response(status=404, text=f"File not found: {full_image_path}")
        if not _is_within_directory(full_image_path, static_dir):
            return web.Response(status=403, text="Access denied: File outside of static directory")
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
    """Endpoint to move an image to a new location, relative to the current gallery root (current_path)."""
    from .gallery_config import disable_logs, gallery_log
    try:
        data = await request.json()
        source_path = data.get("source_path")
        target_path = data.get("target_path")
        current_path = data.get("current_path") or data.get("relative_path") or "./"
        gallery_log(f"source_path: {source_path}")
        gallery_log(f"target_path: {target_path}")
        gallery_log(f"current_path: {current_path}")
        if not source_path or not target_path:
            return web.Response(status=400, text="source_path and target_path are required")
        static_dir = _get_static_dir()
        static_dir_basename = os.path.basename(os.path.normpath(static_dir))
        def make_path(p):
            # Normalize separators first so both / and \ are handled on Windows
            p = p.replace("/", os.sep).replace("\\", os.sep)
            if os.path.isabs(p):
                return os.path.normpath(p)
            prefix = static_dir_basename + os.sep
            if p.startswith(prefix):
                p = p[len(prefix):]
            return os.path.normpath(os.path.join(static_dir, p))
        full_source_path = make_path(source_path)
        full_target_path = make_path(target_path)
        gallery_log(f"static_dir: {static_dir}")
        gallery_log(f"full_source_path: {full_source_path}")
        gallery_log(f"full_target_path: {full_target_path}")
        if not os.path.exists(full_source_path):
            return web.Response(status=404, text=f"Source file not found: {full_source_path}")
        if not _is_within_directory(full_source_path, static_dir) or \
            not _is_within_directory(full_target_path, static_dir) or \
            not _is_within_directory(full_source_path, comfy_path) or \
            not _is_within_directory(full_target_path, comfy_path):
            return web.Response(status=403, text="Access denied: File outside of allowed directory")
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