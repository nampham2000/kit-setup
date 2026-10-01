# Scene View (v3)

Unity-style Scene view chạy **bên trong** game đang chạy. Màn hình chia đôi:
game thật ở bên trái (camera gốc giữ nguyên, chỉ bị đổi viewport), một camera
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
| **Double-click** | **Bay tới object dưới con trỏ** |
| **`F`** | **Focus camera vào object đang chọn** |
| **`U`** | **Bật/tắt vẽ UI trong viewport** |
| **`G`** | **Bật/tắt theo dõi Hierarchy (mặc định bật): chọn node ở đó thì camera bay tới** |
| **`I`** | **Bật/tắt log debug (kết quả mỗi cú click)** |
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

### Game view thu nhỏ đúng hình dạng, không bị cắt

Camera game **không** bị bóp chiều ngang. Trước đây rect là `(0, 0, split, 1)`: Canvas UI vẫn bố
cục theo cả cửa sổ nên nửa phải của game rơi ra ngoài viewport và bị cắt. Giờ cả hai chiều
thu cùng hệ số `split`, nên game giữ nguyên tỉ lệ cửa sổ, thấy trọn vẹn, căn giữa theo chiều
dọc (hàm `gameRect`). Hai dải trên/dưới game do một camera nền (`__SceneViewBackdrop__`, con của
camera quan sát nên không hiện trong Hierarchy) xóa sạch, nếu không chúng giữ lại hình của
frame trước.

**Game tự đặt `camera.rect` thì sao?** Nhiều game làm vậy (SmashFest tự letterbox game dọc
trong cửa sổ ngang, rect `[0.313, 0, 0.374, 1]`) và ghi đè rect mà tool đặt một lần. Nên mỗi frame,
ngay trước khi vẽ (`EVENT_BEFORE_DRAW`), tool so rect hiện tại với rect nó đã đặt; khác thì coi giá trị
đó là ý của game và thu nhỏ lại. Camera nào game tạo thêm **sau khi** mở tool chưa được nhận.
Đã đo trên SmashFest: chọn iPhone 14 Pro, Rotate, kéo thanh chia, rect đều đúng.

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
| `5` | Collider | tay cầm ngay trên khung collider của node đang chọn, kéo để chỉnh |
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

## Bay tới object (double-click, phím F)

Double-click vào một object trong scene viewport thì camera **lướt tới** nó, giữ nguyên
hướng nhìn, giống lệnh Frame của Unity. Phím `F` làm đúng việc đó với object đang chọn.

- **Khung hình theo nội dung, không theo pivot.** Bounds được gộp từ *cả nhánh* node
  (model renderer và UI đang vẽ), nên bay tới một node cha như `Background` hay `Canvas`
  thì khung đúng cả cụm chứ không chỉ một điểm. Trước đây chỉ đo renderer của chính node,
  node cha rơi về bán kính 1 ở pivot, còn node UI thì camera dừng *bên trong* một phần
  tử rộng hàng trăm đơn vị.
- Khoảng cách tính theo **góc nhìn hẹp hơn** trong hai chiều, nên vật cao trong viewport
  rộng (hoặc ngược lại) không tràn ra khỏi khung. Đích lớn hơn far plane thì far plane
  được nâng lên.
- Cú click thứ hai thường rơi đúng vào giữa object đã chọn, nơi các tay cầm move bắt đầu
  (chúng vẽ từ pivot). Từng coi đó là bắt tay cầm và nuốt mất cú click nên double-click gần
  như không bao giờ chạy. Giờ chỉ **kéo thật** mới tính là kéo; bấm trúng tay cầm mà không
  di chuyển vẫn là một cú click, và không làm mất selection nếu tia không trúng object.
- Hai cú click phải cùng trúng **một node** trong 400 ms; con trỏ lệch nhẹ giữa hai lần
  click không làm mất cử chỉ.

### Bay tới node chọn ở panel Hierarchy của editor: không double-click được

**Double-click ở panel Hierarchy không làm được, và đây là kết quả đo chứ không phải suy
đoán.** Mình nghe broadcast `selection:select` của editor, listener gắn thành công
(`listener yes`), rồi click vào nhiều node khác nhau ở Hierarchy: **không có một broadcast
nào tới**, kể cả với cú click thường đổi chọn. Nên vấn đề không phải "editor không phát lại
khi bấm node đang chọn" — process preview không nhận được sự kiện chọn nào từ editor cả.

Hệ quả: chọn cùng một node hai lần thì selection không đổi, polling không thấy gì, và không
còn kênh nào khác để nghe. Code của Hierarchy và package `scene` là file `.ccc` biên dịch sẵn
nên không đọc được cách chúng xử lý. Đã thử tìm API nội bộ (`cce.Camera`, `Camera.focus`,
`focusCamera`) trong toàn bộ asar: không có gì. Phần code nghe broadcast đã được gỡ.

Selection từ Hierarchy vẫn **đồng bộ được bằng polling** (đọc `Editor.Selection`), nên có ba
cách bay tới node:

- **Double-click ngay trong viewport** vào object — chắc chắn chạy.
- **Theo dõi Hierarchy (phím `G`, property `Focus On Editor Select`) — mặc định BẬT:** hễ chọn
  node khác ở Hierarchy thì camera lướt tới nó, trong vòng khoảng 0,15 giây. Bấm `G` để tắt nếu
  bạn không muốn camera di chuyển mỗi khi click ở Hierarchy. Hai chi tiết đã xử lý: lần đọc
  selection đầu tiên khi mở scene view chỉ đồng bộ chứ không bay (khỏi giật camera lúc Play),
  và sau khi chính bạn chọn trong viewport thì bỏ qua polling trong 400 ms (editor có thể còn
  báo node cũ, nhận nó về sẽ làm camera bay nhầm).
- Click vào viewport rồi bấm `F`. Bấm `F` ngay sau khi click ở Hierarchy nhiều khả năng không
  tới được preview vì bàn phím đang thuộc panel Hierarchy (chưa kiểm chứng).

## Khi game đang Pause, và khi chưa Play

### Pause

Cocos có **hai tầng pause** khác nhau, và scene view phải xử lý cả hai:

| | `director.pause()` | `game.pause()` |
|---|---|---|
| Vòng lặp chính | vẫn chạy | **dừng hẳn** (`_pacer.stop()`) |
| Render | vẫn render mỗi frame | **không còn frame nào** |
| `update` của component | không chạy | không chạy |

