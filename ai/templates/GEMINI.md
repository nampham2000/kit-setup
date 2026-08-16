# Gemini / Antigravity AI Rules - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`.

## System Overview & Guidelines

1. **Architecture**:
   - `playable-shared-kit/`: Core libraries (`playable-core`, `playable-sdk`), porting tools, and work-memory database.
   - `assets/`: Game assets and TypeScript source code.
   - `extensions/`: Editor extensions (`cocos-mcp`, `super-html`, `json-scriptable-inspector`).

2. **MCP Ecosystem**:
   - `cocos-mcp`: Stdio proxy to Cocos Creator 3.8.8 editor on port 3000 (100 tools available).
   - `blender-mcp`: Stdio bridge to Blender 5.2 on TCP port 9876.
   - `work-memory`: Persistent SQLite database for porting heuristics and bug traps.

3. **Core Development Workflow**:
   - Verify environment: `npm run doctor`
   - Port Unity assets: `node playable-shared-kit/tools/unity-cocos-port.cjs`
   - Convert Shaders: `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs`
   - Strip FBX textures: `node playable-shared-kit/tools/strip-fbx-textures.cjs`
   - Build Playable Ads: `npm run build`
   - Deploy Live Preview: `npm run deploy` (publishes to GitHub Pages with terminal QR code)

4. **Zero-Scene-Tweak & Scriptable JSON Architecture (CRITICAL)**:
   - **Never hardcode or require manual parameter tweaking on scene nodes**.
   - **Always prioritize putting all parameters into a single JSON file** (`assets/resources/playable-config.json`), acting exactly like a Unity ScriptableObject.
   - **Access config via `PlayableConfigManager`**:
     - CTA URLs & delays: `PlayableConfigManager.instance.cta`
     - Audio volumes & autoPlay: `PlayableConfigManager.instance.audio`
     - Gameplay targets & timers: `PlayableConfigManager.instance.gameplay`
     - Camera presets & FOV: `PlayableConfigManager.instance.camera`
     - Custom game parameters: `PlayableConfigManager.instance.get('custom.myKey', defaultValue)`
   - Cocos Creator Inspector contains a built-in visual editor (`json-scriptable-inspector`) allowing designers to edit JSON fields with a direct Save button.

5. **Code Quality & Performance**:
   - Strict TypeScript for Cocos Creator 3.8.8+ (`@ccclass`, `@property`).
   - Zero allocation in `update(dt)` loops.
   - Use `ObjectPool` for pooling hypercasual entities.
   - Integrate `GameTrackingService` and `SuperHtmlPlayable.download()` for ad network store redirection.
