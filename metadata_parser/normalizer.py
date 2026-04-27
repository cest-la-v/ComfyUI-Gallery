"""Canonical name normalization for sampler, scheduler, and model fields.

Tables are loaded from normalizer_tables.json (single source of truth shared
with web/src/metadata-parser/samplerNormalizer.ts) so Python and TypeScript
normalizers cannot drift from each other.
"""
import json
import os
from pathlib import Path

_TABLES = json.loads((Path(__file__).parent / "normalizer_tables.json").read_text(encoding="utf-8"))

# ComfyUI internal sampler_name → A1111/Civitai display name
SAMPLER_DISPLAY: dict[str, str] = _TABLES["sampler_display"]

# ComfyUI internal scheduler → A1111/Civitai display name
SCHEDULER_DISPLAY: dict[str, str] = _TABLES["scheduler_display"]

# A1111 combined "Sampler: <name> <Scheduler>" suffix → scheduler display name
# Longer entries tested first so multi-word suffixes win
SCHEDULER_SUFFIX_MAP: list[list[str]] = _TABLES["scheduler_suffix_pairs"]


def normalize_sampler(raw: str | None) -> str:
    """ComfyUI snake_case → display name. A1111 names pass through."""
    if not raw:
        return ""
    return SAMPLER_DISPLAY.get(raw, raw)


def normalize_scheduler(raw: str | None) -> str:
    """ComfyUI snake_case → display name. A1111 names pass through."""
    if not raw:
        return ""
    return SCHEDULER_DISPLAY.get(raw, raw)


import re

_MODEL_EXT_RE = re.compile(r"\.(safetensors|ckpt|pt|bin|pth)$", re.IGNORECASE)


def normalize_model_name(ckpt_name: str | None) -> str:
    """Strip path and known model extensions: 'checkpoints/model.safetensors' → 'model'.

    Only strips .safetensors/.ckpt/.pt/.bin/.pth — not arbitrary dots — so
    model names with version numbers like 'RealVisXL_V4.0' are preserved.
    Mirrors the TypeScript normalizeModelName behaviour in samplerNormalizer.ts.
    """
    if not ckpt_name:
        return ""
    name = os.path.basename(ckpt_name)
    return _MODEL_EXT_RE.sub("", name)


def split_a1111_sampler_scheduler(sampler_raw: str) -> tuple[str, str | None]:
    """Split combined A1111 sampler field into (sampler, scheduler | None).

    A1111 sometimes writes: "DPM++ 3M SDE Karras" meaning
    sampler="DPM++ 3M SDE", scheduler="Karras".
    """
    low = sampler_raw.lower()
    for suffix, display in SCHEDULER_SUFFIX_MAP:
        if low.endswith(" " + suffix):
            sampler = sampler_raw[: -(len(suffix) + 1)].strip()
            return sampler, display
    return sampler_raw, None
