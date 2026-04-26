"""Unit tests for the metadata parser — fixture-driven, no real images required.

Each test class loads one fixture from tests/fixtures/ and asserts specific fields
on the output of extract_params(). Fixtures are desensitized (prompts replaced with
[test prompt]) but structural patterns (model, sampler, LoRA tags, node graph shape)
are preserved.

Run:
    python -m pytest tests/test_parser.py -v
    # or without pytest:
    python -m unittest tests.test_parser -v
"""
import json
import os
import sys
import unittest

# Bootstrap: make metadata_parser importable
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from metadata_parser import extract_params  # noqa: E402

_FIXTURES = os.path.join(_HERE, "fixtures")


def _load(name: str) -> dict:
    with open(os.path.join(_FIXTURES, name), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# A1111 fixtures
# ---------------------------------------------------------------------------

class TestA1111Basic(unittest.TestCase):
    def setUp(self):
        self.raw = _load("a1111_basic.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params)

    def test_source(self):
        self.assertEqual(self.params["formats"], ["a1111"])

    def test_model_present(self):
        self.assertTrue(self.params.get("model"), "model should be a non-empty string")

    def test_positive_prompt(self):
        self.assertTrue(self.params.get("positive_prompt"), "positive_prompt should be non-empty")

    def test_negative_prompt(self):
        self.assertTrue(self.params.get("negative_prompt"), "negative_prompt should be non-empty")

    def test_steps(self):
        self.assertIsInstance(self.params.get("steps"), int)
        self.assertGreater(self.params["steps"], 0)

    def test_seed(self):
        self.assertIsNotNone(self.params.get("seed"))

    def test_sampler(self):
        self.assertTrue(self.params.get("sampler"))


class TestA1111Hires(unittest.TestCase):
    def setUp(self):
        self.raw = _load("a1111_hires.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params)

    def test_source(self):
        self.assertEqual(self.params["formats"], ["a1111"])

    def test_hires_upscaler(self):
        self.assertTrue(self.params.get("hires_upscaler"), "hires_upscaler should be extracted")

    def test_hires_steps(self):
        self.assertIsNotNone(self.params.get("hires_steps"), "hires_steps should be extracted")

    def test_denoise_strength(self):
        self.assertIsNotNone(self.params.get("denoise_strength"), "denoising strength should be extracted")

    def test_model(self):
        self.assertTrue(self.params.get("model"))


class TestA1111Loras(unittest.TestCase):
    def setUp(self):
        self.raw = _load("a1111_loras.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params)

    def test_source(self):
        self.assertEqual(self.params["formats"], ["a1111"])

    def test_loras_is_list(self):
        loras = self.params.get("loras")
        self.assertIsInstance(loras, list, "loras should be a list of dicts, not a raw string")

    def test_loras_not_empty(self):
        loras = self.params.get("loras") or []
        self.assertGreater(len(loras), 0, "at least one LoRA should be extracted")

    def test_loras_have_name(self):
        loras = self.params.get("loras") or []
        for lora in loras:
            self.assertIn("name", lora, "each lora entry should have a 'name' key")


class TestA1111JpegExif(unittest.TestCase):
    """A1111 metadata embedded in EXIF UserComment (typical for JPEG outputs)."""

    def setUp(self):
        self.raw = _load("a1111_jpeg_exif.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params)

    def test_source(self):
        self.assertEqual(self.params["formats"], ["a1111"])

    def test_model(self):
        self.assertTrue(self.params.get("model"))

    def test_steps(self):
        self.assertIsInstance(self.params.get("steps"), int)

    def test_seed(self):
        self.assertIsNotNone(self.params.get("seed"))


# ---------------------------------------------------------------------------
# ComfyUI prompt fixtures
# ---------------------------------------------------------------------------

class TestComfyUIPromptSimple(unittest.TestCase):
    def setUp(self):
        self.raw = _load("comfyui_prompt_simple.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params)

    def test_source(self):
        self.assertEqual(self.params["formats"], ["comfyui"])

    def test_model(self):
        self.assertTrue(self.params.get("model"))

    def test_positive_prompt(self):
        self.assertTrue(self.params.get("positive_prompt"))

    def test_steps(self):
        self.assertIsInstance(self.params.get("steps"), int)
        self.assertGreater(self.params["steps"], 0)

    def test_sampler(self):
        self.assertTrue(self.params.get("sampler"))

    def test_seed(self):
        self.assertIsNotNone(self.params.get("seed"))


class TestComfyUIPromptComplex(unittest.TestCase):
    """ComfyUI workflow with LoRAs and multiple models."""

    def setUp(self):
        self.raw = _load("comfyui_prompt_complex.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params)

    def test_source(self):
        self.assertEqual(self.params["formats"], ["comfyui"])

    def test_model(self):
        self.assertTrue(self.params.get("model"))

    def test_positive_prompt(self):
        self.assertTrue(self.params.get("positive_prompt"))

    def test_loras_present(self):
        loras = self.params.get("loras")
        self.assertIsNotNone(loras, "complex workflow should have LoRAs")
        if isinstance(loras, list):
            self.assertGreater(len(loras), 0)


class TestComfyUIWorkflow(unittest.TestCase):
    """ComfyUI workflow JSON (no 'prompt' key — legacy/export format)."""

    def setUp(self):
        self.raw = _load("comfyui_workflow.json")
        self.params = extract_params(self.raw)

    def test_not_none(self):
        self.assertIsNotNone(self.params, "workflow parser should extract from workflow JSON")

    def test_source(self):
        self.assertEqual(self.params["formats"], ["comfyui"])

    def test_model(self):
        self.assertTrue(self.params.get("model"))

    def test_steps(self):
        self.assertIsInstance(self.params.get("steps"), int)

    def test_sampler(self):
        self.assertTrue(self.params.get("sampler"))


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestNoMetadata(unittest.TestCase):
    def test_returns_none_for_empty_dict(self):
        raw = _load("no_metadata.json")
        self.assertIsNone(extract_params(raw))

    def test_returns_none_for_none_input(self):
        self.assertIsNone(extract_params(None))  # type: ignore[arg-type]

    def test_returns_none_for_non_dict(self):
        self.assertIsNone(extract_params("not a dict"))  # type: ignore[arg-type]



# ---------------------------------------------------------------------------
# BFS conditioning concat / combine tests
# ---------------------------------------------------------------------------

class _PromptBuilder:
    """Minimal helper to build ComfyUI prompt-JSON dicts for BFS tests."""

    def __init__(self):
        self._nodes: dict = {}
        self._next_id = 1

    def _id(self) -> str:
        nid = str(self._next_id)
        self._next_id += 1
        return nid

    def clip_text(self, text: str) -> str:
        nid = self._id()
        self._nodes[nid] = {"class_type": "CLIPTextEncode", "inputs": {"text": text}}
        return nid

    def conditioning_concat(self, to_id: str, from_id: str) -> str:
        nid = self._id()
        self._nodes[nid] = {
            "class_type": "ConditioningConcat",
            "inputs": {
                "conditioning_to": [to_id, 0],
                "conditioning_from": [from_id, 0],
            },
        }
        return nid

    def conditioning_combine(self, c1_id: str, c2_id: str) -> str:
        nid = self._id()
        self._nodes[nid] = {
            "class_type": "ConditioningCombine",
            "inputs": {
                "conditioning_1": [c1_id, 0],
                "conditioning_2": [c2_id, 0],
            },
        }
        return nid

    def ksampler(self, positive_id: str, negative_id: str, model_id: str) -> str:
        nid = self._id()
        self._nodes[nid] = {
            "class_type": "KSampler",
            "inputs": {
                "model": [model_id, 0],
                "positive": [positive_id, 0],
                "negative": [negative_id, 0],
                "seed": 1,
                "steps": 20,
                "cfg": 7.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "latent_image": ["latent", 0],
            },
        }
        return nid

    def checkpoint(self, name: str = "model.safetensors") -> str:
        nid = self._id()
        self._nodes[nid] = {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": name},
        }
        return nid

    def build(self) -> dict:
        return dict(self._nodes)


class TestConditioningConcatPrompt(unittest.TestCase):
    """_resolve_text_link must combine both branches of ConditioningConcat."""

    def _parse(self, prompt: dict):
        from metadata_parser import comfyui_prompt as _cp
        return _cp.parse(prompt)

    def test_positive_combines_to_and_from(self):
        b = _PromptBuilder()
        model = b.checkpoint()
        prefix = b.clip_text("quality_prefix")
        content = b.clip_text("actual_content")
        concat = b.conditioning_concat(to_id=prefix, from_id=content)
        neg = b.clip_text("bad stuff")
        b.ksampler(positive_id=concat, negative_id=neg, model_id=model)
        params = self._parse(b.build())
        positive = params.get("positive_prompt", "") or ""
        self.assertIn("quality_prefix", positive, "prefix (conditioning_to) must be present")
        self.assertIn("actual_content", positive, "content (conditioning_from) must be present")

    def test_negative_not_contaminated_by_concat(self):
        b = _PromptBuilder()
        model = b.checkpoint()
        prefix = b.clip_text("quality_prefix")
        content = b.clip_text("actual_content")
        concat = b.conditioning_concat(to_id=prefix, from_id=content)
        neg = b.clip_text("negative_only")
        b.ksampler(positive_id=concat, negative_id=neg, model_id=model)
        params = self._parse(b.build())
        negative = params.get("negative_prompt", "") or ""
        self.assertEqual(negative, "negative_only")
        self.assertNotIn("quality_prefix", negative)
        self.assertNotIn("actual_content", negative)

    def test_nested_concat(self):
        """ConditioningConcat(ConditioningConcat(a, b), c) → a, b, c all present."""
        b = _PromptBuilder()
        model = b.checkpoint()
        a = b.clip_text("part_a")
        br = b.clip_text("part_b")
        c = b.clip_text("part_c")
        inner = b.conditioning_concat(to_id=a, from_id=br)
        outer = b.conditioning_concat(to_id=inner, from_id=c)
        neg = b.clip_text("neg")
        b.ksampler(positive_id=outer, negative_id=neg, model_id=model)
        params = self._parse(b.build())
        positive = params.get("positive_prompt", "") or ""
        for part in ("part_a", "part_b", "part_c"):
            self.assertIn(part, positive, f"{part} missing from nested concat")


class TestConditioningCombinePrompt(unittest.TestCase):
    """_resolve_text_link must combine both branches of ConditioningCombine."""

    def _parse(self, prompt: dict):
        from metadata_parser import comfyui_prompt as _cp
        return _cp.parse(prompt)

    def test_positive_combines_both(self):
        b = _PromptBuilder()
        model = b.checkpoint()
        c1 = b.clip_text("style_tags")
        c2 = b.clip_text("subject_tags")
        combined = b.conditioning_combine(c1_id=c1, c2_id=c2)
        neg = b.clip_text("neg")
        b.ksampler(positive_id=combined, negative_id=neg, model_id=model)
        params = self._parse(b.build())
        positive = params.get("positive_prompt", "") or ""
        self.assertIn("style_tags", positive)
        self.assertIn("subject_tags", positive)


if __name__ == "__main__":
    unittest.main(verbosity=2)
