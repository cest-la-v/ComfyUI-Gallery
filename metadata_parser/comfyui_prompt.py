"""ComfyUI `prompt` JSON extractor.

The `prompt` chunk is a dict keyed by string node IDs (e.g. "42", "752:753").
Each node has `class_type` and `inputs` dict. Links are `[node_id, output_index]`.

Three-pass extraction (mirrors promptMetadataParser.ts):
  Pass 1 — known class-type fast path (KSampler, CLIPTextEncode, etc.)
  Pass 2 — hub-first BFS: find node with pos+neg link inputs, walk upstream, score
  Pass 3 — global scored fallback: score ALL nodes for param-like fields

Generic model resolution follows link chains until .safetensors/.ckpt found.
Generic prompt heuristics use keyword scoring — no node type knowledge required.
Always returns partial results; never gated on finding a specific node type.
"""
import json
from typing import Optional

from .normalizer import normalize_model_name, normalize_sampler, normalize_scheduler
from .fingerprint import prompt_fingerprint

# --- Known type sets for Pass 1 fast path only ---

_CHECKPOINT_TYPES = frozenset({
    "CheckpointLoaderSimple", "CheckpointLoader", "CheckpointLoader|pysssss",
    "UNETLoader", "unCLIPCheckpointLoader", "ModelLoader",
    "Checkpoint Loader (Simple)", "Sage_CheckpointSelector",
})
_KSAMPLER_TYPES = frozenset({
    "KSampler", "KSamplerAdvanced", "SamplerCustom",
    "FaceDetailerPipe", "Sage_KSampler",
})
_CLIP_TEXT_TYPES = frozenset({
    "CLIPTextEncode", "CLIPTextEncodeSDXL", "CLIPTextEncodeSDXLRefiner",
    "CLIPTextEncodeSDXL+", "BNK_CLIPTextEncodeAdvanced",
    "BNK_CLIPTextEncodeSDXLAdvanced", "Sage_DualCLIPTextEncode",
})

# Field specs: (input_name, result_key, type)
_SAMPLER_FIELD_SPECS: list[tuple[str, str, str]] = [
    ("steps",        "steps",      "int"),
    ("cfg",          "cfg_scale",  "float"),
    ("cfg_scale",    "cfg_scale",  "float"),
    ("sampler_name", "sampler",    "str"),
    ("scheduler",    "scheduler",  "str"),
    ("seed",         "seed",       "int"),
    ("noise_seed",   "seed",       "int"),
    ("ckpt_name",    "model",      "model"),
]

# Prompt heuristic keywords (mirrors validator.ts)
_STRONG_NEGATIVE = frozenset(["worst quality", "low quality", "bad", "ugly", "blurry",
                               "distorted", "deformed", "amateur", "poor quality"])
_STRONG_POSITIVE = frozenset(["masterpiece", "best quality", "high quality", "detailed",
                               "professional", "photorealistic", "stunning", "beautiful"])
_NEG_KEYWORDS = ["negative", "bad", "worst quality", "low quality", "poor quality",
                 "blurry", "distorted", "ugly", "deformed", "artifact", "noise",
                 "overexposed", "underexposed", "cropped", "out of frame"]
_POS_KEYWORDS = ["positive", "masterpiece", "best quality", "high quality", "detailed",
                 "beautiful", "amazing", "stunning", "perfect", "photorealistic",
                 "professional", "artistic", "elegant"]


def _is_link(val: object) -> bool:
    """True if val looks like a node output link [node_id, output_index]."""
    return isinstance(val, list) and len(val) >= 2


def _is_model_filename(val: object) -> bool:
    return isinstance(val, str) and (val.endswith(".safetensors") or val.endswith(".ckpt"))


def _is_plain_prompt(val: object) -> bool:
    """True if val looks like a prompt string (not a JSON structure, not empty)."""
    if not isinstance(val, str):
        return False
    t = val.strip()
    if not t:
        return False
    # Reject strings that are valid JSON objects or arrays (but NOT plain strings that
    # happen to start/end with brackets — e.g. "[lora:name]" is a valid prompt).
    if t.startswith("{") and t.endswith("}"):
        try:
            import json as _json
            v = _json.loads(t)
            if isinstance(v, dict):
                return False
        except (ValueError, TypeError):
            pass
    if t.startswith("[") and t.endswith("]"):
        try:
            import json as _json
            v = _json.loads(t)
            if isinstance(v, list):
                return False
        except (ValueError, TypeError):
            pass
    if len(t) > 2000 and t.count(",") > 100:
        return False
    return True


