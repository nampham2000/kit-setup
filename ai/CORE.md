# CORE — Nguyên tắc bất biến của cc_playable_framework

> Sinh tự động từ `playable-shared-kit/ai/capabilities.def.cjs`. Không sửa tay.
> Mọi AI agent (Claude, Codex, Gemini, Copilot, Cursor) đều nạp cùng file này
> để ra quyết định giống nhau khi tool không nói rõ.

1. **config-driven** — Mọi tham số gameplay/CTA nằm trong `assets/resources/playable-config.json`, đọc qua `PlayableConfigManager.instance`. Không hardcode trong TS hay trên node của scene.
2. **zero-gc** — Không cấp phát trong `update(dt)`. Khai báo sẵn `Vec3` / `Quat` / `Color` ở module scope và tái sử dụng. Dùng `ObjectPool` cho spawner.
3. **verify-gate** — Sau mọi lần sửa code hoặc port: chạy `npm run ai:verify` và `npm run ai:lint`. Phải sạch trước khi kết thúc lượt trả lời.
4. **canonical-paths** — Script vào `assets/script/`, effect vào `assets/effects/`, config vào `assets/resources/`. Không tự tạo biến thể như `assets/scripts/`.
5. **severity** — Ngữ nghĩa severity trong report: `high` = mất hành vi hoặc mất hình ảnh, phải xử lý; `medium` = cần người quyết định; `low` = ghi chú thông tin. Không bỏ qua `high`.
6. **trust-but-verify** — Tool báo thành công KHÔNG đồng nghĩa kết quả đúng. Luôn mở ít nhất một file sinh ra để đối chiếu với nguồn trước khi kết luận.
7. **meta-files** — Không sửa tay file `.meta`. Luôn đi qua tool hoặc Cocos editor để giữ UUID nhất quán.

## Hợp đồng lệnh

Danh sách lệnh hợp lệ duy nhất nằm ở `playable-shared-kit/ai/CAPABILITIES.json`.
Nếu một lệnh trong tài liệu khác mâu thuẫn với file đó, **file đó đúng**.
Chạy `npm run ai:contract:verify` để chứng minh manifest khớp với CLI thật.

### Onboarding (chạy trước tiên)

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Bước đầu tiên của mọi task. Thay cho việc quét cây thư mục. | `npm run ai:map` | — |
| Cần biết cấu trúc scene trước khi sửa node/component. | `npm run ai:scene -- <sceneName>` | Component script hiện UUID thô, chưa giải ra tên class. |
| Trước khi giải một vấn đề nghe quen; sau khi giải xong thì ghi lại. | `npm run memory:query -- <keyword>` | Embedding tắt khi thiếu `sqlite-vec` — recall theo keyword, có thể trả kết quả lệch chủ đề. |

### Port Unity → Cocos

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Chuyển prefab Unity thành .prefab của Cocos. | `node playable-shared-kit/tools/unity-cocos-port.cjs port --src <unity_prefab_or_dir> --out <cocos_prefab_or_dir>` | Chậm: đo được ≈140 s/prefab trên project 68k asset meta; chưa có cache, chưa song song. Shader tuỳ biến KHÔNG được port — xem `shader.convert`. Luôn đọc report và xử lý mọi dòng `high` trước khi coi là xong. |
| Port hàng loạt. Nên chạy `--dry-run` trước để xem report. | `npm run port:smart -- --src <unity_dir> --out assets/` | Cùng giới hạn tốc độ và shader như `port.prefab`. |
| Port script/logic C# sang TS: AI Agent LUÔN CHẠY LỆNH NÀY TRƯỚC TIÊN để tạo static first pass, sau đó đọc report và refine/polish gameplay semantics. | `npm run port:compile -- --src <csharp_path> --out assets/script/` | Pass nghĩa là parser/emitter và cú pháp TypeScript hợp lệ; KHÔNG xác nhận gameplay semantic equivalence. Các file có TODO hoặc warning luôn cần AI refine; dùng `--runtime-only` để bỏ Unity Editor code khi port playable runtime. Mặc định giữ cấu trúc thư mục để tránh ghi đè basename; `--flat-output` chỉ dùng khi đã kiểm tra collision. |
| Cần khung TS + @property từ script Unity. | `npm run port:script -- --src <csharp_path> --out assets/script/` | CHỈ sinh property và method rỗng — 100% logic phải do agent dịch tay từ file .cs gốc. Làm phẳng thư mục theo tên class; trùng tên sẽ ghi đè. Giá trị mặc định C# được chèn nguyên văn, có thể không compile. |
| Cần khung .effect + properties + UBO từ shader Unity. | `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src <unity.shader> --out <assets/effects/X.effect>` | KHÔNG dịch thân HLSL. Chỉ sinh khung + properties + UBO, thân shader là template. Report sẽ ghi `high SHADER_NEEDS_MANUAL_PORT` — agent phải tự viết lại phần tính toán. |
| Chuyển nhiều shader một lượt. | `node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs batch --dir <unity_shader_dir> --out-dir <assets/effects>` | Cùng giới hạn với `shader.convert`. |
| Sau khi FBX đã nằm trong assets/ của Cocos và có .meta đi kèm. | `npm run fbx:strip -- <file.fbx>` | Nhận MỘT file, không nhận thư mục. Bắt buộc phải có `<file>.fbx.meta` bên cạnh — tức là chỉ chạy được SAU khi Cocos đã import. |

