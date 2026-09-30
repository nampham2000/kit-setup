# Scene View (v3)

Unity-style Scene view chạy **bên trong** game đang chạy. Màn hình chia đôi:
game thật ở nửa trái (camera gốc giữ nguyên, chỉ bị đổi viewport), một camera
quan sát bay tự do ở nửa phải nhìn vào **cùng scene đang chạy**, kèm gizmo.

## Dùng lại ở project khác

Thư mục này **không phụ thuộc gì vào project**: chỉ import từ `cc` và `cc/env`,
không tham chiếu asset nào, không dùng layer tự định nghĩa. Chép nguyên thư mục
`assets/scene-view/` sang project khác là chạy.

Nhờ [AutoBoot.ts](AutoBoot.ts), **không cần tạo node hay kéo component gì cả** —
nó tự gắn vào mọi scene khi Play. Xoá đúng file đó nếu muốn quay lại cách gắn tay
(cần gắn tay khi muốn chỉnh property trong Inspector).

Ba cách đưa sang project mới:

### 1. Chép thư mục

Kéo `assets/scene-view/` vào `assets/` của project mới. Xong. Hợp khi chỉ thỉnh
thoảng dùng, nhưng sửa lỗi ở một project sẽ không lan sang project khác.

### 2. Git submodule (khuyến nghị)

Đẩy thư mục này thành một repo riêng, rồi ở mỗi project:

```bash
git submodule add <url-repo> assets/scene-view
```

Sửa một lần, `git submodule update --remote` ở các project còn lại là có bản mới.
**Nên commit cả file `.meta`** — giữ UUID ổn định giữa các project, đỡ bị Cocos
import lại mỗi lần.

### 3. Installer .bat (giống sync-tools của playable-shared-kit)

`tools/scene-view-installer/install-scene-view.bat` — thả vào gốc project rồi chạy:

```
install-scene-view.bat <đường-dẫn-hoặc-git-url>
```

Nó chép script vào đúng chỗ **và tự bật `geometry-renderer`** nếu project đã tắt,
nên không còn bước thủ công nào. Điền `SCENE_VIEW_REPO` ở đầu file là bat tự
`git clone` — lúc đó chỉ cần đúng một file cho mọi project.

### Điều kiện duy nhất ở project mới


Cần **Geometry Renderer**. Cách 3 tự bật hộ; hai cách kia thì bật tay ở
`Project → Project Settings → Feature Cropping`. Thiếu nó là mất toàn bộ gizmo
(split screen và chọn object vẫn chạy), Console sẽ báo.

## Cách dùng

Bấm Play. `F1` để bật/tắt. Không cần làm gì thêm — `AutoBoot.ts` tự gắn vào scene.

**Muốn chỉnh property** (tỉ lệ chia, bật/tắt từng loại gizmo, `Show Panels`…) thì
gắn tay để có chỗ chỉnh trong Inspector:

1. Tạo một node rỗng, tên `__Debug__`.
2. Kéo `SceneViewDebug` vào node đó.

Bản gắn tay được ưu tiên; `AutoBoot` thấy đã có sẵn thì tự đứng ngoài.

(Tuỳ chọn) Kéo thêm `DemoContent` nếu scene đang trống và muốn có vật thể để nhìn.

## Điều khiển

| Phím | Tác dụng |
|---|---|
| **Chuột trái** | **Chọn object dưới con trỏ** |
| **`F`** | **Focus camera vào object đang chọn** |
| **`Esc`** | **Bỏ chọn** |
| **Kéo tay cầm màu** | **Di chuyển / xoay / scale object đang chọn** |
| **`1` `2` `3` `4`** | **Đổi công cụ: move / rotate / scale / không gizmo** |
| **Bấm nút ở dải bên trái** | **Đổi công cụ bằng chuột** |
| **Kéo thanh dọc giữa 2 màn** | **Chỉnh tỉ lệ hai viewport** |
| Giữ chuột phải | Xoay góc nhìn |
| `W` `A` `S` `D` | Di chuyển |
| `Q` / `E` | Xuống / lên |
| Giữ chuột giữa | Pan |
| Cuộn chuột | Dolly tới/lui |
| `Shift` | Di chuyển nhanh |
| `F1` | Bật/tắt scene view |

Chuột trái chỉ ăn trong nửa phải (scene viewport); kéo rê thì không tính là click.

## Gizmo