def _is_positive_prompt(text: str) -> bool:
    lo = text.lower()
    if any(k in lo for k in _STRONG_NEGATIVE):
        return False
    if any(k in lo for k in _STRONG_POSITIVE):
        return True
    pos = sum(1 for k in _POS_KEYWORDS if k in lo)
    neg = sum(1 for k in _NEG_KEYWORDS if k in lo)
    return (pos + (1 if len(text) > 50 else 0)) > neg and pos > 0


def _is_negative_prompt(text: str) -> bool:
    lo = text.lower()
    if any(k in lo for k in _STRONG_NEGATIVE):
        return True
    pos = sum(1 for k in _POS_KEYWORDS if k in lo)
    neg = sum(1 for k in _NEG_KEYWORDS if k in lo)
    if neg > pos and neg > 0:
        return True
    if len(text) < 100 and neg > 0:
        return True
    return False


# ---------------------------------------------------------------------------
# Generic graph helpers
# ---------------------------------------------------------------------------

def _resolve_model_link(nodes: dict, ref: object, visited: Optional[set] = None) -> Optional[str]:
    """Follow link chain until a .safetensors/.ckpt string is found."""
    if visited is None:
        visited = set()
    # Direct model filename
    if _is_model_filename(ref):
        return normalize_model_name(str(ref))
    if isinstance(ref, dict) and _is_model_filename(ref.get("content")):
        return normalize_model_name(str(ref["content"]))
    if not (_is_link(ref) and isinstance(ref[0], str)):  # type: ignore[index]
        return None
    node_id = str(ref[0])  # type: ignore[index]
    visit_key = node_id
    if visit_key in visited:
        return None
    visited.add(visit_key)
    node = nodes.get(node_id)
    if not isinstance(node, dict):
        return None
    ct = node.get("class_type", "")
    inp = node.get("inputs", {})

    # Sage model+lora stack — follow model_info link
    if ct == "Sage_ModelLoraStackLoader" and inp.get("model_info"):
        return _resolve_model_link(nodes, inp["model_info"], visited)
    # LoRA nodes — follow their model input upstream
    if ct in ("LoraLoader", "LoraLoaderModelOnly", "Power Lora Loader (rgthree)"):
        if inp.get("model"):
            return _resolve_model_link(nodes, inp["model"], visited)
    # Generic switch: indexed (select/condition/index + input1, input2, ...)
    select_val = inp.get("select") or inp.get("condition") or inp.get("index")
    if isinstance(select_val, int) and not _is_link(select_val):
        candidate = inp.get(f"input{select_val}")
        if candidate:
            result = _resolve_model_link(nodes, candidate, visited)
            if result:
                return result
    # Generic switch: boolean (on_true/on_false)
    if "on_true" in inp and "on_false" in inp:
        bool_key = next((k for k in inp if k not in ("on_true", "on_false")
                         and isinstance(inp[k], bool) and not _is_link(inp[k])), None)
        if bool_key is not None:
            branch = inp["on_true"] if inp[bool_key] else inp["on_false"]
            result = _resolve_model_link(nodes, branch, visited)
            if result:
                return result
    # Fallback: search all inputs
    for val in inp.values():
        result = _resolve_model_link(nodes, val, visited)
        if result:
            return result
    return None


def _resolve_text_link(nodes: dict, ref: object, visited: Optional[set] = None) -> Optional[str]:
    """Follow link chain until a plain prompt string is found."""
    if visited is None:
        visited = set()
    if _is_plain_prompt(ref):
        return str(ref)
    if not (_is_link(ref) and isinstance(ref[0], str)):  # type: ignore[index]
        return None
    node_id = str(ref[0])  # type: ignore[index]
    if node_id in visited:
        return None
    visited.add(node_id)
    node = nodes.get(node_id)
    if not isinstance(node, dict):
        return None
    inp = node.get("inputs", {})
    ct = node.get("class_type", "")
    # Special nodes with known text fields
    if ct == "Textbox" and _is_plain_prompt(inp.get("text")):
        return str(inp["text"])
    if ct == "ImpactWildcardProcessor":
        for key in ("populated_text", "wildcard_text"):
            if _is_plain_prompt(inp.get(key)):
                return str(inp[key])
    # Try common text fields recursively
    for key in ("text", "prompt", "value", "positive", "string"):
        val = inp.get(key)
        if val is not None:
            result = _resolve_text_link(nodes, val, visited)
            if result:
                return result
    return None


