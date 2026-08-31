"""Normalize an FBX through Blender while keeping the interchange format as FBX.

This is intentionally an FBX-to-FBX repair path for files that Unity can import
but Cocos Creator's native FBX converter rejects. It never emits glTF or GLB.
"""

import json
import os
import sys

import bpy


def tool_args():
    if "--" not in sys.argv:
        raise RuntimeError("Expected source and destination after '--'.")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (2, 3, 4):
        raise RuntimeError("Usage: blender --background --python <script> -- <source.fbx> <destination.fbx> [preserve|static] [anchors-json]")
    mode = values[2] if len(values) >= 3 else "preserve"
    if mode not in ("preserve", "static"):
        raise RuntimeError("Normalization mode must be 'preserve' or 'static'.")
    anchors = json.loads(values[3]) if len(values) == 4 else []
    if not isinstance(anchors, list) or any(not isinstance(name, str) or not name.strip() for name in anchors):
        raise RuntimeError("Static deformation anchors must be a JSON array of non-empty names.")
    if anchors and mode != "static":
        raise RuntimeError("Deformation anchors are supported only in static mode.")
    return os.path.abspath(values[0]), os.path.abspath(values[1]), mode, anchors


def scene_stats():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.data]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    return {
        "objects": len(bpy.context.scene.objects),
        "meshes": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "polygons": sum(len(obj.data.polygons) for obj in meshes),
        "armatures": len(armatures),
        "actions": len(bpy.data.actions),
    }


def vertex_group_coverage(mesh, group_name):
    group = mesh.vertex_groups.get(group_name)
    if group is None:
        return None
    weights = []
    for vertex in mesh.data.vertices:
        weight = 0.0
        for assignment in vertex.groups:
            if assignment.group == group.index:
                weight = assignment.weight
                break
        weights.append(weight)
    influenced = [weight for weight in weights if weight > 1e-6]
    return {
        "vertices": len(weights),
        "influenced": len(influenced),
        "minWeight": min(influenced) if influenced else 0.0,
        "maxWeight": max(influenced) if influenced else 0.0,
        "weights": weights,
    }


def create_anchor_morph(mesh, armature, anchor_name):
    if mesh.data.shape_keys is not None:
        raise RuntimeError("Static anchor morph conversion does not support existing shape keys on '%s'." % mesh.name)
    modifiers = [modifier for modifier in mesh.modifiers if modifier.type != "ARMATURE"]
    if modifiers:
        raise RuntimeError("Static anchor morph conversion found non-armature modifiers on '%s'." % mesh.name)
    pose_bone = armature.pose.bones.get(anchor_name)
    if pose_bone is None:
        raise RuntimeError("Static deformation anchor '%s' has no pose bone." % anchor_name)

    mesh.shape_key_add(name="Basis", from_mix=False)
    original_scale = pose_bone.scale.copy()
    pose_bone.scale.y = original_scale.y * 2.0
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_object = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_object.to_mesh()
    try:
        if len(evaluated_mesh.vertices) != len(mesh.data.vertices):
            raise RuntimeError("Anchor morph changed vertex count on '%s'." % mesh.name)
        coordinates = [vertex.co.copy() for vertex in evaluated_mesh.vertices]
    finally:
        evaluated_object.to_mesh_clear()
        pose_bone.scale = original_scale
        bpy.context.view_layer.update()

    target = mesh.shape_key_add(name=anchor_name, from_mix=False)
    for index, coordinate in enumerate(coordinates):
        target.data[index].co = coordinate
    return target


def create_static_anchors(anchor_names):
    """Replace a runtime-scaled bone with a dummy node and morph target.

    The morph is baked from the imported skin at local Y scale 2. Runtime uses
    weight `(scaleY - 1)`, preserving partial vertex weights and cross-boundary
    polygons without exporting Armature/Skin data to Cocos' crashing converter.
    """
    if not anchor_names:
        return {}, []
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.data]
    anchor_objects = {}
    receipt = []
    for anchor_name in anchor_names:
        matches = [(armature, armature.data.bones.get(anchor_name)) for armature in armatures]
        matches = [(armature, bone) for armature, bone in matches if bone is not None]
        if len(matches) != 1:
            raise RuntimeError("Static deformation anchor '%s' resolved to %d bones; expected exactly one." % (anchor_name, len(matches)))
        armature, bone = matches[0]
        affected = []
        for mesh in meshes:
            coverage = vertex_group_coverage(mesh, anchor_name)
            if coverage is None or coverage["influenced"] == 0:
                continue
            affected.append((mesh, coverage))
        if not affected:
            raise RuntimeError("Static deformation anchor '%s' has no weighted mesh." % anchor_name)

        anchor = bpy.data.objects.new(anchor_name, None)
        bpy.context.scene.collection.objects.link(anchor)
        anchor.parent = armature.parent
        anchor.matrix_world = armature.matrix_world.__matmul__(bone.matrix_local)
        anchor_objects[anchor_name] = anchor
        for mesh, coverage in affected:
            create_anchor_morph(mesh, armature, anchor_name)
            receipt.append({
                "name": anchor_name,
                "mesh": mesh.name,
                "representation": "morph",
                "targetScaleY": 2.0,
                "vertices": coverage["vertices"],
                "influenced": coverage["influenced"],
                "minWeight": coverage["minWeight"],
                "maxWeight": coverage["maxWeight"],
            })
    return anchor_objects, receipt


def main():
    source, destination, mode, anchor_names = tool_args()
    if not os.path.isfile(source):
        raise FileNotFoundError(source)
    os.makedirs(os.path.dirname(destination), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(
        filepath=source,
        use_custom_normals=True,
        ignore_leaf_bones=False,
        automatic_bone_orientation=False,
    )
    imported = scene_stats()
    if imported["meshes"] < 1 or imported["vertices"] < 1:
        raise RuntimeError("FBX normalization refused an asset without a readable mesh.")

    object_types = {"EMPTY", "ARMATURE", "MESH"}
    bake_animation = imported["actions"] > 0
    preserved_anchors = []
    if mode == "static":
        anchor_objects, preserved_anchors = create_static_anchors(anchor_names)
        object_types = {"EMPTY", "MESH"} if anchor_objects else {"MESH"}
        bake_animation = False
        for obj in [item for item in bpy.context.scene.objects if item.type == "MESH"]:
            matrix_world = obj.matrix_world.copy()
            for modifier in list(obj.modifiers):
                if modifier.type == "ARMATURE":
                    obj.modifiers.remove(modifier)
            if obj.parent is None or obj.parent.name not in anchor_objects:
                obj.parent = None
            obj.matrix_world = matrix_world

    bpy.ops.export_scene.fbx(
        filepath=destination,
        use_selection=False,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        bake_space_transform=False,
        object_types=object_types,
        use_mesh_modifiers=True,
        mesh_smooth_type="OFF",
        add_leaf_bones=False,
        use_armature_deform_only=True,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        axis_forward="-Z",
        axis_up="Y",
        bake_anim=bake_animation,
        path_mode="AUTO",
        embed_textures=False,
        use_metadata=True,
        use_custom_props=True,
    )
    if not os.path.isfile(destination) or os.path.getsize(destination) < 64:
        raise RuntimeError("Blender did not produce a valid FBX output file.")

    print("FBX_NORMALIZE_RESULT=" + json.dumps({
        "ok": True,
        "source": source,
        "destination": destination,
        "bytes": os.path.getsize(destination),
        "scene": imported,
        "format": "fbx",
        "mode": mode,
        "preservedAnchors": preserved_anchors,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
