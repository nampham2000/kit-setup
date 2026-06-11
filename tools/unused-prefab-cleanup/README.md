# Công cụ dọn prefab không dùng

`unused-prefab-cleanup` quét dependency graph theo UUID của Cocos Creator để tìm
các prefab trong `assets/prefabs` không được dùng bởi scene runtime hoặc dynamic
loading trong code.

Tool mặc định chỉ audit và in danh sách. Chỉ khi truyền `--delete`, tool mới xóa:

- Prefab không reachable từ runtime roots.
- File `.meta` tương ứng.
- Dependency chỉ được nhóm asset sắp xóa reference, ví dụ FBX, material, effect,
  sprite, texture, sound hoặc nested prefab.
- Thư mục rỗng và `.meta` của thư mục đó.

Tool không xóa dependency nếu vẫn còn prefab hoặc asset giữ lại reference đến nó.

## Chạy audit

Chạy từ thư mục gốc của Cocos project:

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs
```

Mặc định tool dùng:

- Thư mục prefab: `assets/prefabs`
- Scene runtime: `assets/Scene/Gameplay.scene`
- Các đường dẫn literal dạng `resources.load("...", Prefab|JsonAsset, ...)`
  và literal bắt đầu bằng `prefabs/` hoặc `json/` được phát hiện tự động trong
  file `.ts` và `.js`. Cách này hỗ trợ cả wrapper loader nhận path qua tham số.

Xuất báo cáo JSON đầy đủ:

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs --json
```

## Xóa asset đã xác nhận

Luôn chạy audit và review danh sách trước. Sau đó mới chạy:

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs --delete
```

Sau khi xóa, tool tự quét lại dependency graph. Lệnh trả lỗi nếu vẫn còn prefab
không dùng hoặc phát hiện deletion không an toàn.

## Runtime root bổ sung

Khi project load asset bằng biến, chuỗi ghép hoặc custom loader, tool không thể
suy ra đường dẫn tĩnh. Khai báo asset đó bằng `--root`:

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs `
  --root assets/prefabs/PowerText/PowerText.prefab `
  --root assets/json/Level23.json
```

Có thể truyền nhiều `--root`.

## Scene và thư mục prefab tùy chỉnh

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs `
  --scene assets/Scene/Gameplay.scene `
  --scene assets/Scene/Boot.scene `
  --prefab-dir assets/prefabs
```

Có thể truyền nhiều `--scene`. Nếu có ít nhất một `--scene`, tool không tự thêm
`assets/Scene/Gameplay.scene`.

## Tùy chọn

- `--project-root <path>`: chỉ định Cocos project root thay vì tự tìm từ `cwd`.
- `--prefab-dir <path>`: thư mục prefab cần audit.
- `--scene <path>`: scene runtime root, có thể lặp lại.
- `--root <path>`: asset runtime root bổ sung, có thể lặp lại.
- `--json`: in báo cáo JSON đầy đủ.
- `--delete`: xóa asset sau khi kiểm tra reverse reference.
- `--help`: xem hướng dẫn CLI.

## Giới hạn và lưu ý

- Tool dựa trên UUID trong asset serialization và `.meta`.
- Dynamic loading chỉ tự phát hiện được khi code còn chứa literal path bắt đầu
  bằng `prefabs/` hoặc `json/`.
- Với bundle loader, custom loader, đường dẫn ghép hoặc asset được dùng bởi code
  native/plugin, cần khai báo `--root` thủ công.
- Nên commit hoặc backup project trước khi chạy `--delete`.
- Sau khi xóa, mở project bằng Cocos Creator để Editor reimport và chạy gameplay
  smoke test.
