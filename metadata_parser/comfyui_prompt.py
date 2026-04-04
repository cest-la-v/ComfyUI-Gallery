"""ComfyUI `prompt` JSON extractor.

The `prompt` chunk is a dict keyed by string node IDs (e.g. "42", "752:753").
Each node has `class_type` and `inputs` dict. Links are `[node_id, output_index]`.
"""
import json
from typing import Optional

from .normalizer import normalize_model_name, normalize_sampler, normalize_scheduler
from .fingerprint import prompt_fingerprint

_CHECKPOINT_TYPES = frozenset({
    "CheckpointLoaderSimple", "CheckpointLoader",
    "UNETLoader", "unCLIPCheckpointLoader",
})
_KSAMPLER_TYPES = frozenset({
    "KSampler", "KSamplerAdvanced",
})
_CLIP_TEXT_TYPES = frozenset({
    "CLIPTextEncode", "CLIPTextEncodeSDXL", "CLIPTextEncodeSDXLRefiner",
})
_LORA_TYPES = frozenset({
    "LoraLoader", "LoraLoaderModelOnly",
    "Power Lora Loader (rgthree)",
})


def _is_link(val: object) -> bool:
    """True if val looks like a node output link [node_id, output_index]."""
    return isinstance(val, list) and len(val) >= 2


def parse(prompt_json: object) -> Optional[dict]:
    """Extract generation params from a ComfyUI prompt JSON dict.

    Returns None if no checkpoint node is found.
    """
    if isinstance(prompt_json, str):
        try:
            prompt_json = json.loads(prompt_json)
        except (ValueError, json.JSONDecodeError):
            return None
    if not isinstance(prompt_json, dict):
        return None

    nodes = prompt_json  # {node_id_str: {class_type, inputs, ...}}

    # --- Checkpoint → model ---
    model_raw: Optional[str] = None
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") in _CHECKPOINT_TYPES:
            inp = node.get("inputs", {})
            ckpt = inp.get("ckpt_name") or inp.get("unet_name")
            if ckpt and not _is_link(ckpt):
                model_raw = str(ckpt)
                break

    if not model_raw:
        return None

    model = normalize_model_name(model_raw)
    result: dict = {"source": "comfyui", "model": model}

    # --- KSampler → params + pos/neg node IDs ---
    positive_id: Optional[str] = None
    negative_id: Optional[str] = None

    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") not in _KSAMPLER_TYPES:
            continue
        inp = node.get("inputs", {})

        pos_link = inp.get("positive")
        if _is_link(pos_link):
            positive_id = str(pos_link[0])

        neg_link = inp.get("negative")
        if _is_link(neg_link):
            negative_id = str(neg_link[0])

        sampler_raw = inp.get("sampler_name")
        if isinstance(sampler_raw, str):
            result["sampler"] = normalize_sampler(sampler_raw)

        scheduler_raw = inp.get("scheduler")
        if isinstance(scheduler_raw, str):
            result["scheduler"] = normalize_scheduler(scheduler_raw)

        steps = inp.get("steps")
        if isinstance(steps, (int, float)) and not isinstance(steps, bool):
            result["steps"] = int(steps)

        cfg = inp.get("cfg")
        if isinstance(cfg, (int, float)) and not isinstance(cfg, bool):
            result["cfg_scale"] = float(cfg)

        seed = inp.get("noise_seed") or inp.get("seed")
        if isinstance(seed, (int, float)) and not isinstance(seed, bool):
            result["seed"] = int(seed)

        break  # use first KSampler found

    # --- Resolve CLIP text nodes for prompts ---
    positive_text = _resolve_clip_text(nodes, positive_id)
    negative_text = _resolve_clip_text(nodes, negative_id)

    if positive_text:
        result["positive_prompt"] = positive_text
    if negative_text:
        result["negative_prompt"] = negative_text

    # --- LoRA nodes ---
    loras = _extract_loras(nodes)
    if loras:
        result["loras"] = loras

    # --- Fingerprint ---
    pos = positive_text or ""
    neg = negative_text or ""
    if pos or model:
        result["prompt_fingerprint"] = prompt_fingerprint(pos, neg, model)

    return result


def _resolve_clip_text(nodes: dict, node_id: Optional[str]) -> Optional[str]:
    """Follow a CLIP node link and return its text input, or None."""
    if not node_id:
        return None
    node = nodes.get(node_id)
    if not isinstance(node, dict):
        return None
    if node.get("class_type") not in _CLIP_TEXT_TYPES:
        return None
    text = node.get("inputs", {}).get("text")
    return text if isinstance(text, str) else None


def _extract_loras(nodes: dict) -> list[dict]:
    loras: list[dict] = []
    seen: set[str] = set()
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inp = node.get("inputs", {})
        if ct in ("LoraLoader", "LoraLoaderModelOnly"):
            name = inp.get("lora_name")
            if name and not _is_link(name) and name not in seen:
                seen.add(name)
                loras.append({
                    "name": normalize_model_name(str(name)),
                    "model_strength": inp.get("strength_model"),
                    "clip_strength": inp.get("strength_clip"),
                })
        elif ct == "Power Lora Loader (rgthree)":
            for key, val in inp.items():
                if isinstance(val, dict) and val.get("on") and val.get("lora"):
                    name = str(val["lora"])
                    if name not in seen:
                        seen.add(name)
                        loras.append({
                            "name": normalize_model_name(name),
                            "model_strength": val.get("strength"),
                        })
    return loras