- Lưới mặt đất XZ, hai trục X/Z được tô đỏ và lam
- Trục world ở gốc toạ độ — **mặc định tắt** (`Show World Axes`), vì nó đè lên
  vật thể nào nằm ở gốc
- Wireframe AABB của mọi `MeshRenderer` đang bật
- Frustum của camera **đang được chọn** — thấy đúng vùng người chơi nhìn thấy.
  Chỉ hiện khi chọn camera, giống Unity. Vẽ frustum của mọi camera cùng lúc thì chúng
  phủ kín cảnh, và camera UI (trực giao) đóng góp một cái hộp to bằng cả canvas —
  che kín tầm nhìn nên rất khó ngắm. (Chúng chỉ là đường vẽ, không tham gia picking —
  không chắn được tia click, chỉ che mắt.) Muốn thấy hết thì bật `Show All Frustums`.
- Object đang chọn: AABB cam + trục local của nó
- UI đang chọn: khung cam quanh phần tử + dấu thập ở pivot, y như object 3D. Trước đây
  node UI không có mesh nên chỉ nhận một dấu thập bé xíu ở gốc, đọc thành "chưa chọn gì".

Bật/tắt từng loại qua property trên component.

## Kéo chỉnh tỉ lệ hai màn

Thanh dọc ở ranh giới hai viewport, kéo được như giữa Scene/Game của Unity.
Giới hạn 10%–90%. Property `Show Splitter`.

Thanh là DOM chứ không vẽ bằng engine, vì nó phải bắt được chuột khi con trỏ đang
ở trên bất kỳ viewport nào, và thao tác kéo nó không được nhầm thành kéo camera hay
kéo gizmo. Dùng pointer capture để kéo không chết khi con trỏ rời khỏi thanh 7px.

Khi tỉ lệ đổi, **bốn** chỗ phải cập nhật cùng lúc: rect của các camera game, rect
của camera quan sát, vùng nhận chuột của free-look, và ngưỡng viewport của picker.
Tất cả đọc chung một giá trị `_split`.

## Bảng công cụ bấm chuột

Dải nút dọc ở mép trái của scene viewport, giống Scene view của Unity. Bấm để đổi
công cụ, nút đang chọn sáng xanh. Property `Show Tool Palette`.

Dải nút bám theo ranh giới hai viewport chứ không bám cửa sổ, nên kéo thanh chia
thì nó đi theo.

Thứ tự nút xếp theo **số phím (1–4)**, không theo thứ tự của Unity (Unity để bàn
tay trước). Một dải nút mà vị trí không khớp với con số in ngay trong tooltip của
chính nó thì khó dùng hơn là không giống Unity y hệt.

Icon vẽ bằng SVG inline chứ không dùng ký tự font: font monospace không có ký tự
nào đọc ra "xoay", và fallback font sẽ khác nhau tuỳ máy.

## Gizmo kéo: di chuyển / xoay / scale
Chọn object rồi kéo tay cầm, theo **trục local** giống Unity ở chế độ Local. Tay
cầm sáng vàng khi rê chuột lên. Property `Enable Transform Gizmo`.

| Phím | Công cụ | Hình dạng |
|---|---|---|
| `1` | Di chuyển | 3 cần trục, đầu hình chữ thập |
| `4` | Không gizmo | không vẽ gì, khỏi lỡ tay nắm tay cầm |
| `2` | Xoay | 3 vòng tròn quanh 3 trục |
| `3` | Scale | 3 cần trục, đầu khối vuông đặc |

Dùng phím số chứ không phải `W`/`E`/`R` như Unity, vì ở đây `WASD` luôn bay camera
— Unity chỉ bật `WASD` khi đang giữ chuột phải nên mới rảnh `W`/`E`/`R`.

Hit-test và kéo đều chạy ở **không gian màn hình**, không phải ray cắt khối 3D:

- `worldToScreen` và `screenPointToRay` của Cocos trả cùng hệ device-pixel đã trừ
  viewport, đúng hệ với toạ độ chuột — nên chiếu tay cầm ra 2D rồi so khoảng cách
  điểm-đoạn thẳng là chính xác tuyệt đối, không cần collider.
- **Di chuyển / scale**: chiếu vector chuột lên vector trục (2D), ra tỉ lệ `t` của
  chiều dài tay cầm. Di chuyển nhân `t` với chiều dài thật; scale nhân trục với
  `1 + t`, tức kéo hết một tay cầm thì gấp đôi. Tự đúng tỉ lệ ở mọi khoảng cách.
