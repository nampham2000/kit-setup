# playable-shared-kit

Bộ thư viện chia sẻ và công cụ cốt lõi cho Cocos Creator 3.8.x Playable Ads.

---

## Cài vào một project mới

Bốn bước. Đã chạy thử trọn vẹn trên project trắng ngày 2026-09-29.

```bash
# 1. Trong thư mục project Cocos, biến nó thành repo git
git init

# 2. Thêm kit làm submodule
git submodule add https://github.com/nampham2000/kit-setup.git playable-shared-kit

# 3. Chép launcher ra gốc project (chỉ lần đầu)
cp playable-shared-kit/scripts/*.bat .

# 4. Chạy setup (vài phút, có npm install)
0_setup-all.bat
```

Xong thì mở bằng `1_open-project.bat`. Scene view đã nằm sẵn trong
`assets/scene-view/` — bấm Play, `F1` để bật/tắt, không phải tạo node hay kéo
component.

Bước 4 in ra, theo đúng thứ tự:

```
[setup] regenerate legacy lockfile
[setup] install locked project dependencies
[setup] install Cocos MCP runtime
[setup] sync packages, extensions, scripts and launchers
  [ok] Synced: playable-sdk -> assets\script\shared\sdk
  [ok] Synced: playable-core -> assets\script\shared\core
  [ok] Synced extension: cocos-mcp
  [ok] Synced extension: json-scriptable-inspector
  [ok] Synced extension: super-html
  [ok] Synced: scene-view -> assets/scene-view
[setup] deploy AI skills and command contract
  [ok] 73 capabilities -> ai/CAPABILITIES.json + ai/CORE.md
[setup] Complete.
```

Kết quả mong đợi: 138 npm script, 3 editor extension, 16 file scene-view, và
`node playable-shared-kit/tools/contract-verify.cjs` báo **PASS 73/73**.

Hai dòng nhiễu vô hại: cảnh báo `npm deprecated prebuild-install` và
`ExperimentalWarning: SQLite` của Node.

### Ba điểm dễ vấp

- **Bước 1 bắt buộc.** Không phải repo git thì `submodule add` hỏng. Project
  không dùng git thì thay bằng
  `git clone https://github.com/nampham2000/kit-setup.git playable-shared-kit`.
- **Bước 3 chỉ làm một lần.** Kit không chứa `sync-tools.bat`; các file
  `0_`…`6_` nằm trong `scripts/` và được chép ra thủ công lần đầu. Từ đó
  `sync-shared-kit.cjs` tự làm mới chúng mỗi lần chạy setup.
- **`tools/dependency/` không nằm trong git.** Python, uv và FFmpeg được tải khi
  cần bằng `npm run dependencies:setup`. Nếu mạng chặn, lấy lại từ bản backup
  `kit-setup-backup-before-rewrite.bundle`.

### Cập nhật về sau

```bash
git submodule update --remote playable-shared-kit
0_setup-all.bat
```

Hoặc dùng sẵn `3_update-submodule-remote.bat`.

---

## ⚡ Lệnh Nhanh Thường Dùng

| Công cụ | Lệnh thực thi | Mục đích |
| :--- | :--- | :--- |
| **All-in-One Port** | `npm run port:smart -- --src <unity_dir>` | Chuyển đổi trọn gói Unity Prefabs, Materials & C# Scaffolds |
| **Script Scaffolder** | `npm run port:script -- --src <file.cs>` | Dịch C# Unity sang TypeScript Cocos 3.8 Zero-GC |
| **Shader Converter** | `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src <shader> --out <effect>` | Đổi Unity Shader sang Cocos `.effect` |
| **Strip FBX Textures** | `node playable-shared-kit/tools/strip-fbx-textures.cjs <file.fbx>` | Xóa link texture nhúng trong binary FBX |
| **Zero-GC Linter** | `npm run lint:gc` | Quét phát hiện cấp phát bộ nhớ trong `update(dt)` |
| **Headless QA Verifier** | `npm run verify` | Bộ kiểm thử 6 tầng tự động (TypeScript, Config, Assets, Meta) |
| **Scene Inspector** | `npm run ai:scene -- <sceneName>` | In cây node Scene/Prefab dạng ASCII gọn nhẹ |
| **AI Knowledge Sync** | `npm run ai:sync` | Tự động sinh `PROJECT_MAP.json`, Typings và đồng bộ 4 AI Provider |
| **Work Memory Query** | `npm run memory:query -- <keyword>` | Tra cứu kinh nghiệm và bẫy lỗi từ SQLite |
| **Build Playable HTML** | `npm run build` | Đóng gói playable ads HTML đơn lẻ |

---

## 📁 Cấu Trúc Thư Mục

```
playable-shared-kit/
├── ai/                 # Templates & Skills cho Claude, Codex, Gemini, Copilot
├── packages/           # Core SDKs (playable-core, playable-sdk, extensions)
├── scripts/            # Batch files khởi tạo workspace & mở editor
└── tools/              # Công cụ Porting, Verifier, Linter, Build & Memory
```

## Hợp đồng lệnh cho AI agent

Danh sách lệnh hợp lệ duy nhất: `playable-shared-kit/ai/CAPABILITIES.json`
(sinh từ `playable-shared-kit/ai/capabilities.def.cjs`).

- `npm run ai:contract` — sinh lại manifest.
- `npm run ai:sync` — render manifest vào CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules / copilot-instructions.md / SKILL.md.
- `npm run ai:contract:verify` — đối chiếu mọi lệnh với CLI thật; exit 1 khi lệch.

Bảng lệnh trong README này chỉ để người đọc; **nguồn sự thật là manifest**.

## Consolidated starter workflow

Run `npm run setup` in the game root after initializing the pinned submodule.
See [porting retrospective and new-project workflow](ai/PORTING_RETROSPECTIVE.md) for lessons from Tape Jam, Harvest Tile, Hidden Suspect, Pixel Light and Dragon Crashers.
