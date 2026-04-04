"""SQLite-backed gallery database.

Serves as the primary gallery database — the filesystem remains the source of
truth for *which files exist*, but this DB owns all structured metadata.

Three tables, all defined upfront to avoid future migrations:
  files        — file identity + validity (inode/mtime/size) + image dimensions
  image_params — structured generation params for SQL grouping
  model_info   — Civitai/HF model info with TTL invalidation (Phase 4+)

Thread safety: each thread gets its own SQLite connection (threading.local).
WAL mode enables concurrent reads while a write is in progress.

Schema versioning: schema_version table tracks the current version.
On version mismatch the cache tables are dropped and recreated — the DB is a
pure cache so no user data is lost.
"""

import os
import sqlite3
import threading
import time
from typing import Optional

from .gallery_config import gallery_log
from .metadata_parser.fingerprint import prompt_only_fingerprint as _prompt_only_fp

DB_FILENAME = "gallery_cache.db"
SCHEMA_VERSION = 5


class GalleryDB:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._local = threading.local()
        self._init_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn

    def _init_schema(self):
        conn = self._conn()
        # Create schema_version table first (survives cache wipes)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            )
        """)
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        current = row["version"] if row else 0
        if current < SCHEMA_VERSION:
            gallery_log(f"Gallery DB: schema v{current} → v{SCHEMA_VERSION}, rebuilding cache tables")
            conn.executescript("""
                DROP TABLE IF EXISTS image_params;
                DROP TABLE IF EXISTS files;
            """)
            conn.execute("DELETE FROM schema_version")
            conn.execute("INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,))

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS files (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                rel_path     TEXT UNIQUE NOT NULL,
                inode        INTEGER NOT NULL,
                mtime        REAL    NOT NULL,
                size         INTEGER NOT NULL,
                file_type    TEXT    NOT NULL,
                width        INTEGER,
                height       INTEGER,
                cached_at    REAL DEFAULT (unixepoch('now', 'subsec'))
            );

            CREATE TABLE IF NOT EXISTS image_params (
                file_id            INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
                formats            TEXT,
                model              TEXT,
                model_hash         TEXT,
                positive_prompt    TEXT,
                negative_prompt    TEXT,
                sampler            TEXT,
                scheduler          TEXT,
                steps              INTEGER,
                cfg_scale          REAL,
                seed               INTEGER,
                vae                TEXT,
                clip_skip          INTEGER,
                denoise_strength   REAL,
                hires_upscaler     TEXT,
                hires_steps        INTEGER,
                hires_denoise      REAL,
                loras              TEXT,
                extras             TEXT,
                prompt_fingerprint TEXT,
                prompt_only_fp     TEXT
            );

            CREATE TABLE IF NOT EXISTS model_info (
                model_hash         TEXT PRIMARY KEY,
                model_name         TEXT,
                civitai_id         INTEGER,
                civitai_version_id INTEGER,
                hf_repo            TEXT,
                thumbnail_url      TEXT,
                tags               TEXT,
                fetched_at         REAL NOT NULL,
                source             TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_files_rel_path ON files(rel_path);
            CREATE INDEX IF NOT EXISTS idx_files_mtime    ON files(mtime DESC);
            CREATE INDEX IF NOT EXISTS idx_params_model   ON image_params(model);
            CREATE INDEX IF NOT EXISTS idx_params_fp      ON image_params(prompt_fingerprint);
            CREATE INDEX IF NOT EXISTS idx_params_only_fp ON image_params(prompt_only_fp);
            CREATE INDEX IF NOT EXISTS idx_params_mhash   ON image_params(model_hash);
        """)

    def get_all_cached(self) -> dict:
        """Batch-fetch all entries. Returns {rel_path: {id, inode, mtime, size, width, height}}."""
        rows = self._conn().execute(
            "SELECT id, rel_path, inode, mtime, size, width, height FROM files"
        ).fetchall()
        return {
            row["rel_path"]: {
                "id": row["id"],
                "inode": row["inode"],
                "mtime": row["mtime"],
                "size": row["size"],
                "width": row["width"],
                "height": row["height"],
            }
            for row in rows
        }

    def upsert_files_batch(self, entries: list) -> dict:
        """Batch upsert files. Returns {rel_path: file_id}.

        entries: list of {rel_path, inode, mtime, size, file_type, width, height}
        """
        conn = self._conn()
        now = time.time()
        rows = [
            (
                e["rel_path"],
                e["inode"],
                e["mtime"],
                e["size"],
                e["file_type"],
                e.get("width"),
                e.get("height"),
                now,
            )
            for e in entries
        ]
        with conn:
            conn.executemany(
                """INSERT INTO files (rel_path, inode, mtime, size, file_type, width, height, cached_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(rel_path) DO UPDATE SET
                       inode=excluded.inode, mtime=excluded.mtime, size=excluded.size,
                       file_type=excluded.file_type, width=excluded.width, height=excluded.height,
                       cached_at=excluded.cached_at""",
                rows,
            )
        rel_paths = [e["rel_path"] for e in entries]
        result_rows = conn.execute(
            f"SELECT id, rel_path FROM files WHERE rel_path IN ({','.join('?' * len(rel_paths))})",
            rel_paths,
        ).fetchall()
        return {row["rel_path"]: row["id"] for row in result_rows}

    def upsert_params_batch(self, params_list: list):
        """Batch upsert image_params. Each dict must have 'file_id' + param fields."""
        if not params_list:
            return
        conn = self._conn()
        with conn:
            conn.executemany(
                """INSERT INTO image_params
                   (file_id, formats, model, model_hash, positive_prompt, negative_prompt,
                    sampler, scheduler, steps, cfg_scale, seed,
                    vae, clip_skip, denoise_strength,
                    hires_upscaler, hires_steps, hires_denoise,
                    loras, extras, prompt_fingerprint, prompt_only_fp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(file_id) DO UPDATE SET
                       formats=excluded.formats,
                       model=excluded.model, model_hash=excluded.model_hash,
                       positive_prompt=excluded.positive_prompt,
                       negative_prompt=excluded.negative_prompt,
                       sampler=excluded.sampler, scheduler=excluded.scheduler,
                       steps=excluded.steps, cfg_scale=excluded.cfg_scale,
                       seed=excluded.seed,
                       vae=excluded.vae, clip_skip=excluded.clip_skip,
                       denoise_strength=excluded.denoise_strength,
                       hires_upscaler=excluded.hires_upscaler,
                       hires_steps=excluded.hires_steps,
                       hires_denoise=excluded.hires_denoise,
                       loras=excluded.loras, extras=excluded.extras,
                       prompt_fingerprint=excluded.prompt_fingerprint,
                       prompt_only_fp=excluded.prompt_only_fp""",
                [
                    (
                        p["file_id"],
                        p.get("formats"),
                        p.get("model"),
                        p.get("model_hash"),
                        p.get("positive_prompt"),
                        p.get("negative_prompt"),
                        p.get("sampler"),
                        p.get("scheduler"),
                        p.get("steps"),
                        p.get("cfg_scale"),
                        p.get("seed"),
                        p.get("vae"),
                        p.get("clip_skip"),
                        p.get("denoise_strength"),
                        p.get("hires_upscaler"),
                        p.get("hires_steps"),
                        p.get("hires_denoise"),
                        p.get("loras"),
                        p.get("extras"),
                        p.get("prompt_fingerprint"),
                        _prompt_only_fp(
                            p.get("positive_prompt") or "",
                            p.get("negative_prompt") or "",
                        ) if (p.get("positive_prompt") or p.get("negative_prompt")) else None,
                    )
                    for p in params_list
                ],
            )

    def gc_dead_entries(self, current_rel_paths: set):
        """Delete entries for files no longer on disk (inverted diff GC).

        Fetches all rel_paths from DB, computes dead = db_paths − current_paths,
        deletes only the dead set. ON DELETE CASCADE handles image_params.
        """
        conn = self._conn()
        db_paths = {row[0] for row in conn.execute("SELECT rel_path FROM files").fetchall()}
        dead = db_paths - current_rel_paths
        if dead:
            with conn:
                conn.executemany("DELETE FROM files WHERE rel_path = ?", [(p,) for p in dead])
            gallery_log(f"Gallery DB: GC removed {len(dead)} stale entries")

    def get_groups_by_model(self) -> list:
        """Image counts grouped by model, with up to 4 sample rel_paths each."""
        rows = self._conn().execute("""
            SELECT ip.model, COUNT(*) AS count, GROUP_CONCAT(f.rel_path, '|||') AS paths
            FROM image_params ip
            JOIN files f ON ip.file_id = f.id
            WHERE ip.model IS NOT NULL
            GROUP BY ip.model
            ORDER BY count DESC
        """).fetchall()
        return [
            {
                "model": row["model"],
                "count": row["count"],
                "sample_paths": [p for p in (row["paths"] or "").split("|||") if p][:4],
            }
            for row in rows
        ]

    def get_groups_by_prompt(self) -> list:
        """Image counts grouped by prompt-only fingerprint (no model), with aggregated models."""
        rows = self._conn().execute("""
            SELECT ip.prompt_only_fp, ip.positive_prompt,
                   GROUP_CONCAT(DISTINCT ip.model, '|||') AS models,
                   COUNT(*) AS count, GROUP_CONCAT(f.rel_path, '|||') AS paths
            FROM image_params ip
            JOIN files f ON ip.file_id = f.id
            WHERE ip.prompt_only_fp IS NOT NULL
            GROUP BY ip.prompt_only_fp
            ORDER BY count DESC
        """).fetchall()
        return [
            {
                "fingerprint": row["prompt_only_fp"],
                "positive_prompt": row["positive_prompt"],
                "models": [m for m in (row["models"] or "").split("|||") if m],
                "count": row["count"],
                "sample_paths": [p for p in (row["paths"] or "").split("|||") if p][:4],
            }
            for row in rows
        ]

    def get_params_by_rel_path(self, rel_path: str) -> Optional[dict]:
        """Return image_params + fileinfo for a single file, or None if file not found.

        Uses LEFT JOIN so that files with no extracted AI metadata still return
        fileinfo (filename, resolution, size, date) — params fields will be None.
        Returns None only if the file itself is not in the DB.
        """
        row = self._conn().execute(
            """SELECT ip.formats, ip.model, ip.model_hash,
                      ip.positive_prompt, ip.negative_prompt,
                      ip.sampler, ip.scheduler, ip.steps, ip.cfg_scale, ip.seed,
                      ip.vae, ip.clip_skip, ip.denoise_strength,
                      ip.hires_upscaler, ip.hires_steps, ip.hires_denoise,
                      ip.loras, ip.extras, ip.prompt_fingerprint,
                      f.width, f.height, f.size, f.mtime, f.rel_path
               FROM files f
               LEFT JOIN image_params ip ON ip.file_id = f.id
               WHERE f.rel_path = ?""",
            (rel_path,),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        # Build fileinfo sub-object
        width = result.pop("width", None)
        height = result.pop("height", None)
        size_bytes = result.pop("size", None)
        mtime = result.pop("mtime", None)
        stored_path = result.pop("rel_path", rel_path)
        result["fileinfo"] = {
            "filename": os.path.basename(stored_path),
            "resolution": f"{width}x{height}" if width and height else None,
            "size": _format_size(size_bytes),
            "date": _format_date(mtime),
        }
        return result

    def get_files_by_model(self, model: str) -> list[str]:
        """Return rel_paths for all files with the given model name."""
        rows = self._conn().execute(
            """SELECT f.rel_path FROM files f
               JOIN image_params ip ON ip.file_id = f.id
               WHERE ip.model = ?
               ORDER BY f.mtime DESC""",
            (model,),
        ).fetchall()
        return [row["rel_path"] for row in rows]

    def get_files_by_fingerprint(self, fingerprint: str) -> list[str]:
        """Return rel_paths for all files with the given prompt-only fingerprint."""
        rows = self._conn().execute(
            """SELECT f.rel_path FROM files f
               JOIN image_params ip ON ip.file_id = f.id
               WHERE ip.prompt_only_fp = ?
               ORDER BY f.mtime DESC""",
            (fingerprint,),
        ).fetchall()
        return [row["rel_path"] for row in rows]

    def reset(self):
        """Wipe all cache tables and reinitialize the schema in-place.

        Uses SQL DROP TABLE instead of file deletion — avoids Windows file
        locking errors (WinError 32) that occur when other threads still hold
        open SQLite connections to the same file.
        """
        conn = self._conn()
        conn.executescript("""
            DROP TABLE IF EXISTS image_params;
            DROP TABLE IF EXISTS files;
            DROP TABLE IF EXISTS model_info;
            DELETE FROM schema_version;
        """)
        # Re-init creates fresh tables at the current schema version
        self._init_schema()
        gallery_log("Gallery DB: reset complete, fresh schema initialized")

    def get_status(self) -> dict:
        """Return diagnostic info: schema version, row counts, DB path."""
        conn = self._conn()
        file_count = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        params_count = conn.execute("SELECT COUNT(*) FROM image_params").fetchone()[0]
        return {
            "schema_version": SCHEMA_VERSION,
            "file_count": file_count,
            "params_count": params_count,
            "db_path": self._db_path,
        }

    def close(self):
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None


def _format_size(size_bytes: Optional[int]) -> Optional[str]:
    if size_bytes is None:
        return None
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _format_date(mtime: Optional[float]) -> Optional[str]:
    if mtime is None:
        return None
    import datetime
    return datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")


def open_gallery_db(base_dir: str) -> GalleryDB:
    """Open (or create) the gallery cache DB in base_dir."""
    db_path = os.path.join(base_dir, DB_FILENAME)
    gallery_log(f"Gallery DB: opening {db_path}")
    return GalleryDB(db_path)
