# Kit changes — asset import gate, lints, scene porting

Rút ra từ lần port `AllIn1SpriteShader/Demo/Demo.unity` (305 GameObject, uber-shader
66 keyword) sang Cocos 3.8.8. Mỗi thay đổi ứng với một chỗ tool hiện tại **báo sai
chiều** — nói "sạch" trong khi thực tế hỏng, hoặc nói "0" trong khi thực tế là
"đã bỏ qua".

## 1. `verify.assets` — cổng kiểm tra Cocos có thực sự import được asset

`node playable-shared-kit/tools/verify-assets.cjs [--path <dir>] [--json]`
Đã nối vào `verify.all` thành check thứ 7.

Trả lời câu hỏi mà không check nào khác trả lời được: *editor có nhận asset không?*
tsc sạch, lint sạch, build exit 0 — playable vẫn trắng màn hình nếu importer từ chối.
Nguồn sự thật là `"imported": false` trong `.meta`, và lý do nằm trong
`temp/logs/project.log` (KHÔNG có trong `temp/asset-db/log/`).

Ca thật: một `.effect` dùng `#define _MainTex MainTex` bị từ chối bằng
`Error EFX2300: sampler '_DistortTex' does not exist`. Trước đây phải mò log tay.

Giới hạn: log của editor bị xoay vòng khi khởi động lại, nên đôi khi chỉ báo được
"chưa import" mà không có message.

## 2. Hai lint mới trong `zero-gc-linter`

| Rule | Chế độ hỏng nó chặn |
| --- | --- |
| `COCOS_MULTIPLE_COMPONENTS` | Nhiều `Component` trong một `.ts` làm Cocos báo *"Each script can have at most one Component"* và **sập toàn bộ module graph** — mọi component khác cũng biến mất khỏi registry, không chỉ file vi phạm. Đo được: 6 component trong 1 file → 0/14 component đăng ký được. |
| `RESOURCE_PATH_NOT_FOUND` | `resources.load('x')` với `x` không nằm dưới `assets/resources/`. Builder loại asset khỏi bundle vì không scene/prefab nào tham chiếu; build vẫn exit 0, runtime trắng màn hình. Có xử lý hậu tố sub-asset (`foo/texture` → `foo.png`). |

## 3. `verify.runtime`

- **Mặc định chọn `build/common/`** thay vì file mới nhất theo mtime. Bản build cho
  từng ad network (applovin/facebook/...) *luôn* console.error vì thiếu SDK host, nên
  mặc định cũ gần như chắc chắn FAIL oan. Ưu tiên bản không minify để stack trace đọc được.
- **`--window-size <WxH>`** (mặc định `720x1280`). Nguồn Unity landscape không có cách
  nào chụp so sánh với khung dọc cứng.

## 4. `port.plan`

- **`skippedVendorDirs` luôn được báo ra.** `VENDOR_DIRS` chứa `demo` và `samples`, nên
  khi port chính một package asset store (`AllIn1SpriteShader/Demo/Demo.unity`) toàn bộ
  nội dung bị loại và report ra `scenes: 0` — đọc như "không có scene".
- **`--include-vendor`** để tắt hẳn việc bỏ qua.
- **Đếm material nhúng và GameObject** trong `.unity`/`.prefab`. Cách đếm cũ chỉ tính file
  `.mat`; Demo.unity có **91 material nhúng và 0 file .mat**. Đường đọc text cũ bị chặn ở
  400KB (scene này 1.7MB) nên phần đếm này quét theo byte, không giới hạn kích thước.

Trước/sau trên cùng một nguồn:

| | trước | sau (`--include-vendor`) |
| --- | --- | --- |
| scenes | 0 | 2 |
| materials | 3 | 15 + **119 nhúng** |
| animations | 0 | 27 |
| GameObjects | (không đếm) | 337 |

## 5. `port.scene` — port scene theo mô hình placeholder-then-wire

`npm run port:scene -- --scene <file.unity> --unity-root <Assets> --out assets/<Name>.scene`

Kit port được prefab nhưng **không có đường nào cho `.unity`**. Tool này chia đôi công việc:

1. Tool sinh phần **không cần UUID**: cây node, transform, active, và component Cocos
   có sẵn tương đương (`cc.Camera`, `cc.Label`, `cc.Sprite` rỗng, `cc.UITransform`).
2. Tool **không đoán asset**. Mọi tham chiếu để trống và đi vào `<Name>.wiring.json`.
3. Agent đọc wiring rồi nối qua cocos-mcp hoặc sửa scene trực tiếp.

