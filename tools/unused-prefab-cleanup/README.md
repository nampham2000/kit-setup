# Công cụ dọn asset không dùng

`unused-prefab-cleanup` quét dependency graph theo UUID của Cocos Creator để tìm
các asset trong toàn bộ thư mục `assets` không được dùng bởi scene runtime,
source code hoặc dynamic loading.

Tool mặc định chỉ audit và in danh sách. Chỉ khi truyền `--delete`, tool mới xóa:

- Asset không reachable từ runtime roots.
- File `.meta` tương ứng.
- File `.meta` mồ côi khi owner asset hoặc thư mục không còn tồn tại.
- Dependency/reference chỉ thuộc nhóm asset không dùng, ví dụ prefab, FBX,
  material, effect, sprite, texture, sound, animation hoặc JSON.
- Thư mục rỗng và `.meta` của thư mục đó.

Tool không xóa dependency nếu vẫn còn prefab hoặc asset giữ lại reference đến nó.
Sau khi xóa, tool kiểm tra lại dependency graph và fail nếu UUID của asset đã xóa
vẫn còn xuất hiện trong file giữ lại.

## Chạy audit

Chạy từ thư mục gốc của Cocos project:

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs
```

Mặc định tool dùng:

- Phạm vi cleanup: toàn bộ file asset trong `assets`.
- Runtime roots: toàn bộ scene, file `.ts`, file `.js`, `--root` thủ công và
  dynamic asset path phát hiện được.
- Asset UUID được reference từ `settings`, `profiles`, config hoặc `.vscode`
  cũng được giữ lại.
- Source `.ts` và `.js` luôn được giữ lại để tránh xóa nhầm script được import
  hoặc gọi gián tiếp.
- Các đường dẫn literal dạng `resources.load("...", Prefab|JsonAsset, ...)`
  và asset path literal có thư mục được phát hiện tự động trong file `.ts` và
  `.js`. Cách này hỗ trợ cả wrapper loader nhận path qua tham số.

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
hoặc asset không dùng, phát hiện deletion không an toàn, hoặc còn dangling UUID.

## Chỉ dọn prefab

Để dùng hành vi cũ, chỉ tìm prefab không dùng và dependency riêng của chúng:

```powershell
node playable-shared-kit/tools/unused-prefab-cleanup.cjs --scope prefabs
node playable-shared-kit/tools/unused-prefab-cleanup.cjs --scope prefabs --delete
```

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
toàn bộ scene trong `assets`.

## Tùy chọn

- `--project-root <path>`: chỉ định Cocos project root thay vì tự tìm từ `cwd`.
- `--scope <all|prefabs>`: dọn toàn bộ asset hoặc chỉ prefab. Mặc định là `all`.
- `--prefab-dir <path>`: thư mục prefab cần audit.
- `--scene <path>`: scene runtime root, có thể lặp lại.
- `--root <path>`: asset runtime root bổ sung, có thể lặp lại.
- `--json`: in báo cáo JSON đầy đủ.
- `--delete`: xóa asset sau khi kiểm tra reverse reference.
- `--help`: xem hướng dẫn CLI.

## Giới hạn và lưu ý

- Tool dựa trên UUID trong asset serialization và `.meta`.
- Dynamic loading chỉ tự phát hiện được khi code còn chứa literal asset path.
- Với bundle loader, custom loader, đường dẫn ghép hoặc asset được dùng bởi code
  native/plugin, cần khai báo `--root` thủ công.
- Nên commit hoặc backup project trước khi chạy `--delete`.
- Sau khi xóa, mở project bằng Cocos Creator để Editor reimport và chạy gameplay
  smoke test.
