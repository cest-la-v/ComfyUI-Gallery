"""A1111 parser tests — inline fixtures, no real images required.

Covers sampler/scheduler splitting (formats A–H), model/model_hash separation,
VAE/extras passthrough, invalid input, detect_formats, and normalizer roundtrips.

Run:
    python -m unittest tests.test_a1111 -v
"""
import sys
import os
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from metadata_parser.a1111 import parse
from metadata_parser.normalizer import (
    normalize_sampler,
    normalize_scheduler,
    normalize_model_name,
    SAMPLER_DISPLAY,
    SCHEDULER_DISPLAY,
)
from metadata_parser import extract_params

# ---------------------------------------------------------------------------
# Desensitized format fixtures (technical params real; prompts synthetic)
# ---------------------------------------------------------------------------

# Format A: separate Schedule type key
FMT_A = (
    "a scenic photo of mountains at dusk\n"
    "Negative prompt: low quality, blurry, watermark\n"
    "Steps: 6, Sampler: DPM++ SDE, Schedule type: Karras, CFG scale: 2, "
    "Seed: 1582036678, Size: 832x1216, Model hash: 609fde646e, "
    "Model: RealVisXL_V4.0, Denoising strength: 0.52, Version: v1.7.0"
)

# Format B: combined Sampler+Scheduler in one field + VAE/VAE hash + Hires
FMT_B = (
    "a portrait photo with soft studio lighting\n"
    "Negative prompt: low quality, worst quality, blurry, watermark\n"
    "Steps: 6, Sampler: DPM++ SDE Karras, CFG scale: 1.5, Seed: 983791494, "
    "Size: 512x768, Model hash: 0928b30687, Model: RVHYPO, "
    "VAE hash: e9ed949371, VAE: vae-ft-mse-840000-ema-pruned.safetensors, "
    "Denoising strength: 0.35, Hires upscale: 2, Hires steps: 2, "
    "Hires upscaler: 4x_NMKD-Superscale-SP_178000_G, Version: v1.7.0"
)

# Format C: separate Schedule type, different model
FMT_C = (
    "an indoor scene with cinematic lighting\n"
    "Negative prompt: low quality, blurry\n"
    "Steps: 10, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 7, "
    "Seed: 736727295, Size: 1248x1824, Model hash: eeaea4f37c, "
    "Model: dreamshaper_8, Denoising strength: 0.52, Version: v1.7.0"
)

# Format D: custom sampler + Schedule type: Automatic
FMT_D = (
    "a forest landscape at sunrise\n"
    "Negative prompt: low quality\n"
    "Steps: 24, Sampler: Cyberdelia Ralston (RK2), Schedule type: Automatic, "
    "CFG scale: 4.5, Seed: 14533328, Size: 832x1216, "
    "Model hash: 6ce0161689, Model: v1-5-pruned-emaonly"
)

# Format E: DPM++ 2M SDE + separate Karras + multiple Civitai extras
FMT_E = (
    "an architectural interior with dramatic shadows\n"
    "Negative prompt: CyberRealistic_Negative_New\n"
    "Steps: 32, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 7, "
    "Seed: 96817171, Size: 704x1024, Model hash: f4d3a85a81, "
    "Model: CyberRealistic_FINAL_FP32, Denoising strength: 0.25, RNG: CPU, "
    "Hires Module 1: Use same choices, Hires CFG Scale: 7, Hires upscale: 1.5, "
    "Hires steps: 12, Hires upscaler: 4x_NickelbackFS_72000_G, "
    "TI: CyberRealistic_Negative_New, Version: neo"
)

# Format F: DPM++ 2M Karras — combined 3-word scheduler suffix + Clip skip
FMT_F = (
    "a misty mountain landscape\n"
    "Negative prompt: low quality\n"
    "Steps: 34, Sampler: DPM++ 2M Karras, CFG scale: 5.0, "
    "Seed: 838378400301630, Size: 832x1216, Clip skip: 2, "
    "Model hash: AEA4EC6C4D, Model: AnythingXL_xl, Version: v1.7.0"
)

