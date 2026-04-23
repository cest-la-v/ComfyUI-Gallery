import hashlib
import json
import os

try:
    import folder_paths
except ImportError:
    folder_paths = None  # type: ignore[assignment]

from .metadata_parser._extractor import buildMetadata
from .metadata_parser import extract_params

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}


def _empty_outputs() -> tuple:
    return ("", "", 0, 0, 0.0, "", "", "", "", 0, 0, 0.0, 0, "[]")


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
        return {"required": _image_combo_input()}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt")
    FUNCTION = "execute"
    CATEGORY = "ComfyUI Gallery"
    DESCRIPTION = (
        "Read positive and negative prompts from a gallery or local image. "
        "Use the 'Pick from Gallery' button to copy a gallery image into "
        "ComfyUI's input directory and select it, or upload a local file directly."
    )

    def execute(self, image: str = ""):
        full_path = _resolve_image(image)
        if not full_path:
            return ("", "")
        try:
            _, _, metadata = buildMetadata(full_path)
        except Exception:
            return ("", "")
        params = extract_params(metadata)
        if not params:
            return ("", "")
        return (params.get("positive_prompt") or "", params.get("negative_prompt") or "")

    @classmethod
    def IS_CHANGED(cls, image: str = ""):
        path = _resolve_image(image)
        if not path:
            return ""
        m = hashlib.sha256()
        with open(path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image: str = ""):
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
        return {"required": _image_combo_input()}

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
        "or local image. Use the 'Pick from Gallery' button to copy a gallery image into "
        "ComfyUI's input directory and select it, or upload a local file directly."
    )

    def execute(self, image: str = ""):
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
    def IS_CHANGED(cls, image: str = ""):
        path = _resolve_image(image)
        if not path:
            return ""
        m = hashlib.sha256()
        with open(path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image: str = ""):
        if not image or image in ("", "none"):
            return True
        if folder_paths and not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


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