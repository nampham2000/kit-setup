# playable-shared-kit

Bộ shared kit cho playable ads/Cocos: package dùng chung, tool build, tool port Unity -> Cocos, tool ghi nhớ nội bộ, và helper mở workspace.

## 1) Batch files trong `scripts/`

| File | Ý nghĩa | Dùng khi |
|---|---|---|
| `scripts/0_setup-all.bat` | Cài npm cho root project và từng extension; tự gắn `playable-sdk`, `playable-core` vào `dependencies` nếu có `package.json`. | Lần đầu setup / refresh dependency. |
| `scripts/1_open-project.bat` | Mở VS Code + Cocos Creator 3.8.8; khôi phục token đăng nhập Cocos; sync MCP config cho mọi AI client; bật backend Blender/GIMP rồi verify cả 4 MCP server. Bỏ qua bằng `PLAYABLE_SKIP_MCP_BACKENDS=1` / `PLAYABLE_SKIP_MCP_VERIFY=1`. | Bắt đầu làm việc hằng ngày. |
| `scripts/2_clean-unversioned.bat` | Quét và xóa thư mục sinh ra như `node_modules`, `temp`, `build`, `library`, `coverage`... nhưng tránh thư mục có file tracked. | Cần dọn workspace sạch. |
| `scripts/3_update-submodule-remote.bat` | Chạy `git submodule update --init --remote --recursive` cho `playable-shared-kit`. | Muốn kéo shared-kit mới nhất vào game project. |
| `scripts/4_create-playable-shared-kit-pr.bat` | Tạo branch/commit/push và mở trang PR cho repo `playable-shared-kit`; tránh tạo PR trùng diff. | Cần publish thay đổi của shared-kit. |
| `scripts/5_fix-git-codex-refs.bat` | Xóa riêng local refs tạm `refs/codex/turn-diffs/*`, rồi chạy `git fetch origin --prune` để xác nhận. | Git fetch/pull báo `bad object refs/codex/turn-diffs/...` hoặc `did not send all necessary objects`. |

## 2) Tools chính và quick guide

> Đa số CLI được chạy từ **root của game project Cocos** đã gắn submodule `playable-shared-kit`.

### `tools/playable-build.cjs`
- Mục đích: build playable, cài dependency, kiểm tra môi trường, kéo subtree `playable_core`.
- File liên quan:
  - `tools/playable-build/playable-cli.cjs`: logic chính.
  - `tools/playable-build/playable-cli.config.cjs`: cấu hình local.
  - `tools/playable-build/playable-cli.config_TEMPLATE.cjs`: mẫu config mặc định.
- Quick guide:
  1. `node playable-shared-kit/tools/playable-build.cjs doctor` — kiểm tra Cocos path, config, git status.
  2. `node playable-shared-kit/tools/playable-build.cjs export-build-configs` — xuất `configs/*.json` từ builder profile.
  3. `node playable-shared-kit/tools/playable-build.cjs install --clean` — cài dependency cho các folder cấu hình.
  4. `node playable-shared-kit/tools/playable-build.cjs build --all` hoặc `--brief brief1` — build playable.
  5. `node playable-shared-kit/tools/playable-build.cjs subtree-pull` — kéo `playable_core` bằng git subtree.

### `tools/unity-cocos-port.cjs`
- Mục đích: port prefab/folder từ Unity sang Cocos, có CSV report.
- Quick guide:
  1. `node playable-shared-kit/tools/unity-cocos-port.cjs doctor` — kiểm tra input/output/report trước khi port.
  2. `node playable-shared-kit/tools/unity-cocos-port.cjs port --src <prefab|folder> --out <prefab|folder> --overwrite --recursive` — port thật.
  3. Thêm `--dry-run` để test không ghi file.
  4. Thêm `--copy-assets` / `--convert-fbx-fallback` khi thiếu asset hoặc FBX import.

### `tools/unity-hlsl-to-cocos-effect.cjs`
- Mục đích: đổi Unity Shader/HLSL sang khung `.effect` cho Cocos.
- Quick guide:
  1. `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src <shader> --out <effect>`.
  2. Thêm `--transparent`, `--opaque`, `--alpha-clip` để ép render state.
  3. Thêm `--dry-run` để kiểm tra trước; xem CSV report nếu còn phần phải sửa tay.

### `tools/strip-fbx-textures.cjs`
- Mục đích: loại `Texture`/`Video` link khỏi binary FBX để Cocos không sinh texture sub-asset trong model, nhưng vẫn giữ material slot, mesh, skeleton và animation.
- Quick guide:
  1. `node playable-shared-kit/tools/strip-fbx-textures.cjs <fbx...>` — dry-run và in JSON report.
  2. Thêm `--write` để cập nhật FBX cùng file `.fbx.meta` tương ứng.
  3. Thêm `--no-meta` khi xử lý FBX độc lập không nằm trong Cocos project.
  4. Xem hướng dẫn đầy đủ tại `tools/strip-fbx-textures/README.md`.

### `tools/work-memory.cjs`
- Mục đích: lưu note/lesson learned cục bộ bằng SQLite + semantic search.
- Quick guide:
  1. `node playable-shared-kit/tools/work-memory.cjs init` — tạo DB/cache trong `playable-shared-kit/tools/work-memory/data`.
  2. `... remember` hoặc `... import-markdown` — ghi note thủ công / import file.
  3. `... import-sources --scope repo` — quét TODO/README/summary trong repo.
  4. `... watch --poll-seconds 15` — tự sync khi mở VS Code và khi note nguồn thay đổi.
  5. `... query --text "..." --scope hybrid --semantic hybrid` — tìm note.
  6. Thêm lesson reusable vào `playable-shared-kit/tools/work-memory/shared-capture.md` để watcher tự import vào shared DB.
  7. `... stats` / `... inspect-cache --items true` — xem thống kê và cache.