# Format G: Euler a — no scheduler suffix
FMT_G = (
    "a fantasy scene with soft magical lighting\n"
    "Negative prompt: low quality, ugly, deformed\n"
    "Steps: 30, Sampler: Euler a, CFG scale: 3.0, Seed: 24492053, "
    "Size: 832x1216, Clip skip: 2, Model hash: 88177d224c, Model: JANKUv7"
)

# Format H: DPM++ 3M SDE Karras — combined with 3M + ADetailer extras
FMT_H = (
    "a dramatic cinematic shot\n"
    "Negative prompt: low quality, worst quality\n"
    "Steps: 4, Sampler: DPM++ 3M SDE Karras, CFG scale: 2, "
    "Seed: 3346112079, Size: 768x1024, Model hash: fdbe56354b, "
    'Model: DreamShaperXL_Turbo-Lightning, Denoising strength: 0.52, '
    "Clip skip: 2, RNG: CPU, "
    'ADetailer model: mediapipe_face_mesh_eyes_only, '
    'ADetailer prompt: "a person walking", ADetailer confidence: 0.3, '
    "Version: v1.7.0"
)


# ---------------------------------------------------------------------------
# Sampler / Scheduler splitting
# ---------------------------------------------------------------------------

class TestA1111SamplerSchedulerSplit(unittest.TestCase):

    def test_fmt_a_separate_schedule_type(self):
        r = parse(FMT_A)
        self.assertEqual(r["sampler"], "DPM++ SDE")
        self.assertEqual(r["scheduler"], "Karras")

    def test_fmt_b_combined_sampler_scheduler(self):
        r = parse(FMT_B)
        self.assertEqual(r["sampler"], "DPM++ SDE")
        self.assertEqual(r["scheduler"], "Karras")

    def test_fmt_c_dpm2m_separate_karras(self):
        r = parse(FMT_C)
        self.assertEqual(r["sampler"], "DPM++ 2M")
        self.assertEqual(r["scheduler"], "Karras")

    def test_fmt_d_custom_sampler_automatic(self):
        r = parse(FMT_D)
        self.assertEqual(r["sampler"], "Cyberdelia Ralston (RK2)")
        self.assertEqual(r["scheduler"], "Automatic")

    def test_fmt_e_dpm2msde_separate_karras(self):
        r = parse(FMT_E)
        self.assertEqual(r["sampler"], "DPM++ 2M SDE")
        self.assertEqual(r["scheduler"], "Karras")

    def test_fmt_f_dpm2m_karras_combined(self):
        r = parse(FMT_F)
        self.assertEqual(r["sampler"], "DPM++ 2M")
        self.assertEqual(r["scheduler"], "Karras")

    def test_fmt_g_euler_a_no_scheduler(self):
        r = parse(FMT_G)
        self.assertEqual(r["sampler"], "Euler a")
        self.assertIsNone(r.get("scheduler"), "no scheduler should be present for Euler a")

    def test_fmt_h_dpm3m_sde_karras_combined(self):
        r = parse(FMT_H)
        self.assertEqual(r["sampler"], "DPM++ 3M SDE")
        self.assertEqual(r["scheduler"], "Karras")


# ---------------------------------------------------------------------------
# Model / model_hash separation
# ---------------------------------------------------------------------------

class TestA1111ModelHash(unittest.TestCase):

    def test_model_and_hash_split(self):
        r = parse(FMT_A)
        self.assertEqual(r["model"], "RealVisXL_V4.0")
        self.assertEqual(r["model_hash"], "609fde646e")

    def test_model_hash_does_not_leak_into_model(self):
        for fmt in (FMT_B, FMT_C, FMT_E):
            with self.subTest(fmt=fmt[:40]):
                r = parse(fmt)
                # model should not look like a hex hash
                self.assertNotRegex(r["model"], r"^[0-9a-fA-F]{8,}$")

    def test_model_is_stem_not_extension(self):
        # A1111 already writes clean stems; normalize_model_name should be idempotent
        r = parse(FMT_C)
        self.assertEqual(r["model"], "dreamshaper_8")
        self.assertNotIn(".safetensors", r["model"])
        self.assertNotIn(".ckpt", r["model"])


