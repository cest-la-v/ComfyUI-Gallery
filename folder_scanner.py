# folder_scanner.py
import os
import sys
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from .metadata_parser._extractor import buildMetadata
from .gallery_config import gallery_log

if TYPE_CHECKING:
    from .gallery_db import GalleryDB

# Default extensions include images, media and audio
DEFAULT_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.webp',  # Images
    '.mp4', '.gif', '.webm', '.mov',   # Media
    '.wav', '.mp3', '.m4a', '.flac'    # Audio
]

_IMAGE_EXTS = frozenset(['.png', '.jpg', '.jpeg', '.webp'])
_MEDIA_EXTS = frozenset(['.mp4', '.gif', '.webm', '.mov'])
_AUDIO_EXTS = frozenset(['.wav', '.mp3', '.m4a', '.flac'])


def _file_type(ext: str) -> str:
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _MEDIA_EXTS:
        return "media"
    if ext in _AUDIO_EXTS:
        return "audio"
    return "unknown"


def _scan_for_images(full_base_path, base_path, include_subfolders, allowed_extensions=None, db=None, source_id: str = ""):
    """Scans directories for files matching allowed extensions.

    If db is provided, raw metadata for image files is cached in SQLite:
    buildMetadata() is only called for new or changed files (cache miss).
    os.scandir() is always called — it is the source of truth for file existence.

    source_id — when set (multi-source mode):
      • rel_path  is prefixed: "{source_id}/{file_rel}"
      • url       becomes:     "/Gallery/file/{source_id}/{file_rel}"
      • GC is source-scoped so sibling sources' DB rows are not touched
    """
    if allowed_extensions is None:
        allowed_extensions = DEFAULT_EXTENSIONS

    allowed_ext_set = frozenset(
        ext.lower() if ext.startswith('.') else f".{ext.lower()}"
        for ext in allowed_extensions
    )

    folders_data = {}
    current_rel_paths: set = set()
    changed = False

    # Batch-fetch all cached entries upfront (one DB round-trip)
    cache: dict = db.get_all_cached() if db is not None else {}

    # Collect new/changed image entries for batch DB upsert
    upsert_queue: list = []

    def scan_directory(dir_path: str, relative_path: str = ""):
        folder_content: dict = {}
        try:
            with os.scandir(dir_path) as it:
                entries = list(it)

            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    if include_subfolders and not entry.name.startswith("."):
                        scan_directory(entry.path, os.path.join(relative_path, entry.name))
                    continue

                if not entry.is_file(follow_symlinks=False):
                    continue

                lower_name = entry.name.lower()
                ext = os.path.splitext(lower_name)[1]
                if ext not in allowed_ext_set:
                    continue

                file_type = _file_type(ext)

                # rel_path — DB identity key (always uses /)
                # In multi-source mode prefix with source_id so keys are globally unique.
                try:
                    file_rel = os.path.relpath(entry.path, full_base_path).replace("\\", "/")
                except ValueError:
                    # Windows: raised when entry.path and full_base_path are on different drives
                    gallery_log(f"Skipping {entry.path}: on different drive from gallery root")
                    continue
                rel_path = f"{source_id}/{file_rel}" if source_id else file_rel
                current_rel_paths.add(rel_path)

                try:
                    st = entry.stat(follow_symlinks=False)
                    inode = st.st_ino
                    mtime = st.st_mtime
                    size = st.st_size
                except OSError:
                    continue

                date_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")

                # URL construction
                try:
                    rel_dir = os.path.relpath(dir_path, full_base_path).replace("\\", "/")
                except ValueError:
                    rel_dir = "."
                if source_id:
                    # Multi-source: stable URL via dynamic file-serving endpoint
                    file_rel_for_url = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"
                    url_path = f"/Gallery/file/{source_id}/{file_rel_for_url}"
                elif rel_dir == ".":
                    url_path = f"/static_gallery/{entry.name}"
                else:
                    url_path = f"/static_gallery/{rel_dir}/{entry.name}"

                metadata: dict = {}
                width: Optional[int] = None
                height: Optional[int] = None
                if file_type == "image":
                    cached = cache.get(rel_path)
                    cache_hit = (
                        cached is not None
                        and abs(cached["mtime"] - mtime) < 0.001
                        and cached["size"] == size
                        # Skip inode check on Windows: NTFS often returns 0 for st_ino,
                        # making every file a false positive cache hit.
                        and (sys.platform == "win32" or cached["inode"] == inode)
                    )
                    if cache_hit:
                        width = cached.get("width")
                        height = cached.get("height")
                    else:
                        try:
                            _, _, metadata = buildMetadata(entry.path)
                            width = metadata["fileinfo"]["width"]
                            height = metadata["fileinfo"]["height"]
                        except Exception as e:
                            gallery_log(f"Error building metadata for {entry.path}: {e}")
                        # Queue for batch DB upsert
                        upsert_queue.append({
                            "rel_path": rel_path,
                            "inode": inode,
                            "mtime": mtime,
                            "size": size,
                            "file_type": file_type,
                            "width": width,
                            "height": height,
                            "_metadata": metadata or None,
                        })

                folder_content[entry.name] = {
                    "name": entry.name,
                    "url": url_path,
                    "timestamp": mtime,
                    "date": date_str,
                    "type": file_type,
                    "width": width,
                    "height": height,
                    "file_size": size,
                    "rel_path": rel_path,
                }

        except Exception as e:
            gallery_log(f"Error scanning directory {dir_path}: {e}")

        folder_key = os.path.join(base_path, relative_path) if relative_path else base_path
        if folder_content:
            folders_data[folder_key] = folder_content

    scan_directory(full_base_path, "")

    # Batch upsert new/changed files + their extracted params
    if db is not None and upsert_queue:
        try:
            from .metadata_parser import extract_params, params_to_json_columns
            file_ids = db.upsert_files_batch(upsert_queue)
            params_list = []
            for entry in upsert_queue:
                file_id = file_ids.get(entry["rel_path"])
                if file_id is None:
                    continue
                raw_meta = entry.get("_metadata")
                if raw_meta:
                    params = extract_params(raw_meta)
                    if params:
                        params = params_to_json_columns(params)
                        params["file_id"] = file_id
                        params_list.append(params)
            if params_list:
                db.upsert_params_batch(params_list)
        except Exception as e:
            gallery_log(f"Gallery DB: error upserting batch: {e}")

    # GC dead entries — source-scoped in multi-source mode to avoid cross-source corruption
    if db is not None:
        try:
            if source_id:
                db.gc_dead_entries_for_source(source_id, current_rel_paths)
            else:
                db.gc_dead_entries(current_rel_paths)
        except Exception as e:
            gallery_log(f"Gallery DB: error in GC: {e}")

    return folders_data, changed