Nút Pause của Preview gọi **`game.pause()`** (đọc từ mã thanh công cụ preview:
`!game.isPaused() ? game.pause() : game.resume()`). Nghĩa là khi bấm Pause thì engine ngừng
vẽ hẳn, và viewport quan sát **đóng băng cùng game** — khác Unity, nơi Pause chỉ dừng thời
gian game còn Scene view vẫn sống.

Cách xử lý: khi nhận `Game.EVENT_PAUSE`, scene view tự chạy một vòng `requestAnimationFrame`
riêng. Mỗi vòng nó chạy phần việc của scene view (camera, gizmo, chọn, theo dõi) rồi gọi
`Root.frameMove` để vẽ lại cảnh. Dùng `frameMove` trực tiếp chứ **không** dùng
`director.tick`, vì `tick` còn chạy `update` của mọi component — tức là game sẽ chạy tiếp
ngay trong lúc đang "pause". Vòng này dừng khi `Game.EVENT_RESUME`.

Mỗi frame chỉ có **đúng một** bên chạy scene view: `update()` khi game chạy bình thường,
`Director.EVENT_BEFORE_DRAW` khi chỉ director bị pause, vòng riêng khi cả game bị pause.

Nút Step không bị ảnh hưởng vì mình không hề pause director.

**Chưa kiểm chứng trên editor thật:** (1) sự kiện chuột/phím có còn tới khi game đang pause
hay không — tài liệu engine nói Web vẫn dispatch ngay, nhưng Preview-in-editor nhận input
theo đường riêng; (2) nút Pause trên thanh trên cùng của editor có đúng là cái gọi
`game.pause()` ở trên hay không. Nếu bạn Pause mà viewport vẫn đứng, hãy cho mình biết camera
có còn xoay được không (chuột phải) — việc đó tách được "không có frame" khỏi "không có input".

### Chưa Play

**Panel Scene của Cocos Creator chính là Scene view lúc edit của Unity**: camera bay tự do,
gizmo, chọn, move/rotate/scale, Hierarchy, Inspector. Scene view trong bộ này chỉ tồn tại vì
Cocos *không có* gì tương đương khi game đang chạy; nên nó **cố ý không chạy lúc chưa Play**.

Chạy nó trong panel Scene bằng `@executeInEditMode` sẽ chia đôi viewport của chính panel đó,
nhét camera thứ hai vào giữa hệ gizmo, camera và selection của editor — dựng lại panel Scene
ngay bên trong panel Scene, bản tệ hơn. Và ở đó các camera game cũng không render vào panel
nên phần chia đôi màn hình không có nghĩa.

Nếu điều bạn muốn là một tính năng **cụ thể** của bộ này lúc edit (chọn UI, vẽ UI, bay tới
node…), hãy nói tính năng nào, vì mỗi cái có cách khác nhau và nhiều cái panel Scene đã có.

## Bật/tắt UI ngay lúc chạy (phím `U`)

`Show UI` là property, mà khi dùng `AutoBoot` node gắn component bị ẩn nên không có chỗ
nào để chỉnh nó trong Inspector (đúng với mọi property khác). Phím `U` bật/tắt việc vẽ UI trong viewport tức thì, và
công tắc `Game UI` trong panel `!` phản ánh trạng thái đó. Xem mục "Hiển thị UI trong
viewport" để biết rủi ro của nó.

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

### Hiển thị UI trong viewport (`Show UI`, mặc định BẬT)

Camera quan sát vẽ UI thật. Tắt `Show UI` (hoặc bấm `U`) thì quay về khung viền thay thế.
Từng để mặc định tắt vì rủi ro dưới đây, đọc từ engine chứ không phải suy đoán; đã đổi
sang bật sau khi dùng thử thực tế mà không thấy game phản ứng với click ở scene view:

- **Click trong scene viewport có thể bị hiểu là click vào UI của game.**
  `UITransform.hitTest` duyệt qua *mọi* camera thấy layer của node, đổi điểm màn hình
  sang world ở độ sâu 0, rồi **chỉ so x,y với hình chữ nhật node, bỏ qua z**, và trả
  `true` nếu *bất kỳ* camera nào báo trúng. Camera quan sát mà thấy layer UI thì một cú
  click trong viewport của nó có thể bấm trúng nút của game. Nếu game phản ứng
  với click ở scene view thì tắt đi.
- **UI vẽ không có depth test**, nên canvas cỡ design resolution có thể phủ lên cả cảnh
  thay vì nằm đúng chỗ như trong Unity.
- Vài chỗ của engine chọn "camera đầu tiên thấy layer này" (`getFirstRenderCamera`:
  `EditBox`, `VideoPlayer`, `WebView`, một số hàm đổi toạ độ của `UITransform`). Camera
  quan sát được thêm sau camera game nên thường không phải camera đầu, nhưng thứ tự
  đó không được đảm bảo.

Khi `Show UI` bật, các khung viền UI chưa chọn được ẩn đi (UI thật đã hiện, viền chỉ
thêm rối); UI đang chọn vẫn được highlight.

### Điều cần biết trước khi bật

Canvas screen-space có kích thước bằng **design resolution**, ví dụ 960×640 **đơn
vị world**. Cạnh một capsule 1 đơn vị thì khung UI sẽ **to khủng khiếp** và có thể
lấp cả khung nhìn. Unity cũng đúng như vậy với Screen Space Canvas. Thấy vướng thì
tắt `Enable UI Picking`.

`UITransform.hitTest()` là đường còn lại, nhưng nó phân giải qua camera UI nên chỉ
trả lời cho nửa game, không dùng được cho viewport quan sát.

## Chọn được những loại renderer nào

Mọi thứ vẽ ra một model: `MeshRenderer`, `SkinnedMeshRenderer` và **`SpriteRenderer` 3D**.

Từng chỉ thu thập `MeshRenderer`, và đó là lỗi: `SpriteRenderer` kế thừa `ModelRenderer`,
**ngang hàng với `MeshRenderer` chứ không phải con của nó**, nên
`getComponentsInChildren(MeshRenderer)` không bao giờ trả về nó. Cảnh dùng sprite làm nền
(như `BG` và `Top` trong SmashFest, cả hai scene có 0 `MeshRenderer`) thì nền vừa không
chọn được vừa không có khung viền — bấm vào là "không có gì".

