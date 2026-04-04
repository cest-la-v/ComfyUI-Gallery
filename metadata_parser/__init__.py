"""Generic, multi-pass metadata extractor for AI-generated images.

Architecture mirrors web/src/metadata-parser/ — each format is an isolated
module exposing a `parse(raw_metadata)` function that returns a normalized
dict or None. The orchestrator tries passes in priority order:

  1. A1111 / Civitai  (`parameters` text chunk or EXIF UserComment)
  2. ComfyUI prompt   (`prompt` JSON, string node IDs)
  3. ComfyUI workflow (`workflow` JSON, integer node IDs + links array)

First non-None result wins. Grouping (prompt_fingerprint) is a by-product
of extraction, not its purpose.

Public API
----------
extract_params(raw_metadata)          # from a buildMetadata() dict
extract_params_from_file(image_path)  # convenience wrapper
"""
from __future__ import annotations

import json
import os
from typing import Optional

from . import a1111 as _a1111
from . import comfyui_prompt as _prompt
from . import comfyui_workflow as _workflow

__all__ = ["extract_params", "extract_params_from_file"]


def extract_params(raw_metadata: dict) -> Optional[dict]:
    """Extract normalized generation params from a buildMetadata() result.

    Returns a dict with any subset of:
        source, model, model_hash, positive_prompt, negative_prompt,
        sampler, scheduler, steps, cfg_scale, seed,
        vae, clip_skip, denoise_strength,
        hires_upscaler, hires_steps, hires_denoise,
        loras (list of {name, model_strength, clip_strength}),
        extras (dict of remaining A1111 key-value pairs),
        prompt_fingerprint
    Returns None if no recognizable metadata is found.
    """
    if not isinstance(raw_metadata, dict):
        return None

    # --- Pass 1: A1111 ---
    parameters = raw_metadata.get("parameters")
    if not parameters:
        exif_ifd = raw_metadata.get("ExifIFD", {})
        if isinstance(exif_ifd, dict):
            parameters = exif_ifd.get("UserComment")
    if parameters and isinstance(parameters, str) and "Steps:" in parameters:
        result = _a1111.parse(parameters)
        if result:
            return result

    # --- Pass 2: ComfyUI prompt JSON ---
    prompt_json = raw_metadata.get("prompt")
    if prompt_json:
        result = _prompt.parse(prompt_json)
        if result:
            return result

    # --- Pass 3: ComfyUI workflow JSON ---
    workflow_json = raw_metadata.get("workflow")
    if workflow_json:
        result = _workflow.parse(workflow_json)
        if result:
            return result

    return None


def extract_params_from_file(image_path: str) -> Optional[dict]:
    """Convenience: open an image, call buildMetadata(), then extract_params()."""
    try:
        from ..metadata_extractor import buildMetadata  # relative import when used as subpackage
    except ImportError:
        # Fallback for standalone/CLI use
        import sys
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from metadata_extractor import buildMetadata  # type: ignore[import]

    _, _, raw = buildMetadata(image_path)
    return extract_params(raw)


def params_to_json_columns(params: dict) -> dict:
    """Convert list/dict values in params to JSON strings for SQLite storage."""
    result = dict(params)
    if isinstance(result.get("loras"), list):
        result["loras"] = json.dumps(result["loras"], ensure_ascii=False)
    if isinstance(result.get("extras"), dict):
        result["extras"] = json.dumps(result["extras"], ensure_ascii=False)
    return result
