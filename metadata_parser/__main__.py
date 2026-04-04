#!/usr/bin/env python3
"""CLI entry point: python -m metadata_parser <image_path> [image_path ...]

Extracts and prints normalized generation metadata from image files.

Usage:
    python -m metadata_parser output/image.png
    python -m metadata_parser *.png --json
    python -m metadata_parser image.png --source civitai
"""
import argparse
import json
import sys
import os


def main():
    parser = argparse.ArgumentParser(
        prog="python -m metadata_parser",
        description="Extract AI generation metadata from image files.",
    )
    parser.add_argument("images", nargs="+", metavar="IMAGE", help="Image file path(s)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument(
        "--source",
        choices=["auto", "a1111", "comfyui"],
        default="auto",
        help="Force a specific extraction pass (default: auto)",
    )
    args = parser.parse_args()

    # Ensure parent package is importable
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    try:
        from metadata_parser._extractor import buildMetadata  # type: ignore[import]
    except ImportError:
        print("ERROR: metadata_parser package not found. Run from the ComfyUI-Gallery root.", file=sys.stderr)
        sys.exit(1)

    from metadata_parser import extract_params
    from metadata_parser import a1111 as _a1111
    from metadata_parser import comfyui_prompt as _prompt
    from metadata_parser import comfyui_workflow as _workflow

    results = []
    for path in args.images:
        entry: dict = {"file": path}
        try:
            _, _, raw = buildMetadata(path)
        except FileNotFoundError:
            entry["error"] = "File not found"
            results.append(entry)
            continue
        except Exception as exc:
            entry["error"] = str(exc)
            results.append(entry)
            continue

        if args.source == "a1111":
            params_text = raw.get("parameters") or raw.get("ExifIFD", {}).get("UserComment")
            params = _a1111.parse(params_text or "")
        elif args.source == "comfyui":
            params = _prompt.parse(raw.get("prompt")) or _workflow.parse(raw.get("workflow"))
        else:
            params = extract_params(raw)

        entry["params"] = params
        results.append(entry)

    if args.json:
        print(json.dumps(results if len(results) > 1 else results[0], indent=2, ensure_ascii=False))
    else:
        for entry in results:
            print(f"\n=== {entry['file']} ===")
            if "error" in entry:
                print(f"  ERROR: {entry['error']}")
                continue
            params = entry.get("params")
            if not params:
                print("  (no recognized metadata)")
                continue
            for key, val in params.items():
                if key == "prompt_fingerprint":
                    continue
                if isinstance(val, (list, dict)):
                    val = json.dumps(val, ensure_ascii=False)
                print(f"  {key}: {val}")


if __name__ == "__main__":
    main()
