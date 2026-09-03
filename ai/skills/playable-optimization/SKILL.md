---
name: playable-optimization
description: "Use when optimizing Cocos Creator 3.8.8+ Playable Ads for resources dynamic-root boundaries, static asset catalogs, file size (<2MB / <5MB limit), draw calls, texture/font/audio budgets, and single-file HTML packaging."
argument-hint: "Playable project or asset to optimize"
---

# Playable Ads Optimization Skill

This skill provides guidelines and checklists to ensure Playable Ads meet strict ad network store size limits (Google Ads < 2MB or 5MB, AppLovin < 5MB, Unity Ads < 5MB, IronSource < 5MB) and run at 60 FPS on low-end mobile devices.

## 1. Automated Cleanup Tools

Before building, always run the automated asset optimization tools:
1. **Enforce portable texture compression metadata** (Cocos Creator must be open):
   ```bash
   npm run ai:texture:compress
   npm run ai:texture:compress -- --verify
   ```
   The shared Cocos extension also listens to `asset-db:asset-add` and
   `asset-db:asset-change`. Every `.png`, `.jpg`, and `.jpeg` is assigned the
   existing `PlayableTransparent` / `Playable Transparent` preset. If neither
   exists, the extension creates a WebP quality 50 preset. If an existing alias
   is not exactly WebP 50, it is normalized instead of being trusted by name.
   The policy persists
   `useCompressTexture=true` plus its `presetId` through the Cocos Profile and
   Asset DB APIs. Never patch image `.meta` files directly.
2. **Enforce the portable FBX importer policy** (Cocos Creator must be open):
   ```bash
   npm run ai:model:optimize
   npm run ai:model:optimize -- --verify
   ```
   This uses Asset DB metadata only. It enables Mesh Optimize with Vertex
   Cache/Fetch/Overdraw, Mesh Simplify at ratio 0.8, and Mesh Compress with
   Compress enabled while Encode/Quantize remain disabled. Mesh Cluster stays
   disabled. The Cocos MCP listener reapplies the same contract to new imports.
   Keep the source/output format as FBX. If Cocos explicitly rejects the Unity
   FBX, first normalize FBX-to-FBX while preserving armature/animation:
   ```bash
   npm run ai:fbx:normalize -- --src <Unity.fbx> --out <Cocos.fbx> --mode preserve
   ```
   Reimport via Asset DB and require `imported:true`. Use `--mode static` only
   when a Unity/runtime oracle proves the skeleton is never animated; then run
   model policy, asset, visual, and runtime verification again. Never convert
   the asset to glTF/GLB to make the FBX importer error disappear.
3. **Normalize every sound to the portable audio profile**:
   ```bash
   npm run sound:optimize
   npm run sound:optimize -- --write
   npm run sound:optimize -- --verify
   ```
   Defaults are MP3 quality 30 (32kbps/22.05kHz) with source mono/stereo
   preserved. Extension changes go through Asset DB move/reimport and must keep
   the UUID. Never patch audio `.meta` files directly.
4. **Strip FBX Textures**:
   ```bash
   node playable-shared-kit/tools/strip-fbx-textures.cjs <file.fbx>
   ```
5. **Enforce the portable 80/100 KiB TTF budget**:
   ```bash
   npm run stats
   npm run font:subset -- --config tools/font-subsets.json --unity-project <UnityProjectRoot>
   npm run font:subset -- --config tools/font-subsets.json --unity-project <UnityProjectRoot> --write
   npm run font:subset -- --config tools/font-subsets.json --verify
   ```
   Active playable TTF files target 80 KiB and must not exceed the hard 100 KiB
   gate. Before writing a subset, trace the exact font owner through the Unity
   prefab/TMP font asset/source TTF and collect every reachable label string,
   including ScriptableObject, JSON/config, and dynamic text. For an
   English-only playable, prefer subsetting the exact source font to printable
   Basic Latin U+0020-U+007E plus any additional reachable characters. Keep the
   manifest project-relative and source-hash-bound; never infer the inventory
   from one screenshot or one sample string.

   If the game carries two fonts, remove one only when it is dormant in the
   playable closure. Consolidating a live label onto the smaller family requires
   explicit user authorization plus glyph-metric and tight text-ROI acceptance;
   file size alone is not evidence of parity. `--write` preserves the Cocos
   `.meta`/UUID. After it runs, wait for AssetDB reimport, then require
   `font:subset --verify`, `ai:verify:assets`, the relevant visual regression,
   and a clean `npm run stats` font budget report.