def _find_sampler_hub(nodes: dict) -> Optional[str]:
    """Find the node that has both 'positive' and 'negative' as link inputs (type-agnostic)."""
    for node_id, node in nodes.items():
        if not isinstance(node, dict):
            continue
        inp = node.get("inputs", {})
        if _is_link(inp.get("positive")) and _is_link(inp.get("negative")):
            return node_id
    return None


def _bfs_upstream(nodes: dict, start_id: str) -> list[str]:
    """BFS all upstream nodes reachable from start_id via link inputs."""
    visited: set[str] = {start_id}
    queue = [start_id]
    while queue:
        current_id = queue.pop(0)
        node = nodes.get(current_id)
        if not isinstance(node, dict):
            continue
        for val in node.get("inputs", {}).values():
            if _is_link(val) and isinstance(val[0], str):
                nid = str(val[0])
                if nid not in visited:
                    visited.add(nid)
                    queue.append(nid)
    return list(visited)


def _score_node_params(inp: dict) -> tuple[int, dict]:
    """Score a node's inputs for sampler fields. Returns (score, extracted_fields)."""
    fields: dict = {}
    score = 0
    for input_name, field_key, field_type in _SAMPLER_FIELD_SPECS:
        val = inp.get(input_name)
        if _is_link(val):
            continue
        if field_key in fields:
            continue
        if field_type == "int" and isinstance(val, (int, float)) and not isinstance(val, bool):
            fields[field_key] = int(val)
            score += 1
        elif field_type == "float" and isinstance(val, (int, float)) and not isinstance(val, bool):
            fields[field_key] = float(val)
            score += 1
        elif field_type == "str" and isinstance(val, str) and val:
            fields[field_key] = val
            score += 1
        elif field_type == "model" and _is_model_filename(val):
            fields[field_key] = normalize_model_name(str(val))
            score += 1
    return score, fields


def _extract_params_from_nodes(nodes: dict, node_ids: list[str]) -> dict:
    """Score each node in node_ids and merge highest-scoring values per field."""
    result: dict = {}
    scored = []
    for nid in node_ids:
        node = nodes.get(nid)
        if not isinstance(node, dict):
            continue
        score, fields = _score_node_params(node.get("inputs", {}))
        if fields:
            scored.append((score, fields))
    scored.sort(key=lambda x: x[0], reverse=True)
    for _, fields in scored:
        for _, field_key, _ in _SAMPLER_FIELD_SPECS:
            if field_key not in result and field_key in fields:
                result[field_key] = fields[field_key]
    return result


