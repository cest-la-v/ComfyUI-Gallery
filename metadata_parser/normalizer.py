"""Canonical name normalization for sampler, scheduler, and model fields.

Mirrors web/src/metadata-parser/samplerNormalizer.ts so that values stored
in the DB match what the TypeScript UI expects.
"""
import os

# ComfyUI internal sampler_name → A1111/Civitai display name
SAMPLER_DISPLAY: dict[str, str] = {
    "euler":                   "Euler",
    "euler_ancestral":         "Euler a",
    "heun":                    "Heun",
    "heunpp2":                 "Heun++2",
    "dpm_2":                   "DPM2",
    "dpm_2_ancestral":         "DPM2 a",
    "lms":                     "LMS",
    "dpm_fast":                "DPM fast",
    "dpm_adaptive":            "DPM adaptive",
    "dpmpp_2s_ancestral":      "DPM++ 2S a",
    "dpmpp_sde":               "DPM++ SDE",
    "dpmpp_sde_gpu":           "DPM++ SDE",
    "dpmpp_2m":                "DPM++ 2M",
    "dpmpp_2m_sde":            "DPM++ 2M SDE",
    "dpmpp_2m_sde_gpu":        "DPM++ 2M SDE",
    "dpmpp_3m_sde":            "DPM++ 3M SDE",
    "dpmpp_3m_sde_gpu":        "DPM++ 3M SDE",
    "ddpm":                    "DDPM",
    "lcm":                     "LCM",
    "ddim":                    "DDIM",
    "uni_pc":                  "UniPC",
    "uni_pc_bh2":              "UniPC BH2",
    "ipndm":                   "IPNDM",
    "ipndm_v":                 "IPNDM V",
    "deis":                    "DEIS",
    "res_multistep":           "ReS Multistep",
    "res_multistep_ancestral": "ReS Multistep a",
}

# ComfyUI internal scheduler → A1111/Civitai display name
SCHEDULER_DISPLAY: dict[str, str] = {
    "normal":           "Normal",
    "karras":           "Karras",
    "exponential":      "Exponential",
    "sgm_uniform":      "SGM Uniform",
    "simple":           "Simple",
    "ddim_uniform":     "DDIM Uniform",
    "beta":             "Beta",
    "linear_quadratic": "Linear Quadratic",
    "kl_optimal":       "KL Optimal",
    "laplace":          "Laplace",
    "ays":              "Align Your Steps",
    "gits":             "GITS",
    "polyexponential":  "Polyexponential",
    "vp":               "VP",
    "turbo":            "Turbo",
    "automatic":        "Automatic",
}

# A1111 combined "Sampler: <name> <Scheduler>" suffix → scheduler display name
# Longer entries tested first so multi-word suffixes win
SCHEDULER_SUFFIX_MAP: list[tuple[str, str]] = [
    ("sgm uniform",      "SGM Uniform"),
    ("ddim uniform",     "DDIM Uniform"),
    ("linear quadratic", "Linear Quadratic"),
    ("exponential",      "Exponential"),
    ("karras",           "Karras"),
    ("simple",           "Simple"),
    ("beta",             "Beta"),
    ("normal",           "Normal"),
]


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


def normalize_model_name(ckpt_name: str | None) -> str:
    """Strip path and extension: 'checkpoints/model.safetensors' → 'model'."""
    if not ckpt_name:
        return ""
    name = os.path.basename(ckpt_name)
    stem, _ = os.path.splitext(name)
    return stem


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