6. **Enforce `assets/resources` as a dynamic-load boundary**:
   ```bash
   npm run ai:resources:boundary
   npm run ai:resources:boundary -- --write-catalog
   npm run ai:resources:boundary -- --verify
   ```
   Before classifying or moving anything, trace every reachable
   `resources.load` / `loadDir` call and the ScriptableObject/JSON/config fields
   that supply its path. `assets/resources` is an API boundary for true dynamic
   roots, not a generic asset folder. Keep only roots that runtime genuinely
   selects by path, commonly config JSON, SFX/BGM, dynamically selected prefabs,
   and the small subset of sprites that cannot be serialized from a known
   owner. Asset type alone is never evidence: a prefab may be dormant conversion
   evidence, while one sprite may genuinely be runtime-selected.

   Put fixed fonts, SpriteFrames, AnimationClips, materials/effects, FBX/models,
   Spine dependencies, and similar assets outside `resources`. Wire them through
   a scene/prefab `StaticAssetCatalog` (or another explicit serialized owner), so
   Cocos includes them as transitive dependencies. Keep logical config keys
   stable while AssetDB moves preserve UUIDs and sprite-frame sub-UUIDs. The
   Git-tracked `tools/resource-boundary.json` must declare every dynamic root,
   static move, catalog rule, and reason.

   `--write-catalog` only generates the deterministic catalog prefab; it never
   moves assets or edits `.meta`. Reimport that prefab through Cocos AssetDB, move
   every declared folder through AssetDB/MCP, then run `--verify` and
   `ai:verify:assets`. Verification must fail on pending/conflicting moves,
   unclassified resource files, missing/dormant catalog entries, importer drift,
   UUID/sub-asset drift, or a stale manifest digest. Open the preview and exercise
   deferred animation/VFX/end-screen paths after the move; file-level PASS alone
   does not prove the catalog dependency graph is runnable.
7. **Clean Unused Assets**:
   ```bash
   node playable-shared-kit/tools/unused-asset-cleanup.cjs scan --clean
   ```
8. **Build & Package Super-HTML**:
   ```bash
   npm run build
   ```

---

## 2. Playable Ad Size Budget Breakdown (Target: < 2.0 MB / < 5.0 MB)

| Asset Type | Target Budget | Optimization Strategy |
| :--- | :--- | :--- |
| **Engine Core / WASM** | ~600 KB - 900 KB | Inlined by Super-HTML; enable `engine-mangle-config.json` |
| **Textures / UI** | ~500 KB - 1 MB | Max 512x512, combine into atlases, enforce WebP quality 50 |
| **3D Models / Meshes** | ~200 KB - 500 KB | Keep/export FBX directly; importer Optimize + Simplify 0.8 + Compress; strip embedded textures |
| **Audio (BGM / SFX)** | ~100 KB - 250 KB | MP3 quality 30; preserve original mono/stereo; short looped BGM (<15s) |
| **Shaders / Code** | ~100 KB | Minified and inlined |

---

## 3. Mobile Performance & Draw Calls

1. **Draw Call Budget**: Keep total Draw Calls under **25** (ideally < 15) for 60 FPS on mobile.
2. **Auto Atlas / Dynamic Batching**:
   - Put all UI icons and textures in an AutoAtlas.
   - Use identical materials for identical 3D meshes to enable static / dynamic instancing.
3. **Audio Autoplay Policy**:
   - Modern mobile browsers (iOS Safari, Android Chrome) block audio before first user touch.
   - Always initialize audio on `NodeEventType.TOUCH_START` or through `SoundManager.instance.init()`.
4. **Window Focus / Blur**:
   - Mute BGM and pause timer when `document.hidden` or window loses focus.
   - Handled automatically by `playable-core/SoundManager` and `playable-sdk/SuperHtmlPlayable`.
