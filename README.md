# playable-shared-kit

Bộ shared kit cho playable ads/Cocos: package dùng chung, tool build, tool port Unity -> Cocos, tool ghi nhớ nội bộ, và helper mở workspace.

## 1) Batch files trong `scripts/`

| File | Ý nghĩa | Dùng khi |
|---|---|---|
| `scripts/0_setup-all.bat` | Cài npm cho root project và từng extension; tự gắn `playable-sdk`, `playable-core` vào `dependencies` nếu có `package.json`. | Lần đầu setup / refresh dependency. |
| `scripts/1_open-project.bat` | Mở VS Code + Cocos Creator 3.8.8; cố gắng khôi phục token đăng nhập Cocos. | Bắt đầu làm việc hằng ngày. |
| `scripts/2_clean-unversioned.bat` | Quét và xóa thư mục sinh ra như `node_modules`, `temp`, `build`, `library`, `coverage`... nhưng tránh thư mục có file tracked. | Cần dọn workspace sạch. |
| `scripts/3_update-submodule-remote.bat` | Chạy `git submodule update --init --remote --recursive` cho `playable-shared-kit`. | Muốn kéo shared-kit mới nhất vào game project. |
| `scripts/4_create-playable-shared-kit-pr.bat` | Tạo branch/commit/push và mở trang PR cho repo `playable-shared-kit`; tránh tạo PR trùng diff. | Cần publish thay đổi của shared-kit. |

## 2) Tools chính và quick guide

> Đa số CLI được chạy từ **root của game project Cocos** đã gắn submodule `playable-shared-kit`.

### `tools/playable-build.cjs`
- Mục đích: build playable, cài dependency, kiểm tra môi trường, kéo subtree `playable_core`.
- File liên quan:
  - `tools/playable-build/playable-cli.cjs`: logic chính.
  - `tools/playable-build/playable-cli.config.cjs`: cấu hình local.
  - `tools/playable-build/playable-cli.config_TEMPLATE.cjs`: mẫu config mặc định.
  - `tools/playable-build/build_project.*`, `install_all.*`, `subtree_pull.*`: wrapper quay về root project rồi gọi CLI.
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