- **Xoay**: lấy góc `atan2` của con trỏ quanh tâm đã chiếu, xoay theo độ lệch góc
  giữa hai frame. Bước nhảy được chuẩn hoá về phía ngắn để đi qua ±π không bị quay
  vòng. Chiều xoay đảo dấu khi trục chĩa ra xa camera, nếu không thì nửa vòng phía
  sau sẽ kéo ngược.

Hai trường hợp suy biến đã chặn:

- Trục chĩa gần thẳng vào camera → đoạn 2D ngắn lại, bỏ qua frame đó thay vì nhân
  ra giá trị điên rồ.
- Điểm chiếu nằm sau camera (`z` ngoài 0–1) bị loại, vì phép chia phối cảnh lật
  ngược kết quả. Với vòng xoay chỉ **bỏ đoạn hỏng** chứ không bỏ cả vòng — lúc
  camera ở gần thì phần lớn vòng vẫn nằm trên màn hình và vẫn nắm được.

Tay cầm dài theo khoảng cách tới camera nên nhìn luôn cùng cỡ trên màn hình.
Đổi công cụ giữa lúc đang kéo sẽ kết thúc thao tác kéo, tránh diễn giải lại cùng
một cú kéo bằng công thức khác.

## Chọn UI

Click vào UI trong scene viewport cũng chọn được, giống như vật thể 3D.
Property `Enable UI Picking`, mặc định bật.

UI là screen-space nhưng **vẫn tồn tại trong world**: `UITransform.getComputeAABB()`
trả về hộp bao world-space thật, nên cùng một tia ray tìm được cả mesh lẫn UI —
không cần cơ chế riêng.

Camera quan sát **không render layer UI** (UI screen-space nhìn từ góc bất kỳ là vô
nghĩa), nên viewport vẽ **khung viền xanh** cho từng phần tử UI. Đó là thứ duy nhất
để bạn ngắm mà bấm.

Chỉ node có `UIRenderer` (Sprite, Label…) được tính. Node layout rỗng và node Canvas
gốc có hộp bao trải hết design resolution, tính vào thì chúng nuốt mọi cú click nhắm
vào thứ nằm bên trong.

**Mesh được ưu tiên, UI chỉ là phương án dự phòng.** Một cú trúng mesh là chính xác
tới từng tam giác; còn canvas screen-space to cỡ design resolution tính bằng đơn vị
world, nên một sprite nền full-screen sẽ trả lời mọi cú click trong viewport nếu UI
được xét trước. UI chỉ nhận click ở chỗ không có mesh nào dưới con trỏ.

Khi nhiều phần tử UI chồng nhau thì **phần tử nhỏ nhất dưới con trỏ thắng** — nút nằm
trên panel nằm trên nền. Không dùng sibling index vì nó vô nghĩa giữa các nhánh không
liên quan, và cũng không dùng khoảng cách vì canvas phẳng nằm ở đâu là do nó đặt.

Node thuộc layer của editor (`GIZMOS`, `EDITOR`, `SCENE_GIZMO`, `PROFILER`) bị loại
khỏi danh sách UI. Preview chạy chung scene graph với editor nên các node như
`internal/editor/grid-2d` có mặt lúc runtime, và nếu không lọc thì hộp bao khổng lồ
của chúng sẽ lọt vào tia ray.

### Điều cần biết trước khi bật

Canvas screen-space có kích thước bằng **design resolution**, ví dụ 960×640 **đơn
vị world**. Cạnh một capsule 1 đơn vị thì khung UI sẽ **to khủng khiếp** và có thể
lấp cả khung nhìn. Unity cũng đúng như vậy với Screen Space Canvas. Thấy vướng thì
tắt `Enable UI Picking`.

`UITransform.hitTest()` là đường còn lại, nhưng nó phân giải qua camera UI nên chỉ
trả lời cho nửa game, không dùng được cho viewport quan sát.

## Picking hoạt động thế nào

Hai pha, không cần collider và không cần module Physics:

1. **Broad phase** — `intersect.rayAABB` trên bounding box của từng `MeshRenderer`.
   Rẻ, loại gần hết ứng viên. Box nào xa hơn hit tốt nhất hiện tại thì bỏ qua luôn.
2. **Narrow phase** — `intersect.rayModel` với `ERaycastMode.CLOSEST` trên số còn lại,
   cho kết quả chính xác tới từng tam giác.

Nếu mesh tắt `allowDataAccess` thì narrow phase ném lỗi; lúc đó rơi về khoảng cách
AABB thay vì bỏ qua object.

