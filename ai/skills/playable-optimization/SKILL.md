---
name: playable-optimization
description: "Use when optimizing Cocos Creator 3.8.8+ Playable Ads for file size (<2MB / <5MB limit), draw calls, texture budgets, audio compression, and single-file HTML packaging."
argument-hint: "Playable project or asset to optimize"
---

# Playable Ads Optimization Skill

This skill provides guidelines and checklists to ensure Playable Ads meet strict ad network store size limits (Google Ads < 2MB or 5MB, AppLovin < 5MB, Unity Ads < 5MB, IronSource < 5MB) and run at 60 FPS on low-end mobile devices.

## 1. Automated Cleanup Tools

Before building, always run the automated asset optimization tools:
1. **Strip FBX Textures**:
   ```bash
   node playable-shared-kit/tools/strip-fbx-textures.cjs <file.fbx>
   ```
2. **Clean Unused Assets**:
   ```bash
   node playable-shared-kit/tools/unused-asset-cleanup.cjs scan --clean
   ```
3. **Build & Package Super-HTML**:
   ```bash
   npm run build
   ```

---

## 2. Playable Ad Size Budget Breakdown (Target: < 2.0 MB / < 5.0 MB)

| Asset Type | Target Budget | Optimization Strategy |
| :--- | :--- | :--- |
| **Engine Core / WASM** | ~600 KB - 900 KB | Inlined by Super-HTML; enable `engine-mangle-config.json` |
| **Textures / UI** | ~500 KB - 1 MB | Max 512x512, combine into Atlases/Spritesheets, WebP/PNG 8-bit |
| **3D Models / Meshes** | ~200 KB - 500 KB | Low-poly (< 5,000 tris per scene), strip embedded textures from FBX |
| **Audio (BGM / SFX)** | ~100 KB - 250 KB | Mono 22kHz - 44.1kHz, MP3 at 48kbps - 64kbps, short looped BGM (<15s) |
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
