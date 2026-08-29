"""Headless Blender fallback for FBX files rejected by Cocos' FBX converter.

The Node porter invokes this script with Blender's bundled Python runtime. It
never edits the Unity source: the output is a derived GLB under Cocos assets and
the normal Cocos AssetDB importer remains responsible for its .meta/sub-assets.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import bpy


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    forwarded = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Convert one FBX to a Cocos-friendly GLB")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(forwarded)


def main() -> None:
    args = parse_args()
    source = os.path.abspath(args.input)
    output = os.path.abspath(args.output)
    if not os.path.isfile(source):
        raise FileNotFoundError(f"FBX source does not exist: {source}")

    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    imported = bpy.ops.import_scene.fbx(filepath=source)
    if "FINISHED" not in imported:
        raise RuntimeError(f"Blender FBX importer returned: {sorted(imported)}")

    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("Blender imported the FBX but found no mesh objects")

    export_options = {
        "filepath": output,
        "export_format": "GLB",
        "use_selection": False,
        "export_yup": True,
        "export_animations": True,
    }
    try:
        exported = bpy.ops.export_scene.gltf(export_apply=True, **export_options)
    except TypeError:
        # Blender releases occasionally rename/remove optional glTF flags. The
        # essential transform conversion remains deterministic without it.
        exported = bpy.ops.export_scene.gltf(**export_options)
    if "FINISHED" not in exported:
        raise RuntimeError(f"Blender glTF exporter returned: {sorted(exported)}")
    if not os.path.isfile(output) or os.path.getsize(output) == 0:
        raise RuntimeError("Blender reported success but did not create a GLB")

    receipt = {
        "backend": "blender",
        "blenderVersion": bpy.app.version_string,
        "meshObjects": len(mesh_objects),
        "vertices": sum(len(obj.data.vertices) for obj in mesh_objects),
        "outputBytes": os.path.getsize(output),
    }
    print(f"[unity-cocos-port:fbx-fallback] {json.dumps(receipt, sort_keys=True)}")


if __name__ == "__main__":
    main()