## Chọn object → nhảy thẳng sang Hierarchy / Inspector của editor

Mặc định, click vào vật thể ở scene view sẽ **chọn đúng node đó trong panel
Hierarchy thật của Cocos Creator**, và Inspector thật hiện thông số — thay vì bảng
nổi trên màn hình. Chiều ngược lại cũng chạy: chọn node trong Hierarchy thì scene
view highlight theo (poll mỗi `Rescan Interval` giây).

Làm được là nhờ Preview trong editor chạy ngay trong **scene process** của editor —
cùng ngữ cảnh sở hữu scene graph, cũng chính là lý do gizmo editor lọt vào runtime.
Ngoài ngữ cảnh đó (preview trên browser, bản build thật) thì không có editor, mọi
lệnh thành no-op, và bạn bật `Show Panels` để dùng overlay DOM thay thế.

Property liên quan:

| Property | Mặc định | Ý nghĩa |
|---|---|---|
| `Sync Editor Selection` | bật | Đẩy selection sang editor |
| `Show Panels` | **tắt** | Overlay Hierarchy/Inspector tự vẽ, dùng khi không có editor |

### Nếu nó không chạy

API selection của editor không nằm trong typings của engine và đã bị minify trong
bản build, nên `EditorBridge` **dò khả năng lúc chạy** rồi log đúng một dòng:

```
[SceneView] editor selection route: Editor.Selection.select, reverse sync on
```

Nếu dòng đó báo `no editor host` hoặc route khác với mong đợi, đưa nguyên dòng log
đó thì sẽ biết chính xác phải nối vào API nào.

## Panel Hierarchy + Inspector
Overlay DOM ở cạnh phải, hai thẻ:

**Hierarchy** — cây node của scene. Click chọn, nút `o` ẩn/hiện, nút `S` solo.
Cây chỉ dựng lại khi cấu trúc thật sự đổi; dựng mỗi frame sẽ reset scroll và huỷ
mất chính cái dòng con trỏ đang bấm.

**Inspector** (chỉ khi bật `Show Panels`) — sửa trực tiếp position / rotation / scale / active của node đang
chọn. Giá trị được đẩy vào ô mỗi frame để vật thể đang animate hiện đúng, **trừ ô
đang gõ**. Commit khi `change` (blur hoặc Enter), không phải mỗi lần gõ, nên `-`
hay `1.` dở dang không bị parse thành số. Ô không parse được thì giữ giá trị cũ,
không thành `NaN`.

Tắt cả hai bằng property `Show Panels`.

## Ẩn / Solo ảnh hưởng cả game view

Cocos cull theo **layer**, không theo từng object cho từng camera
(`scene-culling`: model hiện khi `(visibility & node.layer) === node.layer` hoặc
`visibility & model.visFlags`). Không có công tắc per-object-per-camera, nên không
thể ẩn riêng trong scene viewport — nửa trái cũng mất object đó.

Đổi lại, code tắt `MeshRenderer.enabled` chứ không tắt `node.active`: dừng vẽ
nhưng **không** dừng script, physics hay node con, nên game vẫn chạy trong lúc bạn
quan sát. Mọi thay đổi được khôi phục nguyên trạng khi đóng scene view.
## Yêu cầu

Gizmo cần module **Geometry Renderer**. Nếu console báo
`[SceneView] GeometryRenderer unavailable`, bật ở
`Project → Project Settings → Feature Cropping → Geometry Renderer`.
Split-screen vẫn chạy bình thường kể cả khi thiếu module này.


## Giới hạn hiện tại (hết v3)

- Camera UI (`UI_2D` / `UI_3D`) bị loại khỏi scene view — UI là screen-space nên
  render trong viewport quan sát sẽ vô nghĩa. UI vẫn hiện đúng ở nửa trái.
- Click trong viewport chỉ trúng `MeshRenderer`. Light, camera, node rỗng phải chọn
  từ cây Hierarchy.
- Ẩn/Solo ảnh hưởng cả game view (xem mục trên).
- Gizmo chỉ theo trục local, chưa có chế độ World, chưa có snap theo lưới.
- Component tự huỷ khi `DEBUG` là false, nên không lọt vào bản release.

## Cấu trúc

