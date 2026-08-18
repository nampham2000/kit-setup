# Claude AI Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer specialized in porting Unity casual/hypercasual games into lightweight Cocos Creator 3.8.8+ TypeScript playable ads.

## 1. Fast Project Onboarding (Low-Token Context)
- Do NOT scan file trees or read raw scene JSON files.
- Read `PROJECT_MAP.json` or run `npm run ai:map` to get instant project topology (<500 tokens).
- Use `npm run ai:scene -- <sceneName>` to inspect scene node hierarchy in compact ASCII format (~150 tokens).

## 2. Standard 4-Step Execution Flow

```mermaid
flowchart LR
    A["1. Read Map & Memory"] --> B["2. Plan & Automated Port"]
    B --> C["3. Scriptable JSON & TS"]
    C --> D["4. Mandatory Verification & Build"]
```

1. **Context & Memory Check**:
   - Check `PROJECT_MAP.json` for scenes, prefabs, audio, and current `playable-config.json` schema.
   - Run `npm run memory:query -- <keyword>` to check for known trap patterns.
2. **Automated Porting First**:
   - All-in-One Smart Port: `npm run port:smart -- --src <unity_folder> --out assets/`
   - Prefabs & Meshes: `node playable-shared-kit/tools/unity-cocos-port.cjs port --src <src> --out assets/prefabs/`
   - C# Scripts Scaffolding: `npm run port:script -- --src <csharp_path> --out assets/script/`
   - Unity Shaders: `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs <shader> assets/effects/<name>.effect`
   - Strip FBX Textures: `node playable-shared-kit/tools/strip-fbx-textures.cjs assets/models/`
3. **Scriptable JSON & TypeScript Implementation**:
   - Place all tunable gameplay parameters into `assets/resources/playable-config.json`.
   - Access via `PlayableConfigManager.instance.get('custom.myParam', defaultValue)`.
   - Ensure **Zero GC** inside `update(dt)`: Pre-allocate static `Vec3`, `Quat`, `Color`.
4. **Mandatory Post-Port / Post-Code Verification Gate**:
   - **Immediately after modifying code or porting**:
     - Run `npm run ai:verify`: Validates TypeScript compilation (0 errors), config schema, asset bindings, meta integrity, and bundle size.
     - Run `npm run ai:lint`: Validates Zero-GC compliance.
   - Fix any errors reported by the verifier before concluding your response.
   - Build single-file playable: `npm run build`.
   - Live Mobile QR Preview: `npm run deploy`.

## 3. Core Rules & Architecture
- **Framework Structure**:
  - `playable-shared-kit/`: Core libraries, porting tools, build system, and work-memory.
  - `assets/`: Game assets and TypeScript source code.
  - `extensions/`: Editor extensions (`cocos-mcp`, `super-html`, `json-scriptable-inspector`).
- **Available MCP Tools**:
  - `cocos-mcp`: Control Cocos Creator editor directly (scene, node, components, assets, prefabs, build).
  - `blender-mcp`: Inspect 3D models, materials, and run Python scripts in Blender 5.2.
  - `work-memory`: Query and persist project knowledge via SQLite (`queryWorkMemory`, `rememberWorkMemory`).

## 4. TypeScript & Performance Guidelines
- Cocos Creator 3.8.8+ uses decorators: `@ccclass('ClassName')`, `@property(CCFloat)`.
- Use `ObjectPool` from `playable-core` for hypercasual spawner loops.
- Use `tween(this.node).to(...)` for UI & node animations.
- Wire `GameManager.instance` for lifecycle (`onGameReady`, `onGameStart`, `onGameWin`, `onGameLose`) and `SuperHtmlPlayable.download()` for CTA clicks.

## 5. Work Memory Integration
- Append `<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"...","content":"...","tags":["..."]} -->` to persist solutions.
