# Cocos FBX Texture Link Stripper

`strip-fbx-textures.cjs` removes FBX `Texture` and `Video` objects plus their
connections. It retains the FBX `Material` object so mesh material-slot indices,
meshes, skeletons, and animations stay stable. For Cocos assets, it also removes
generated `gltf-embeded-image` and `texture` sub-assets from the companion
`.fbx.meta` without changing the remaining UUIDs.

## Usage

Run from the Cocos project root. The default mode is read-only:

```bat
node playable-shared-kit\tools\strip-fbx-textures.cjs assets\models\table.fbx
```

Apply the changes after reviewing the JSON report:

```bat
node playable-shared-kit\tools\strip-fbx-textures.cjs --write assets\models\table.fbx assets\models\wood.fbx
```

Use `--no-meta` for a standalone FBX without Cocos metadata:

```bat
node playable-shared-kit\tools\strip-fbx-textures.cjs --write --no-meta path\to\model.fbx
```

After writing, let Cocos reimport the files and verify every consumer prefab
remaps each mesh material slot to a standalone `.mtl` asset.
