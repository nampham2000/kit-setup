# GitHub Copilot Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`. Always write production-ready Cocos Creator 3.8.8+ TypeScript code adhering to strict hypercasual playable ad performance constraints.

## 1. Project Context & Map
- Run `npm run ai:map` to inspect all scenes, prefabs, scripts, and config schemas (<500 tokens).
- Run `npm run ai:scene -- <sceneName>` to inspect scene node hierarchy in compact ASCII format.
- Config file: `assets/resources/playable-config.json` (auto-typed via `PlayableConfigTypes.d.ts`). Never hardcode gameplay parameters on scene nodes.

## 2. Strict Performance Rules (Zero GC in Loops)
- **NEVER** allocate memory (`new Vec3()`, `new Quat()`, `new Color()`, `instantiate()`) inside `update(dt)` loops.
- Always declare and reuse static/module-level cached variables:
```typescript
import { _decorator, Component, Node, Vec3, Quat, Color, tween } from 'cc';
const { ccclass, property } = _decorator;

const _tempVec3 = new Vec3();
const _tempQuat = new Quat();

@ccclass('HeroController')
export class HeroController extends Component {
  update(dt: number) {
    // Correct Zero-GC calculation:
    Vec3.set(_tempVec3, 0, 0, 5 * dt);
    this.node.translate(_tempVec3);
  }
}
```

## 3. Config-Driven Architecture (`PlayableConfigManager`)
```typescript
import { PlayableConfigManager } from 'playable-core';

// Standard sections
const ctaUrl = PlayableConfigManager.instance.cta.googlePlayUrl;
const bgmVol = PlayableConfigManager.instance.audio.bgmVolume;
const targetTaps = PlayableConfigManager.instance.gameplay.targetTaps;
const fov = PlayableConfigManager.instance.camera.fovPortrait;

// Custom keys
const moveSpeed = PlayableConfigManager.instance.get<number>('custom.moveSpeed', 5.0);
```

## 4. Playable Ads Lifecycle & CTA Redirect
```typescript
import { GameManager } from 'playable-core';
import { SuperHtmlPlayable } from 'playable-sdk';

// Lifecycle hooks
GameManager.instance.onGameReady();  // When assets loaded & initial screen ready
GameManager.instance.onGameStart();  // On player first touch
GameManager.instance.onGameWin();    // On win -> show EndCard
GameManager.instance.onGameLose();   // On lose -> show EndCard

// CTA Click
SuperHtmlPlayable.download();        // Trigger store redirection across all 20+ ad networks
```

## 5. Object Pooling for Hypercasual Spawners
```typescript
import { ObjectPool } from 'playable-core';

// In spawner class:
const bulletNode = this.pool.get();
// When done:
this.pool.put(bulletNode);
```

## 6. Mandatory Post-Porting & Post-Code Verification
Always remind the user or run in terminal after porting or writing code:
- `npm run verify` (or `npm run ai:verify`): Runs automated 6-stage QA pass/fail.
- `npm run lint:gc` (or `npm run ai:lint`): Scans for runtime Zero-GC violations.
- `npm run ai:scene -- <scene>`: Inspects scene structure.
