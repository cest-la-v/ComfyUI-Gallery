"""Test bootstrap: makes ComfyUI-Gallery importable as 'comfyui_gallery' package.

Loaded automatically by pytest (conftest.py). For standalone scripts, import this
module first:

    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    import conftest  # noqa: F401

Why this is needed:
- ComfyUI-Gallery uses relative imports (.gallery_config, .metadata_parser, etc.)
- The repo directory name has a hyphen, so it can't be a valid Python package name
- This file synthesises 'comfyui_gallery' in sys.modules with the right __path__,
  so relative imports in folder_scanner.py, gallery_db.py, etc. resolve without
  loading server.py or any ComfyUI / aiohttp dependency.
"""
import sys
import os
import types
import importlib.util

# Root of ComfyUI-Gallery (parent of this tests/ directory)
GALLERY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = "comfyui_gallery"

# Add ComfyUI-Gallery/ to sys.path so 'from metadata_parser import ...' works
if GALLERY_DIR not in sys.path:
    sys.path.insert(0, GALLERY_DIR)

# Stub folder_paths (ComfyUI-only module) before anything imports it
if "folder_paths" not in sys.modules:
    stub = types.ModuleType("folder_paths")
    stub.get_output_directory = lambda: "/tmp/gallery_test_output"  # type: ignore[attr-defined]
    stub.get_input_directory = lambda: "/tmp/gallery_test_input"    # type: ignore[attr-defined]
    sys.modules["folder_paths"] = stub


def _register_submodule(pkg_obj: types.ModuleType, name: str) -> types.ModuleType:
    """Import a root-level .py file as 'comfyui_gallery.<name>'."""
    fq = f"{PKG}.{name}"
    if fq in sys.modules:
        return sys.modules[fq]
    path = os.path.join(GALLERY_DIR, f"{name}.py")
    spec = importlib.util.spec_from_file_location(fq, path)
    assert spec and spec.loader, f"Cannot find {path}"
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = PKG
    sys.modules[fq] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    setattr(pkg_obj, name, mod)
    return mod


# Create the synthetic package (without running __init__.py which pulls in aiohttp)
if PKG not in sys.modules:
    pkg = types.ModuleType(PKG)
    pkg.__path__ = [GALLERY_DIR]  # type: ignore[assignment]
    pkg.__package__ = PKG
    sys.modules[PKG] = pkg

    # Register leaf modules that have no heavy dependencies first
    _register_submodule(pkg, "gallery_config")

    # metadata_parser is a real subpackage — register it via normal import
    import metadata_parser as _mp
    _mp.__name__ = f"{PKG}.metadata_parser"
    _mp.__package__ = PKG
    sys.modules[f"{PKG}.metadata_parser"] = _mp

    # Register operational modules (depend on gallery_config + metadata_parser)
    _register_submodule(pkg, "gallery_db")
    _register_submodule(pkg, "folder_scanner")
