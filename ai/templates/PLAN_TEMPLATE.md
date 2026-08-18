# Playable Implementation & Porting Blueprint

## 1. Quick Context & Goal
- **Target Experience**: [Brief 1-line description of the playable ad gameplay]
- **Target Orientation**: [Portrait 720x1280 | Landscape 1280x720]
- **Ad Network Scope**: [Universal / AppLovin / UnityAds / Google / Facebook] (Max single-file HTML < 3MB)

## 2. Input Assets & Porting Pipeline
- [ ] **3D Models**: Port & strip textures (`node playable-shared-kit/tools/strip-fbx-textures.cjs <dir>`)
- [ ] **Materials & Textures**: PBR Standard / Unlit / Custom Effect conversion
- [ ] **Prefabs & Hierarchy**: Automated porting via `unity-cocos-port.cjs`
- [ ] **Audio Clips**: Convert/optimize to MP3 64kbps (`npm run sound:optimize`)

## 3. Scriptable JSON Configuration (`playable-config.json`)
*(Define all designer-tweakable parameters here - Zero hardcoding in scene/nodes)*

```json
{
  "gameplay": {
    "targetTaps": 3,
    "autoWinTimer": 0
  },
  "camera": {
    "defaultMode": 0,
    "fovPortrait": 55,
    "fovLandscape": 45
  },
  "custom": {
    "heroMoveSpeed": 5.0,
    "enemySpawnInterval": 2.0
  }
}
```

## 4. TypeScript Architecture & Component Matrix
| Component Name | Role / Responsibility | Key Lifecycle & Zero-GC Notes |
| :--- | :--- | :--- |
| `GameplayController` | Manages game rounds & win/lose states | Wires `GameManager.instance` |
| `HeroController` | Handles touch input & movement | Pre-allocates temp `Vec3` & `Quat` |
| `EnemySpawner` | Spawns enemies using `ObjectPool` | Zero `instantiate()` in `update()` |

## 5. Verification & Quality Gates
- [ ] **TypeScript Build**: `npx tsc --noEmit` passes with 0 errors.
- [ ] **Playable Build**: `npm run build` succeeds and produces `build/<GameName>/...`.
- [ ] **Size Budget**: Single-file HTML size < 3MB.
- [ ] **Lifecycle Integrity**:
  - `GameManager.instance.onGameReady()` called on start.
  - First touch triggers `GameManager.instance.onGameStart()`.
  - Win/Lose triggers CTA & `SuperHtmlPlayable.download()`.
- [ ] **Experience Capture**: Append `<!-- WORK_MEMORY: {...} -->` if a reusable pattern/bugfix was found.