# ---------------------------------------------------------------------------
# Structured fields vs extras
# ---------------------------------------------------------------------------

class TestA1111StructuredFields(unittest.TestCase):
    """Fields with known meaning are mapped to top-level result keys."""

    def test_vae_in_result(self):
        r = parse(FMT_B)
        self.assertEqual(r["vae"], "vae-ft-mse-840000-ema-pruned.safetensors")

    def test_vae_hash_in_result(self):
        r = parse(FMT_B)
        self.assertEqual(r["vae_hash"], "e9ed949371")

    def test_hires_upscaler_in_result(self):
        r = parse(FMT_B)
        self.assertEqual(r["hires_upscaler"], "4x_NMKD-Superscale-SP_178000_G")

    def test_hires_steps_in_result(self):
        r = parse(FMT_B)
        self.assertEqual(r["hires_steps"], 2)

    def test_clip_skip_in_result(self):
        r = parse(FMT_F)
        self.assertEqual(r["clip_skip"], 2)

    def test_denoise_strength_in_result(self):
        r = parse(FMT_A)
        self.assertAlmostEqual(r["denoise_strength"], 0.52, places=2)


class TestA1111Extras(unittest.TestCase):
    """Unknown keys go to the extras dict."""

    def test_adetailer_fields_in_extras(self):
        r = parse(FMT_H)
        extras = r.get("extras", {})
        self.assertEqual(extras.get("adetailer model"), "mediapipe_face_mesh_eyes_only")
        self.assertEqual(extras.get("adetailer confidence"), "0.3")

    def test_civitai_rng_ti_version_in_extras(self):
        r = parse(FMT_E)
        extras = r.get("extras", {})
        self.assertEqual(extras.get("rng"), "CPU")
        self.assertEqual(extras.get("ti"), "CyberRealistic_Negative_New")
        self.assertEqual(extras.get("version"), "neo")


# ---------------------------------------------------------------------------
# Invalid input
# ---------------------------------------------------------------------------

class TestA1111InvalidInput(unittest.TestCase):

    def test_empty_string_returns_none(self):
        self.assertIsNone(parse(""))

    def test_whitespace_only_returns_none(self):
        self.assertIsNone(parse("   \n  "))

    def test_non_string_returns_none(self):
        self.assertIsNone(parse(None))   # type: ignore[arg-type]
        self.assertIsNone(parse(42))     # type: ignore[arg-type]
        self.assertIsNone(parse({}))     # type: ignore[arg-type]

    def test_bare_text_without_params_is_positive_only(self):
        # Python behaviour: text with no param line is treated as bare positive_prompt,
        # not rejected.  This is by design — allows partial A1111 text to be useful.
        r = parse("hello world")
        self.assertIsNotNone(r)
        self.assertEqual(r.get("positive_prompt"), "hello world")
        self.assertNotIn("sampler", r)


# ---------------------------------------------------------------------------
# detect_formats via extract_params orchestrator
# ---------------------------------------------------------------------------

