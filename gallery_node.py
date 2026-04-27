import hashlib
import json
import os

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

try:
    import folder_paths
except ImportError:
    folder_paths = None  # type: ignore[assignment]

try:
    from comfy.cli_args import args as _comfy_args
except ImportError:
    _comfy_args = None  # type: ignore[assignment]

try:
    import comfy.samplers as _comfy_samplers
    _SAMPLER_TYPE: object = _comfy_samplers.KSampler.SAMPLERS
    _SCHEDULER_TYPE: object = _comfy_samplers.KSampler.SCHEDULERS
except ImportError:
    _comfy_samplers = None  # type: ignore[assignment]
    _SAMPLER_TYPE = "STRING"
    _SCHEDULER_TYPE = "STRING"

from .metadata_parser._extractor import buildMetadata
from .metadata_parser import extract_params
from .metadata_parser import comfyui_prompt as _prompt
from .metadata_parser._writer import params_to_a1111_string

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}


def _empty_outputs() -> dict:
    empty_tuple = ("", "", 0, 0, 0.0, "", "", "", "", 0, 0, 0.0, 0, "[]")
    return {"ui": {"positive": [""], "negative": [""]}, "result": empty_tuple}


def _image_combo_input() -> dict:
    """Return the INPUT_TYPES 'required' block for an image COMBO widget.

    Lists files from both input/ (plain) and output/ (annotated as 'file [output]')
    so that gallery picks from output/ don't require a copy into input/.
    """
    images: list[str] = []
    if folder_paths:
        def _collect(base_dir: str, annotation: str = "") -> None:
            try:
                real_base = os.path.realpath(base_dir)
                files: list[str] = []
                for dirpath, _, filenames in os.walk(real_base):
                    for f in filenames:
                        rel = os.path.relpath(os.path.join(dirpath, f), real_base).replace("\\", "/")
                        files.append(rel)
                if hasattr(folder_paths, "filter_files_content_types"):
                    matched = folder_paths.filter_files_content_types(files, ["image"])
                else:
                    matched = [f for f in files if os.path.splitext(f)[1].lower() in _IMAGE_EXTS]
                suffix = f" [{annotation}]" if annotation else ""
                images.extend(f"{f}{suffix}" for f in matched)
            except Exception:
                pass

        _collect(folder_paths.get_input_directory())

    return {"image": (sorted(images) if images else ["none"], {"image_upload": True})}


def _resolve_image(image: str) -> str | None:
    """Resolve an image COMBO value to an absolute path, or None if not found."""
    if not image or image in ("", "none"):
        return None
    if folder_paths:
        try:
            p = folder_paths.get_annotated_filepath(image)
            return p if os.path.isfile(p) else None
        except Exception:
            pass
    return None


class GalleryNode:

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "gallery_node"
    CATEGORY = "utils"
    OUTPUT_NODE = True

    def gallery_node(self):
        return ()


