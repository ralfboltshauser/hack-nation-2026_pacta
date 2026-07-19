"""Export the visible character geometry from robot_head.blend as a web GLB.

Run with:
    blender --background robot_head.blend --python export_web.py

The source .blend is never saved by this script.
"""

from pathlib import Path

import bpy


PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = PROJECT_DIR / "web" / "public" / "assets" / "pacta-character-integrated.glb"

CHARACTER_OBJECTS = (
    "White head shell",
    "Black face display",
    "Left floating side pod",
    "Right floating side pod",
    "Left recessed cyan halo",
    "Left cyan eye",
    "Right recessed cyan halo",
    "Right cyan eye",
    "Smile",
)


def export_character() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for name in CHARACTER_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise RuntimeError(f"Required object is missing: {name}")
        obj.select_set(True)
        selected.append(obj)

    for obj in selected:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_tangents=False,
        export_texcoords=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_copyright="Pacta character reconstruction",
        check_existing=False,
    )
    print(f"Exported web model: {OUTPUT_PATH}")


if __name__ == "__main__":
    export_character()