class TestDetectFormats(unittest.TestCase):

    def test_a1111_only(self):
        r = extract_params({"parameters": FMT_A})
        self.assertIsNotNone(r)
        self.assertEqual(r["formats"], ["a1111"])

    def test_comfyui_only(self):
        prompt = {
            "1": {"class_type": "CheckpointLoaderSimple",
                  "inputs": {"ckpt_name": "model.safetensors"}},
            "2": {"class_type": "KSampler",
                  "inputs": {"seed": 1, "steps": 20, "cfg": 7,
                              "sampler_name": "euler", "scheduler": "normal",
                              "denoise": 1, "model": ["1", 0],
                              "positive": ["3", 0], "negative": ["4", 0],
                              "latent_image": ["5", 0]}},
            "3": {"class_type": "CLIPTextEncode",
                  "inputs": {"text": "masterpiece detailed portrait", "clip": ["1", 1]}},
            "4": {"class_type": "CLIPTextEncode",
                  "inputs": {"text": "worst quality blurry", "clip": ["1", 1]}},
            "5": {"class_type": "EmptyLatentImage",
                  "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        }
        r = extract_params({"prompt": prompt})
        self.assertIsNotNone(r)
        self.assertEqual(r["formats"], ["comfyui"])

    def test_both_formats(self):
        prompt = {
            "1": {"class_type": "CheckpointLoaderSimple",
                  "inputs": {"ckpt_name": "model.safetensors"}},
            "2": {"class_type": "KSampler",
                  "inputs": {"seed": 1, "steps": 20, "cfg": 7,
                              "sampler_name": "euler", "scheduler": "normal",
                              "denoise": 1, "model": ["1", 0],
                              "positive": ["3", 0], "negative": ["4", 0],
                              "latent_image": ["5", 0]}},
            "3": {"class_type": "CLIPTextEncode",
                  "inputs": {"text": "masterpiece detailed portrait", "clip": ["1", 1]}},
            "4": {"class_type": "CLIPTextEncode",
                  "inputs": {"text": "worst quality blurry", "clip": ["1", 1]}},
            "5": {"class_type": "EmptyLatentImage",
                  "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        }
        r = extract_params({"parameters": FMT_A, "prompt": prompt})
        self.assertIsNotNone(r)
        self.assertIn("a1111", r["formats"])
        self.assertIn("comfyui", r["formats"])


# ---------------------------------------------------------------------------
# Normalizer roundtrip — all table entries
# ---------------------------------------------------------------------------

class TestNormalizerRoundtrip(unittest.TestCase):

    def test_all_sampler_display_entries(self):
        for key, expected in SAMPLER_DISPLAY.items():
            with self.subTest(key=key):
                self.assertEqual(normalize_sampler(key), expected)
                self.assertGreater(len(expected), 0)

    def test_all_scheduler_display_entries(self):
        for key, expected in SCHEDULER_DISPLAY.items():
            with self.subTest(key=key):
                self.assertEqual(normalize_scheduler(key), expected)
                self.assertGreater(len(expected), 0)

    def test_sampler_passthrough_for_a1111_names(self):
        for display in SAMPLER_DISPLAY.values():
            with self.subTest(display=display):
                # A1111 display names are not in the map → pass through unchanged
                self.assertEqual(normalize_sampler(display), display)

    def test_scheduler_passthrough_for_a1111_names(self):
        for display in SCHEDULER_DISPLAY.values():
            with self.subTest(display=display):
                self.assertEqual(normalize_scheduler(display), display)

    def test_gpu_variants_same_display(self):
        self.assertEqual(normalize_sampler("dpmpp_sde_gpu"), "DPM++ SDE")
        self.assertEqual(normalize_sampler("dpmpp_2m_sde_gpu"), "DPM++ 2M SDE")
        self.assertEqual(normalize_sampler("dpmpp_3m_sde_gpu"), "DPM++ 3M SDE")

    def test_unknown_names_pass_through(self):
        self.assertEqual(normalize_sampler("custom_sampler"), "custom_sampler")
        self.assertEqual(normalize_scheduler("my_scheduler"), "my_scheduler")

    def test_none_and_empty_return_empty_string(self):
        self.assertEqual(normalize_sampler(None), "")
        self.assertEqual(normalize_sampler(""), "")
        self.assertEqual(normalize_scheduler(None), "")
        self.assertEqual(normalize_scheduler(""), "")

    def test_normalize_model_name_strips_ext_and_path(self):
        self.assertEqual(normalize_model_name("checkpoints/dreamshaper_8.safetensors"),
                         "dreamshaper_8")
        self.assertEqual(normalize_model_name("v1-5-pruned.ckpt"), "v1-5-pruned")
        self.assertEqual(normalize_model_name("RVHYPO"), "RVHYPO")
        # Version numbers with dots must NOT be stripped (only known model extensions)
        self.assertEqual(normalize_model_name("RealVisXL_V4.0"), "RealVisXL_V4.0")
        self.assertEqual(normalize_model_name("SDXL_1.0.safetensors"), "SDXL_1.0")
        self.assertEqual(normalize_model_name(None), "")
        self.assertEqual(normalize_model_name(""), "")


if __name__ == "__main__":
    unittest.main()
