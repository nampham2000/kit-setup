# Claude AI Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer specialized in porting Unity casual/hypercasual games into lightweight Cocos Creator 3.8.8+ TypeScript playable ads.

## Core Rules & Architecture

1. **Framework Structure**:
   - `playable-shared-kit/`: Submodule with libs, porting tools, build system, and work-memory.
   - `assets/`: Game assets and TypeScript source code.
   - `extensions/`: Cocos extensions (`cocos-mcp`, `super-html`, `json-scriptable-inspector`).

2. **Available MCP Tools**:
   - `cocos-mcp`: Control Cocos Creator editor directly (scene, node, components, assets, prefabs, build).
   - `blender-mcp`: Control Blender 5.2 for 3D model inspect, export, and python script execution.
   - `work-memory`: Query and store lessons learned, bug traps, and porting patterns (`queryWorkMemory`, `rememberWorkMemory`).

3. **Zero-Scene-Tweak & Scriptable JSON Architecture (CRITICAL)**:
   - **Never hardcode or require manual parameter tweaking on scene nodes**.
   - **Always prioritize putting all parameters into a single JSON file** (`assets/resources/playable-config.json`), acting exactly like a Unity ScriptableObject.
   - **Access config via `PlayableConfigManager`**:
     - CTA URLs & delays: `PlayableConfigManager.instance.cta`
     - Audio volumes & autoPlay: `PlayableConfigManager.instance.audio`
     - Gameplay targets & timers: `PlayableConfigManager.instance.gameplay`
     - Camera presets & FOV: `PlayableConfigManager.instance.camera`
     - Custom game parameters: `PlayableConfigManager.instance.get('custom.myKey', defaultValue)`
   - Cocos Creator Inspector contains a built-in visual editor (`json-scriptable-inspector`) allowing designers to edit JSON fields with a direct Save button.

4. **Porting Workflow**:
   - For Unity Assets & Prefabs: Use `node playable-shared-kit/tools/unity-cocos-port.cjs convert-prefab`.
   - For Unity Shaders: Use `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs`.
   - For FBX Models: Run `node playable-shared-kit/tools/strip-fbx-textures.cjs`.
   - For Playable Build: Run `npm run build` (produces single-file HTML in `build/`).
   - For Live Mobile Preview: Run `npm run deploy` (publishes to GitHub Pages with terminal QR code).

5. **TypeScript & Performance Rules**:
   - Cocos Creator 3.8.8+ uses decorators: `@ccclass('ClassName')`, `@property(CCFloat)`.
   - Zero Garbage Collection in `update(dt)`: Reuse static `Vec3`, `Quat`, and `Color` variables.
   - Use `ObjectPool` from `playable-core` for hypercasual spawner loops.
   - Use `tween(this.node).to(...)` for animations.

6. **Work Memory Integration**:
   - When you discover a reusable solution or fix a subtle Cocos bug, append:
     `<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"Title","content":"Lesson","tags":["cocos","porting"],"importance":0.85} -->`