| File | Vai trò |
|---|---|
| `SceneViewDebug.ts` | Component chính: split screen, vòng đời, hotkey, điều phối |
| `FreeCamera.ts` | Camera bay tự do kiểu editor |
| `SceneGizmos.ts` | Grid, trục world, AABB, frustum, highlight selection |
| `ScenePicker.ts` | Ray picking hai pha |
| `TransformGizmo.ts` | Cần trục kéo di chuyển, hit-test screen-space |
| `ViewSplitter.ts` | Thanh kéo chia tỉ lệ hai màn |
| `ToolPalette.ts` | Dải nút chọn công cụ, vẽ bằng hình học |
| `ScreenDraw.ts` | Vẽ screen-space bằng GeometryRenderer |
| `EditorBridge.ts` | Đẩy selection sang Hierarchy/Inspector thật của editor |
| `DebugOverlay.ts` | Gốc DOM dùng chung + CSS + bookkeeping input (fallback) |
| `HierarchyPanel.ts` | Cây node, nút ẩn/solo |
| `InspectorPanel.ts` | Inspector sửa được giá trị |
| `VisibilityController.ts` | Trạng thái ẩn/solo và khôi phục |
| `AutoBoot.ts` | Tự gắn vào mọi scene; xoá file này để tắt |
| `InputProbe.ts` | Chẩn đoán kênh input (bật qua `Debug Input`) |
| `DemoContent.ts` | Tuỳ chọn: spawn vật thể để test |
## Lưu ý: Preview trong editor dùng chung scene graph

Panel **Preview** của Cocos Creator chạy trong chính process của editor, nên gizmo
của editor (cụm mũi tên X/Y/Z dưới `Editor Scene Foreground / gizmoRoot`) là **node
thật trong scene graph đang chạy**. Nếu không lọc, chúng sẽ hiện trong scene view,
bị vẽ bounding box, và click chọn được.

Vì vậy `SCENE_VISIBILITY` loại các layer `GIZMOS`, `EDITOR`, `SCENE_GIZMO`,
`PROFILER`, `UI_2D`, `UI_3D`, và danh sách renderer cũng lọc theo đúng mask đó.

Cùng lý do, node `__SceneViewCamera__` được gắn cờ `DontSave | HideInHierarchy`
để không bị ghi vào file `.scene` nếu bạn Ctrl+S lúc đang Preview.

## Input: vài chỗ Cocos web hay cắn nhau với DOM overlay

Đọc từ `pal/input/web`:

- `mousedown` đăng ký trên **canvas**, nhưng `mouseup` đăng ký cả trên **window**.
  Nhả chuột trên panel vẫn lọt vào engine, nên picker phải bỏ qua khi con trỏ đang
  ở trong panel (`DebugOverlay.cursorInside`).
- `keydown`/`keyup` đăng ký trên **canvas**, nên gõ vào ô nhập không lọt vào game.
  Nhưng phím đang giữ lúc focus nhảy sang ô nhập sẽ **không bao giờ nhận keyup** và
  bị kẹt — vì vậy có `FreeCamera.clearKeys()` gọi từ `focusin`.
- `.sv-root` phải `pointer-events: none`, chỉ card mới nhận chuột; nếu không, khoảng
  trống giữa các card thành vùng chết nuốt thao tác xoay camera.

## Toạ độ: đừng bao giờ dùng `screen.windowSize` để kiểm tra viewport

Từng có bug: click chọn và thanh kéo **chỉ chạy trên browser, chết trong Preview
panel của editor**. Nguyên nhân là ngưỡng viewport tính bằng
`screen.windowSize.width * fraction`.

`screen.windowSize` là kích thước **vật lý của cửa sổ**. Còn `camera.width` là kích
thước **render window mà camera dùng** — chính là đại lượng mà `screenPointToRay` và
`worldToScreen` chuẩn hoá theo, và cũng là hệ mà toạ độ chuột nằm trong đó.

Trên browser hai giá trị trùng nhau nên không lộ. Preview panel của editor render
theo Design Resolution riêng nên chúng lệch, ngưỡng rơi sai chỗ, và **mọi click
trong viewport bị từ chối im lặng** — không lỗi, không log, chỉ là không có gì xảy ra.

Kết luận: luôn lấy ngưỡng từ `camera.camera.width * camera.rect.x`
(`ScenePicker.viewportMinX`). Như vậy hit-test khớp với phép chiếu **theo thiết kế**,
chứ không phải nhờ may mắn hai con số bằng nhau.

Property `Debug Input` in ra toàn bộ các hệ toạ độ lúc mở scene view, kèm phần tử
đang nằm trên cùng ở vị trí thanh kéo. Tắt đi khi đã chạy ổn.