class GalleryPromptReader:
    """Read positive and negative prompts from an image in the gallery.

    Use the 'Pick from Gallery' button to copy a gallery image into ComfyUI's
    input directory and select it, or upload a file directly via the image widget.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": _image_combo_input(),
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "ComfyUI Gallery"
    DESCRIPTION = (
        "Read positive and negative prompts from a gallery or local image. "
        "Use the 'Pick from Gallery' button to copy a gallery image into "
        "ComfyUI's input directory and select it, or upload a local file directly."
    )

    def execute(self, image: str = "", unique_id=None):
        full_path = _resolve_image(image)
        if not full_path:
            return {"ui": {"positive": [""], "negative": [""]}, "result": ("", "")}
        try:
            _, _, metadata = buildMetadata(full_path)
        except Exception:
            return {"ui": {"positive": [""], "negative": [""]}, "result": ("", "")}
        params = extract_params(metadata)
        if not params:
            return {"ui": {"positive": [""], "negative": [""]}, "result": ("", "")}
        positive = params.get("positive_prompt") or ""
        negative = params.get("negative_prompt") or ""
        return {
            "ui": {"positive": [positive], "negative": [negative]},
            "result": (positive, negative),
        }

    @classmethod
    def IS_CHANGED(cls, image: str = "", unique_id=None):
        path = _resolve_image(image)
        if not path:
            return ""
        m = hashlib.sha256()
        with open(path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image: str = "", unique_id=None):
        if not image or image in ("", "none"):
            return True
        if folder_paths and not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


class GalleryMetadataExtractor:
    """Extract full generation metadata from a gallery or local image.

    Use the 'Pick from Gallery' button or 'Send to Node' in the lightbox to copy a gallery
    image into ComfyUI's input directory and select it, or upload a file directly via the
    image widget.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": _image_combo_input(),
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = (
        "STRING", "STRING",
        "INT", "INT", "FLOAT",
        _SAMPLER_TYPE, _SCHEDULER_TYPE,
        "STRING", "STRING",
        "INT", "INT", "FLOAT", "INT",
        "STRING",
    )
    RETURN_NAMES = (
        "positive_prompt", "negative_prompt",
        "seed", "steps", "cfg",
        "sampler_name", "scheduler",
        "model", "vae",
        "width", "height", "denoise", "clip_skip",
        "loras",
    )
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "ComfyUI Gallery"
    DESCRIPTION = (
        "Extract generation metadata (prompts, sampler, seed, model, …) from a gallery "
        "or local image. Use the 'Pick from Gallery' button to copy a gallery image into "
        "ComfyUI's input directory and select it, or upload a local file directly."
    )

    def execute(self, image: str = "", unique_id=None):
        full_path = _resolve_image(image)
        if not full_path:
            return _empty_outputs()

        try:
            _, _, metadata = buildMetadata(full_path)
        except Exception:
            return _empty_outputs()

        fileinfo = metadata.get("fileinfo") or {}
        width = int(fileinfo.get("width") or 0)
        height = int(fileinfo.get("height") or 0)

        params = extract_params(metadata)
        if not params:
            empty_tuple = ("", "", 0, 0, 0.0, "", "", "", "", width, height, 0.0, 0, "[]")
            return {"ui": {"positive": [""], "negative": [""]}, "result": empty_tuple}

        loras = params.get("loras") or []
        loras_json = json.dumps(loras, ensure_ascii=False) if isinstance(loras, list) else "[]"

        positive = params.get("positive_prompt") or ""
        negative = params.get("negative_prompt") or ""

        result_tuple = (
            positive,
            negative,
            int(params.get("seed") or 0),
            int(params.get("steps") or 0),
            float(params.get("cfg_scale") or 0.0),
            params.get("sampler") or "",
            params.get("scheduler") or "",
            params.get("model") or "",
            params.get("vae") or "",
            width,
            height,
            float(params.get("denoise_strength") or 0.0),
            -int(params.get("clip_skip") or 0),
            loras_json,
        )
        return {
            "ui": {"positive": [positive], "negative": [negative]},
            "result": result_tuple,
        }

    @classmethod
    def IS_CHANGED(cls, image: str = "", unique_id=None):
        path = _resolve_image(image)
        if not path:
            return ""
        m = hashlib.sha256()
        with open(path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image: str = "", unique_id=None):
        if not image or image in ("", "none"):
            return True
        if folder_paths and not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


