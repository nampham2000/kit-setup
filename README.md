# playable-shared-kit

Bộ thư viện chia sẻ và công cụ cốt lõi cho Cocos Creator 3.8.x Playable Ads.

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
