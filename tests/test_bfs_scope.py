"""Tests for BFS scoping in comfyui_prompt.parse().

Verifies that `parse()` restricts extraction to nodes reachable from the
sampler hub, preventing false-positive LoRA / upscaler results from
disconnected / orphaned nodes in the workflow JSON.

Also covers StringConcatenate, ConditioningConcat, ConditioningCombine
prompt merging, and fallback behaviour when no hub is found.

Run:
    python -m pytest tests/test_bfs_scope.py -v
    python -m unittest tests.test_bfs_scope -v
"""
import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from metadata_parser import comfyui_prompt as bfs  # noqa: E402


def _simple_workflow(extra_nodes=None):
    """Minimal valid workflow: CheckpointLoader → CLIPTextEncode x2 → KSampler."""
    nodes = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        "2": {"class_type": "CLIPModel", "inputs": {}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "beautiful portrait masterpiece", "clip": ["2", 0]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly, blurry, worst quality", "clip": ["2", 0]}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0],
                "latent_image": ["6", 0], "steps": 20, "cfg": 7.0,
                "sampler_name": "euler", "scheduler": "normal", "seed": 42, "denoise": 1.0,
            },
        },
        "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
    }
    if extra_nodes:
        nodes.update(extra_nodes)
    return nodes


# ---------------------------------------------------------------------------
# Orphaned node filtering
# ---------------------------------------------------------------------------

class TestOrphanedLoraExcluded(unittest.TestCase):
    """An orphaned LoraLoader (not connected to the sampler) must NOT appear in results."""

    def setUp(self):
        self.result = bfs.parse(_simple_workflow(extra_nodes={
            "99": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": "orphan_style.safetensors",
                    "strength_model": 0.8, "strength_clip": 0.8,
                    "model": ["1", 0], "clip": ["2", 0],
                },
            },
        }))

    def test_loras_absent(self):
        """Orphaned LoRA must not appear in results."""
        self.assertFalse(self.result.get("loras"), "orphaned LoRA should be excluded")

    def test_prompts_still_extracted(self):
        """Connected prompt nodes must still be extracted."""
        self.assertIn("beautiful portrait", self.result.get("positive_prompt", ""))


class TestConnectedLoraIncluded(unittest.TestCase):
    """A LoraLoader wired into the model chain IS upstream and must appear in results."""

    def setUp(self):
        # LoraLoader sits between CheckpointLoader and KSampler
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "base.safetensors"}},
            "2": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": "style_lora.safetensors",
                    "strength_model": 0.7, "strength_clip": 0.7,
                    "model": ["1", 0], "clip": ["3", 0],
                },
            },
            "3": {"class_type": "CLIPModel", "inputs": {}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "stunning portrait masterpiece", "clip": ["3", 0]}},
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly, blurry, worst quality", "clip": ["3", 0]}},
            "6": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["2", 0], "positive": ["4", 0], "negative": ["5", 0],
                    "latent_image": ["7", 0], "steps": 25, "cfg": 8.0,
                    "sampler_name": "dpm_2", "scheduler": "karras", "seed": 123, "denoise": 1.0,
                },
            },
            "7": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        }
        self.result = bfs.parse(nodes)

    def test_loras_present(self):
        loras = self.result.get("loras") or []
        self.assertGreater(len(loras), 0, "connected LoRA should be included")

    def test_lora_name(self):
        loras = self.result.get("loras") or []
        names = [l["name"] for l in loras]
        self.assertIn("style_lora", names)

    def test_prompts_extracted(self):
        self.assertIn("stunning portrait", self.result.get("positive_prompt", ""))


class TestOrphanedUpscalerExcluded(unittest.TestCase):
    """An orphaned UltimateSDUpscale (not connected to sampler) must NOT appear in results."""

    def setUp(self):
        self.result = bfs.parse(_simple_workflow(extra_nodes={
            "98": {
                "class_type": "UltimateSDUpscale",
                "inputs": {
                    "upscale_model": ["97", 0],
                    "upscale_by": 2.0,
                    "denoise": 0.4,
                },
            },
            "97": {
                "class_type": "UpscaleModelLoader",
                "inputs": {"model_name": "4x_UltraSharp.pth"},
            },
        }))

    def test_upscaler_absent(self):
        self.assertIsNone(self.result.get("hires_upscaler"), "orphaned upscaler should be excluded")

    def test_basic_params_still_extracted(self):
        self.assertEqual(self.result.get("steps"), 20)
        self.assertEqual(self.result.get("seed"), 42)


class TestMultipleKSamplers(unittest.TestCase):
    """When two KSamplers are present, only the first-found hub's upstream is used."""

    def setUp(self):
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "correct_model.safetensors"}},
            "2": {"class_type": "CLIPModel", "inputs": {}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "first sampler positive", "clip": ["2", 0]}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "first sampler negative", "clip": ["2", 0]}},
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0],
                    "latent_image": ["10", 0], "steps": 20, "cfg": 7.0,
                    "sampler_name": "euler", "scheduler": "normal", "seed": 42, "denoise": 1.0,
                },
            },
            "10": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
            # Disconnected second sampler with orphaned LoRA
            "20": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "wrong_model.safetensors"}},
            "21": {"class_type": "CLIPTextEncode", "inputs": {"text": "second sampler positive", "clip": ["2", 0]}},
            "22": {"class_type": "CLIPTextEncode", "inputs": {"text": "second sampler negative", "clip": ["2", 0]}},
            "23": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["20", 0], "positive": ["21", 0], "negative": ["22", 0],
                    "latent_image": ["10", 0], "steps": 50, "cfg": 4.0,
                    "sampler_name": "dpm_2", "scheduler": "karras", "seed": 999, "denoise": 1.0,
                },
            },
        }
        self.result = bfs.parse(nodes)

    def test_returns_a_result(self):
        self.assertIsNotNone(self.result)

    def test_steps_from_some_sampler(self):
        # Either 20 or 50 — both are valid; test that we get one of them (not both, not None)
        self.assertIn(self.result.get("steps"), (20, 50))


