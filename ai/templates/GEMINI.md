# Gemini / Antigravity AI Rules - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`.

## 1. Fast Project Onboarding (Low-Token Context)
- Do NOT scan file trees or read raw scene JSON files.
- Read `PROJECT_MAP.json` or run `npm run ai:map` to get instant project topology (<500 tokens).
- Use `npm run ai:scene -- <sceneName>` to inspect scene node hierarchy in compact ASCII format (~150 tokens).

## 2. MCP Ecosystem & Subagent Orchestration
- **MCP Servers**:
  - `cocos-mcp`: Stdio proxy to Cocos Creator 3.8.8 editor on port 3000 (scene, node, components, assets, prefabs, build).
  - `blender-mcp`: Stdio bridge to Blender 5.2 on TCP port 9876.
  - `work-memory`: Persistent SQLite database for porting heuristics and bug traps.
- **Subagent Workflows**:
  - `research`: Use for reading external documentation, large shader files, or inspecting asset databases without cluttering execution context.
  - `self`: Use for running parallel builds, asset conversions, or independent verification tasks.

## 3. Core Development & Porting Commands
- Project Map: `npm run ai:map`
- Inspect Scene: `npm run ai:scene -- <sceneName>`
- All-In-One Smart Port: `npm run port:smart -- --src <unity_folder> --out assets/`
- Scaffold C# Script: `npm run port:script -- --src <csharp_path> --out assets/script/`
- Port Unity Prefabs: `node playable-shared-kit/tools/unity-cocos-port.cjs port --src <src> --out assets/prefabs/`
- Convert Shaders: `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs <shader> assets/effects/<name>.effect`
- Strip FBX Textures: `node playable-shared-kit/tools/strip-fbx-textures.cjs assets/models/`
- Zero-GC Code Review: `npm run ai:lint` (or `npm run lint:gc`)
- Headless Verification Suite: `npm run ai:verify` (or `npm run verify`)
- Optimize Audio: `npm run sound:optimize`
- Build Playable Ads: `npm run build`
- Deploy Live Preview: `npm run deploy` (publishes to GitHub Pages with terminal QR code)

## 4. Mandatory Post-Porting & Post-Code Verification Gate (CRITICAL)
- **Immediately after modifying code, creating assets, or porting data**:
  - Execute `npm run ai:verify`: Validates TypeScript compilation (0 errors), config schema, asset bindings, meta integrity, and bundle size.
  - Execute `npm run ai:lint`: Validates Zero-GC compliance.
- Do NOT finish execution turn or report completion if `npm run ai:verify` fails. Fix any errors immediately.

## 5. Zero-Scene-Tweak & Scriptable JSON Architecture (CRITICAL)
- **Never hardcode or require manual parameter tweaking on scene nodes**.
- **Always prioritize putting all parameters into a single JSON file** (`assets/resources/playable-config.json`), acting exactly like a Unity ScriptableObject.
- **Access config via `PlayableConfigManager`**:
  - CTA URLs & delays: `PlayableConfigManager.instance.cta`
  - Audio volumes & autoPlay: `PlayableConfigManager.instance.audio`
  - Gameplay targets & timers: `PlayableConfigManager.instance.gameplay`
  - Camera presets & FOV: `PlayableConfigManager.instance.camera`
  - Custom game parameters: `PlayableConfigManager.instance.get('custom.myKey', defaultValue)`

## 6. TypeScript & Performance Rules
- Strict TypeScript for Cocos Creator 3.8.8+ (`@ccclass`, `@property`).
- **Zero allocation in `update(dt)` loops**: Pre-allocate static `Vec3`, `Quat`, `Color`.
- Use `ObjectPool` for pooling hypercasual entities.
- Integrate `GameManager.instance` for game lifecycle and `SuperHtmlPlayable.download()` for ad network store redirection.

## 7. Work Memory Logging
- Append `<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"...","content":"...","tags":["..."]} -->` to persist valuable solutions.