Lý do tách: nối UUID là chỗ port prefab dễ vỡ nhất (`port.prefab` cần Cocos Creator đang
mở mới nối được UUID sub-asset). Sinh hình học trước thì bước sinh không phụ thuộc editor,
còn bước nối thì có sẵn toàn bộ ngữ cảnh Unity trong wiring.

Wiring gom việc **theo asset**, không theo node: 171 label dùng chung một font là **1 việc**,
không phải 168. Trên Demo.unity: 694 tham chiếu → **75 việc thật**, xếp theo số node ảnh hưởng.

Kết quả đo trên Demo.unity: 305 node / 1 camera / 105 sprite / 171 label — khớp Unity
tuyệt đối; scene sinh ra **import sạch vào Cocos** (`imported: true`), 0 tham chiếu treo,
0 lệch parent/child.

## 6. `tools/lib/unity-yaml.cjs` — parser Unity YAML dùng chung

Chứa bản sửa quan trọng: **fileID của Unity có thể dài 19 chữ số**, vượt
`Number.MAX_SAFE_INTEGER`. Parser nào chạy `parseInt` trên mọi số nguyên sẽ làm tròn
im lặng và mọi tham chiếu tới các object đó bị treo — trên Demo.unity là **8/305
GameObject biến mất không báo lỗi**. Parser này giữ số nguyên không an toàn ở dạng chuỗi.

## 7. `shader.validate` — bỏ false positive, thêm check thật

Trên một effect viết tay, gate cũ trả về **1 FAIL giả + 35 warning giả + 0 phát hiện thật**.
Ba nguyên nhân, đã sửa cả ba:

| Trước | Sau |
| --- | --- |
| Hardcode tên program `vs`/`fs` (`cli-batch-engine.cjs:119`) → 4 lỗi trên mọi effect đặt tên khác | Đọc `vert:`/`frag:` từ technique, giải ra program tương ứng và kiểm tra entry mà nó khai báo |
| Không hiểu cú pháp `target:` của CCEffect → 34 cảnh báo `UBO_MEMBER_UNBOUND` giả | `checkPropertyBinding` đọc `target:`; property ghi vào lát cắt vec4 được tính là đã bind |
| Không tính `#define` có sẵn → báo "Residual `_Time.y`" trên một shim cố ý | Mỗi residual check khai báo symbol nó phụ thuộc và bỏ qua khi symbol đó được `#define` trong file |

Và thêm **`EFX2300_ALIASED_SAMPLER`** — check duy nhất thực sự quan trọng mà gate cũ
không có: `texture()` gọi lên một tên là `#define` alias thay vì sampler đã khai báo.
Đây chính là lỗi làm effect không import được. Chỉ ca alias là ERROR; tên lạ mà không
được `#define` chỉ là warning (nhiều khả năng đến từ `#include` không nhìn thấy được).

Kết quả trên effect thật: FAIL(giả) → **PASS**. Trên fixture tái hiện lỗi: **FAIL, exit 5**,
kèm câu lệnh sửa. 58/58 test có sẵn vẫn xanh.

## 8. Lớp tương thích HLSL + ba lỗi hạ mã

`compat/unity-compat.glsl` chứa `texU`, `hmod`, `rotRow`/`rotCol`, `sat`, `CLIP` —
được **inline** vào program nào thực sự dùng (không dùng `.chunk` vì phân giải chunk
phụ thuộc vị trí file trong asset db của từng project).

Ba lỗi hạ mã đã sửa trong `unity-semantic-lowering`:

1. **Toán tử `%` trên float không được xử lý.** GLSL chỉ cho `%` với số nguyên, nên
   `((t + seed) * speed) % 1` là **lỗi biên dịch**, không phải chỉ khác kết quả. Giờ hạ
   thành `hmod()`. Chỉ nhận dạng vế trái là nhóm ngoặc hoặc lời gọi hàm, nên `i % 2`
   trong vòng lặp không bị đụng.
2. **`fmod()` hạ thành `mod()`** — sai dấu khi toán hạng âm (scroll speed âm là thường).
   Giờ hạ thành `hmod()`.
3. **Constructor ma trận không chuyển vị.** HLSL `float2x2(c,-s,s,c)` nhận theo HÀNG,
   GLSL `mat2` theo CỘT — hai ma trận chuyển vị của nhau, nên mọi `mul()` phía sau đều
   sai mà vẫn compile sạch. Chuyển vị ngay tại constructor thì cả `mul(M,v)` lẫn
   `mul(v,M)` tự khắc đúng.

`--unity-uv` (mặc định TẮT) bật lấy mẫu qua `texU()`. Tắt mặc định vì bật lên sẽ đổi
hình của mọi effect đã sinh trước đó, và shader toàn màn hình không có quy ước UV mesh
để mà hiệu chỉnh.

