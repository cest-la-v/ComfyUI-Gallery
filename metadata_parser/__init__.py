"""Generic, multi-pass metadata extractor for AI-generated images.

Architecture mirrors web/src/metadata-parser/ — each format is an isolated
module exposing a `parse(raw_metadata)` function that returns a normalized
dict or None. The orchestrator runs all applicable parsers and merges results:

  1. A1111 / Civitai  (`parameters` text chunk or EXIF UserComment)
  2. ComfyUI prompt   (`prompt` JSON, string node IDs)
  3. ComfyUI workflow (`workflow` JSON, integer node IDs + links array)

When multiple parsers succeed, results are merged: ComfyUI fields take
priority (structurally precise); A1111 fills any gaps. `formats` is a list
of all parsers that contributed (e.g. ["a1111", "comfyui"]), allowing callers
to know which metadata sources were present in the image.

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
        formats (list[str]: which parsers contributed, e.g. ["a1111", "comfyui"]),
        model, model_hash, positive_prompt, negative_prompt,
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
    a1111_result: Optional[dict] = None
    if parameters and isinstance(parameters, str) and parameters.strip():
        a1111_result = _a1111.parse(parameters)

    # --- Pass 2: ComfyUI prompt JSON ---
    comfyui_result: Optional[dict] = None
    prompt_json = raw_metadata.get("prompt")
    if prompt_json:
        comfyui_result = _prompt.parse(prompt_json)

    # --- Pass 3: ComfyUI workflow JSON (only if prompt JSON yielded nothing) ---
    if not comfyui_result:
        workflow_json = raw_metadata.get("workflow")
        if workflow_json:
            comfyui_result = _workflow.parse(workflow_json)

    # Nothing found at all
    if not a1111_result and not comfyui_result:
        return None

    # Only one source — return it directly
    if not comfyui_result:
        return a1111_result
    if not a1111_result:
        return comfyui_result

    # Both sources found: merge.
    # Strategy: start with A1111, overlay with ComfyUI (ComfyUI wins on
    # every field where it has a non-None value — it's structurally precise).
    # A1111-only fields (extras, loras extracted from prompt text, hires_*)
    # are kept when ComfyUI doesn't provide them.
    merged = dict(a1111_result)
    for k, v in comfyui_result.items():
        if v is not None:
            merged[k] = v

    # Collect formats from both parsers (e.g. ["a1111", "comfyui"])
    a1111_formats = a1111_result.get("formats") or ["a1111"]
    comfyui_formats = comfyui_result.get("formats") or ["comfyui"]
    merged["formats"] = sorted(set(a1111_formats) | set(comfyui_formats))

    return merged



def extract_params_from_file(image_path: str) -> Optional[dict]:
    """Convenience: open an image, call buildMetadata(), then extract_params()."""
    from ._extractor import buildMetadata
    _, _, raw = buildMetadata(image_path)
    return extract_params(raw)


def params_to_json_columns(params: dict) -> dict:
    """Convert list/dict values in params to JSON strings for SQLite storage."""
    result = dict(params)
    if isinstance(result.get("formats"), list):
        result["formats"] = json.dumps(result["formats"], ensure_ascii=False)
    if isinstance(result.get("loras"), list):
        result["loras"] = json.dumps(result["loras"], ensure_ascii=False)
    if isinstance(result.get("extras"), dict):
        result["extras"] = json.dumps(result["extras"], ensure_ascii=False)
    return result
