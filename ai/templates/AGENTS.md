# Codex / ChatGPT Desktop Agent Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer for `cc_playable_framework`: porting Unity casual/hypercasual games into Cocos Creator 3.8.8+ TypeScript playable ads.

> **Lệnh CLI được SINH TỰ ĐỘNG** từ `playable-shared-kit/ai/capabilities.def.cjs`.
> Không sửa tay giữa các marker. Nguồn máy đọc: `playable-shared-kit/ai/CAPABILITIES.json`.

## 1. Project Context & Map
- Đọc `PROJECT_MAP.json` trước tiên — đừng quét cây thư mục.
- Đọc `playable-shared-kit/ai/CAPABILITIES.json` để biết lệnh nào hợp lệ và tool nào có giới hạn.

## 2. Nguyên tắc bất biến (mọi AI agent dùng chung)

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->

## 3. Action Matrix (Input -> Command -> Output)

<!-- BEGIN:GENERATED:commands -->
<!-- END:GENERATED:commands -->

## 4. Giới hạn đã biết của tooling

<!-- BEGIN:GENERATED:limits -->
<!-- END:GENERATED:limits -->

## 5. Architecture
- `playable-shared-kit/` — core libs, porting tools, build system, work-memory.
- `assets/` — game assets + TypeScript source.
- `extensions/` — editor extensions (`cocos-mcp`, `super-html`, `json-scriptable-inspector`).
- Config: `assets/resources/playable-config.json`, typed via `PlayableConfigTypes.d.ts`.

## 6. TypeScript Rules
- `@ccclass('Name')` + `@property(CCFloat)` decorators (Cocos 3.8.8+).
- `ObjectPool` from `playable-core` for spawner loops.
- `tween(this.node).to(...)` for UI/node animation.
- `GameManager.instance` lifecycle: `onGameReady` / `onGameStart` / `onGameWin` / `onGameLose`.
- `SuperHtmlPlayable.download()` for CTA clicks.