Lớp cha `ModelRenderer` không công khai `model` (chỉ có `_models` protected), mỗi lớp con
tự định nghĩa getter riêng, nên `ModelAccess.ts` đọc qua một hàm chung.

Bẫy thứ hai trên cùng đường đó: khi mesh không đọc được dữ liệu đỉnh, `rayModel` trả **0**
chứ không ném lỗi, mà 0 cũng là "trượt". Nếu không phân biệt thì một renderer chỉ đơn giản
là không test chính xác được sẽ bị loại ngay sau khi hộp bao của nó đã trúng tia.
`hasReadableTriangles` kiểm tra trước, và nếu không có tam giác nào đọc được thì tin vào
hộp bao.

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
lệnh thành no-op, và overlay DOM (`Show Panels`, bật mặc định trong browser) thay thế.

Property liên quan:

| Property | Mặc định | Ý nghĩa |
|---|---|---|
| `Sync Editor Selection` | bật | Đẩy selection sang editor |
| `Show Panels` | **bật, chỉ trong browser** | Overlay Hierarchy/Inspector tự vẽ; tự ẩn trong Preview của editor |

### Nếu nó không chạy

API selection của editor không nằm trong typings của engine và đã bị minify trong
bản build, nên `EditorBridge` **dò khả năng lúc chạy** rồi log đúng một dòng:

```
[SceneView] editor selection route: Editor.Selection.select, reverse sync on
```

Nếu dòng đó báo `no editor host` hoặc route khác với mong đợi, đưa nguyên dòng log
đó thì sẽ biết chính xác phải nối vào API nào.

## Panel trợ giúp (nút `!`) và phím tắt

Một nút tròn **`!`** ở góc dưới-trái của scene viewport mở ra **một panel duy nhất** gồm cả
hai thứ từng nằm rải rác: danh sách phím tắt và các công tắc bật/tắt tính năng. Nó thay cho
thanh chữ dài chạy dọc đáy cửa sổ, vốn đè lên cả hai viewport. Nút đi theo mép viewport khi
bạn kéo thanh chia.

Panel gồm: dòng trạng thái (công cụ đang dùng, node đang chọn), các **công tắc**
(Game UI, Follow Hierarchy selection, Hierarchy and Inspector, Grid, Bounding boxes,
Selected camera frustum, World axes, Debug logging — mỗi cái có phím nếu có), rồi danh sách
phím tắt theo nhóm: Tools, Select and focus, Camera, Panel.

- **Trong browser:** bấm nút `!` để mở, bấm vào từng hàng công tắc để bật/tắt. Sau mỗi cú bấm,
  focus bàn phím được trả lại cho canvas (phím chỉ tới engine từ canvas, còn bấm vào DOM thì
  focus rời khỏi nó).
- **Trong Preview của editor:** editor không gửi sự kiện DOM vào trang, nên **không bấm được**.
  Panel hiện một dòng lưu ý nói rõ điều đó, các công tắc chỉ để xem; dùng phím **`H`** để mở
  panel và phím riêng của từng công tắc để đổi. Không có thao tác nào *chỉ* làm được bằng chuột.
- Biểu tượng là một hằng số (`ICON` trong `HelpPanel.ts`) nên đổi dấu rất dễ.

| Phím | Tác dụng |
|---|---|
| `H` | Mở/đóng panel trợ giúp |
| `P` | Bật/tắt panel Hierarchy và Inspector (chỉ browser) |
| `L` | Mở/đóng Console trong trang (chỉ browser) |
| `Ctrl+Z` / `Ctrl+Y` | Hoàn tác / làm lại |
| `Delete` | Xóa node đang chọn (hoàn tác được) |
| `Ctrl+C` / `Ctrl+V` | Copy / dán node đang chọn |
| Chuột phải trong Hierarchy | Menu node: Create, Copy, Paste, Duplicate, Delete, UUID, PATH |

## Cỡ chữ của các panel

Chữ trong panel từng là **monospace 11px**: nhỏ, và monospace là lựa chọn tệ cho tên node kiểu
`Object_Type_1100`. Chữ phụ lại dùng màu xám tối (`#6b7280`) trên nền gần đen nên tương phản thấp.

- **Mặc định giờ là 13px**, font hệ thống không-monospace (system-ui / Segoe UI / Roboto) cho tên
  và nhãn. Monospace chỉ giữ cho **con số** trong Inspector và **phím** (nơi cần thẳng hàng).
  Chữ phụ sáng hơn (`#a3abba`), tên node sáng hơn, dòng cao hơn.
- **Chỉnh được lúc chạy, từ 10 đến 22px, và được nhớ** (`localStorage`, nên lần sau mở vẫn giữ):
  phím **`[`** nhỏ đi, phím **`]`** to lên, hoặc nút **A- / A+** ở mục "Text size" trong panel `!`
  (bấm được trong browser). Không có một con số hợp mọi màn hình: cỡ vừa mắt trên màn hình lớn
  thì chật trên laptop, và ngược lại.
- **Cả bộ CSS đổi sang đơn vị `em`** theo một biến `--sv-fs`, nên một con số phóng to *toàn bộ*
  dòng cây, caret, chip, công tắc và nút, chứ không chỉ chữ. Bề rộng tối thiểu/tối đa của panel
  cũng tính theo em (16 và 32), nên chữ to hơn thì panel rộng hơn, không bị cắt tên.
- Nút `!` tự tính vị trí theo kích thước thật của nó vì nó cũng to lên theo cỡ chữ.

## Chỉnh sửa trong preview: hoàn tác, tạo node, collider

Mọi thay đổi này **chỉ nằm trong phiên preview**, không ghi vào file scene. Tải lại trang là mất.
Muốn giữ thì làm lại trong editor.

### Hoàn tác / làm lại (`Ctrl+Z`, `Ctrl+Y` hoặc `Ctrl+Shift+Z`)

`History.ts` là một ngăn xếp lệnh dùng chung (tối đa 200 bước). Một lệnh được đẩy vào **sau khi** thao
tác đã làm xong, nên code thao tác giữ nguyên, chỉ cần mô tả cách đảo ngược. Làm thao tác mới thì
xóa ngăn xếp redo. Có hai nút ↶ ↷ ở đầu Hierarchy (tooltip nói sẽ hoàn tác gì) cho ai chỉ dùng chuột.
Cocos 3.8 không cho cờ Ctrl/Shift trong sự kiện phím, nên tool tự theo dõi phím Ctrl/Cmd/Shift qua
`KEY_DOWN/KEY_UP`. Ctrl+Z cũng chạy trong Preview của editor (gizmo dùng input của engine).

