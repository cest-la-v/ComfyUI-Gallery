import hashlib
import json
import os

try:
    import folder_paths
except ImportError:
    folder_paths = None  # type: ignore[assignment]

from .metadata_parser._extractor import buildMetadata
from .metadata_parser import extract_params

_SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_settings.json")
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}


def _gallery_root() -> str:
    """Return the current gallery monitor root from user_settings.json."""
    base = folder_paths.get_output_directory() if folder_paths else ""
    try:
        with open(_SETTINGS_FILE, "r", encoding="utf-8") as f:
            settings = json.load(f)
        raw = settings.get("relativePath", "./")
        if not raw or raw.strip() in ("", "null", "./", "."):
            return base
        if os.path.isabs(raw):
            return os.path.normpath(raw)
        return os.path.normpath(os.path.join(base, raw))
    except Exception:
        return base


def _resolve_image_path(image_path: str) -> str | None:
    """Resolve image_path to an absolute filesystem path, or None if not found.

    Resolution order:
      1. Already absolute — use directly.
      2. Relative to output directory.
      3. Relative to gallery monitor root (from user_settings.json relativePath).
    """
    if not image_path:
        return None
    if os.path.isabs(image_path):
        return image_path if os.path.isfile(image_path) else None

    output_dir = folder_paths.get_output_directory() if folder_paths else ""
    for base in filter(None, [output_dir, _gallery_root()]):
        candidate = os.path.normpath(os.path.join(base, image_path))
        if os.path.isfile(candidate):
            return candidate
    return None


def _empty_outputs() -> tuple:
    return ("", "", 0, 0, 0.0, "", "", "", "", 0, 0, 0.0, 0, "[]")


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
    """Read positive and negative prompts from an image in the gallery."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_path": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt")
    FUNCTION = "execute"
    CATEGORY = "ComfyUI Gallery"

    def execute(self, image_path: str):
        if not image_path:
            return ("", "")
        output_dir = folder_paths.get_output_directory() if folder_paths else ""
        full_path = os.path.join(output_dir, image_path) if not os.path.isabs(image_path) else image_path
        try:
            _, _, metadata = buildMetadata(full_path)
        except Exception:
            return ("", "")
        params = extract_params(metadata)
        if not params:
            return ("", "")
        return (params.get("positive_prompt") or "", params.get("negative_prompt") or "")


class GalleryMetadataExtractor:
    """Extract full generation metadata from a gallery or local image.

    Accepts an image via the standard ComfyUI upload picker (``image`` widget) or
    via a gallery-resolved absolute path (``image_path`` widget, populated by the
    "Pick from Gallery" button or the "Send to Node" action in the lightbox).
    ``image_path`` takes priority when non-empty.
    """

    @classmethod
    def INPUT_TYPES(cls):
        output_images = []
        if folder_paths:
            try:
                out_dir = folder_paths.get_output_directory()
                files = [f for f in os.listdir(out_dir) if os.path.isfile(os.path.join(out_dir, f))]
                if hasattr(folder_paths, "filter_files_content_types"):
                    output_images = folder_paths.filter_files_content_types(files, ["image"])
                else:
                    output_images = [f for f in files if os.path.splitext(f)[1].lower() in _IMAGE_EXTS]
            except Exception:
                pass

        return {
            "required": {
                "image_path": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "image": (sorted(output_images) if output_images else ["none"], {"image_upload": True}),
            },
        }

    RETURN_TYPES = (
        "STRING", "STRING",
        "INT", "INT", "FLOAT",
        "STRING", "STRING",
        "STRING", "STRING",
        "INT", "INT", "FLOAT", "INT",
        "STRING",
    )
    RETURN_NAMES = (
        "positive_prompt", "negative_prompt",
        "seed", "steps", "cfg_scale",
        "sampler", "scheduler",
        "model", "vae",
        "width", "height", "denoise_strength", "clip_skip",
        "loras",
    )
    FUNCTION = "execute"
    CATEGORY = "ComfyUI Gallery"
    DESCRIPTION = (
        "Extract generation metadata (prompts, sampler, seed, model, …) from a gallery "
        "or local image. Use the 'Pick from Gallery' button to select from the gallery, "
        "or choose a local file with the image upload widget."
    )

    def execute(self, image_path: str = "", image: str = ""):
        full_path = self._resolve(image_path, image)
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
            return ("", "", 0, 0, 0.0, "", "", "", "", width, height, 0.0, 0, "[]")

        loras = params.get("loras") or []
        loras_json = json.dumps(loras, ensure_ascii=False) if isinstance(loras, list) else "[]"

        return (
            params.get("positive_prompt") or "",
            params.get("negative_prompt") or "",
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
            int(params.get("clip_skip") or 0),
            loras_json,
        )

    @classmethod
    def IS_CHANGED(cls, image_path: str = "", image: str = ""):
        path = cls._resolve(image_path, image)
        if not path:
            return ""
        m = hashlib.sha256()
        with open(path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image_path: str = "", image: str = ""):
        if image_path.strip():
            if not _resolve_image_path(image_path.strip()):
                return f"Image not found: {image_path}"
        elif image and image not in ("", "none"):
            if folder_paths and not folder_paths.exists_annotated_filepath(image):
                return f"Invalid image file: {image}"
        return True

    @staticmethod
    def _resolve(image_path: str, image: str) -> str | None:
        if image_path.strip():
            return _resolve_image_path(image_path.strip())
        if image and image not in ("", "none"):
            if folder_paths:
                try:
                    p = folder_paths.get_annotated_filepath(image)
                    return p if os.path.isfile(p) else None
                except Exception:
                    pass
        return None


NODE_CLASS_MAPPINGS = {
    "GalleryNode": GalleryNode,
    "GalleryPromptReader": GalleryPromptReader,
    "GalleryMetadataExtractor": GalleryMetadataExtractor,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GalleryNode": "Gallery Button",
    "GalleryPromptReader": "Gallery Prompt Reader",
    "GalleryMetadataExtractor": "Gallery Metadata Extractor",
}