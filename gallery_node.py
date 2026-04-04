import os

try:
    import folder_paths
except ImportError:
    folder_paths = None  # type: ignore[assignment]

from .metadata_extractor import buildMetadata
from .param_extractor import extract_params


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


NODE_CLASS_MAPPINGS = {
    "GalleryNode": GalleryNode,
    "GalleryPromptReader": GalleryPromptReader,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GalleryNode": "Gallery Button",
    "GalleryPromptReader": "Gallery Prompt Reader",
}