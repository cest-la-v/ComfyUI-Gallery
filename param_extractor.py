"""Python-side generation param extraction for SQLite indexing.

Handles two source formats:
  A1111  — 'parameters' text chunk (or EXIF UserComment promoted to 'parameters')
  ComfyUI — 'prompt' JSON; locates checkpoint loader + KSampler nodes

Intentionally simpler than the TypeScript parser: only extracts fields
needed for SQL grouping (model, model_hash, positive/negative prompt,
sampler, scheduler, steps, cfg_scale, seed, prompt_fingerprint).
Display-level normalization (sampler name mapping, etc.) lives in the frontend.
"""

import hashlib
import json
import os
import re
from typing import Optional

_CHECKPOINT_CLASS_TYPES = {"CheckpointLoaderSimple", "CheckpointLoader", "UNETLoader"}
_CLIP_TEXT_CLASS_TYPES = {"CLIPTextEncode", "CLIPTextEncodeSDXL"}
_KSAMPLER_CLASS_TYPES = {"KSampler", "KSamplerAdvanced"}

_A1111_FIELD_MAP = {
    "steps": "steps",
    "sampler": "sampler",
    "sampler name": "sampler",
    "cfg scale": "cfg_scale",
    "cfg": "cfg_scale",
    "seed": "seed",
    "model": "model",
    "model hash": "model_hash",
    "scheduler": "scheduler",
}


def _normalize_model_name(ckpt_name: str) -> str:
    """Strip directory and extension from a checkpoint name."""
    name = os.path.basename(ckpt_name)
    stem, _ = os.path.splitext(name)
    return stem


def _prompt_fingerprint(positive: str, negative: str, model: str) -> str:
    """Stable 8-byte hash for grouping images by prompt combination.

    Whitespace-normalizes each field before hashing. Uses \\x00 as separator
    to prevent ("ab", "c") from colliding with ("a", "bc").
    """
    def norm(s: str) -> str:
        return " ".join(s.lower().split())

    combined = "\x00".join([norm(positive), norm(negative), norm(model)])
    return hashlib.blake2b(combined.encode(), digest_size=8).hexdigest()


def _parse_a1111(parameters_text: str) -> Optional[dict]:
    """Extract structured fields from an A1111 parameters string."""
    if not parameters_text or not isinstance(parameters_text, str):
        return None

    lines = parameters_text.strip().split("\n")
    if not lines:
        return None

    positive_prompt = ""
    negative_prompt = ""
    last_line = ""

    # Find the "Negative prompt:" line
    neg_idx = None
    for i, line in enumerate(lines):
        if line.startswith("Negative prompt:"):
            neg_idx = i
            break

    # Find the parameters line (contains "Steps: N" and "Sampler:" or "Model:")
    def _find_param_line(search_lines):
        for i, line in enumerate(search_lines):
            if re.search(r"\bSteps:\s*\d+", line) and ("Sampler:" in line or "Model:" in line):
                return i
        return None

    if neg_idx is not None:
        positive_prompt = "\n".join(lines[:neg_idx]).strip()
        remaining = lines[neg_idx:]
        param_idx = _find_param_line(remaining)
        if param_idx is not None:
            first_neg = remaining[0][len("Negative prompt:"):].strip()
            neg_lines = remaining[1:param_idx]
            negative_prompt = "\n".join([first_neg] + neg_lines).strip()
            last_line = remaining[param_idx]
        else:
            negative_prompt = remaining[0][len("Negative prompt:"):].strip()
            last_line = lines[-1]
    else:
        param_idx = _find_param_line(lines)
        if param_idx is not None:
            positive_prompt = "\n".join(lines[:param_idx]).strip()
            last_line = lines[param_idx]
        else:
            positive_prompt = "\n".join(lines[:-1]).strip()
            last_line = lines[-1]

    # Parse the parameter line: "Steps: 20, Sampler: DPM++ 2M Karras, CFG scale: 7, ..."
    params: dict = {}
    if last_line:
        # Each key starts with a capital letter; values may contain commas (e.g. "DPM++ 2M Karras")
        # so we split by ", <Key>:" pattern
        pattern = r"([A-Za-z][A-Za-z0-9 ]+?):\s*(.*?)(?=,\s*[A-Za-z][A-Za-z0-9 ]+?:|$)"
        for m in re.finditer(pattern, last_line):
            key = m.group(1).strip().lower()
            val = m.group(2).strip().rstrip(",").strip()
            mapped = _A1111_FIELD_MAP.get(key)
            if mapped:
                params[mapped] = val

    result: dict = {"source": "a1111"}
    if positive_prompt:
        result["positive_prompt"] = positive_prompt
    if negative_prompt:
        result["negative_prompt"] = negative_prompt

    for k, v in params.items():
        if k in ("steps", "seed"):
            try:
                result[k] = int(v)
            except (ValueError, TypeError):
                pass
        elif k == "cfg_scale":
            try:
                result[k] = float(v)
            except (ValueError, TypeError):
                pass
        elif k == "model":
            result["model"] = _normalize_model_name(v)
        else:
            result[k] = v

    if not result.get("model") and not result.get("positive_prompt"):
        return None

    pos = result.get("positive_prompt", "")
    neg = result.get("negative_prompt", "")
    model = result.get("model", "")
    if pos or model:
        result["prompt_fingerprint"] = _prompt_fingerprint(pos, neg, model)

    return result