### Xác minh (bắt buộc)

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| BẮT BUỘC sau mọi lần sửa code hoặc port. Phải sạch trước khi kết thúc lượt. | `npm run ai:verify` | — |
| BẮT BUỘC cùng với `verify.all`. | `npm run ai:lint` | — |

### Tối ưu

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Khi bundle vượt ngưỡng và audio chiếm tỉ trọng lớn. | `npm run sound:optimize` | Mặc định là dry-run; phải thêm `--write` mới ghi đè. |
| Trước khi build bản cuối, để cắt bundle. | `npm run cleanup:unused` | NGUY HIỂM: asset vừa port nhưng chưa được scene/prefab nào tham chiếu sẽ bị liệt kê là unused. KHÔNG chạy `--delete` ngay sau khi port. |
| Khi cần biết thứ gì đang làm bundle phình. | `npm run stats` | — |

### Build & Deploy

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Sau khi verify sạch. | `npm run build` | Playable nên dưới 3.5 MB; verifier sẽ cảnh báo khi vượt. |
| Khi build lỗi hoặc mới clone repo. | `npm run doctor` | — |
| Khi cần gửi bản chạy thử cho người khác. | `npm run deploy` | — |

### Tri thức & bộ nhớ

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Sau khi sửa `capabilities.def.cjs` hoặc thay đổi tool. | `npm run ai:sync` | — |
| Trong CI, và sau khi đổi CLI của bất kỳ tool nào. | `npm run ai:contract:verify` | — |
| Sau khi giải xong một vấn đề không hiển nhiên. | `npm run memory:stats` | — |

## Giới hạn đã biết

Những tool sau **không làm được việc mà tên gọi gợi ý**. Đọc kỹ trước khi tin kết quả:

- **`scene.inspect`** (npm run ai:scene -- <sceneName>)
  - Component script hiện UUID thô, chưa giải ra tên class.
- **`memory.query`** (npm run memory:query -- <keyword>)
  - Embedding tắt khi thiếu `sqlite-vec` — recall theo keyword, có thể trả kết quả lệch chủ đề.
- **`port.prefab`** (node playable-shared-kit/tools/unity-cocos-port.cjs port --src <unity_prefab_or_dir> --out <cocos_prefab_or_dir>)
  - Chậm: đo được ≈140 s/prefab trên project 68k asset meta; chưa có cache, chưa song song.
  - Shader tuỳ biến KHÔNG được port — xem `shader.convert`.
  - Luôn đọc report và xử lý mọi dòng `high` trước khi coi là xong.
- **`port.smart`** (npm run port:smart -- --src <unity_dir> --out assets/)
  - Cùng giới hạn tốc độ và shader như `port.prefab`.
- **`port.compile`** (npm run port:compile -- --src <csharp_path> --out assets/script/)
  - Pass nghĩa là parser/emitter và cú pháp TypeScript hợp lệ; KHÔNG xác nhận gameplay semantic equivalence.
  - Các file có TODO hoặc warning luôn cần AI refine; dùng `--runtime-only` để bỏ Unity Editor code khi port playable runtime.
  - Mặc định giữ cấu trúc thư mục để tránh ghi đè basename; `--flat-output` chỉ dùng khi đã kiểm tra collision.
- **`port.script`** (npm run port:script -- --src <csharp_path> --out assets/script/)
  - CHỈ sinh property và method rỗng — 100% logic phải do agent dịch tay từ file .cs gốc.
  - Làm phẳng thư mục theo tên class; trùng tên sẽ ghi đè.
  - Giá trị mặc định C# được chèn nguyên văn, có thể không compile.
- **`shader.convert`** (node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src <unity.shader> --out <assets/effects/X.effect>)
  - KHÔNG dịch thân HLSL. Chỉ sinh khung + properties + UBO, thân shader là template.
  - Report sẽ ghi `high SHADER_NEEDS_MANUAL_PORT` — agent phải tự viết lại phần tính toán.
- **`shader.batch`** (node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs batch --dir <unity_shader_dir> --out-dir <assets/effects>)
  - Cùng giới hạn với `shader.convert`.
- **`fbx.strip`** (npm run fbx:strip -- <file.fbx>)
  - Nhận MỘT file, không nhận thư mục.
  - Bắt buộc phải có `<file>.fbx.meta` bên cạnh — tức là chỉ chạy được SAU khi Cocos đã import.
- **`audio.optimize`** (npm run sound:optimize)
  - Mặc định là dry-run; phải thêm `--write` mới ghi đè.
- **`assets.cleanup`** (npm run cleanup:unused)
  - NGUY HIỂM: asset vừa port nhưng chưa được scene/prefab nào tham chiếu sẽ bị liệt kê là unused.
  - KHÔNG chạy `--delete` ngay sau khi port.
- **`build.playable`** (npm run build)
  - Playable nên dưới 3.5 MB; verifier sẽ cảnh báo khi vượt.
