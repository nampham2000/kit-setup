# GitHub Copilot Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`. Always write production-ready Cocos Creator 3.8.8+ TypeScript adhering to strict hypercasual playable ad performance constraints.

> Lệnh CLI bên dưới sinh tự động từ `playable-shared-kit/ai/capabilities.def.cjs`. Không sửa tay giữa marker.

## 1. Project Context
- Đọc `PROJECT_MAP.json` để biết scene / prefab / script / config.
- Đọc `playable-shared-kit/ai/CAPABILITIES.json` để biết lệnh nào hợp lệ và tool nào có giới hạn.
- Config: `assets/resources/playable-config.json` (typed via `PlayableConfigTypes.d.ts`). Không hardcode tham số gameplay.

## 2. Nguyên tắc bất biến

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->

## 3. Zero-GC pattern

```typescript
import { _decorator, Component, Vec3 } from 'cc';
const { ccclass } = _decorator;

const _tempVec3 = new Vec3();          // pre-allocated at module scope

@ccclass('HeroController')
export class HeroController extends Component {
  update(dt: number) {
    Vec3.set(_tempVec3, 0, 0, 5 * dt); // no allocation inside update
    this.node.translate(_tempVec3);
  }
}
```

## 4. Config-driven architecture

```typescript
import { PlayableConfigManager } from 'playable-core';

const ctaUrl     = PlayableConfigManager.instance.cta.googlePlayUrl;
const bgmVolume  = PlayableConfigManager.instance.audio.bgmVolume;
const targetTaps = PlayableConfigManager.instance.gameplay.targetTaps;
const custom     = PlayableConfigManager.instance.get('custom.myParam', 1.0);
```

## 5. Lệnh hợp lệ

<!-- BEGIN:GENERATED:commands-list -->
<!-- END:GENERATED:commands-list -->

## 6. Giới hạn tooling

<!-- BEGIN:GENERATED:limits -->
<!-- END:GENERATED:limits -->
