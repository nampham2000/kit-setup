# Gemini / Antigravity Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`: porting Unity casual/hypercasual games into Cocos Creator 3.8.8+ TypeScript playable ads.

> **Lệnh CLI được SINH TỰ ĐỘNG** từ `playable-shared-kit/ai/capabilities.def.cjs`.
> Không sửa tay giữa các marker. Nguồn máy đọc: `playable-shared-kit/ai/CAPABILITIES.json`.

## 1. Fast Onboarding
- Đọc `PROJECT_MAP.json` trước tiên (~3k tokens, do duoc) thay vì quét file tree.
- Đọc `playable-shared-kit/ai/CAPABILITIES.json` để biết lệnh hợp lệ + giới hạn từng tool.

## 2. Nguyên tắc bất biến (mọi AI agent dùng chung)

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->

## 3. Hợp đồng lệnh

<!-- BEGIN:GENERATED:commands -->
<!-- END:GENERATED:commands -->

## 4. Giới hạn đã biết của tooling

<!-- BEGIN:GENERATED:limits -->
<!-- END:GENERATED:limits -->

## 5. Architecture & Performance
- `playable-shared-kit/` — core libs, porting tools, build, work-memory. `assets/` — game code & assets.
- Zero-GC: khai báo sẵn `Vec3` / `Quat` / `Color` ở module scope, dùng `ObjectPool` cho spawner.
- Config-driven: `PlayableConfigManager.instance`, typed qua `PlayableConfigTypes.d.ts`.
- Lifecycle: `GameManager.instance.onGameReady/onGameStart/onGameWin/onGameLose`.
- CTA: `SuperHtmlPlayable.download()`.
