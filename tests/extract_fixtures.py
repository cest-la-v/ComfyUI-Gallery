#!/usr/bin/env python3
"""One-off helper: extract raw metadata from all images in a directory.

Dumps the PNG text chunks / EXIF data (no pixel data) as JSON to stdout.
Use this to discover fixture candidates; pick one per pattern, desensitize,
and save under tests/fixtures/.

Usage:
    cd ComfyUI-Gallery
    python tests/extract_fixtures.py ../../examples [--limit N] [--pattern a1111|comfyui|none]
"""
import sys
import os
import json
import argparse

# Bootstrap package so relative imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from metadata_parser._extractor import buildMetadata  # noqa: E402
from metadata_parser import extract_params            # noqa: E402

IMAGE_EXTS = frozenset([".png", ".jpg", ".jpeg", ".webp"])


def collect_images(root: str) -> list[str]:
    found = []
    for dirpath, _, filenames in os.walk(root):
        for fn in sorted(filenames):
            if os.path.splitext(fn.lower())[1] in IMAGE_EXTS:
                found.append(os.path.join(dirpath, fn))
    return found


def classify(raw: dict, params: dict | None) -> str:
    if params is None:
        return "none"
    src = params.get("source", "")
    if src == "a1111":
        loras = params.get("loras")
        hires = params.get("hires_upscaler")
        exif = bool(raw.get("ExifIFD", {}).get("UserComment"))
        if exif:
            return "a1111_jpeg_exif"
        if hires:
            return "a1111_hires"
        if loras:
            return "a1111_loras"
        return "a1111_basic"
    if src == "comfyui":
        has_prompt = bool(raw.get("prompt"))
        has_workflow = bool(raw.get("workflow"))
        loras = params.get("loras")
        if has_prompt and loras:
            return "comfyui_prompt_complex"
        if has_prompt:
            return "comfyui_prompt_simple"
        if has_workflow:
            return "comfyui_workflow"
    return "unknown"


def main():
    ap = argparse.ArgumentParser(description="Extract raw metadata fixture candidates.")
    ap.add_argument("directory", nargs="?", default="../../examples", help="Image root directory")
    ap.add_argument("--limit", type=int, default=0, help="Max images to scan (0 = all)")
    ap.add_argument("--pattern", default="", help="Only print images matching this pattern")
    ap.add_argument("--one-per-pattern", action="store_true", help="Print only the first match per pattern")
    args = ap.parse_args()

    root = os.path.abspath(args.directory)
    images = collect_images(root)
    if args.limit:
        images = images[: args.limit]

    seen_patterns: set = set()
    results = []

    for path in images:
        try:
            _, _, raw = buildMetadata(path)
        except Exception as exc:
            results.append({"file": os.path.relpath(path, root), "error": str(exc)})
            continue

        try:
            params = extract_params(raw)
        except Exception as exc:
            results.append({"file": os.path.relpath(path, root), "error": f"parse: {exc}"})
            continue

        pattern = classify(raw, params)

        if args.pattern and pattern != args.pattern:
            continue
        if args.one_per_pattern:
            if pattern in seen_patterns:
                continue
            seen_patterns.add(pattern)

        # Emit: the raw metadata chunks (no pixel data) + detected pattern + key parsed fields
        entry: dict = {
            "file": os.path.relpath(path, root),
            "pattern": pattern,
            "raw_keys": list(raw.keys()),
        }
        # Include raw metadata chunks (the actual fixture material)
        for key in ("parameters", "workflow", "prompt"):
            if raw.get(key):
                val = raw[key]
                if isinstance(val, str) and len(val) > 2000:
                    val = val[:2000] + "...[truncated]"
                entry[key] = val
        exif_comment = raw.get("ExifIFD", {}).get("UserComment") if isinstance(raw.get("ExifIFD"), dict) else None
        if exif_comment:
            entry["ExifIFD"] = {"UserComment": exif_comment[:2000] if len(exif_comment) > 2000 else exif_comment}

        # Summary of parsed params (for quick review, not the fixture itself)
        if params:
            entry["parsed"] = {
                k: v for k, v in params.items()
                if k in ("source", "model", "sampler", "scheduler", "steps", "cfg_scale", "seed")
                and v is not None
            }
            loras = params.get("loras")
            if loras:
                entry["parsed"]["lora_count"] = len(loras) if isinstance(loras, list) else "?"

        results.append(entry)

    print(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n# Total: {len(results)} images", file=sys.stderr)
    counts: dict = {}
    for r in results:
        p = r.get("pattern", "error")
        counts[p] = counts.get(p, 0) + 1
    for p, n in sorted(counts.items()):
        print(f"#   {p}: {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