## Preview trong editor KHÔNG gửi sự kiện DOM

Đây là ràng buộc định hình cả công cụ. Đo bằng `InputProbe` (bật `Debug Input`),
click một cái trong Preview panel của editor:

```
cc MOUSE_MOVE / MOUSE_DOWN / MOUSE_UP / KEY_DOWN     ✓ tới nơi
window pointerdown / window mousedown                ✗ không
canvas mousedown / overlay pointerdown               ✗ không
```

Panel Preview bơm input **thẳng vào engine**, không đi qua DOM của tài liệu đang
hiển thị. Bản build native thì còn không có `document` để mà vẽ.

Nên **thanh kéo và bảng công cụ không dùng DOM chút nào**: vẽ bằng
`GeometryRenderer`, bắt chuột bằng input Cocos. Pixel của camera là hệ toạ độ duy
nhất, nên phần vẽ và phần hit-test không thể lệch nhau. Chạy giống hệt ở editor,
browser và native.

### Vẽ screen-space bằng hình học 3D

`GeometryRenderer` chỉ nói được world space. `ScreenDraw.ts` đẩy từng điểm màn hình
ngược ra thế giới qua `screenToWorld` ở **một độ sâu cố định**. Vì mọi góc của một
hình đều quy đổi ở cùng độ sâu, phép chia phối cảnh triệt tiêu và kết quả đúng bằng
hình chữ nhật màn hình yêu cầu. Tắt depth test nên luôn nằm trên cảnh.

Mặt đặc được vẽ **cả hai chiều xoay đỉnh**, vì material của geometry renderer có thể
cull mặt sau, và chiều nào là mặt trước còn tuỳ camera — thêm vài tam giác rẻ hơn
nhiều so với một UI thỉnh thoảng tàng hình.

Icon là **line art**, không phải font hay SVG: geometry renderer không vẽ được chữ
lẫn ảnh.

### Thứ tự batch: tam giác luôn vẽ sau đường thẳng

`GeometryRenderer` giữ đường thẳng và tam giác ở **hai batch riêng**, và nộp toàn bộ
tam giác **sau** toàn bộ đường thẳng — bất kể bạn gọi theo thứ tự nào.

Hậu quả thực tế: nền đặc của bảng công cụ phủ lên icon vẽ bằng line, nút đang chọn
ra trắng trơn không có icon, các nút còn lại thì icon bị nền làm mờ.

Nên **mọi thứ cần xếp chồng theo thứ tự đều phải là tam giác**. Icon vẽ bằng
`screenThickPath` — mỗi đoạn là một quad, kèm nắp vuông ở mỗi đỉnh để góc không bị
hở. Nét dày cũng đọc rõ hơn hẳn nét một pixel ở cỡ icon.

Đường thẳng vẫn dùng cho gizmo trong cảnh (lưới, AABB, cần trục) — chúng nằm dưới
bảng công cụ, mà đó đúng là điều mong muốn.

### Thứ còn lại dùng DOM

- **Thanh gợi ý phím** ở đáy — là chữ, mà geometry renderer không vẽ được chữ.
  Thiếu nó không sao, chỉ mất phần trợ giúp.
- **Panel Hierarchy/Inspector** (`Show Panels`, mặc định tắt) — cần ô nhập text
  thật. **Chỉ chạy trên browser.** Trong editor đã có Hierarchy/Inspector thật qua
  `EditorBridge`.

## Vòng đời camera quan sát: tạo một lần, không huỷ đi tạo lại

Tắt F1 rồi bật lại từng làm nửa phải **đen thui**. Nguyên nhân là vòng đời:
lần mở đầu tiên chạy trong lúc scene khởi tạo, các lần sau chạy từ callback input
giữa vòng update — một `Camera` dựng ra trong hai điều kiện đó không lên giống nhau.

Nên `close()` giờ chỉ **tắt** camera (`node.active = false`), không huỷ. `_ensureSceneCamera`
tạo đúng một lần rồi tái sử dụng, và chỉ `onDestroy` mới thật sự huỷ node.

Phần thưởng đi kèm: scene view **nhớ vị trí camera** giữa các lần bật tắt, vì node
không mất đi.

Kèm theo, `GeometryRenderer` được **thử lại mỗi frame** cho tới khi có. Camera phía
renderer có thể chậm hơn component một frame khi component được thêm giữa vòng
update; trước đây chỉ thử một lần rồi âm thầm mất sạch gizmo vĩnh viễn.
