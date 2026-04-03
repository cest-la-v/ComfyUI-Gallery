# folder_scanner.py
import os
from datetime import datetime
from typing import TYPE_CHECKING

from .metadata_extractor import buildMetadata
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


def _scan_for_images(full_base_path, base_path, include_subfolders, allowed_extensions=None, db=None):
    """Scans directories for files matching allowed extensions.

    If db is provided, raw metadata for image files is cached in SQLite:
    buildMetadata() is only called for new or changed files (cache miss).
    os.scandir() is always called — it is the source of truth for file existence.
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

                # rel_path relative to full_base_path (DB identity key)
                rel_path = os.path.relpath(entry.path, full_base_path).replace("\\", "/")
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
                rel_dir = os.path.relpath(dir_path, full_base_path).replace("\\", "/")
                if rel_dir == ".":
                    url_path = f"/static_gallery/{entry.name}"
                else:
                    url_path = f"/static_gallery/{rel_dir}/{entry.name}"

                metadata: dict = {}
                if file_type == "image":
                    cached = cache.get(rel_path)
                    cache_hit = (
                        cached is not None
                        and cached["inode"] == inode
                        and abs(cached["mtime"] - mtime) < 0.001
                        and cached["size"] == size
                    )
                    if cache_hit:
                        metadata = cached.get("raw_metadata") or {}
                    else:
                        try:
                            _, _, metadata = buildMetadata(entry.path)
                        except Exception as e:
                            gallery_log(f"Error building metadata for {entry.path}: {e}")
                            metadata = {}
                        # Queue for batch DB upsert
                        upsert_queue.append({
                            "rel_path": rel_path,
                            "inode": inode,
                            "mtime": mtime,
                            "size": size,
                            "file_type": file_type,
                            "raw_metadata": metadata or None,
                        })

                folder_content[entry.name] = {
                    "name": entry.name,
                    "url": url_path,
                    "timestamp": mtime,
                    "date": date_str,
                    "metadata": metadata,
                    "type": file_type,
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
            from .param_extractor import extract_params
            file_ids = db.upsert_files_batch(upsert_queue)
            params_list = []
            for entry in upsert_queue:
                file_id = file_ids.get(entry["rel_path"])
                if file_id is None:
                    continue
                raw_meta = entry.get("raw_metadata")
                if raw_meta:
                    params = extract_params(raw_meta)
                    if params:
                        params["file_id"] = file_id
                        params_list.append(params)
            if params_list:
                db.upsert_params_batch(params_list)
        except Exception as e:
            gallery_log(f"Gallery DB: error upserting batch: {e}")

    # GC dead entries (inverted diff: delete entries no longer on disk)
    if db is not None:
        try:
            db.gc_dead_entries(current_rel_paths)
        except Exception as e:
            gallery_log(f"Gallery DB: error in GC: {e}")

    return folders_data, changed