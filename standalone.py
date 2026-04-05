#!/usr/bin/env python3
"""Standalone entry point for ComfyUI-Gallery backend.

Runs the gallery API server without ComfyUI, for development and testing:

    python standalone.py [--port 8188] [--output ./output] [--host 127.0.0.1]

The Vite dev server (bun run dev) proxies /Gallery/* and /static_gallery/* to
this server so the frontend talks to a real backend without ComfyUI running.

Environment variables:
    GALLERY_OUTPUT_DIR  Default output directory (overridden by --output)
"""

import argparse
import importlib.util
import os
import sys
import types

# ---------------------------------------------------------------------------
# Bootstrap: make the gallery package importable despite the hyphen in its
# directory name ("ComfyUI-Gallery" → registered as "ComfyUI_Gallery").
# ---------------------------------------------------------------------------
_here = os.path.dirname(os.path.abspath(__file__))
_PKG = "ComfyUI_Gallery"

_pkg_mod = types.ModuleType(_PKG)
_pkg_mod.__path__ = [_here]  # type: ignore[assignment]
_pkg_mod.__package__ = _PKG
_pkg_mod.__file__ = os.path.join(_here, "__init__.py")
sys.modules.setdefault(_PKG, _pkg_mod)


def _load_submodule(name: str) -> types.ModuleType:
    """Load a gallery sub-module and register it under the package namespace."""
    full_name = f"{_PKG}.{name}"
    if full_name in sys.modules:
        return sys.modules[full_name]  # type: ignore[return-value]
    spec = importlib.util.spec_from_file_location(
        full_name, os.path.join(_here, f"{name}.py")
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = _PKG
    sys.modules[full_name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def main() -> None:
    parser = argparse.ArgumentParser(description="ComfyUI Gallery standalone backend")
    parser.add_argument("--port", type=int, default=8188, help="Port (default: 8188)")
    parser.add_argument("--output", default="", help="Output directory to serve")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    args = parser.parse_args()

    if args.output:
        os.environ["GALLERY_OUTPUT_DIR"] = os.path.abspath(args.output)

    # Load sub-modules in dependency order so relative imports resolve correctly.
    # Note: server.py imports folder_monitor internally — load it first.
    _load_submodule("gallery_db")
    _load_submodule("folder_scanner")

    # Load metadata_parser package
    _mp_pkg = f"{_PKG}.metadata_parser"
    _mp_dir = os.path.join(_here, "metadata_parser")
    _mp_mod = types.ModuleType(_mp_pkg)
    _mp_mod.__path__ = [_mp_dir]  # type: ignore[assignment]
    _mp_mod.__package__ = _mp_pkg
    sys.modules.setdefault(_mp_pkg, _mp_mod)

    # server.py imports folder_monitor internally; loading server is sufficient
    server_mod = _load_submodule("server")

    from aiohttp import web
    from aiohttp.web_middlewares import normalize_path_middleware  # noqa: F401

    ps = server_mod.PromptServer.instance
    app: web.Application = ps.app

    # CORS middleware for local dev (Vite dev server is on a different port)
    @web.middleware
    async def cors_middleware(request: web.Request, handler):  # type: ignore[misc]
        if request.method == "OPTIONS":
            return web.Response(
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                }
            )
        response = await handler(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response

    app.middlewares.append(cors_middleware)  # type: ignore[arg-type]
    app.router.add_routes(ps.routes)

    output_dir = os.environ.get("GALLERY_OUTPUT_DIR", server_mod.PLACEHOLDER_DIR)
    print(f"ComfyUI Gallery standalone backend")
    print(f"  http://{args.host}:{args.port}")
    print(f"  Output dir: {output_dir}")
    print(f"  Proxy tip: add /Gallery/* and /static_gallery/* → :{args.port} in your dev server")

    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
