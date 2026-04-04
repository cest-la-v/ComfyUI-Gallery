#!/usr/bin/env python3
"""Smoke test: run the metadata parser on all images in a directory.

Not a unit test — this is a diagnostic tool for validating real images.

Usage:
    cd ComfyUI-Gallery
    python tests/test_smoke.py ../../examples
    python tests/test_smoke.py ../../examples --fail-on-none

Exit codes:
    0  — no exceptions (ERRORs)
    1  — at least one image caused an exception
"""
import sys
import os
import argparse

# Bootstrap: add ComfyUI-Gallery/ to sys.path
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Stub folder_paths before importing anything that might need it
import types as _types
if "folder_paths" not in sys.modules:
    _stub = _types.ModuleType("folder_paths")
    _stub.get_output_directory = lambda: "/tmp"  # type: ignore[attr-defined]
    sys.modules["folder_paths"] = _stub

from metadata_parser import extract_params_from_file  # noqa: E402

_IMAGE_EXTS = frozenset([".png", ".jpg", ".jpeg", ".webp"])
_COL_W = 50  # filename column width


def collect_images(root: str) -> list[str]:
    found = []
    for dirpath, _, filenames in os.walk(root):
        for fn in sorted(filenames):
            if os.path.splitext(fn.lower())[1] in _IMAGE_EXTS:
                found.append(os.path.join(dirpath, fn))
    return found


def run(root: str, fail_on_none: bool = False) -> int:
    images = collect_images(root)
    if not images:
        print(f"No images found in {root}")
        return 0

    counts = {"PASS": 0, "WARN": 0, "NONE": 0, "ERROR": 0}
    errors = []

    header = f"{'File':<{_COL_W}}  {'Source':<8}  {'Model':<30}  {'Status'}"
    print(header)
    print("-" * len(header))

    for path in images:
        rel = os.path.relpath(path, root)
        display = rel if len(rel) <= _COL_W else "…" + rel[-(  _COL_W - 1):]
        try:
            params = extract_params_from_file(path)
        except Exception as exc:
            status = "✗ ERROR"
            counts["ERROR"] += 1
            errors.append((rel, str(exc)))
            print(f"{display:<{_COL_W}}  {'?':<8}  {'?':<30}  {status}  [{exc}]")
            continue

        if params is None:
            status = "— NONE"
            counts["NONE"] += 1
        elif params.get("positive_prompt"):
            status = "✓ PASS"
            counts["PASS"] += 1
        else:
            status = "⚠ WARN"
            counts["WARN"] += 1

        src_raw = (params or {}).get("formats") or []
        if isinstance(src_raw, str):
            import json as _j
            try:
                src_raw = _j.loads(src_raw)
            except Exception:
                src_raw = [src_raw]
        src = "+".join(src_raw) if src_raw else ""
        model = (params or {}).get("model", "") or ""
        if len(model) > 28:
            model = model[:27] + "…"
        print(f"{display:<{_COL_W}}  {src:<8}  {model:<30}  {status}")

    print()
    print(f"Total: {len(images)}  ✓ PASS: {counts['PASS']}  ⚠ WARN: {counts['WARN']}  "
          f"— NONE: {counts['NONE']}  ✗ ERROR: {counts['ERROR']}")

    if errors:
        print("\nErrors:")
        for rel, msg in errors:
            print(f"  {rel}: {msg}")

    if counts["ERROR"] > 0:
        return 1
    if fail_on_none and counts["NONE"] > 0:
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(description="Smoke-test the metadata parser on real images.")
    ap.add_argument("directory", nargs="?",
                    default=os.path.join(_ROOT, "..", "..", "examples"),
                    help="Directory to scan (default: ../../examples relative to repo root)")
    ap.add_argument("--fail-on-none", action="store_true",
                    help="Exit 1 if any image has no metadata (default: only fail on exceptions)")
    args = ap.parse_args()

    root = os.path.abspath(args.directory)
    if not os.path.isdir(root):
        print(f"ERROR: directory not found: {root}", file=sys.stderr)
        sys.exit(2)

    sys.exit(run(root, fail_on_none=args.fail_on_none))


if __name__ == "__main__":
    main()
