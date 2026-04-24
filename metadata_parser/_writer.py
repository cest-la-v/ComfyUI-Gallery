"""A1111-format metadata writer for GallerySaveImage.

Converts a merged params dict into a properly formatted A1111 parameters
string suitable for writing as a PNG 'parameters' text chunk.

The params dict is the merged result of:
  - _prompt.parse(prompt)  — BFS enrichment (prompts, LoRAs, gap-filling)
  - GenerationMetadata     — runtime-derived values (steps, cfg, sampler, etc.)

LoRAs are written as 'Lora weights:' (we store names + strengths, not file
hashes, so 'Lora hashes:' would be misleading to downstream tools).
"""
from __future__ import annotations

import os

from .normalizer import SAMPLER_DISPLAY, SCHEDULER_DISPLAY


def params_to_a1111_string(params: dict) -> str:
    """Render a merged params dict as an A1111 'parameters' PNG text chunk.

    Output format mirrors GenerationMetadata.to_a1111_string():

        <positive prompt>
        Negative prompt: <negative prompt>
        Steps: 20, Sampler: DPM++ 2M Karras, Schedule type: Karras, CFG scale: 7.0, Seed: 42, Model: v1-5
        Lora weights: "lora_name: str=0.8 clip=0.8", ...
    """
    parts: list[str] = []

    positive = (params.get("positive_prompt") or "").strip()
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

    loras = params.get("loras")
    if loras and isinstance(loras, list):
        lora_parts: list[str] = []
        for lora in loras:
            if isinstance(lora, dict):
                name = lora.get("name") or ""
                if not name:
                    continue
                ms = lora.get("model_strength")
                cs = lora.get("clip_strength")
                if ms is not None and cs is not None:
                    lora_parts.append(f'"{name}: str={ms} clip={cs}"')
                elif ms is not None:
                    lora_parts.append(f'"{name}: str={ms}"')
                else:
                    lora_parts.append(f'"{name}"')
            elif isinstance(lora, str) and lora:
                lora_parts.append(f'"{lora}"')
        if lora_parts:
            param_parts.append(f"Lora weights: {', '.join(lora_parts)}")

    if param_parts:
        parts.append(", ".join(param_parts))

    return "\n".join(p for p in parts if p)
