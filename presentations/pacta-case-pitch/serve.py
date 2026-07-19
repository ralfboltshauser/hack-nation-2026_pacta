from __future__ import annotations

import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


PORT = 4173
DECK_ROOT = Path(__file__).resolve().parent
REPO_ROOT = DECK_ROOT.parents[1]
THREE_ROOT = REPO_ROOT / "node_modules/.pnpm/three@0.185.1/node_modules/three"

ALIASES = {
    "/mascot.glb": REPO_ROOT / "apps/web/public/mascot/pacta-character-integrated.glb",
    "/mascot-fallback.png": REPO_ROOT / "apps/web/public/mascot/blender-front.png",
    "/mascot-runtime/character-motion.js": REPO_ROOT / "mascot/web/src/character-motion.js",
    "/vendor/three.module.js": THREE_ROOT / "build/three.module.js",
    "/vendor/three.core.js": THREE_ROOT / "build/three.core.js",
}


class PactaDeckHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DECK_ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        request_path = unquote(urlparse(path).path)
        if request_path in ALIASES:
            return str(ALIASES[request_path])
        addon_prefix = "/vendor/addons/"
        if request_path.startswith(addon_prefix):
            relative = request_path.removeprefix(addon_prefix)
            candidate = (THREE_ROOT / "examples/jsm" / relative).resolve()
            addon_root = (THREE_ROOT / "examples/jsm").resolve()
            if candidate.is_relative_to(addon_root):
                return str(candidate)
        return super().translate_path(path)

    def guess_type(self, path: str) -> str:
        if path.endswith(".glb"):
            return "model/gltf-binary"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), PactaDeckHandler)
    print(f"Pacta deck with Three.js mascot: http://0.0.0.0:{PORT}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