class GallerySaveImage:
    """Save images with enriched metadata using Gallery's BFS parser.

    Combines runtime-accurate values from ComfyUI's GENERATION_METADATA
    with richer prompt/LoRA extraction from our 3-pass BFS algorithm.
    Supports A1111, ComfyUI JSON, both, or no metadata output.
    """

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory() if folder_paths else "output"
        self.type = "output"
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "The images to save."}),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI",
                    "tooltip": "Filename prefix. Supports ComfyUI formatting like %date:yyyy-MM-dd%.",
                }),
                "metadata_format": (
                    ["a1111", "comfyui", "both", "none"],
                    {
                        "default": "both",
                        "tooltip": (
                            "a1111: human-readable 'parameters' text chunk. "
                            "comfyui: prompt + workflow JSON chunks. "
                            "both: all chunks. none: no metadata."
                        ),
                    },
                ),
            },
            "optional": {
                "positive_prompt": ("STRING", {"forceInput": True, "tooltip": "Override positive prompt in saved metadata. Connect extractor or StringConcatenate output here."}),
                "negative_prompt":  ("STRING", {"forceInput": True, "tooltip": "Override negative prompt in saved metadata."}),
                "seed":         ("INT",    {"forceInput": True, "tooltip": "Override seed in saved metadata."}),
                "steps":        ("INT",    {"forceInput": True, "tooltip": "Override steps in saved metadata."}),
                "cfg":          ("FLOAT",  {"forceInput": True, "tooltip": "Override CFG scale in saved metadata."}),
                "sampler_name": (_SAMPLER_TYPE,   {"forceInput": True, "tooltip": "Override sampler in saved metadata."}),
                "scheduler":    (_SCHEDULER_TYPE, {"forceInput": True, "tooltip": "Override scheduler in saved metadata."}),
                "model_name":   ("STRING", {"forceInput": True, "tooltip": "Override model name in saved metadata."}),
                "vae_name":     ("STRING", {"forceInput": True, "tooltip": "Override VAE name in saved metadata."}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "generation_metadata": "GENERATION_METADATA",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "ComfyUI Gallery"
    DESCRIPTION = (
        "Save images with enriched metadata. Combines ComfyUI's runtime "
        "GENERATION_METADATA (accurate sampling params) with Gallery's BFS "
        "parser (richer prompt and LoRA extraction). Supports A1111 and/or "
        "ComfyUI JSON metadata formats."
    )

    def save_images(
        self,
        images,
        filename_prefix: str = "ComfyUI",
        metadata_format: str = "both",
        prompt=None,
        extra_pnginfo=None,
        generation_metadata=None,
        positive_prompt=None,
        negative_prompt=None,
        seed=None,
        steps=None,
        cfg=None,
        sampler_name=None,
        scheduler=None,
        model_name=None,
        vae_name=None,
    ):
        disable_meta = _comfy_args is not None and getattr(_comfy_args, "disable_metadata", False)

        full_output_folder, filename, counter, subfolder, filename_prefix = (
            folder_paths.get_save_image_path(
                filename_prefix, self.output_dir,
                images[0].shape[1], images[0].shape[0],
            )
        )

        results = []
        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            pnginfo = None
            if not disable_meta and metadata_format != "none":
                pnginfo = PngInfo()
                merged = self._build_merged_params(
                    prompt, generation_metadata,
                    positive_prompt=positive_prompt,
                    negative_prompt=negative_prompt,
                    seed=seed, steps=steps, cfg=cfg,
                    sampler_name=sampler_name, scheduler=scheduler,
                    model_name=model_name, vae_name=vae_name,
                )

                if metadata_format in ("a1111", "both") and merged:
                    a1111_str = params_to_a1111_string(merged)
                    if a1111_str:
                        pnginfo.add_text("parameters", a1111_str)

                if metadata_format in ("comfyui", "both"):
                    if prompt is not None:
                        pnginfo.add_text("prompt", json.dumps(prompt))
                    if extra_pnginfo is not None:
                        for k, v in extra_pnginfo.items():
                            pnginfo.add_text(k, json.dumps(v))

            filename_with_batch = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch}_{counter:05}_.png"
            img.save(
                os.path.join(full_output_folder, file),
                pnginfo=pnginfo,
                compress_level=self.compress_level,
            )
            results.append({"filename": file, "subfolder": subfolder.replace("\\", "/"), "type": self.type})
            counter += 1

        return {"ui": {"images": results}}

    def _build_merged_params(self, prompt, gm, *,
                             positive_prompt=None, negative_prompt=None,
                             seed=None, steps=None, cfg=None,
                             sampler_name=None, scheduler=None,
                             model_name=None, vae_name=None) -> dict:
        """Merge BFS-extracted params with GENERATION_METADATA and explicit inputs.

        Priority (highest wins):
          3. Explicit optional inputs — runtime-accurate, user-controlled, work on vanilla ComfyUI
          2. GM overlay — runtime-derived (fork only); accurate sampling params
          1. BFS — graph structure; richer for LoRAs, prompts, static literals
        """
        # BFS enrichment from original prompt graph
        bfs_params: dict = {}
        if prompt:
            parsed = _prompt.parse(prompt)
            if parsed:
                bfs_params = parsed

        merged = dict(bfs_params)

        # GM overlay: runtime-derived fields win over BFS
        if gm is not None:
            try:
                is_empty = gm.is_empty()
            except Exception:
                is_empty = True

            if not is_empty:
                for field in ("steps", "cfg_scale", "sampler", "scheduler", "seed", "model"):
                    val = getattr(gm, field, None)
                    if val is not None:
                        merged[field] = val

                # Prompts: BFS first; fall back to GM if BFS found nothing
                if not merged.get("positive_prompt") and getattr(gm, "positive_prompt", None):
                    merged["positive_prompt"] = gm.positive_prompt
                if not merged.get("negative_prompt") and getattr(gm, "negative_prompt", None):
                    merged["negative_prompt"] = gm.negative_prompt

                # LoRAs: BFS (dicts with name/strength) preferred; fall back to GM (strings)
                if not merged.get("loras"):
                    gm_loras = getattr(gm, "loras", None)
                    if gm_loras:
                        merged["loras"] = gm_loras

        # Explicit optional inputs win over everything — user-controlled, runtime-accurate
        if positive_prompt: merged["positive_prompt"] = positive_prompt
        if negative_prompt: merged["negative_prompt"] = negative_prompt
        if seed is not None: merged["seed"] = seed
        if steps is not None: merged["steps"] = steps
        if cfg is not None: merged["cfg_scale"] = cfg
        if sampler_name: merged["sampler"] = sampler_name
        if scheduler: merged["scheduler"] = scheduler
        if model_name: merged["model"] = model_name
        if vae_name: merged["vae"] = vae_name

        return merged


NODE_CLASS_MAPPINGS = {
    "GalleryNode": GalleryNode,
    "GalleryPromptReader": GalleryPromptReader,
    "GalleryMetadataExtractor": GalleryMetadataExtractor,
    "GallerySaveImage": GallerySaveImage,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GalleryNode": "Gallery Button",
    "GalleryPromptReader": "Gallery Prompt Reader",
    "GalleryMetadataExtractor": "Gallery Metadata Extractor",
    "GallerySaveImage": "Gallery Save Image",
}