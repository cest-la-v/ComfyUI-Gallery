"""SQLite-backed gallery database.

Serves as the primary gallery database — the filesystem remains the source of
truth for *which files exist*, but this DB owns all structured metadata.

Three tables, all defined upfront to avoid future migrations:
  files        — file identity + validity (inode/mtime/size) + raw_metadata blob
  image_params — structured generation params for SQL grouping
  model_info   — Civitai/HF model info with TTL invalidation (Phase 4)

Thread safety: each thread gets its own SQLite connection (threading.local).
WAL mode enables concurrent reads while a write is in progress.
"""

import os
import json
import sqlite3
import threading
import time
from typing import Optional

from .gallery_config import gallery_log

DB_FILENAME = "gallery_cache.db"


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
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS files (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                rel_path     TEXT UNIQUE NOT NULL,
                inode        INTEGER NOT NULL,
                mtime        REAL    NOT NULL,
                size         INTEGER NOT NULL,
                file_type    TEXT    NOT NULL,
                raw_metadata TEXT,
                cached_at    REAL DEFAULT (unixepoch('now', 'subsec'))
            );

            CREATE TABLE IF NOT EXISTS image_params (
                file_id           INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
                model             TEXT,
                model_hash        TEXT,
                positive_prompt   TEXT,
                negative_prompt   TEXT,
                sampler           TEXT,
                scheduler         TEXT,
                steps             INTEGER,
                cfg_scale         REAL,
                seed              INTEGER,
                source            TEXT,
                prompt_fingerprint TEXT
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
            CREATE INDEX IF NOT EXISTS idx_params_mhash   ON image_params(model_hash);
        """)

    def get_all_cached(self) -> dict:
        """Batch-fetch all entries. Returns {rel_path: {id, inode, mtime, size, raw_metadata}}."""
        rows = self._conn().execute(
            "SELECT id, rel_path, inode, mtime, size, raw_metadata FROM files"
        ).fetchall()
        return {
            row["rel_path"]: {
                "id": row["id"],
                "inode": row["inode"],
                "mtime": row["mtime"],
                "size": row["size"],
                "raw_metadata": json.loads(row["raw_metadata"]) if row["raw_metadata"] else None,
            }
            for row in rows
        }

    def upsert_files_batch(self, entries: list) -> dict:
        """Batch upsert files. Returns {rel_path: file_id}.

        entries: list of {rel_path, inode, mtime, size, file_type, raw_metadata}
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
                json.dumps(e["raw_metadata"]) if e.get("raw_metadata") is not None else None,
                now,
            )
            for e in entries
        ]
        with conn:
            conn.executemany(
                """INSERT INTO files (rel_path, inode, mtime, size, file_type, raw_metadata, cached_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(rel_path) DO UPDATE SET
                       inode=excluded.inode, mtime=excluded.mtime, size=excluded.size,
                       file_type=excluded.file_type, raw_metadata=excluded.raw_metadata,
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
                   (file_id, model, model_hash, positive_prompt, negative_prompt,
                    sampler, scheduler, steps, cfg_scale, seed, source, prompt_fingerprint)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(file_id) DO UPDATE SET
                       model=excluded.model, model_hash=excluded.model_hash,
                       positive_prompt=excluded.positive_prompt,
                       negative_prompt=excluded.negative_prompt,
                       sampler=excluded.sampler, scheduler=excluded.scheduler,
                       steps=excluded.steps, cfg_scale=excluded.cfg_scale,
                       seed=excluded.seed, source=excluded.source,
                       prompt_fingerprint=excluded.prompt_fingerprint""",
                [
                    (
                        p["file_id"],
                        p.get("model"),
                        p.get("model_hash"),
                        p.get("positive_prompt"),
                        p.get("negative_prompt"),
                        p.get("sampler"),
                        p.get("scheduler"),
                        p.get("steps"),
                        p.get("cfg_scale"),
                        p.get("seed"),
                        p.get("source"),
                        p.get("prompt_fingerprint"),
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
            SELECT ip.model, COUNT(*) AS count, GROUP_CONCAT(f.rel_path) AS paths
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
                "sample_paths": (row["paths"] or "").split(",")[:4],
            }
            for row in rows
        ]

    def get_groups_by_prompt(self) -> list:
        """Image counts grouped by prompt fingerprint, with up to 4 sample rel_paths each."""
        rows = self._conn().execute("""
            SELECT ip.prompt_fingerprint, ip.positive_prompt, ip.model,
                   COUNT(*) AS count, GROUP_CONCAT(f.rel_path) AS paths
            FROM image_params ip
            JOIN files f ON ip.file_id = f.id
            WHERE ip.prompt_fingerprint IS NOT NULL
            GROUP BY ip.prompt_fingerprint
            ORDER BY count DESC
        """).fetchall()
        return [
            {
                "fingerprint": row["prompt_fingerprint"],
                "positive_prompt": row["positive_prompt"],
                "model": row["model"],
                "count": row["count"],
                "sample_paths": (row["paths"] or "").split(",")[:4],
            }
            for row in rows
        ]

    def close(self):
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None


def open_gallery_db(base_dir: str) -> GalleryDB:
    """Open (or create) the gallery cache DB in base_dir."""
    db_path = os.path.join(base_dir, DB_FILENAME)
    gallery_log(f"Gallery DB: opening {db_path}")
    return GalleryDB(db_path)
