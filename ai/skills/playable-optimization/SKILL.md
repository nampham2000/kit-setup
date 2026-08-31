---
name: playable-optimization
description: "Use when optimizing Cocos Creator 3.8.8+ Playable Ads for file size (<2MB / <5MB limit), draw calls, texture budgets, audio compression, and single-file HTML packaging."
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
5. **Inspect size and multilingual font coverage**:
   ```bash
   npm run stats
   ```
   Review `fontDiagnostics`: it contains only font assets currently referenced
   by authoring data or mapped into the build. Subset multilingual fonts only
   after checking the actual character inventory and verifying every glyph.
6. **Clean Unused Assets**:
   ```bash
   node playable-shared-kit/tools/unused-asset-cleanup.cjs scan --clean
   ```
7. **Build & Package Super-HTML**:
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