Hoàn tác được: **kéo gizmo** (move/rotate/scale, một lần kéo = một bước), **sửa vị trí/xoay/scale/active
trong Inspector**, **tạo / nhân đôi / xóa node**, **sửa collider**.

### Menu chuột phải trong Hierarchy (browser)

Bấm **chuột phải** vào một hàng (hoặc vào vùng trống của danh sách) thì hiện menu kiểu Cocos editor thay cho
menu mặc định của trình duyệt (`ContextMenu.ts`, menu tự vẽ vì menu của trình duyệt không thêm mục được):

- **Create ▸** Empty node / **3D Object ▸** Cube, Sphere, Capsule, Cylinder, Plane / **Light ▸** Directional light /
  **UI Component ▸** Label. Nút **New ▾** ở đầu Hierarchy mở đúng menu này.
- **Copy** (`Ctrl+C`), **Paste** (`Ctrl+V`), **Duplicate**, **Delete** (`Delete`). Paste tạo một bản sao mới của node
  đã copy, đặt dưới node đang chọn (hoặc dưới scene), nên dán được nhiều lần; hoàn tác được.
- **Copy and Print UUID** / **Copy and Print PATH**: chép vào clipboard và in ra Console (`[SceneView] PATH: Canvas/UIScene/Label`).
- Giống editor: bấm chuột phải **chọn node đó trước** rồi mới mở menu, nên mọi mục tác động lên đúng node. Bấm vào vùng
  trống nghĩa là "scene": bỏ chọn, nên Create đặt node dưới scene. Mục không dùng được thì mờ (Paste khi chưa copy gì;
  Copy/Duplicate/Delete với scene hoặc camera của chính tool).
- Menu con xổ ngang khi rê chuột, tự lật sang trái nếu hết chỗ bên phải, trượt vào nếu sát mép dưới. Đóng khi bấm ra
  ngoài, `Esc`, mất focus cửa sổ, hoặc sau khi chọn một mục.
- Chưa có: Cut, Rename, Camera / 2D Object / Effects / Terrain trong Create.

### Ô số trong Inspector áp dụng ngay khi gõ

Gõ tới đâu thì scene đổi tới đó, **không cần bấm ra ngoài hay Enter**: vị trí/xoay/scale của node và mọi ô số của
collider (center, size, radius, height). `LiveFields.ts` (`bindLiveNumbers`) bắt sự kiện `input` của từng ô.

- **Cả lần gõ chỉ là một bước undo**, ghi lúc rời ô (sự kiện `change`), từ giá trị trước phím đầu tiên tới giá trị
  sau phím cuối. Không thì gõ "150" thành ba bước hoàn tác. Gõ rồi gõ lại về đúng giá trị cũ thì không ghi gì.
- **Giá trị gõ dở không làm scene nhảy lung tung**: ô rỗng, chỉ có `-` hoặc `.` không phải số, nên giá trị đó
  giữ nguyên trong scene cho tới khi chuỗi thành số (`-4.` đã là số).
- Giới hạn dưới vẫn áp dụng lúc đang gõ: size/radius tối thiểu 0,001 (gõ `0` thì scene nhận 0,001 chứ không
  tạo shape suy biến), height tối thiểu 0.
- Công tắc (trigger, enabled, active) và danh sách hướng capsule vốn áp dụng ngay khi chọn, không đổi.

### Tạo, nhân đôi, xóa node (browser)

Hàng nút ở đầu Hierarchy: **New ▾**, **Duplicate**, **Delete**.

- **New** mở menu: Empty node; Cube, Sphere, Capsule, Cylinder, Plane (mesh do
  `Primitives.ts` tự sinh dữ liệu, vật liệu là `builtin-standard`, không cần asset. **Không dùng `primitives` của
  engine**: project có thể tắt module "primitive" (SmashFest tắt, `primitives` khi đó là `undefined` và gây
  `Cannot read properties of undefined (reading 'box')`). Cần `utils.MeshUtils` của engine để đổi dữ liệu thành Mesh).
  **Vật liệu là mặc định của Cocos** (`default-material`: bề mặt trơn, có ánh sáng, không texture, giống
  Cube mới tạo trong editor). Nó được **tìm chứ không giả định**: effect `builtin-standard` có thể không có
  trong build, và vật liệu thiếu effect **không có pass nào** làm `SubModel.initialize` chết ở
  `passes[0].localSetLayout`, rồi `getSkinPassIndex` ném `Cannot read properties of null (reading 'length')`.
  Thứ tự thử: (1) vật liệu có sẵn của engine, (2) tạo mới từ `builtin-standard`, (3) tạo mới từ effect "standard" mà
  một mesh trong scene đang dùng (vật liệu **mới**, nên có giá trị mặc định của effect chứ không mượn texture
  hay màu của mesh đó), (4) tương tự với effect bất kỳ. Không cái nào được thì từ chối tạo và báo trong Console.
  Nếu việc gắn node vào scene vẫn ném lỗi, node bị hủy sạch chứ không bị bỏ lại hỏng.
- Node mới là **con của node đang chọn** (không chọn gì thì nằm dưới scene), và được chọn ngay.
  Vật 3D đặt cách camera scene view khoảng 6 đơn vị, để hiện đúng chỗ bạn đang nhìn thay vì ở gốc
  tọa độ, có thể rất xa. **Label** phải nằm dưới một Canvas mới vẽ được, nên tool đặt nó dưới Canvas
  gần nhất; scene không có Canvas thì báo trong Console và không tạo.
- **Duplicate** dùng `instantiate` (nhân cả cây con) và chèn ngay sau bản gốc. **Delete** (hoặc phím
  `Delete`) gỡ node khỏi scene **nhưng không destroy**, để hoàn tác đặt lại đúng node đó với đủ component.
  Không xóa/nhân đôi được scene và camera của chính tool.
- Chưa có: Sprite, Button, Camera, kéo thả đổi cha trong Hierarchy.

### Hiển thị và chỉnh collider có sẵn (browser)

Chỉ làm việc với collider **đã có trên node**, không tạo hay xóa collider.

