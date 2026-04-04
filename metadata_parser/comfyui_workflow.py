"""ComfyUI `workflow` JSON extractor.

The `workflow` chunk has a different structure from `prompt`:
  - `nodes`: list of node dicts, each with integer `id`, `type`, `inputs` (widget_values list)
  - `links`: list of [link_id, src_node_id, src_slot, dst_node_id, dst_slot, type_name]

Node IDs are integers. Links resolve by matching dst_node_id + dst_slot.
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

# KSampler widget_values indices (standard order in ComfyUI workflow JSON)
_KS_SEED = 0
_KS_STEPS = 2
_KS_CFG = 3
_KS_SAMPLER = 4
_KS_SCHEDULER = 5
_KS_DENOISE = 6


def parse(workflow_json: object) -> Optional[dict]:
    """Extract generation params from a ComfyUI workflow JSON object.

    Returns None if no checkpoint node is found.
    """
    if isinstance(workflow_json, str):
        try:
            workflow_json = json.loads(workflow_json)
        except (ValueError, json.JSONDecodeError):
            return None
    if not isinstance(workflow_json, dict):
        return None

    raw_nodes: list = workflow_json.get("nodes") or []
    raw_links: list = workflow_json.get("links") or []

    if not raw_nodes:
        return None

    # Index nodes by id
    nodes_by_id: dict[int, dict] = {}
    for n in raw_nodes:
        if isinstance(n, dict) and isinstance(n.get("id"), int):
            nodes_by_id[n["id"]] = n

    # Build link map: (dst_node_id, dst_slot) → src_node_id
    link_map: dict[tuple[int, int], int] = {}
    for link in raw_links:
        # link = [link_id, src_node, src_slot, dst_node, dst_slot, type]
        if isinstance(link, list) and len(link) >= 5:
            try:
                link_map[(int(link[3]), int(link[4]))] = int(link[1])
            except (ValueError, TypeError):
                pass

    # --- Checkpoint → model ---
    model_raw: Optional[str] = None
    for node in nodes_by_id.values():
        if node.get("type") in _CHECKPOINT_TYPES:
            wv = node.get("widgets_values") or []
            if wv and isinstance(wv[0], str) and not _is_link_widget(wv[0]):
                model_raw = wv[0]
                break

    if not model_raw:
        return None

    model = normalize_model_name(model_raw)
    result: dict = {"formats": ["comfyui"], "model": model}

    # --- KSampler → params + linked pos/neg node IDs ---
    positive_id: Optional[int] = None
    negative_id: Optional[int] = None

    for node in nodes_by_id.values():
        if node.get("type") not in _KSAMPLER_TYPES:
            continue
        node_id: int = node["id"]
        wv = node.get("widgets_values") or []
        inputs = node.get("inputs") or []

        # Resolve seed/steps/cfg/sampler/scheduler from widget_values
        try:
            if len(wv) > _KS_SEED and isinstance(wv[_KS_SEED], (int, float)):
                result["seed"] = int(wv[_KS_SEED])
            if len(wv) > _KS_STEPS and isinstance(wv[_KS_STEPS], (int, float)):
                result["steps"] = int(wv[_KS_STEPS])
            if len(wv) > _KS_CFG and isinstance(wv[_KS_CFG], (int, float)):
                result["cfg_scale"] = float(wv[_KS_CFG])
            if len(wv) > _KS_SAMPLER and isinstance(wv[_KS_SAMPLER], str):
                result["sampler"] = normalize_sampler(wv[_KS_SAMPLER])
            if len(wv) > _KS_SCHEDULER and isinstance(wv[_KS_SCHEDULER], str):
                result["scheduler"] = normalize_scheduler(wv[_KS_SCHEDULER])
        except (IndexError, TypeError):
            pass

        # Resolve positive/negative via links
        for slot_idx, inp in enumerate(inputs):
            if not isinstance(inp, dict):
                continue
            name = inp.get("name", "").lower()
            linked_node = link_map.get((node_id, slot_idx))
            if linked_node is not None:
                if name == "positive":
                    positive_id = linked_node
                elif name == "negative":
                    negative_id = linked_node

        break  # use first KSampler

    # --- Resolve CLIP text nodes ---
    positive_text = _resolve_clip_text(nodes_by_id, positive_id)
    negative_text = _resolve_clip_text(nodes_by_id, negative_id)

    if positive_text:
        result["positive_prompt"] = positive_text
    if negative_text:
        result["negative_prompt"] = negative_text

    # --- LoRA nodes ---
    loras = _extract_loras(nodes_by_id)
    if loras:
        result["loras"] = loras

    # --- Fingerprint ---
    pos = positive_text or ""
    neg = negative_text or ""
    if pos or model:
        result["prompt_fingerprint"] = prompt_fingerprint(pos, neg, model)

    return result


def _is_link_widget(val: object) -> bool:
    """Widget values that are link references look like lists in the raw JSON."""
    return isinstance(val, list)


def _resolve_clip_text(nodes_by_id: dict[int, dict], node_id: Optional[int]) -> Optional[str]:
    if node_id is None:
        return None
    node = nodes_by_id.get(node_id)
    if not isinstance(node, dict):
        return None
    if node.get("type") not in _CLIP_TEXT_TYPES:
        return None
    wv = node.get("widgets_values") or []
    text = wv[0] if wv else None
    return text if isinstance(text, str) else None


def _extract_loras(nodes_by_id: dict[int, dict]) -> list[dict]:
    loras: list[dict] = []
    seen: set[str] = set()
    for node in nodes_by_id.values():
        ct = node.get("type", "")
        wv = node.get("widgets_values") or []
        if ct in ("LoraLoader", "LoraLoaderModelOnly"):
            name = wv[0] if wv else None
            if isinstance(name, str) and name not in seen:
                seen.add(name)
                loras.append({
                    "name": normalize_model_name(name),
                    "model_strength": wv[1] if len(wv) > 1 else None,
                    "clip_strength": wv[2] if len(wv) > 2 else None,
                })
    return loras