### `tools/vscode-mcp-autostart/`
- Mục đích: VS Code helper tự bật MCP server khi mở workspace có `.vscode/mcp.json`.
- Quick guide:
  1. Chạy `scripts/0_setup-all.bat` để cài/refresh helper.
  2. Mở workspace; helper tự bật toàn bộ workspace MCP server không phụ thuộc vào `localhost:3000`.
  3. `cocos-mcp` vẫn chỉ bật sau khi `localhost:3000` sẵn sàng.
  4. Workspace hiện có thể expose `workMemory` qua `.vscode/mcp.json` để query/save memory trực tiếp từ chat tools.

### `tools/mcp-clients-sync.ps1`
- Mục đích: đăng ký cùng một bộ MCP server (`cocos-mcp`, `blender-mcp`, `gimp-mcp`, `node_repl`) vào config của mọi AI client trên máy, để Claude Code / Antigravity / GitHub Copilot / Codex đều thấy đủ tool. `scripts/1_open-project.bat` tự gọi script này.
- Đường dẫn binary được **dò tại runtime** (venv Blender, `uv.exe`, runtime `cua_node` của Codex có hash đổi mỗi lần update), không hardcode.
- File được ghi:

| Client | File config | Server được ghi |
|---|---|---|
| Claude Code desktop + Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | cả 4 |
| Antigravity | `%USERPROFILE%\.gemini\config\mcp_config.json` | cả 4 (`serverUrl` cho HTTP) |
| Copilot / VS Code (workspace) | `<project>\.vscode\mcp.json` | `cocos-mcp` |
| Copilot / VS Code + Insiders (user) | `%APPDATA%\Code[ - Insiders]\User\mcp.json` | `blender-mcp`, `gimp-mcp`, `node_repl` |
| Copilot / JetBrains | `%LOCALAPPDATA%\github-copilot\intellij\mcp.json` | cả 4 |
| Codex / ChatGPT desktop | `%USERPROFILE%\.codex\config.toml` | chỉ kiểm tra, không ghi |

- Mỗi tên server chỉ nằm ở **một scope cho mỗi client** nên client không bao giờ thấy trùng tool. `cocos-mcp` ở workspace scope của VS Code vì nó là endpoint của editor project này.
- Quick guide:
  1. `powershell -NoProfile -ExecutionPolicy Bypass -File playable-shared-kit\tools\mcp-clients-sync.ps1 -ProjectDir .` — ghi lại toàn bộ config.
  2. Thêm `-Verify` để bắt tay MCP `initialize` thật với từng server; `-VerifyOnly` để chỉ kiểm tra mà không ghi file.
  3. Thêm `-ClaudeUserScope` nếu dùng Claude Code từ terminal (ghi `~/.claude.json` qua CLI `claude` bundled). Mặc định tắt vì app desktop đã đọc `claude_desktop_config.json`, bật cả hai sẽ nhân đôi tool.
  4. Lần ghi đầu tiên tạo backup `<file>.mcp-sync-backup` cho từng config.
  5. Sau khi sync phải **restart client** — không client nào đọc lại config khi đang chạy.

### `tools/mcp-probe.cjs`
- Mục đích: health-check MCP server bằng `initialize` + `tools/list` thật, dùng bởi `-Verify` ở trên.
- Chạy qua Node chứ không phải PowerShell vì `StandardInput` bị redirect trong Windows PowerShell sẽ ghi thêm encoding preamble trước dòng JSON đầu, mọi MCP server đều reject.
- Quick guide: `node playable-shared-kit/tools/mcp-probe.cjs <spec.json>` — in `name<TAB>ok|fail<TAB>detail`, exit code khác 0 nếu có server fail.

## 3) Các lệnh npm cần thiết

> Các lệnh dưới đây thường nằm ở **game project tích hợp shared-kit**, không phải repo shared-kit root này.

### Nhóm setup/build playable

| Lệnh | Ý nghĩa |
|---|---|
| `npm install` | Cài dependency cho package/folder hiện tại. |
| `npm run doctor` | Kiểm tra môi trường build playable. |
| `npm run setup` | Cài sạch toàn bộ dependency theo cấu hình. |
| `npm run setup:fast` | Cài nhanh, không xóa `node_modules` trước. |
| `npm run build` | Build tất cả config trong `configs/`. |
| `npm run build:fast` | Build nhanh theo preset của project. |
| `npm run build:seq` | Build tuần tự 1 job; ổn định hơn khi máy yếu. |
| `npm run build:maxcpu` | Build ưu tiên tận dụng CPU tối đa. |
| `npm run build:Short` | Build preset brief `Short`. |
| `npm run build:Mid` | Build preset brief `Mid`. |
| `npm run build:Long` | Build preset brief `Long`. |
| `npm run subtree:pull` | Kéo cập nhật `playable_core` bằng subtree. |

### Nhóm extension `packages/extensions/super-html`

| Lệnh | Ý nghĩa |
|---|---|
| `npm run build` | Build extension `super-html`. |
| `npm run watch` | Watch TypeScript và build lại khi file đổi. |

## 4) Ghi nhớ nhanh

- Repo này **không có `package.json` ở root**, nên không chạy `npm test` hay `npm run ...` trực tiếp ở đây.
- CLI shared-kit chủ yếu chạy bằng `node playable-shared-kit/tools/<tool>.cjs ...` từ game project chứa submodule.