- **Chọn một node** thì các collider của nó hiện thành **khung xanh lá** trong scene view, theo xoay và
  scale của node như physics áp dụng (vẽ không depth test để không bị chính mesh che).
  Property `Show Colliders` hoặc công tắc "Collider shapes" trong panel `!`.
- **Công tắc "All colliders"** (property `Show All Colliders`, mặc định tắt) vẽ collider của **mọi node** trong
  scene bằng màu xanh dịu hơn, để thấy cả màn chơi; cái của node đang chọn vẫn sáng hơn. Danh sách thu
  lại mỗi nửa giây, tối đa 500 collider; node đang tắt hoặc collider bị tắt thì không vẽ.
- **Inspector** có một khối cho mỗi collider trên node: **Box** (center, size), **Sphere** (center, radius),
  **Capsule** (center, radius, height, direction X/Y/Z), cộng công tắc **trigger** và **enabled**. Sửa số thì
  khung đổi ngay, và hoàn tác được (`Ctrl+Z`). Các loại collider khác (Mesh, Cylinder, Cone, Plane...) hiện
  tên, center, trigger, enabled nhưng chưa có khung vẽ.
- **Kéo trực tiếp trong viewport: công cụ Collider (phím `5`, nút thứ 5 trong bảng công cụ).** Chọn node, bấm
  `5` thì các collider của nó có tay cầm (ô vuông nhỏ). Rê chuột vào thì tay cầm sáng vàng; kéo thì chỉnh
  hình dạng, thả chuột là **một bước undo**:
  - **Box**: sáu tay cầm, mỗi mặt một cái. Kéo mặt nào thì mặt đó dịch, **mặt đối diện đứng yên** (size đổi
    và center dịch nửa phần chênh).
  - **Sphere**: sáu điểm trên mặt cầu, kéo để đổi bán kính.
  - **Capsule**: hai đầu mũ (đổi chiều cao phần thẳng, hai đầu cùng giãn nên center không đổi) và bốn điểm
    quanh giữa (đổi bán kính).
  - Chưa có kéo để dời **center** (dùng ô center trong Inspector), và chưa có tay cầm cho Mesh/Cylinder/Cone.
  - Cách làm: như gizmo, toàn bộ tính trong không gian màn hình. Chiếu một đoạn tham chiếu dọc hướng tay cầm
    ra màn hình rồi đo con trỏ theo đoạn đó, nên không cần hình học va chạm. Mỗi lần kéo tính **từ hình dạng
    lúc bắt đầu kéo** (không cộng dồn từng sự kiện chuột), nên kéo ra rồi kéo về thì trả đúng giá trị cũ.
    Hướng tay cầm chĩa thẳng vào camera thì không làm gì (khỏi biến cử động nhỏ thành khoảng cách khổng lồ).
    Node bị scale thì cùng một cú kéo đổi ít hơn ở đơn vị local, đúng như physics áp scale.
    Kích thước tối thiểu 0,001 để không tạo ra collider suy biến.
- Dùng được khi build có module physics; bản cắt physics thì không hiện gì.

## Widget vẽ bằng engine: lệch khi camera chuyển động, và bị vật trong suốt che

Bảng công cụ 1-5 và thanh chia được vẽ bằng geometry renderer.

- **Lệch khi giữ chuột phải di chuyển camera, dừng lại mới về đúng chỗ: đã sửa.** Widget đặt bằng `screenToWorld`, đọc ma trận
  camera, mà ma trận chỉ được làm mới lúc render, nên widget dựng theo tư thế camera của frame trước rồi vẽ với tư thế frame này.
  `_prepareCameras` làm mới ma trận ngay sau khi camera đã di chuyển trong frame, trước khi vẽ.
