# Công cụ dọn TOÀN BỘ asset không dùng

`unused-asset-cleanup.cjs` là CLI wrapper chuyên dụng để dọn mọi asset không
reachable từ runtime của Cocos project hiện tại. Bên dưới nó gọi
`unused-prefab-cleanup.cjs --scope all`, chặn override `--scope` để đảm bảo luôn
dọn toàn bộ chứ không chỉ prefab.

Phạm vi hoạt động giống hệt `unused-prefab-cleanup.cjs` ở scope `all`:

- Quét dependency graph theo UUID trên toàn bộ `assets/`.
- Runtime roots: mọi scene, mọi `.ts`/`.js`, `--root` thủ công, dynamic asset
  path phát hiện từ `resources.load(...)`, UUID xuất hiện trong
  `settings/profiles/config/.vscode/package.json/tsconfig.json`.
- Không xóa nếu vẫn có asset giữ lại reference.
- Sau khi xóa, tự audit lại và fail nếu còn dangling UUID.

## Chạy audit

Chạy từ root Cocos project:

```powershell
node playable-shared-kit/tools/unused-asset-cleanup.cjs
```

In báo cáo JSON đầy đủ:

```powershell
node playable-shared-kit/tools/unused-asset-cleanup.cjs --json
```

## Xóa asset

Luôn audit và review trước, rồi mới xóa:

```powershell
node playable-shared-kit/tools/unused-asset-cleanup.cjs --delete
```

## Tùy chọn

- `--project-root <path>` — chỉ định Cocos project root thay vì auto detect.
- `--prefab-dir <path>` — thư mục prefab khi audit. Default: `assets/prefabs`.
- `--scene <path>` — scene runtime root; lặp lại được. Default: tất cả `.scene`.
- `--root <path>` — asset runtime root bổ sung; lặp lại được.
- `--json` — in báo cáo JSON đầy đủ.
- `--delete` — xóa asset sau khi kiểm tra reverse reference.
- `--help`, `-h` — hiện help.

Không hỗ trợ `--scope`; muốn chỉ dọn prefab thì dùng
`unused-prefab-cleanup.cjs --scope prefabs`.
