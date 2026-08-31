# FBX normalizer

`fbx-normalizer.cjs` repairs Unity FBX files that Cocos Creator's native FBX
converter rejects while preserving the interchange format as FBX. It never
creates `.gltf` or `.glb` output.

```bash
npm run ai:fbx:normalize -- --src <Unity.fbx> --out <Cocos.fbx> --mode preserve
```

Use this sequence:

1. Copy/import the original Unity FBX directly.
2. If Cocos reports an explicit importer failure, normalize with
   `--mode preserve`, reimport via Cocos Asset DB, and require `imported:true`.
3. If preserve mode still fails, inspect the Unity model and runtime code.
   `--mode static` is allowed only when the model has no skeleton animation at
   runtime. Static mode removes armature data and bakes the rest-pose mesh.
4. Run `npm run ai:model:optimize -- --verify`,
   `npm run ai:verify:assets`, and the model's visual/runtime regression gate.

The tool prints mesh, vertex, polygon, armature, and action counts so the caller
can record why static normalization was or was not safe. Blender is resolved
from `--blender`, `BLENDER_PATH`, or common Blender 4.2+/5.x install locations.

If gameplay still addresses a fully weighted bone as a transform anchor,
preserve it explicitly while removing the armature/skin container:

```bash
npm run ai:fbx:normalize -- --src Unity.fbx --out Cocos.fbx --mode static --preserve-anchor Tape_Thickness_jnt
```

The tool bakes the bone's local-Y scale at `2.0` into an FBX morph target and
also emits a transform-only node with the same name. Runtime must bind morph
weight as `anchor.scaleY - 1`; this preserves partial skin weights and polygons
that cross weighted/unweighted regions without exporting the crashing skin.
Existing shape keys, non-armature modifiers, or ambiguous bones fail instead
of silently changing the runtime animation.