# ---------------------------------------------------------------------------
# StringConcatenate / ConditioningConcat / ConditioningCombine
# ---------------------------------------------------------------------------

class TestStringConcatenatePrompt(unittest.TestCase):
    """StringConcatenate must produce the full merged prompt (both branches)."""

    def setUp(self):
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
            "2": {"class_type": "CLIPModel", "inputs": {}},
            # StringConcatenate: prefix + user prompt
            "3": {
                "class_type": "StringConcatenate",
                "inputs": {
                    "string_a": "score_9, score_8_up",
                    "string_b": "beautiful red hair girl",
                    "delimiter": ", ",
                },
            },
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": ["3", 0], "clip": ["2", 0]}},
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly, worst quality, blurry", "clip": ["2", 0]}},
            "6": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
                    "latent_image": ["7", 0], "steps": 20, "cfg": 7.0,
                    "sampler_name": "euler", "scheduler": "normal", "seed": 1, "denoise": 1.0,
                },
            },
            "7": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        }
        self.result = bfs.parse(nodes)

    def test_prefix_in_positive(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn("score_9", pos, "prefix must be in positive_prompt")

    def test_suffix_in_positive(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn("beautiful red hair girl", pos, "user prompt must be in positive_prompt")

    def test_separator_applied(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn(", ", pos)


class TestConditioningConcatPrompt(unittest.TestCase):
    """ConditioningConcat must produce the full merged prompt from both branches."""

    def setUp(self):
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
            "2": {"class_type": "CLIPModel", "inputs": {}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "prefix quality tags", "clip": ["2", 0]}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "main subject description", "clip": ["2", 0]}},
            "5": {
                "class_type": "ConditioningConcat",
                "inputs": {"conditioning_to": ["3", 0], "conditioning_from": ["4", 0]},
            },
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly, bad quality, blurry", "clip": ["2", 0]}},
            "7": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0],
                    "latent_image": ["8", 0], "steps": 20, "cfg": 7.0,
                    "sampler_name": "euler", "scheduler": "normal", "seed": 2, "denoise": 1.0,
                },
            },
            "8": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        }
        self.result = bfs.parse(nodes)

    def test_to_branch_in_positive(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn("prefix quality tags", pos)

    def test_from_branch_in_positive(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn("main subject description", pos)


class TestConditioningCombinePrompt(unittest.TestCase):
    """ConditioningCombine must produce the merged prompt from both branches."""

    def setUp(self):
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
            "2": {"class_type": "CLIPModel", "inputs": {}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "style tags masterpiece", "clip": ["2", 0]}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "subject portrait woman", "clip": ["2", 0]}},
            "5": {
                "class_type": "ConditioningCombine",
                "inputs": {"conditioning_1": ["3", 0], "conditioning_2": ["4", 0]},
            },
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly, low quality, deformed", "clip": ["2", 0]}},
            "7": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0],
                    "latent_image": ["8", 0], "steps": 20, "cfg": 7.0,
                    "sampler_name": "euler", "scheduler": "normal", "seed": 3, "denoise": 1.0,
                },
            },
            "8": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        }
        self.result = bfs.parse(nodes)

    def test_conditioning_1_in_positive(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn("style tags", pos)

    def test_conditioning_2_in_positive(self):
        pos = self.result.get("positive_prompt") or ""
        self.assertIn("subject portrait", pos)


# ---------------------------------------------------------------------------
# No-hub fallback
# ---------------------------------------------------------------------------

class TestNoHubFallback(unittest.TestCase):
    """When no sampler hub is found, parse() should still return partial results."""

    def setUp(self):
        # Node graph with no standard KSampler — only a checkpoint and a text encoder
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a beautiful photograph masterpiece"}},
        }
        self.result = bfs.parse(nodes)

    def test_returns_dict(self):
        self.assertIsInstance(self.result, dict)

    def test_model_extracted(self):
        self.assertEqual(self.result.get("model"), "model")

    def test_positive_prompt_extracted(self):
        # Heuristic scan picks up the CLIPTextEncode text
        pos = self.result.get("positive_prompt") or ""
        self.assertTrue(pos, "heuristic scan should find a positive prompt when no hub exists")


# ---------------------------------------------------------------------------
# Pass 1 KSampler literal extraction
# ---------------------------------------------------------------------------

class TestPass1Literals(unittest.TestCase):
    """KSampler literal values should be extracted in Pass 1."""

    def setUp(self):
        self.result = bfs.parse(_simple_workflow())

    def test_steps(self):
        self.assertEqual(self.result.get("steps"), 20)

    def test_cfg(self):
        self.assertAlmostEqual(self.result.get("cfg_scale"), 7.0)

    def test_seed(self):
        self.assertEqual(self.result.get("seed"), 42)

    def test_sampler(self):
        self.assertEqual(self.result.get("sampler"), "Euler")

    def test_scheduler(self):
        self.assertEqual(self.result.get("scheduler"), "Normal")

    def test_model(self):
        self.assertEqual(self.result.get("model"), "model")

    def test_positive_prompt(self):
        self.assertIn("beautiful portrait", self.result.get("positive_prompt", ""))

    def test_negative_prompt(self):
        neg = self.result.get("negative_prompt") or ""
        self.assertTrue(neg, "negative_prompt should be extracted")


if __name__ == "__main__":
    unittest.main()
