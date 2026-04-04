#!/usr/bin/env python3
"""Integration test: scan a directory through the full scanner+DB pipeline.

Verifies:
  1. All image files on disk appear in the `files` DB table
  2. `image_params` table is populated for images that the parser can handle
  3. A second scan is idempotent (no duplicate rows)
  4. No exceptions during scan

Usage:
    cd ComfyUI-Gallery
    python tests/test_scanner.py ../../examples

Exit codes:
    0  — all checks pass
    1  — a check failed or an exception occurred
"""
import sys
import os
import argparse
import tempfile

# Bootstrap package so relative imports inside folder_scanner / gallery_db work.
# Must run before any ComfyUI-Gallery imports.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
# Load conftest to bootstrap 'comfyui_gallery' synthetic package
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import conftest  # noqa: F401, E402  — registers comfyui_gallery.* in sys.modules

from comfyui_gallery.gallery_db import GalleryDB           # noqa: E402
from comfyui_gallery.folder_scanner import _scan_for_images, DEFAULT_EXTENSIONS  # noqa: E402

_IMAGE_EXTS = frozenset([".png", ".jpg", ".jpeg", ".webp"])


def count_disk_images(root: str) -> int:
    n = 0
    for _, _, fns in os.walk(root):
        for fn in fns:
            if os.path.splitext(fn.lower())[1] in _IMAGE_EXTS:
                n += 1
    return n


def run(root: str) -> int:
    ok = True

    with tempfile.TemporaryDirectory(prefix="gallery_test_") as tmpdir:
        db_path = os.path.join(tmpdir, "gallery_test.db")

        # ----------------------------------------------------------------
        # Scan 1
        # ----------------------------------------------------------------
        print(f"Scan 1: {root}")
        db = GalleryDB(db_path)
        try:
            _scan_for_images(root, root, include_subfolders=True,
                             allowed_extensions=DEFAULT_EXTENSIONS, db=db)
        except Exception as exc:
            print(f"  ✗ EXCEPTION during scan 1: {exc}")
            return 1

        file_count_db = db._conn().execute("SELECT COUNT(*) FROM files").fetchone()[0]
        params_count_db = db._conn().execute("SELECT COUNT(*) FROM image_params").fetchone()[0]
        disk_count = count_disk_images(root)

        print(f"  Files on disk (images only):  {disk_count}")
        print(f"  Files in DB (all extensions): {file_count_db}")
        print(f"  image_params rows:            {params_count_db}")

        if file_count_db == 0:
            print("  ✗ FAIL: no files in DB after scan")
            ok = False
        else:
            print("  ✓ DB populated")

        if params_count_db == 0:
            print("  ✗ FAIL: no image_params rows — parser never ran or always returned None")
            ok = False
        else:
            coverage = params_count_db / disk_count * 100 if disk_count else 0
            print(f"  ✓ {params_count_db}/{disk_count} images have metadata ({coverage:.0f}%)")

        # ----------------------------------------------------------------
        # Scan 2 — idempotency
        # ----------------------------------------------------------------
        print("Scan 2: idempotency check")
        try:
            _scan_for_images(root, root, include_subfolders=True,
                             allowed_extensions=DEFAULT_EXTENSIONS, db=db)
        except Exception as exc:
            print(f"  ✗ EXCEPTION during scan 2: {exc}")
            return 1

        file_count_db2 = db._conn().execute("SELECT COUNT(*) FROM files").fetchone()[0]
        params_count_db2 = db._conn().execute("SELECT COUNT(*) FROM image_params").fetchone()[0]

        if file_count_db2 != file_count_db:
            print(f"  ✗ FAIL: file count changed {file_count_db} → {file_count_db2} (not idempotent)")
            ok = False
        else:
            print(f"  ✓ file count stable: {file_count_db2}")

        if params_count_db2 != params_count_db:
            print(f"  ✗ FAIL: params count changed {params_count_db} → {params_count_db2} (not idempotent)")
            ok = False
        else:
            print(f"  ✓ params count stable: {params_count_db2}")

        # ----------------------------------------------------------------
        # LEFT JOIN check — get_params_by_rel_path returns fileinfo even
        # for images that have no AI metadata (no image_params row).
        # ----------------------------------------------------------------
        no_meta_row = db._conn().execute("""
            SELECT f.rel_path FROM files f
            LEFT JOIN image_params ip ON f.id = ip.file_id
            WHERE f.file_type = 'image' AND ip.file_id IS NULL
            LIMIT 1
        """).fetchone()
        if no_meta_row:
            no_meta_path = no_meta_row[0]
            result = db.get_params_by_rel_path(no_meta_path)
            if result is None:
                print(f"  ✗ FAIL: get_params_by_rel_path returned None for metadata-free image {no_meta_path!r}")
                ok = False
            elif not result.get("fileinfo", {}).get("filename"):
                print(f"  ✗ FAIL: fileinfo.filename missing for metadata-free image {no_meta_path!r}")
                ok = False
            else:
                fi = result["fileinfo"]
                print(f"  ✓ LEFT JOIN: metadata-free image returns fileinfo — {fi['filename']} ({fi.get('resolution')})")
        else:
            print("  ─ No metadata-free images found, LEFT JOIN check skipped")
        rows = db._conn().execute("""
            SELECT f.rel_path, p.source
            FROM files f
            LEFT JOIN image_params p ON f.id = p.file_id
            WHERE f.file_type = 'image'
            ORDER BY p.source IS NULL DESC, f.rel_path
            LIMIT 20
        """).fetchall()

        print("\nSample (first 20 image rows):")
        print(f"  {'rel_path':<60}  {'source'}")
        print(f"  {'-'*60}  {'------'}")
        for rel, src in rows:
            src_str = src or "— (no metadata)"
            display = rel if len(rel) <= 60 else "…" + rel[-59:]
            print(f"  {display:<60}  {src_str}")

    print()
    if ok:
        print("✓ All checks passed")
        return 0
    else:
        print("✗ Some checks failed")
        return 1


def main():
    ap = argparse.ArgumentParser(description="Scanner+DB integration test.")
    ap.add_argument("directory", nargs="?",
                    default=os.path.join(_ROOT, "..", "..", "examples"),
                    help="Directory to scan (default: ../../examples)")
    args = ap.parse_args()

    root = os.path.abspath(args.directory)
    if not os.path.isdir(root):
        print(f"ERROR: directory not found: {root}", file=sys.stderr)
        sys.exit(2)

    sys.exit(run(root))


if __name__ == "__main__":
    main()
