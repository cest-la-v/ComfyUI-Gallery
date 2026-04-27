"""A1111-format metadata writer for GallerySaveImage.

Converts a merged params dict into a properly formatted A1111 parameters
string suitable for writing as a PNG 'parameters' text chunk.

The params dict is the merged result of:
  - _prompt.parse(prompt)  — BFS enrichment (prompts, LoRAs, gap-filling)
  - GenerationMetadata     — runtime-derived values (steps, cfg, sampler, etc.)

LoRAs are appended to the positive prompt as standard A1111 <lora:name:weight>
tags. Any pre-existing <lora:...> tags in the positive_prompt (which may come
from a reference image's metadata) are stripped first, so only the workflow's
actual LoRA nodes appear in the saved metadata.
"""
from __future__ import annotations

import os
import re

from .normalizer import SAMPLER_DISPLAY, SCHEDULER_DISPLAY

# Matches any <lora:...> tag in the positive prompt, including surrounding whitespace
_LORA_TAG_RE = re.compile(r"\s*<lora:[^>]+>\s*", re.IGNORECASE)


def params_to_a1111_string(params: dict) -> str:
    """Render a merged params dict as an A1111 'parameters' PNG text chunk.

    Output format mirrors GenerationMetadata.to_a1111_string():

        <positive prompt> <lora:name:weight> ...
        Negative prompt: <negative prompt>
        Steps: 20, Sampler: DPM++ 2M Karras, Schedule type: Karras, CFG scale: 7.0, Seed: 42, Model: v1-5
    """
    parts: list[str] = []

    # Strip any pre-existing <lora:...> tags from positive_prompt.
    # These come from the reference image's A1111 text and don't represent
    # actual LoRA nodes in the current workflow.
    positive = _LORA_TAG_RE.sub(" ", params.get("positive_prompt") or "").strip()

    # Append <lora:name:model_strength> tags for actual LoRA nodes.
    # A1111 format uses a single weight; model_strength is the primary one.
    loras = params.get("loras")
    if loras and isinstance(loras, list):
        lora_tags: list[str] = []
        for lora in loras:
            if isinstance(lora, dict):
                name = lora.get("name") or ""
                if not name:
                    continue
                strength = lora.get("model_strength", 1.0)
                lora_tags.append(f"<lora:{name}:{strength}>")
            elif isinstance(lora, str) and lora:
                lora_tags.append(f"<lora:{lora}:1.0>")
        if lora_tags:
            tag_str = " ".join(lora_tags)
            positive = f"{positive} {tag_str}".strip() if positive else tag_str

    parts.append(positive)

    negative = (params.get("negative_prompt") or "").strip()
    if negative:
        parts.append(f"Negative prompt: {negative}")

    param_parts: list[str] = []

    steps = params.get("steps")
    if steps is not None:
        param_parts.append(f"Steps: {int(steps)}")

    sampler = params.get("sampler")
    scheduler = params.get("scheduler")
    if sampler is not None:
        sampler_display = SAMPLER_DISPLAY.get(sampler, sampler)
        if scheduler is not None:
            scheduler_display = SCHEDULER_DISPLAY.get(scheduler, scheduler)
            param_parts.append(f"Sampler: {sampler_display} {scheduler_display}")
            param_parts.append(f"Schedule type: {scheduler_display}")
        else:
            param_parts.append(f"Sampler: {sampler_display}")
    elif scheduler is not None:
        scheduler_display = SCHEDULER_DISPLAY.get(scheduler, scheduler)
        param_parts.append(f"Schedule type: {scheduler_display}")

    cfg = params.get("cfg_scale")
    if cfg is not None:
        param_parts.append(f"CFG scale: {float(cfg)}")

    seed = params.get("seed")
    if seed is not None:
        param_parts.append(f"Seed: {int(seed)}")

    model = params.get("model")
    if model:
        # Normalize: strip path then extension (handles both "model.safetensors"
        # and "checkpoints/model.safetensors" from different sources)
        model = os.path.basename(model)
        for ext in (".safetensors", ".ckpt", ".pt", ".pth"):
            if model.lower().endswith(ext):
                model = model[: -len(ext)]
                break
        param_parts.append(f"Model: {model}")

    if param_parts:
        parts.append(", ".join(param_parts))

    return "\n".join(p for p in parts if p)
