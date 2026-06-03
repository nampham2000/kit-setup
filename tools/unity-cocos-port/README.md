# Unity -> Cocos Prefab Porter

CLI:

```powershell
node playable-shared-kit/tools/unity-cocos-port.cjs port `
  --src "D:\_Projects\Unity\MarbleSort\Assets\_Game\Prefabs\Gameplay\Obstacle\BoxObject.prefab" `
  --out assets\prefabs\BoxObject.prefab `
  --overwrite `
  --recursive `
  --report .unity\port-report.csv
```

Batch port a folder recursively:

```powershell
node playable-shared-kit/tools/unity-cocos-port.cjs port `
  --src "D:\_Projects\CC3\unity2cc_particles3d\unity\Assets\Hovl Studio\Toon Projectiles 2\Prefabs" `
  --out "assets\Hovl Studio\Toon Projectiles 2\Prefabs" `
  --overwrite `
  --recursive `
  --report .unity\port-report.csv
```

Module layout:

- `playable-shared-kit/tools/unity-cocos-port.cjs` keeps the CLI entrypoint, batch orchestration, Unity/Cocos DB parsing, and prefab graph assembly glue.
- `playable-shared-kit/tools/unity-cocos-port/constants.js` keeps shared constants and built-in UUID tables.
- `playable-shared-kit/tools/unity-cocos-port/core-utils.js` keeps shared path/uuid/fs/value helpers.
- `playable-shared-kit/tools/unity-cocos-port/reporter.js` owns CSV report accumulation and writeback.
- `playable-shared-kit/tools/unity-cocos-port/asset-import-porter.js` handles Unity asset copy/import fallback, FBX fallback conversion, and generic asset meta creation.
- `playable-shared-kit/tools/unity-cocos-port/material-porter.js` handles Unity material/shader property conversion into Cocos `.mtl` assets.
- `playable-shared-kit/tools/unity-cocos-port/sprite-porter.js` handles sprite-frame resolution and `cc.SpriteRenderer` emission.
- `playable-shared-kit/tools/unity-cocos-port/collider-porter.js` handles Rigidbody2D, CircleCollider2D, BoxCollider2D, and PolygonCollider2D conversion.
- `playable-shared-kit/tools/unity-cocos-port/renderer-porter.js` handles MeshRenderer emission and nested model renderer fallback wiring.
- `playable-shared-kit/tools/unity-cocos-port/particle-porter.js` handles particle template approximation.
- `playable-shared-kit/tools/unity-cocos-port/light-porter.js` handles Unity Light to Cocos light conversion.
- `playable-shared-kit/tools/unity-cocos-port/animation-porter.js` handles AnimationClip and AnimatorController conversion plus `cc.animation.AnimationController` wiring.
- `playable-shared-kit/tools/unity-cocos-port/script-porter.js` handles MonoBehaviour-to-Cocos-script wiring and serialized field translation.

Safety defaults:

- Existing output prefabs are not replaced unless `--overwrite` is provided.
- `--dry-run` builds and validates the prefab graph without writing the prefab or meta files.
- Generated prefabs are validated for broken `__id__` references before writing.
- Missing Cocos folder and prefab `.meta` files are created automatically when writing.
- CSV reports keep rows grouped by `prefab`; running the same prefab again replaces that prefab's rows while preserving rows for other prefabs.
- If the CSV report is locked by another process, a timestamped fallback report is written instead of failing the port.
- When `--src` is a folder, the tool scans `*.prefab` recursively and writes each prefab under the `--out` folder using the same relative path.
- In folder mode, a failed prefab is reported as `PREFAB_PORT_FAILED`; the batch continues and exits non-zero if any prefab failed.

Supported mapping:

- Unity `GameObject` + `Transform` / `RectTransform` to Cocos nodes and `cc.UITransform`.
- Unity layers to Cocos project layers using the Tape Tap defaults from the Unity layer screenshot.
- PrefabInstance `m_Name`, `m_Layer`, and `m_IsActive` overrides are baked into generated nodes.
- Handedness conversion for position, rotation, and Euler hint.
- `MeshRenderer`, `SpriteRenderer`, `Camera`, `Light`, `Canvas`, common Unity UI `Image` / `Text` / `Button`, and `Animator`.
- Unity `AnimationClip` and `AnimatorController` assets are converted to Cocos `.anim` and `.animgraph` assets, then wired into `cc.animation.AnimationController`.
- Unity built-in primitive meshes, including cube/box and plane, are mapped to matching Cocos built-in mesh assets.
- Generated Unity materials use Cocos `builtin-standard.effect`; Unity `_BaseMap` / `_MainTex` textures are assigned to `mainTexture` with `USE_ALBEDO_MAP` enabled.
- Missing renderer FBX/image assets are prepared under `assets/unity_imported`; generated prefabs wire only imported model mesh UUIDs, while pending model imports keep a `cc.MeshRenderer` with an empty mesh slot until Cocos materializes real mesh sub-assets.
- When Cocos reimports a model and changes sub-asset ids, sibling generated prefabs are repaired from the current `.meta` so old `_mesh` / `_materials` references do not become `Missing Asset`.
- Sprite lookup supports common Unity naming suffixes such as `-gameplay`, `-icon`, and `-ui`.
- `cc.SpriteRenderer` falls back to Cocos built-in `default-sprite-renderer-material.mtl` (`ade8a15a-dcca-4b3c-84c6-f6476ac875bb`) when no matching Unity material exists.
- Unity `ParticleSystem` components are approximated with a Cocos particle template when a Cocos particle prefab exists in the project.
- Custom `MonoBehaviour` components when a Cocos TypeScript class with the same class name exists.
- Recursive inspection of nested prefab/model/controller dependencies.
- Nested Unity prefab dependencies are also emitted as sibling Cocos `.prefab` assets when `--recursive` is enabled.

Known limits are emitted to CSV with `high`, `medium`, or `low` severity. Typical unresolved items are Unity particle modules, custom scripts that have no Cocos class yet, and FBX/model assets that have no imported Cocos mesh sub-assets. For FBX problems, run with `--convert-fbx-fallback` to check for local `FBX2glTF` or `assimp` availability and report the fallback path.