Đo trên AllIn1SpriteShader: 37 `texU`, 18 `hmod`, `mat2` chuyển vị đúng, confidence giữ
nguyên 80/100 với đúng một lỗi có sẵn.

> Ghi chú quá trình: bản `%` đầu tiên xử lý sai trường hợp lồng nhau — vừa quét vừa nối
> chuỗi nên sau lần thay đầu tiên các chỉ số cũ trỏ vào văn bản đã đổi, làm nhân đôi đoạn
> và mất ngoặc. `shader.validate` bắt được ngay bằng `GLSL_UNBALANCED_BRACKET`. Bản sửa
> thay đúng một toán tử mỗi lượt rồi quét lại từ đầu.

## 9. Bốn defect hạ mã còn tồn + đóng gói scalar vào vec4

`shader.convert` trên AllIn1SpriteShader: **80/100 Grade B, FAIL → 100/100 Grade A, PASS.**
Bốn lỗi, cả bốn đều sinh ra GLSL không compile được mà không có gate nào bắt:

| Defect | Sinh ra | Vì sao sai |
| --- | --- | --- |
| Ghi vào attribute | `a_position += (...)` | HLSL `v.vertex.xyz += ...` hợp lệ vì `v` là bản sao struct; `in` trong GLSL ES 3.0 chỉ đọc. Giờ hạ vào `pos.xyz` (prologue đã khai báo sẵn `vec4 pos`). |
| Ghi vào varying | 18 lệnh `v_uv += ...` trong fs | Cùng lý do. Giờ sinh bản sao cục bộ `vec2 v_uv_rw = v_uv;` — chỉ cho varying thực sự bị ghi. |
| Cast kiểu C | `(mat3)inverse(cc_matView)` | GLSL không có cast kiểu C. Nhánh cast trong `mul()` chỉ khớp `(float3x3)<định danh>`, nên toán hạng là lời gọi thì lọt. Giờ mọi `(matN)expr` thành `matN(expr)`. |
| Gán ghép vào trường output | `o.uv += center;` sống sót | Bộ remap struct→varying chỉ khớp `=`, không khớp `+=`. Giờ khớp `[-+*/]?=`, và thêm remap cho phần ĐỌC trường output. |

Hai check mới chặn tái phát: **`GLSL_WRITE_TO_INPUT`** (gán vào biến `in`) và
**`GLSL_DEFINE_SHADOWS_LOCAL`**.

**Đóng gói scalar vào vec4** giờ đã có trong `shader.convert`, tự bật khi số scalar
vượt 24 (`--packScalarsThreshold`). Trên AllIn1SpriteShader: UBO từ hơn 100 `float`
rời còn **72 member toàn vec4 (1152 byte)**, 138 scalar nằm trong 70 lát cắt, mỗi cái
được phơi lại qua `target:` nên material vẫn gọi bằng tên property.

> Cạm bẫy đã xử lý: alias `#define alpha pack0.x` gặp biến cục bộ `float alpha` sẽ nở
> thành `float pack0.x = ...`. AllIn1SpriteShader có đúng ca này (`_Alpha` và biến
> `alpha` trong nhánh HOLOGRAM). Token sau khi hạ mã là một, không tách được — nên
> việc đổi tên làm trên **HLSL gốc**, nơi `_Alpha` và `alpha` còn là hai token khác
> nhau. Nếu vẫn còn đụng độ thì tự tắt packing, quay về scalar rời.

## Điểm tôi đã báo sai và rút lại

`playable-build` **không** nuốt lỗi: `fail()` gọi `process.exit(1)` và top-level catch
định tuyến mọi exception qua đó. Số `0` quan sát được là exit code của `| tail` trong
lệnh shell, không phải của tool. Không có thay đổi nào ở đây.

## Giới hạn còn lại (đã biết, không phải bug)

- Hạ `mul()` cho ma trận **không** dựng bằng constructor (đọc từ uniform hoặc biến) vẫn
  giả định thuận cột. Đúng khi ma trận đến từ engine; ma trận Unity truyền vào qua
  property thì phải tự chuyển vị.
- Sampler vẫn được khai báo vô điều kiện, nên uber-shader báo cảnh báo 13 sampler
  (giới hạn WebGL1 là 8). Bản viết tay giải bằng cách bọc `#if` quanh từng sampler theo
  macro tương ứng; bộ sinh chưa suy ra được ánh xạ sampler→macro đó.
- `shader.validate` là phân tích tĩnh: chứng minh được là SAI, không chứng minh được là
  ĐÚNG hình ảnh. Vẫn phải xem `verify.assets` (editor có nhận không) và
  `verify.runtime` (có vẽ ra gì không).