- **Bị UI của game che (ví dụ một tấm nền đen phủ cả màn hình): sửa ở trình duyệt bằng cách dùng phần tử DOM.** Mesh 3D không che
  được widget, nhưng UI thì có: engine vẽ UI ở bước sau cùng, sau mọi gizmo, nên bất cứ thứ gì geometry renderer vẽ đều nằm dưới
  một phần tử UI phủ kín. Đã thử vẽ widget trên một camera lớp phủ riêng, nhưng trên project thật widget **biến mất hẳn** nên đã gỡ.
  Giờ ở trình duyệt, **bảng công cụ và thanh chia là phần tử trang** (\`DomWidgets.ts\`): luôn nằm trên cả canvas dù engine vẽ gì,
  **không lệch khi camera chuyển động** (vị trí chỉ phụ thuộc rect của canvas và tỉ lệ chia, không có tư thế camera nào ở đây),
  có hover và tooltip sẵn. Icon SVG dùng lại đúng nét vẽ của bản engine. Thanh chia kéo bằng pointer capture, giữ trong 10%-90%,
  và ngắn lại khi Console mở để không cắt qua nó. **Trong Preview của editor vẫn dùng bản vẽ bằng engine** như trước, vì ở đó
  trang không nhận chuột; bản engine chỉ được vẽ khi bản DOM chưa được dựng, nên không bao giờ có hai bản.

## Giải thích khi rê chuột (tooltip)

Rê chuột vào bất kỳ nút, công tắc, ô số, hàng nào của tool thì hiện một khung giải thích (`Tooltip.ts`, chữ nằm hết trong
`Tips.ts` để đọc và sửa lời mà không đụng code). Chữ giải thích viết bằng tiếng Anh, cùng ngôn ngữ với phần còn lại của giao diện.

- **Dạng:** một dòng tiêu đề đậm, một đoạn mô tả. Có ở: các công tắc, **công cụ** và **phím tắt** trong bảng `!`, dòng trạng thái,
  cỡ chữ; **Inspector** (tên, đường dẫn, position/rotation/scale, active, dòng world/layer/children, danh sách component, và
  từng ô của collider: center, size, radius, height, direction, trigger, enabled); **Hierarchy** (mũi tên mở/thu, ô màu loại node,
  tên prefab xanh, số con, nút ẩn/solo, các nút New/Duplicate/Delete/Undo/Redo); **Console** (nút đếm lỗi, bộ lọc, giờ, số lần lặp).
- **Cả những thứ vẽ bằng engine** không có phần tử DOM để rê vào: bảng công cụ 1-5, thanh chia, và tay cầm collider. Với chúng,
  `SceneViewDebug._updateEngineTip` đổi tọa độ chuột từ pixel camera sang pixel CSS qua rect của canvas (lật trục y vì engine đếm
  từ dưới lên) rồi gọi `tooltip.showAt`.
- **Chỉ hiện khi chuột nằm trên chữ**, không phải bất cứ chỗ nào trên hàng: cố ý rê vào mới thấy, lướt ngang qua khoảng trống,
  công tắc hay ô nhập thì không. `overText` đo từng đoạn chữ thật của phần tử (không phải hộp của nó, nên hàng gồm công tắc + nhãn +
  phím tắt chỉ trả lời "có" trên nhãn và phím tắt), chừa 3 px quanh mỗi chữ. Phần tử **không có chữ** (ô màu loại node, mũi tên) thì
  tính cả hộp của nó. Vì chuột đi trong cùng một phần tử cũng có thể vào hay ra khỏi chữ mà không có sự kiện mouseover nào, tool nghe
  cả `mousemove`. Chuột đi ngang qua canvas không làm mất tooltip của phần vẽ bằng engine (thanh chia, bảng công cụ).
- **Hiện sau ~0,4 giây** khi chuột đứng yên, nhưng **hiện ngay** khi chuyển từ cái này sang cái khác đã có giải thích, nên lướt qua
  cả một panel không phải chờ ở từng hàng. Mất đi khi bấm chuột, cuộn, bấm phím, mất focus cửa sổ, hoặc chuột rời đi.
- **Mọi `title` cũ tự được nâng cấp:** tooltip lấy chữ của `title` rồi xóa thuộc tính đó (để tooltip chậm, không có kiểu của trình
  duyệt không hiện chồng lên), nên các nút đặt `title` từ trước không cần sửa. Muốn thêm giải thích cho một phần tử mới: `tip(el, 'Tiêu đề' + String.fromCharCode(10) + 'Mô tả')`: dấu xuống dòng tách tiêu đề (in đậm) khỏi mô tả (trong code TypeScript viết là `\n` bên trong chuỗi).
- Tự đặt vị trí: dưới phần tử, lật lên trên nếu hết chỗ, trượt vào nếu sát mép, không bao giờ ra ngoài cửa sổ.
- Như các panel DOM khác, **chỉ ở browser** (Preview của editor không chuyển sự kiện chuột vào trang).

## Console trong trang (phím `L`)

Xem log mà không cần mở F12 (mở F12 trên màn hình nhỏ nghĩa là bóp game lại). Cạnh nút `!` có
nút **Console** mang số **lỗi** (đỏ) và **cảnh báo** (vàng): lỗi hiện ra ngay cả khi ngăn kéo đang đóng.
Bấm nút hoặc phím `L` để mở ngăn kéo; nó nằm giữa hai panel bên, ngay trên hàng nút, và nhớ trạng
thái đóng/mở. **Mở ra thì game và scene view co lại phía trên để nhường chỗ**, không bị ngăn kéo đè lên
(cùng cơ chế với hai panel bên: `insets` trái/phải/dưới, game giữ nguyên tỉ lệ và căn giữa trong phần còn lại).
Nền ngăn kéo đặc, không để hình phía sau lộ xuyên qua. Picker và free-look cũng chặn theo cạnh trên/dưới
của viewport, nên bấm vào dải dưới ngăn kéo không chọn nhầm vật.

- **Bắt gì:** `console.log / info / debug / warn / error`, lỗi chưa bắt (`window.onerror`), promise bị
  reject mà không ai xử lý, và tài nguyên tải hỏng (ảnh, script...). Các lỗi mạng của `fetch`/XHR
  không có sự kiện nào để bắt, chúng chỉ hiện trong DevTools.
- **Không thay thế console thật:** `ConsoleCapture.ts` bọc các hàm `console`, hàm gốc luôn chạy trước,
  nên F12 vẫn thấy mọi thứ y như cũ. Hook được cài **ngay khi file được import**, vì hook cài muộn không
  lấy lại được những gì đã log trước đó. Bộ nhớ tối đa 1000 dòng, trang chỉ giữ 400 dòng cuối.
- **Lỗi từ tiện ích trình duyệt bị lọc ra.** Một tiện ích Chrome chạy trong tab có thể ném lỗi (stack có
  `chrome-extension://...`, ví dụ `Cannot read properties of undefined (reading 'M_ID')` từ `executors/200.js`) và trang nhìn thấy chúng
  như lỗi của mình. Chúng không phải của game, nên không được ghi và không làm đỏ nút đếm; thay vào đó tiêu đề
  Console hiện **"N from extensions hidden"** (rê chuột để đọc giải thích; **Clear** đặt lại về 0), để biết log đã bỏ bớt bao nhiêu.
  Nhận biết bằng đường dẫn `chrome-extension://`, `moz-extension://`, `safari-extension://`, `ms-browser-extension://`, `edge-extension://`.
  Với sự kiện `error` toàn cục thì kiểm tra đường dẫn đầy đủ **trước khi** rút gọn thành tên file. Muốn tự xác nhận một lỗi là của
  tiện ích: mở `chrome://extensions/?id=<ID trong stack>`, hoặc mở trang bằng cửa sổ ẩn danh (tiện ích mặc định bị tắt) rồi xem lỗi còn không.
- **Đối tượng sự kiện in dễ đọc.** `console.error(event)` trước đây ra `{"isTrusted":true}` (vì `isTrusted` là thuộc tính duy nhất nó sở hữu).
  Giờ ra dạng `[ErrorEvent error] Script error.`, `[Event load on <img>]`, `[PromiseRejectionEvent unhandledrejection] reason: ...`.
- **Gộp dòng trùng** liên tiếp thành một dòng có số lần (như DevTools). `%c` bị bỏ, `%s %d %i %f %o %O`
  được thay đúng, object vòng không làm hỏng log.
- **Lọc** theo Log / Warn / Error (kèm số lượng), **Clear** xóa hết. **Copy** xem mục "Chọn và chép dòng log" ngay dưới. Đang ở cuối danh sách thì tự cuộn theo dòng mới; cuộn lên đọc thì không bị kéo xuống.
- **Chọn và chép dòng log:**
  - **Bấm một dòng** để chọn (tô xanh); **Ctrl/Cmd+bấm** thêm hoặc bớt từng dòng; **Shift+bấm** chọn cả đoạn từ
    dòng bấm trước tới dòng này (đoạn theo thứ tự đang thấy, nên đúng cả khi đang lọc). Bấm lại dòng đang là dòng
    duy nhất được chọn thì bỏ chọn.
  - **`Ctrl+C`** chép các dòng đã chọn (kèm giờ, mức, nội dung, số lần lặp), **`Ctrl+A`** chọn tất cả, **`Esc`** bỏ chọn.
  - Nút **Copy** ở đầu đổi theo: "Copy all" khi chưa chọn gì, "Copy (3)" khi đã chọn 3 dòng. Rê chuột lên một dòng thì
    hiện nút **Copy** nhỏ ở cuối dòng để chép đúng dòng đó.
  - **Chuột phải** vào dòng: Copy line, Copy message only (chỉ nội dung, không giờ/mức), Copy picked lines, Copy all shown,
    Select all, Clear console. Chuột phải vào dòng chưa chọn thì chọn nó trước, như danh sách file.
  - **Bôi đen chữ bằng chuột** vẫn dùng được để chép một đoạn trong dòng (CSS đặt `user-select: text !important`, vì có
    trang tắt chọn chữ toàn cục). Khi đang có chữ được bôi, `Ctrl+C` là của trình duyệt và chép đúng đoạn đó.
  - Đang chọn dòng hoặc bôi chữ thì log **không tự cuộn** xuống dòng mới, khỏi giật khỏi chỗ bạn đang đọc.
  - Chép có **hai đường**: `navigator.clipboard` (chỉ có ở HTTPS hoặc localhost, và bị từ chối khi trang không có focus),
    sau đó dự phòng bằng ô nhập ẩn + lệnh `copy` (chạy cả khi mở preview bằng địa chỉ IP trên điện thoại). Có ghi chú
    nhỏ cạnh nút ("Copied 3 lines", hoặc "Copy failed..." nếu cả hai đều thất bại), thay vì im lặng như trước.
- **Chỉ ở browser**, như Hierarchy/Inspector: trong Preview của editor đã có Console của editor, và
  Preview không chuyển click vào trang. Phím `L` và công tắc "Console" trong panel `!` cũng chỉ có ở browser.
- Giới hạn: dòng log trông như xuất phát từ `ConsoleCapture.ts` chứ không phải file gọi, nếu soi bằng DevTools.
  Muốn biết nơi gọi thì xem stack (lỗi và `Error` có sẵn stack trong dòng).

## Panel Hierarchy + Inspector trên bản preview web

Bật **mặc định trong browser** (`Show Panels`), **nằm hai bên canvas** như editor: Hierarchy ở bên trái, Inspector ở bên phải.
Vị trí và kích thước được **đo từ chính canvas**, nên khớp với từng màn hình:

- **Chiều cao bằng chiều cao canvas.** Neo theo cửa sổ thì panel bắt đầu từ mép trên và che
  mất thanh công cụ của trang preview (Design Resolution, Rotate, Debug Mode, Show FPS,
  Pause…) nằm phía trên canvas.
- **Sát mép canvas, bề rộng lấp đầy dải trống** (tính theo cỡ chữ: Hierarchy 20 đến 32 em, Inspector 18 đến 32 em, tức 300 và 270 px ở 15 px; chừa 8 px mỗi bên). Neo
  vào mép cửa sổ và chặn bề rộng tối đa thì còn thừa một khoảng hở giữa panel và game mỗi
  khi dải trống rộng hơn mức chặn.
- **Bám theo canvas khi đổi thiết bị.** Chọn thiết bị trong Design Resolution thì trang gọi
  `setWindowSize` (engine đặt `screen.windowSize = kích thước thiết bị × devicePixelRatio`) rồi
  bắn `resize` **ngay**, lúc canvas chưa kịp đổi — handler đo lúc đó thấy canvas cũ. Nút Rotate
  thì bắn `orientationchange` chứ không phải `resize`. Nên `CanvasWatcher.ts` dùng
  `ResizeObserver` gắn vào canvas và phần tử chứa nó (báo đúng lúc kích thước đổi, ai đổi cũng
  được), cộng `resize` và `orientationchange`, và **đo lại 3 lần** sau đó (60, 250, 700 ms) vì
  engine áp kích thước mới trong vài frame. Hai panel, nút `!` và các nút trong viewport đều
  đi theo cùng bộ theo dõi này.

**Thứ tự xếp lớp (z-index) với trang preview.** Panel nằm ở `z-index: 50`, panel trợ giúp `51`.
Danh sách Design Resolution của trang preview là một `div` định vị tuyệt đối ở `z-index: 99`
(`.view-select-container .options`), nên panel phải nhỏ hơn 99 thì danh sách sổ xuống mới nằm
trên panel. Từng đặt 9999 nên danh sách bị che. Nhỏ hơn thì cũng phải lớn hơn canvas, vốn không
có z-index. Hai con số này đọc từ `builtin/preview/static/resources/index.css`; trang preview
của phiên bản Creator khác có thể dùng số khác.

Cửa sổ hẹp tới mức không còn dải trống thì panel buộc phải chồng lên canvas ở bề rộng tối
thiểu, và được giữ trong màn hình; phím `P` ẩn chúng.

**Phần canvas bị panel che không còn dùng để vẽ.** Trước đây game và scene view chia đôi **cả**
canvas, nên khi panel đè lên canvas (cửa sổ Full Screen không có dải trống) thì mép trái của
game nằm dưới Hierarchy: game trông như bị đẩy sang trái, bên phải còn một mảng đen rộng. Giờ
`DebugOverlay.insets()` đo phần canvas mà các card đang che (từ rect của chính card, nên card
đã thu gọn hay Inspector còn ngắn đều tính đúng), `SceneViewDebug._reflow()` đặt game và scene
view chia nhau **phần còn lại ở giữa hai panel**. Chưa kéo thanh chia thì vạch chia luôn nằm
giữa vùng đó; kéo rồi thì giữ vị trí bạn chọn (kẹp trong vùng, mỗi bên tối thiểu 10%). Picker và
free-look cũng bị chặn ở mép phải của scene view, nên bấm vào vùng của Inspector không chọn
nhầm vật phía sau.

**Thu gọn / mở từng panel.** Bấm vào thanh tiêu đề (có mũi tên ▾/▸) của Hierarchy hoặc
Inspector để thu nó về đúng thanh tiêu đề (rộng khoảng 11 em), và phần canvas đó được trả lại
cho game / scene view; bấm lần nữa để mở. Nút `+` / `-` trong tiêu đề Hierarchy không làm
thu gọn. Trạng thái được nhớ trong `localStorage` (khóa `scene-view-collapsed`).

**Cỡ chữ mặc định 15 px** (trước là 13), chỉnh bằng `[` `]` hoặc A-/A+ trong panel "!". Trong Preview của
editor chúng **tự ẩn**: editor có Hierarchy/Inspector thật, và panel DOM ở đó cũng không bấm
được. Phím `P` bật/tắt ngay lúc chạy.

**Hierarchy** — cây node của scene. Đọc một cây dài chủ yếu là phân biệt được các cấp, nên mỗi
dòng mang cấp của nó bằng ba cách chứ không chỉ thụt lề:

- **Đường dẫn cấp:** mỗi tổ tiên là một đường dọc riêng, tô màu theo cấp (xanh dương, xanh lá,
  vàng, cam, tím, ngọc — lặp lại sau 6 cấp). Các dòng sát nhau nên các đường nối liền thành
  vạch dọc liên tục.
- **Caret ▸/▾** tô đúng màu cấp của dòng. Bấm để mở/thu gọn nhánh. Một node có hàng trăm con
  (như `Level_14` có 123) không còn chiếm hết danh sách: mặc định chỉ mở cấp trên cùng.
  Nút `+` / `-` ở tiêu đề mở hết / thu về cấp trên cùng. Chọn một node sâu từ viewport thì các
  nhánh cha của nó **tự mở** và dòng được cuộn vào tầm nhìn.
- **Chip phân loại** ở đầu tên: vàng = Camera, cam tròn = Light, xanh da trời = UI,
  xanh lá = Model (mesh/sprite), xám đặc = nhóm có con, xám viền = node rỗng. Rê chuột lên
  chip để xem tên loại.
- Node có con in **đậm**, node lá mờ hơn; node đang tắt (hoặc nằm dưới node tắt) **mờ đi**.
  Dòng chẵn lẻ có nền hơi khác nhau. Nút `o` / `S` mờ cho tới khi rê chuột vào dòng.
- **Prefab in chữ xanh lá** như Hierarchy của Cocos editor. Luật là "node có prefab root"
  (`node._prefab.root`), không đòi `PrefabInstance`: instance chỉ có với prefab đặt vào scene
  bằng editor, còn prefab sinh lúc chạy bằng `instantiate()` có thể có root mà không có
  instance. Đã đo trên SmashFest: `Ground`, `Character`, `UIScene` xanh; `Level_14` (123 con) **không
  có `_prefab` nào** nên không xanh, khớp với dữ liệu. Node tắt (mờ) vẫn giữ quy tắc mờ, chỉ màu đổi.
- Click một dòng để chọn; nút `o` ẩn/hiện, nút `S` solo.
- **Double-click một dòng để camera scene view bay tới node đó.** Làm được là vì trên web DOM
  nhận chuột thật; ở editor thì không có kênh nào để nghe double-click ở Hierarchy.
- Cây **có cả node UI**. Trước đây nó dùng mask loại luôn layer `UI_2D`/`UI_3D`, nên UI biến mất
  khỏi cây; giờ chỉ loại layer của editor (`GIZMOS`, `EDITOR`, `SCENE_GIZMO`, `PROFILER`).
- Cây chỉ dựng lại khi cấu trúc thật sự đổi (gồm cả trạng thái mở/đóng); dựng mỗi frame sẽ reset
  scroll và huỷ mất chính dòng con trỏ đang bấm. Vị trí cuộn được giữ lại qua mỗi lần dựng.

**Inspector** — sửa trực tiếp position / rotation / scale / active của node đang chọn. Giá trị
được đẩy vào ô mỗi frame để vật thể đang animate hiện đúng, **trừ ô đang gõ**. Commit khi
`change` (blur hoặc Enter), không phải mỗi lần gõ, nên `-` hay `1.` dở dang không bị parse
thành số. Ô không parse được thì giữ giá trị cũ, không thành `NaN`.

Chưa kiểm chứng trên trang preview thật: toàn bộ phần DOM này chỉ mới được typecheck, chưa
từng được chạy trong browser.

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
| `History.ts` | Ngăn xếp undo/redo và các lệnh cơ bản (giá trị, pose) |
| `SceneEdit.ts` | Lệnh thêm/xóa node |
| `NodeFactory.ts` | Dựng node mới: primitive, light, label |
| `Primitives.ts` | Sinh dữ liệu mesh (box, sphere, capsule, cylinder, plane), không cần module của engine |
| `EditToolbar.ts` | New / Duplicate / Delete / Undo / Redo ở đầu Hierarchy |
| `ContextMenu.ts` | Menu chuột phải tự vẽ, có menu con |
| `HierarchyMenu.ts` | Nội dung menu của node (Create ▸, Copy, Paste...) và đường dẫn node |
| `LiveFields.ts` | Ô số áp dụng ngay khi gõ, một bước undo mỗi lần sửa |
| `ColliderEdit.ts` | Có physics không, collider thuộc loại nào |
| `ColliderGizmo.ts` | Vẽ khung collider (của node đang chọn, hoặc của mọi node) |
| `ColliderHandles.ts` | Tay cầm kéo được trên collider (công cụ phím 5) |
| `ColliderMath.ts` | Toán kéo tay cầm, thuần, không phụ thuộc engine |
| `ColliderInspector.ts` | Khối collider có sẵn trong Inspector |
| `ConsoleCapture.ts` | Bắt log, lỗi, promise reject; không phụ thuộc DOM |
| `Tooltip.ts` | Tooltip giải thích khi rê chuột, và hàm `tip()` |
| `Tips.ts` | Toàn bộ chữ giải thích, gom một chỗ |
| `ConsolePanel.ts` | Ngăn kéo Console, nút đếm lỗi, chọn và chép dòng |
| `LogText.ts` | Định dạng dòng log và bộ chọn dòng (bấm / Ctrl / Shift) |
| `Clipboard.ts` | Chép vào clipboard, có đường dự phòng |
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

- **Panel trợ giúp `!`** — là chữ, mà geometry renderer không vẽ được chữ. Bấm được trong
  browser; trong editor dùng phím `H`.
- **Panel Hierarchy/Inspector** (`Show Panels`, bật mặc định trong browser) — cần ô nhập
  text thật. **Chỉ chạy trên browser**, tự ẩn trong editor nơi đã có Hierarchy/Inspector thật
  qua `EditorBridge`.

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