def _extract_prompts_heuristic(nodes: dict) -> tuple[Optional[str], Optional[str]]:
    """
    Scan all nodes for likely positive/negative prompt text.
    Checks inputs.text / inputs.prompt / inputs.value on every node.
    Uses keyword scoring to classify. Returns (positive, negative).
    """
    positive: Optional[str] = None
    negative: Optional[str] = None
    pos_candidates: list[tuple[int, str]] = []  # (priority, text)
    neg_candidates: list[tuple[int, str]] = []

    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        title = (node.get("_meta") or {}).get("title", "")
        inp = node.get("inputs", {})

        for key in ("prompt", "text", "value"):
            val = inp.get(key)
            text: Optional[str] = None
            if _is_plain_prompt(val):
                text = str(val)
            elif _is_link(val) or (isinstance(val, (list, dict)) and val):
                text = _resolve_text_link(nodes, val)
            if not text:
                continue
            # Priority scoring
            priority = 0
            if "positive" in title.lower():
                priority = 10
            elif "negative" in title.lower():
                priority = 10
            elif ct in _CLIP_TEXT_TYPES:
                priority = 2
            elif "positive" in ct.lower():
                priority = 3
            elif "negative" in ct.lower():
                priority = 3

            if _is_positive_prompt(text):
                pos_candidates.append((priority, text))
            if _is_negative_prompt(text):
                neg_candidates.append((priority, text))

    if pos_candidates:
        pos_candidates.sort(key=lambda x: x[0], reverse=True)
        positive = pos_candidates[0][1]
    if neg_candidates:
        neg_candidates.sort(key=lambda x: x[0], reverse=True)
        negative = neg_candidates[0][1]
    # If positive == negative (same node caught both), try to disambiguate
    if positive and negative and positive == negative:
        negative = None
        remaining = [t for _, t in neg_candidates if t != positive]
        if remaining:
            negative = remaining[0]
    return positive, negative


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
            if isinstance(name, str) and not _is_link(name) and name not in seen:
                seen.add(name)
                loras.append({
                    "name": normalize_model_name(name),
                    "model_strength": inp.get("strength_model"),
                    "clip_strength": inp.get("strength_clip"),
                })
        elif ct == "Power Lora Loader (rgthree)":
            for key, val in inp.items():
                if key.startswith("lora_") and isinstance(val, dict) and val.get("on") and val.get("lora"):
                    name = str(val["lora"])
                    if name not in seen:
                        seen.add(name)
                        loras.append({
                            "name": normalize_model_name(name),
                            "model_strength": val.get("strength"),
                        })
    return loras


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse(prompt_json: object) -> Optional[dict]:
    """Extract generation params from a ComfyUI prompt JSON dict.

    Uses a 3-pass algorithm. Always returns partial results (never None)
    as long as the input is a non-empty dict.
    """
    if isinstance(prompt_json, str):
        try:
            prompt_json = json.loads(prompt_json)
        except (ValueError, json.JSONDecodeError):
            return None
    if not isinstance(prompt_json, dict) or not prompt_json:
        return None

    nodes = prompt_json
    result: dict = {"source": "comfyui"}

    # -----------------------------------------------------------------------
    # Pass 1 — known class-type fast path
    # -----------------------------------------------------------------------
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inp = node.get("inputs", {})

        # KSampler family
        if ct in _KSAMPLER_TYPES:
            if "steps" not in result and inp.get("steps") is not None and not _is_link(inp.get("steps")):
                result["steps"] = int(inp["steps"])
            if "cfg_scale" not in result and inp.get("cfg") is not None and not _is_link(inp.get("cfg")):
                result["cfg_scale"] = float(inp["cfg"])
            if "sampler" not in result and isinstance(inp.get("sampler_name"), str) and not _is_link(inp.get("sampler_name")):
                result["sampler"] = normalize_sampler(inp["sampler_name"])
            if "scheduler" not in result and isinstance(inp.get("scheduler"), str) and not _is_link(inp.get("scheduler")):
                result["scheduler"] = normalize_scheduler(inp["scheduler"])
            if "seed" not in result:
                for skey in ("noise_seed", "seed"):
                    sv = inp.get(skey)
                    if sv is not None and not _is_link(sv):
                        result["seed"] = int(sv)
                        break
            # Resolve pos/neg from sampler hub
            if "positive_prompt" not in result and _is_link(inp.get("positive")):
                text = _resolve_text_link(nodes, inp["positive"])
                if text:
                    result["positive_prompt"] = text
            if "negative_prompt" not in result and _is_link(inp.get("negative")):
                text = _resolve_text_link(nodes, inp["negative"])
                if text:
                    result["negative_prompt"] = text

        # Sage_SamplerInfo — stores params as direct literals
        if ct == "Sage_SamplerInfo":
            if "steps" not in result and inp.get("steps") is not None and not _is_link(inp.get("steps")):
                result["steps"] = int(inp["steps"])
            if "cfg_scale" not in result and inp.get("cfg") is not None and not _is_link(inp.get("cfg")):
                result["cfg_scale"] = float(inp["cfg"])
            if "sampler" not in result and isinstance(inp.get("sampler_name"), str) and not _is_link(inp.get("sampler_name")):
                result["sampler"] = normalize_sampler(inp["sampler_name"])
            if "scheduler" not in result and isinstance(inp.get("scheduler"), str) and not _is_link(inp.get("scheduler")):
                result["scheduler"] = normalize_scheduler(inp["scheduler"])
            if "seed" not in result and inp.get("seed") is not None and not _is_link(inp.get("seed")):
                result["seed"] = int(inp["seed"])

        # Checkpoint nodes
        if ct in _CHECKPOINT_TYPES and "model" not in result:
            ckpt = inp.get("ckpt_name")
            if _is_model_filename(ckpt):
                result["model"] = normalize_model_name(str(ckpt))
            elif isinstance(ckpt, dict) and _is_model_filename(ckpt.get("content")):
                result["model"] = normalize_model_name(str(ckpt["content"]))

    def _missing_any() -> bool:
        return any(result.get(k) is None for k in ("steps", "cfg_scale", "sampler", "scheduler", "seed", "model"))

    # -----------------------------------------------------------------------
    # Pass 2 — hub-first BFS (generic, no class-type knowledge)
    # -----------------------------------------------------------------------
    if _missing_any():
        hub_id = _find_sampler_hub(nodes)
        if hub_id:
            upstream_ids = _bfs_upstream(nodes, hub_id)
            hub_params = _extract_params_from_nodes(nodes, upstream_ids)
            for key in ("steps", "cfg_scale", "sampler", "scheduler", "seed"):
                if key not in result and key in hub_params:
                    result[key] = hub_params[key]
            # Normalize sampler/scheduler from BFS
            if "sampler" in result:
                result["sampler"] = normalize_sampler(result["sampler"])
            if "scheduler" in result:
                result["scheduler"] = normalize_scheduler(result["scheduler"])
            # Model via generic link traversal from hub's model input
            if "model" not in result:
                hub_node = nodes.get(hub_id, {})
                model_input = hub_node.get("inputs", {}).get("model")
                if model_input:
                    resolved = _resolve_model_link(nodes, model_input)
                    if resolved:
                        result["model"] = resolved

    # -----------------------------------------------------------------------
    # Pass 3 — global scored fallback
    # -----------------------------------------------------------------------
    if _missing_any():
        all_params = _extract_params_from_nodes(nodes, list(nodes.keys()))
        for key in ("steps", "cfg_scale", "sampler", "scheduler", "seed"):
            if key not in result and key in all_params:
                result[key] = all_params[key]
        if "sampler" in result and isinstance(result["sampler"], str):
            result["sampler"] = normalize_sampler(result["sampler"])
        if "scheduler" in result and isinstance(result["scheduler"], str):
            result["scheduler"] = normalize_scheduler(result["scheduler"])

    # Model via generic traversal from all sampler-like nodes (vote)
    if "model" not in result:
        model_votes: dict[str, int] = {}
        for node in nodes.values():
            if not isinstance(node, dict):
                continue
            ct = node.get("class_type", "")
            # Any node with positive+negative inputs is likely a sampler hub
            inp = node.get("inputs", {})
            if _is_link(inp.get("positive")) and _is_link(inp.get("negative")):
                model_ref = inp.get("model")
                if model_ref:
                    resolved = _resolve_model_link(nodes, model_ref)
                    if resolved:
                        model_votes[resolved] = model_votes.get(resolved, 0) + 1
        if model_votes:
            result["model"] = max(model_votes, key=lambda k: model_votes[k])

    # Prompts — heuristic scan if not already found
    if "positive_prompt" not in result or "negative_prompt" not in result:
        pos, neg = _extract_prompts_heuristic(nodes)
        if "positive_prompt" not in result and pos:
            result["positive_prompt"] = pos
        if "negative_prompt" not in result and neg:
            result["negative_prompt"] = neg

    # LoRAs
    loras = _extract_loras(nodes)
    if loras:
        result["loras"] = loras

    # Fingerprint
    pos_text = result.get("positive_prompt") or ""
    neg_text = result.get("negative_prompt") or ""
    model_text = result.get("model") or ""
    if pos_text or model_text:
        result["prompt_fingerprint"] = prompt_fingerprint(pos_text, neg_text, model_text)

    # Return None only if we found nothing useful at all
    useful_keys = ("model", "positive_prompt", "sampler", "steps", "seed")
    if not any(result.get(k) for k in useful_keys):
        return None

    return result


