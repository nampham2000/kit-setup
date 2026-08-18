# Codex / ChatGPT Desktop Agent Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`.

## 1. Fast Project Onboarding (Low-Token Context)
- Do NOT scan file trees or read raw scene JSON files.
- Read `PROJECT_MAP.json` or run `npm run ai:map` to get instant project metadata, scenes, prefabs, scripts, audio, 3D models, and config schemas (<500 tokens).
- Use `npm run ai:scene -- <sceneName>` to inspect scene node hierarchy in compact ASCII format (~150 tokens).

## 2. Action Matrix (Input -> Command -> Output)

| Workflow Stage | Direct Command | Output / Expected Artifact |
| :--- | :--- | :--- |
| **Project Overview** | `npm run ai:map` | `ai/PROJECT_MAP.json` |
| **Inspect Scene** | `npm run ai:scene -- <scene>` | ASCII Node Tree (<200 tokens) |
| **Smart All-In-One Port** | `npm run port:smart -- --src <unity_dir> --out assets/` | Prefabs + Materials + TS Scaffolds + Auto Verify |
| **Port Unity Prefab** | `node playable-shared-kit/tools/unity-cocos-port.cjs port --src <src> --out assets/prefabs/` | Cocos `.prefab` + `.mtl` |
| **Scaffold C# Script** | `npm run port:script -- --src <csharp_path> --out assets/script/` | Cocos 3.8 TypeScript Component |
| **Port Unity Shader** | `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs <shader> assets/effects/<name>.effect` | Cocos `.effect` |
| **Strip FBX Textures** | `node playable-shared-kit/tools/strip-fbx-textures.cjs assets/models/` | Clean FBX without embedded textures |
| **Zero-GC & Lint Check** | `npm run ai:lint` (or `npm run lint:gc`) | Compact JSON / Lint violation report |
| **Headless Verification**| `npm run ai:verify` (or `npm run verify`) | 6-Stage Automated QA Pass/Fail |
| **Optimize Audio** | `npm run sound:optimize` | 64kbps MP3 audio clips |
| **Build Playable HTML**| `npm run build` | Single-file HTML in `build/<GameName>/...` |
| **Deploy Live Preview**| `npm run deploy` | Live URL + Terminal QR Code |
| **Work Memory Query** | `npm run memory:query -- <keyword>` | Trap prevention & best practices |

## 3. Mandatory Autonomous Verification Gate (CRITICAL)
**Immediately after porting any asset/prefab or writing/editing TypeScript/JSON code**, you MUST ALWAYS run:
1. `npm run ai:verify`: Validates TypeScript compilation (0 errors), config schema, asset bindings, meta integrity, and build size.
2. `npm run ai:lint`: Validates ZERO runtime GC allocations in `update()` loops and no hardcoded CTA URLs.
*Never report a task as complete if verification fails. Automatically fix any reported errors before concluding.*

## 4. Zero-Scene-Tweak & Scriptable JSON Architecture
- **Never hardcode or require manual parameter tweaking on scene nodes**.
- **Always prioritize putting all parameters into a single JSON file** (`assets/resources/playable-config.json`), acting exactly like a Unity ScriptableObject.
- **Access config via `PlayableConfigManager`**:
  - CTA URLs & delays: `PlayableConfigManager.instance.cta`
  - Audio volumes & autoPlay: `PlayableConfigManager.instance.audio`
  - Gameplay targets & timers: `PlayableConfigManager.instance.gameplay`
  - Camera presets & FOV: `PlayableConfigManager.instance.camera`
  - Custom game parameters: `PlayableConfigManager.instance.get('custom.myKey', defaultValue)`

## 5. Cocos Creator 3.8 TypeScript & Zero-GC Rules
- Always import math types from `'cc'`: `Vec3`, `Quat`, `Color`, `tween`, `instantiate`.
- **Never allocate objects inside `update(dt)` loops (Zero GC)**. Reuse static/module-level `Vec3`, `Quat`, `Color`.
- Use `ObjectPool` from `playable-core` for spawner loops.
- Wire `GameManager.instance` for lifecycle (`onGameReady`, `onGameStart`, `onGameWin`, `onGameLose`) and `SuperHtmlPlayable.download()` for CTA click.

## 6. Work Memory Logging
- Append `<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"...","content":"...","tags":["..."]} -->` to persist valuable solutions.
