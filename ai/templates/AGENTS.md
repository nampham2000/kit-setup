# Codex / ChatGPT Desktop Agent Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`.

## Key Capabilities & Tools

1. **MCP Tools Available**:
   - `cocos-mcp`: Directly inspect scenes, create nodes, attach components, and trigger builds in Cocos Creator 3.8.8.
   - `blender-mcp`: Inspect 3D models, vertices, materials, and run Python scripts in Blender 5.2.
   - `work-memory`: Query and persist project knowledge via SQLite (`queryWorkMemory`, `rememberWorkMemory`).

2. **Core Development & Porting Commands**:
   - Port Unity Prefabs: `node playable-shared-kit/tools/unity-cocos-port.cjs convert-prefab --source <unity_path> --dest assets/prefabs/`
   - Convert Shaders: `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs <shader_file> assets/effects/<effect_file>`
   - Clean Unused Assets: `node playable-shared-kit/tools/unused-asset-cleanup.cjs scan --clean`
   - Build Playable HTML: `npm run build`
   - Deploy Live Preview: `npm run deploy` (publishes to GitHub Pages with terminal QR code)

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

4. **Cocos Creator 3.8 TypeScript Guidelines**:
   - Always import math types from `'cc'`: `Vec3`, `Quat`, `Color`, `tween`, `instantiate`.
   - Never allocate objects inside `update(dt)` loops (Zero GC in loop).
   - Wire `GameManager.instance` / `PlayableEntry.instance` for lifecycle and `SuperHtmlPlayable.download()` for CTA click.

5. **Work Memory Logging**:
   - Append `<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"...","content":"...","tags":["..."]} -->` to persist valuable solutions.
