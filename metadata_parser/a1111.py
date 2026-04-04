"""A1111-compatible parameters text chunk parser.

Handles the `parameters` PNG text chunk written by Automatic1111, ComfyUI
(with our generation context patch), and most other SD frontends.

Format:
    <positive prompt lines>
    Negative prompt: <negative prompt lines>
    Steps: 20, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 42, ...
"""
import re
from typing import Optional

from .normalizer import normalize_model_name, split_a1111_sampler_scheduler

# Maps lowercased A1111 key → internal field name
_KEY_MAP: dict[str, str] = {
    "steps":              "steps",
    "sampler":            "sampler",
    "sampler name":       "sampler",
    "schedule type":      "scheduler",
    "scheduler":          "scheduler",
    "cfg scale":          "cfg_scale",
    "cfg":                "cfg_scale",
    "seed":               "seed",
    "model":              "model",
    "model hash":         "model_hash",
    "vae":                "vae",
    "vae hash":           "vae_hash",
    "clip skip":          "clip_skip",
    "denoising strength": "denoise_strength",
    "hires upscale":      "hires_upscale",
    "hires upscaler":     "hires_upscaler",
    "hires steps":        "hires_steps",
    "hires denoising strength": "hires_denoise",
    "lora hashes":        "lora_hashes",  # supplementary; extracted from <lora:> tags
}

# Keys that are structural (handled explicitly) — not put into extras
_STRUCTURAL_KEYS = frozenset(_KEY_MAP.keys()) | {"negative prompt"}


def parse(parameters_text: str) -> Optional[dict]:
    """Parse an A1111 parameters string into a structured dict.

    Returns None if the text doesn't look like A1111 output.

    Returned keys (all optional): source, positive_prompt, negative_prompt,
    model, model_hash, sampler, scheduler, steps, cfg_scale, seed,
    vae, clip_skip, denoise_strength, hires_upscaler, hires_steps,
    hires_denoise, loras, extras, prompt_fingerprint.
    """
    if not isinstance(parameters_text, str):
        return None
    text = parameters_text.strip()
    if not text:
        return None

    lines = text.split("\n")

    # Locate "Negative prompt:" and parameter line
    neg_idx: Optional[int] = None
    param_idx: Optional[int] = None

    for i, line in enumerate(lines):
        if line.startswith("Negative prompt:") and neg_idx is None:
            neg_idx = i
        if _is_param_line(line) and param_idx is None:
            param_idx = i

    positive_prompt, negative_prompt = _split_prompts(lines, neg_idx, param_idx)

    if param_idx is None:
        # No recognizable parameter line
        if not positive_prompt:
            return None
        return {"formats": ["a1111"], "positive_prompt": positive_prompt}

    raw_kv = _parse_param_line(lines[param_idx])

    # Also scan remaining lines after param_idx for multi-line param continuations
    # (rare but A1111 sometimes wraps ADetailer etc.)
    for line in lines[param_idx + 1:]:
        raw_kv.update(_parse_param_line(line))

    result: dict = {"formats": ["a1111"]}
    extras: dict[str, str] = {}

    if positive_prompt:
        result["positive_prompt"] = positive_prompt
    if negative_prompt:
        result["negative_prompt"] = negative_prompt

    for key_low, val in raw_kv.items():
        mapped = _KEY_MAP.get(key_low)
        if mapped == "model":
            result["model"] = normalize_model_name(val)
        elif mapped == "model_hash":
            result["model_hash"] = val
        elif mapped == "steps":
            result["steps"] = _to_int(val)
        elif mapped == "cfg_scale":
            result["cfg_scale"] = _to_float(val)
        elif mapped == "seed":
            result["seed"] = _to_int(val)
        elif mapped == "sampler":
            sampler, sched = split_a1111_sampler_scheduler(val)
            result["sampler"] = sampler
            if sched and "scheduler" not in result:
                result["scheduler"] = sched
        elif mapped == "scheduler":
            result["scheduler"] = val
        elif mapped == "vae":
            result["vae"] = val
        elif mapped == "clip_skip":
            result["clip_skip"] = _to_int(val)
        elif mapped == "denoise_strength":
            result["denoise_strength"] = _to_float(val)
        elif mapped == "hires_upscale":
            result.setdefault("hires_upscaler", val)
        elif mapped == "hires_upscaler":
            result["hires_upscaler"] = val
        elif mapped == "hires_steps":
            result["hires_steps"] = _to_int(val)
        elif mapped == "hires_denoise":
            result["hires_denoise"] = _to_float(val)
        elif mapped == "lora_hashes":
            # Lora hashes line is supplementary info; actual LoRAs are extracted
            # from <lora:name:weight> tags in the positive prompt below.
            # Store as extra so it's not lost.
            extras["lora_hashes"] = val
        else:
            # Unknown key → extras dict
            if key_low not in _STRUCTURAL_KEYS:
                extras[key_low] = val

    if extras:
        result["extras"] = extras

    # Extract <lora:name:weight> tags from positive prompt
    pos_text = result.get("positive_prompt", "")
    if pos_text:
        lora_pattern = re.compile(r"<lora:([^:>]+):([^>]+)>", re.IGNORECASE)
        loras = []
        for m in lora_pattern.finditer(pos_text):
            name = m.group(1).strip()
            try:
                strength = float(m.group(2))
            except ValueError:
                strength = 1.0
            loras.append({"name": normalize_model_name(name) or name, "model_strength": strength, "clip_strength": strength})
        if loras:
            result["loras"] = loras

    # Fingerprint
    pos = result.get("positive_prompt", "")
    neg = result.get("negative_prompt", "")
    model = result.get("model", "")
    if pos or model:
        from .fingerprint import prompt_fingerprint
        result["prompt_fingerprint"] = prompt_fingerprint(pos, neg, model)

    if not result.get("model") and not result.get("positive_prompt"):
        return None

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_param_line(line: str) -> bool:
    return bool(
        re.search(r"\bSteps:\s*\d+", line)
        and ("Sampler:" in line or "Model:" in line)
    )


def _split_prompts(
    lines: list[str],
    neg_idx: Optional[int],
    param_idx: Optional[int],
) -> tuple[str, str]:
    positive = ""
    negative = ""

    if neg_idx is not None:
        positive = "\n".join(lines[:neg_idx]).strip()
        neg_start = neg_idx
        neg_end = param_idx if param_idx is not None and param_idx > neg_idx else len(lines)
        neg_lines = lines[neg_start:neg_end]
        first = neg_lines[0][len("Negative prompt:"):].strip()
        rest = neg_lines[1:]
        negative = "\n".join([first] + rest).strip()
    elif param_idx is not None:
        positive = "\n".join(lines[:param_idx]).strip()
    else:
        positive = "\n".join(lines).strip()

    return positive, negative


_PARAM_RE = re.compile(
    r"([A-Za-z][A-Za-z0-9 ]+?):\s*(.*?)(?=,\s*[A-Za-z][A-Za-z0-9 ]+?:|$)"
)


def _parse_param_line(line: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for m in _PARAM_RE.finditer(line):
        key = m.group(1).strip().lower()
        val = m.group(2).strip().rstrip(",").strip()
        result[key] = val
    return result


def _to_int(val: str) -> Optional[int]:
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _to_float(val: str) -> Optional[float]:
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
