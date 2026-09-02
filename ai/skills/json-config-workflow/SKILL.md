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
> All balancing parameters, CTA store links, delays, audio volumes, camera presets, and custom mechanics **MUST reside in a centralized JSON file** (`assets/resources/playable-config.json`).

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

Always query parameters through `PlayableConfigManager.instance`:

```typescript
import { _decorator, Component } from 'cc';
import { PlayableConfigManager } from '../shared/core/config/PlayableConfigManager';

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

---

## 4. Visual Inspector Editing Workflow

1. In Cocos Creator **Assets** panel, click on `assets/resources/playable-config.json`.
2. The **Inspector** panel will render the custom `json-scriptable-inspector` UI:
   - Visual groups for **CTA**, **AUDIO**, **GAMEPLAY**, **CAMERA**, **HERO**, **TRACKING**, and **CUSTOM**.
   - Input fields with auto-type detection (numbers, text, checkboxes, color pickers, array reordering).
   - Click **💾 Save (Ctrl+S)** to immediately save to disk and reimport the asset.