def _parse_comfyui(prompt_json: dict) -> Optional[dict]:
    """Extract model + prompts from a ComfyUI prompt JSON dict."""
    if not isinstance(prompt_json, dict):
        return None

    # Find checkpoint node
    model_raw = None
    for node in prompt_json.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") in _CHECKPOINT_CLASS_TYPES:
            inputs = node.get("inputs", {})
            ckpt = inputs.get("ckpt_name") or inputs.get("unet_name")
            if ckpt and not isinstance(ckpt, list):  # list = link to another node
                model_raw = ckpt
                break

    if not model_raw:
        return None

    model = _normalize_model_name(model_raw)
    result: dict = {"source": "comfyui", "model": model}

    # Find KSampler to get params + positive/negative node links
    positive_node_id: Optional[str] = None
    negative_node_id: Optional[str] = None

    for node in prompt_json.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") not in _KSAMPLER_CLASS_TYPES:
            continue
        inputs = node.get("inputs", {})

        pos_link = inputs.get("positive")
        neg_link = inputs.get("negative")
        if isinstance(pos_link, list) and len(pos_link) >= 1:
            positive_node_id = str(pos_link[0])
        if isinstance(neg_link, list) and len(neg_link) >= 1:
            negative_node_id = str(neg_link[0])

        for field, out_key in [
            ("sampler_name", "sampler"),
            ("scheduler", "scheduler"),
        ]:
            v = inputs.get(field)
            if isinstance(v, str):
                result[out_key] = v

        v = inputs.get("steps")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            result["steps"] = int(v)

        v = inputs.get("cfg")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            result["cfg_scale"] = float(v)

        v = inputs.get("noise_seed") or inputs.get("seed")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            result["seed"] = int(v)

        break  # use first KSampler found

    # Resolve CLIPTextEncode text for positive/negative
    def _get_clip_text(node_id: Optional[str]) -> Optional[str]:
        if not node_id or node_id not in prompt_json:
            return None
        node = prompt_json[node_id]
        if not isinstance(node, dict):
            return None
        if node.get("class_type") not in _CLIP_TEXT_CLASS_TYPES:
            return None
        text = node.get("inputs", {}).get("text")
        return text if isinstance(text, str) else None

    positive_text = _get_clip_text(positive_node_id)
    negative_text = _get_clip_text(negative_node_id)

    if positive_text:
        result["positive_prompt"] = positive_text
    if negative_text:
        result["negative_prompt"] = negative_text

    pos = positive_text or ""
    neg = negative_text or ""
    if pos or model:
        result["prompt_fingerprint"] = _prompt_fingerprint(pos, neg, model)

    return result


def extract_params(raw_metadata: dict) -> Optional[dict]:
    """Extract structured generation params from a buildMetadata() result dict.

    Returns a dict with keys: source, model, model_hash, positive_prompt,
    negative_prompt, sampler, scheduler, steps, cfg_scale, seed,
    prompt_fingerprint. Missing fields are absent (use .get()).
    Returns None if no recognizable metadata found.
    """
    if not isinstance(raw_metadata, dict):
        return None

    # A1111: parameters text chunk, or EXIF UserComment promoted to 'parameters'
    parameters = raw_metadata.get("parameters")
    if not parameters:
        exif_ifd = raw_metadata.get("ExifIFD", {})
        if isinstance(exif_ifd, dict):
            parameters = exif_ifd.get("UserComment")

    if parameters and isinstance(parameters, str) and "Steps:" in parameters:
        result = _parse_a1111(parameters)
        if result:
            return result

    # ComfyUI prompt JSON
    prompt_json = raw_metadata.get("prompt")
    if prompt_json:
        if isinstance(prompt_json, str):
            try:
                prompt_json = json.loads(prompt_json)
            except (json.JSONDecodeError, ValueError):
                prompt_json = None
        if isinstance(prompt_json, dict):
            result = _parse_comfyui(prompt_json)
            if result:
                return result

    return None
