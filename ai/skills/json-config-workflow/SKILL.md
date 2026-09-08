---
name: json-config-workflow
description: "Use when designing, refactoring, or tuning playable ad parameters, balancing, CTA links, audio settings, or gameplay mechanics to follow the Zero-Scene-Tweak Scriptable JSON architecture."
argument-hint: "Configuration parameter or gameplay mechanic to externalize to JSON"
---

# Zero-Scene-Tweak Scriptable JSON Workflow for Cocos Creator 3.8

This skill defines the architectural pattern and development guidelines for creating data-driven, easily configurable Playable Ads without modifying scene nodes in Cocos Creator.

---

## 1. Core Principle: Zero Scene Tweak

> [!IMPORTANT]
> **NEVER hardcode gameplay variables or require developers to tweak values directly on Scene node inspectors.**
> All balancing parameters, CTA store links, delays, audio volumes, camera presets, and custom mechanics **MUST be reachable through the centralized `assets/resources/playable-config.json` manifest**. Large subtrees may live in fragment JSON files under `assets/resources`.

### Why?
1. **Prevents Scene Merge Conflicts**: Editing scene files (`.scene`) creates large, binary/serialized diffs that break multi-developer collaboration and AI modifications.
2. **Instant Variant Generation**: Ad networks require dozens of variations (different difficulty, colors, win timers, store links). Modifying 1 JSON file is 100x faster than editing scenes.
3. **Unity ScriptableObject Parity**: Developers familiar with Unity's ScriptableObject workflow can treat `playable-config.json` as the single source of truth.
4. **Visual Inspector Support**: Cocos Creator's `json-scriptable-inspector` extension provides an interactive visual form directly on `.json` assets with a single-click Save button (`Ctrl+S`).

---

## 2. Configuration Structure (`playable-config.json`)

All playable configs follow the standard structure below:

```json
{
  "$schema": "playable-config-v1",
  "title": "Playable Ad Config",
  "version": "1.0.0",
  "cta": {
    "googlePlayUrl": "https://play.google.com/store/apps/details?id=com.playable.ad",
    "appStoreUrl": "https://apps.apple.com/app/id123456789",
    "enableButtonPulse": true,
    "autoRedirectDelay": 0,
    "pulseScaleMultiplier": 1.08,
    "pulseDuration": 0.6
  },
  "audio": {
    "autoPlayBgm": true,
    "bgmVolume": 0.6,
    "sfxVolume": 1.0,
    "bgmSoundPath": "sound/bgm_main",
    "clickSoundPath": "sound/sfx_click",
    "successSoundPath": "sound/sfx_success",
    "winSoundPath": "sound/sfx_win"
  },
  "gameplay": {
    "targetTaps": 3,
    "autoWinTimer": 0,
    "difficulty": "normal"
  },
  "camera": {
    "defaultMode": 0,
    "transitionDuration": 0.5,
    "fovPortrait": 55,
    "fovLandscape": 45,
    "presets": [
      { "position": { "x": 0, "y": 5.5, "z": 7.5 }, "eulerRotation": { "x": -32, "y": 0, "z": 0 } }
    ]
  },
  "hero": {
    "enableIdleAnimation": true,
    "floatHeight": 0.35,
    "floatDuration": 1.4,
    "rotationDuration": 4.0,
    "punchScaleFactor": 1.3
  },
  "tracking": {
    "enableHeartbeat": true,
    "heartbeatInterval": 5,
    "gameId": "cc_playable_game"
  },
  "custom": {
    "playerSpeed": 12.0,
    "spawnRate": 1.5,
    "scoreMultiplier": 2
  }
}
```

---

## 3. Code Access Pattern via `PlayableConfigManager`

When `playable-config.json` becomes difficult to review, add a `$fragments`
map whose keys are mount paths in the merged config and whose values are
resource paths without `.json`:

```json
{
  "$schema": "playable-config-v1",
  "$fragments": {
    "cta": "playable-config/cta",
    "audio": "playable-config/audio",
    "custom.hiddenSuspect": "playable-config/hidden-suspect"
  },
  "gameplay": {
    "activeBundle": "hidden-suspect"
  }
}
```

Store the mounted value itself in each fragment. For example,
`assets/resources/playable-config/cta.json` starts with
`{ "googlePlayUrl": "..." }`, without another `cta` wrapper. Target paths
must not overlap, and resource paths must remain under `assets/resources`.
`PlayableConfigManager` loads fragments in parallel and mounts them before
notifying listeners. The visual Inspector presents the result as one form and
saves each subtree back to its owning fragment.

For a large existing config, select `playable-config.json`, click
**🧩 Split Sections**, review the merged form, then Save. This creates one
fragment per eligible top-level object through the extension and refreshes each
new AssetDB entry. Use Raw Code only when a large nested subtree needs its own
more specific target such as `custom.hiddenSuspect.levels`.

Always query parameters through `PlayableConfigManager.instance`:

```typescript
import { _decorator, Component } from 'cc';
import { PlayableConfigManager } from '../shared';

const { ccclass, property } = _decorator;

@ccclass('MyGameplayController')
export class MyGameplayController extends Component {
  private _playerSpeed: number = 10;

  onLoad() {
    this.applyConfig();

    // Support reactive live-reloading if config changes during runtime
    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
    });
  }

  private applyConfig() {
    // 1. Direct typed category access
    const gameplay = PlayableConfigManager.instance.gameplay;
    const cta = PlayableConfigManager.instance.cta;
    const audio = PlayableConfigManager.instance.audio;

    // 2. Deep dot-path access for custom game parameters
    this._playerSpeed = PlayableConfigManager.instance.get('custom.playerSpeed', 10.0);
  }
}
```

## 4. Playable Brief Bundles

When one Cocos project contains several playable briefs, keep the shared launch
scene and `playable-config.json` in `assets/resources`, and put each brief's
runtime assets in exactly one Cocos bundle:

```text
assets/gameplay-bundles/<brief-name>/
configs/<brief-name>.json
```

Declare every brief under `gameplay.briefs` and select Editor preview with the
single `gameplay.activeBundle` value. Runtime code must load that bundle through
`assetManager.loadBundle`; changing the selector then reloading Preview must be
enough to run another brief. Each build config must include `resources`, include
only its matching gameplay bundle, and stamp
`packages.gameplay-briefs.activeBundle` so command-line builds cannot silently
follow the current preview selector. Run `npm run briefs:check` after adding or
renaming a brief.

---

## 5. Visual Inspector Editing Workflow

For a playable with level-to-level transition popups and a separate final-win
screen, keep one imported sliced button/font treatment and assign behavior from
session state. The transition state labels it `Next` and advances the sequence;
the terminal win state labels it from config and calls `PlayableCTAController`
with a stable source name. Store URLs must come from the top-level `cta` config.
Resolve the real package/store listing when possible, clear an unknown platform
URL so the controller can fall back to the known one, and never ship template
package IDs or fabricated App Store IDs.

1. In Cocos Creator **Assets** panel, click on `assets/resources/playable-config.json`.
2. The **Inspector** panel will render the custom `json-scriptable-inspector` UI:
   - Visual groups for **CTA**, **AUDIO**, **GAMEPLAY**, **CAMERA**, **HERO**, **TRACKING**, and **CUSTOM**.
   - Input fields with auto-type detection (numbers, text, checkboxes, color pickers, array reordering).
   - Collapse or expand any object, array, or nested array item independently.
   - Search by a full/partial key path or primitive value; matching branches expand temporarily without changing saved collapse state.
   - Click **💾 Save (Ctrl+S)** to immediately save to disk and reimport the asset.

When maintaining the inspector, scope stock JSON-preview suppression to the
current custom panel. Record every element style before hiding it, then restore
styles and disconnect observers/timers on both `update` and `close`. Guard
asynchronous asset reads with a selection generation token so an older request
cannot overwrite the inspector after the user selects another asset.
