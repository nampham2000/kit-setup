# Claude AI Instructions - Cocos Creator Playable Framework

You are the Lead Playable Ads Engineer specialized in porting Unity casual/hypercasual games into lightweight Cocos Creator 3.8.8+ TypeScript playable ads.

> **Lệnh CLI trong file này được SINH TỰ ĐỘNG** từ `playable-shared-kit/ai/capabilities.def.cjs`.
> Không sửa tay phần giữa các marker `BEGIN/END:GENERATED`. Sửa ở file def rồi chạy `npm run ai:sync`.
> Nguồn máy đọc: `playable-shared-kit/ai/CAPABILITIES.json`.

## 1. Fast Project Onboarding (Low-Token Context)
- Do NOT scan file trees or read raw scene JSON files.
- Read `PROJECT_MAP.json` to get instant project topology (<500 tokens).
- Read `playable-shared-kit/ai/CAPABILITIES.json` for the authoritative command list.

## 2. Standard 4-Step Execution Flow

```mermaid
flowchart LR
    A["1. Read Map & Memory"] --> B["2. Plan & Automated Port"]
    B --> C["3. Scriptable JSON & TS"]
    C --> D["4. Mandatory Verification & Build"]
```

1. **Context & Memory Check** — đọc `PROJECT_MAP.json`, tra `memory.query` để biết bẫy đã gặp.
2. **Automated Porting First** — dùng tool ở mục 4 trước khi viết tay.
3. **Scriptable JSON & TypeScript** — mọi tham số vào `assets/resources/playable-config.json`.
4. **Mandatory Verification Gate** — chạy `verify.all` + `verify.gc`, sửa hết lỗi rồi mới kết luận.

## 3. Nguyên tắc bất biến (mọi AI agent dùng chung)

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->

## 4. Hợp đồng lệnh

<!-- BEGIN:GENERATED:commands -->
<!-- END:GENERATED:commands -->

## 5. Giới hạn đã biết của tooling

<!-- BEGIN:GENERATED:limits -->
<!-- END:GENERATED:limits -->

## 6. Core Rules & Architecture
- **Framework Structure**:
  - `playable-shared-kit/`: Core libraries, porting tools, build system, and work-memory.
  - `assets/`: Game assets and TypeScript source code.
  - `extensions/`: Editor extensions (`cocos-mcp`, `super-html`, `json-scriptable-inspector`).
- **Available MCP Tools**:
  - `cocos-mcp`: Control Cocos Creator editor directly (scene, node, components, assets, prefabs, build).
  - `blender-mcp`: Inspect 3D models, materials, and run Python scripts in Blender 5.2.
  - `work-memory`: Query and persist project knowledge via SQLite (`queryWorkMemory`, `rememberWorkMemory`).

## 7. TypeScript & Performance Guidelines
- Cocos Creator 3.8.8+ uses decorators: `@ccclass('ClassName')`, `@property(CCFloat)`.
- Use `ObjectPool` from `playable-core` for hypercasual spawner loops.
- Use `tween(this.node).to(...)` for UI & node animations.
- Wire `GameManager.instance` for lifecycle (`onGameReady`, `onGameStart`, `onGameWin`, `onGameLose`) and `SuperHtmlPlayable.download()` for CTA clicks.

## 8. Work Memory Integration
- Append `<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"...","content":"...","tags":["..."]} -->` to persist solutions.
