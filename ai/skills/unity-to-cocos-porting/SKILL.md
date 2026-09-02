---
name: unity-to-cocos-porting
description: "Use when porting Unity assets, prefabs, components, transforms, physics, particle systems, or C# scripts to Cocos Creator 3.8.8+ Playable Ads."
argument-hint: "Unity asset or script to port"
---

# Unity to Cocos Creator 3.8.8+ Porting Skill

This skill provides step-by-step guidance and architectural rules for converting Unity hypercasual/casual gameplay into Cocos Creator 3.8.8+ TypeScript playable ads.

## 1. Automated Tooling First

### Portable checkout / cross-PC bootstrap

Shared kit chỉ portable khi source of truth đã được commit và checkout đúng exact submodule pointer. Trên một PC
hoặc project clone mới, chạy chuỗi này trước khi đọc Unity source hay resume implementation:

```bash
git submodule update --init --recursive
npm ci
npm run ai:portable:doctor
npm run ai:sync
npm run ai:contract:verify
npm run memory:doctor -- --json
```

`ai:portable:doctor` là read-only và fail-closed khi submodule lệch commit, skill/contract generated bị stale,
Work Memory corrupt, dependency chưa cài, hoặc một file trong canonical regression closure bị thiếu/untracked. Closure này
được lấy trực tiếp từ regression gate: registry, matrix, eval/oracle, Unity reference và watchFiles; không chỉ registry root.
Sau `ai:sync`, chạy doctor lại nếu lượt đầu báo provider skill/contract stale.

Trên Codex Desktop Windows, audit portability phải batch/cache `git ls-files` cho toàn bộ candidate thay vì spawn một
process Git cho từng file. Desktop đã tự chạy review/status/diff watcher; per-file Git loops từ tool sẽ khuếch đại lỗi
resource/process exhaustion của app. Nếu log `%LOCALAPPDATA%/Codex/Logs` có nhiều `git.command.complete` bị cancel/fail,
không cố reproduce bằng vòng `git status`: dừng Git-heavy gate, giữ TEMP/TMP/cache trên ổ còn headroom, và chỉ resume sau
khi Git/app ổn định. `ai:sync` không được tự gọi Git và generate unchanged phải idempotent để không đánh thức watcher vô ích.

Phải Git-track `capabilities.def.cjs`, hai skill source, global pinned memory DB và toàn bộ regression input
(`tools/port-regressions.json`, matrix, eval/oracle, Unity reference, watchFiles). Chỉ
`.ai/port/**/resume-packet.json`, `regression-receipt.json` và `static-scaffold.receipt.json` là local/regenerated;
không ignore rộng `.ai`, `core-gameplay.json` hoặc `static-scaffold.wiring.json`. Mutation receipt, semantic cache,
preview output và temp screenshot cũng là state local; không copy chúng từ PC cũ để authorize mutation.
Trên máy mới, chạy `ai:port:core:resume` hoặc scaffold để revalidate source và sinh lại receipt. Không ghi đường dẫn
ổ đĩa tuyệt đối vào registry/oracle/handoff; dùng project-relative path để một checkout khác chạy lại được.

Nếu brief/user cấm build, nghiệm thu core bằng
`npm run ai:port:core:verify -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot> --preview-only`.
Mode này vẫn chạy verify/lint/assets/regressions và runtime smoke trên editor preview nhưng không chạy build hoặc yêu cầu
`build/common`; headless verify nhận `--skip-build-size` nên không đọc/fail bởi HTML build cũ nhưng vẫn giữ TS/config/
feature/meta/import checks. Chỉ được báo `preview-accepted`/`preview-runnable`. `accepted=false` trong mode này là chủ ý và không
được đổi wording thành build accepted/runnable.

Với skeletal/Spine JSON, không commit `images`/`audio` path tuyệt đối của máy exporter. Trước khi normalize, trace
source skeleton + atlas/texture/audio và importer/AssetDB để chứng minh dependency runtime thực. Chỉ normalize Cocos
copy sau khi ownership đã rõ, rồi AssetDB reimport và kiểm lại asset type, dependency graph cùng runtime preview;
không blind-rewrite bằng regex vì path đó có thể thật sự sở hữu dependency.

Trước khi viết tay bất kỳ prefab / shader / script nào, dùng tool sẵn có.
Với port mới, golden entry là:

```bash
npm run ai:port:core:scaffold -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>
```

Lệnh dùng static provider trước, tạo core manifest, scene skeleton, wiring report và
`.ai/port/resume-packet.json`. Không mở cả cây Unity source để “lấy context” sau bước này.
Đọc `nextActions`, `staticFirst.wiring.todo` và port-report digest; chỉ mở evidence slice được chỉ định.

Model pipeline phải FBX-only. Nếu nguồn đã là `.fbx`, copy/import đúng file đó. Nếu nguồn là Unity Mesh `.asset`
YAML đọc được, porter xuất thẳng FBX 7.4. Với mesh compressed/binary mà static exporter không đọc được, dùng Unity
FBX Exporter trong đúng Editor/version nguồn và ghi provenance; không chuyển qua glTF/GLB để làm importer có vẻ pass.
Flag legacy `--convert-fbx-fallback` bị từ chối. Sau khi Cocos import, chạy `npm run ai:model:optimize` rồi
`npm run ai:model:optimize -- --verify`; tool dùng Asset DB để áp Mesh Optimize, Simplify ratio 0.8, Cluster off và
Compress-only. Nếu Cocos converter từ chối FBX gốc, chạy
`npm run ai:fbx:normalize -- --src <Unity.fbx> --out <Cocos.fbx> --mode preserve`, reimport bằng Asset DB và bắt buộc
`imported:true`. Chỉ dùng `--mode static` khi oracle nguồn/runtime chứng minh không có skeleton animation. Nếu C#/prefab
vẫn giữ reference tới bone để scale/rotate trực tiếp, truyền `--preserve-anchor <boneName>` cho mọi anchor đó; static
output mất anchor là lỗi high dù mesh vẫn render. Tool bake skin tại bone local scaleY=2 thành morph target cùng tên;
runtime phải bind morph weight=`anchor.scaleY-1`. Existing shape key, modifier ngoài armature hoặc anchor mơ hồ phải fail
để review. Sau đó kiểm bounds/mesh, visual và runtime. FBX importer còn fail là blocker
cần sửa ở source/export/import config, không được che bằng glTF/GLB.

Khi tiếp tục một port đang dở hoặc sau compaction/interruption, chạy trước:

```bash
npm run ai:port:core:resume -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>
```

Trước khi handoff hoặc kết thúc một lượt chưa hoàn tất, thêm `--write` để refresh packet trên disk.
Nếu packet báo source stale thì scaffold lại với `--force`; không dùng packet cũ để tiếp tục mutate.
Chỉ nâng provider lên `auto`/`unity-mcp` khi static preflight nêu đúng uncertainty cần live evidence.

Luôn hoàn tất rule generated `unity-preflight`: đọc compact `decision`, `features`, `obligationIndex`, `obligations`
và chỉ mở evidence slice được brief yêu cầu trước khi implement.
Khi `port.closure --copy-to` tạo staging ngoài Unity project, giữ nguyên `.unity-port-provenance.json`
và truyền `--unity-project <UnityProjectRoot>` cho `port.compile`; không copy/ghép thêm source vào staging đã ký.
Không đi vòng mutation gate qua symlink/reparse path. `--dry-run` phải hoàn toàn read-only; nếu thấy tool tạo
folder, `.meta`, chạy converter hoặc ghi output thì coi là lỗi gate và dừng workflow.

Khi port/cache chạy trên exFAT hoặc filesystem có timestamp resolution thấp, không được dùng riêng
`size + mtime + ctime` làm bằng chứng source chưa đổi. Text/Unity-serialized evidence và `.meta` mà scanner
consume phải có content hash; đổi stamp contract phải invalidate cache schema. Test cần sắp thứ tự timestamp
phải dùng mốc từ 1980 trở đi và khoảng cách lớn hơn resolution của exFAT. Security test cần symlink/junction
chỉ được skip với explicit unsupported-filesystem error; vẫn phải chạy thật trên NTFS/Linux CI.

Ngay sau preflight và trước khi viết gameplay code, đọc `engineFeatureClosure`. `port.core.init`/`scaffold` phải
hoàn tất gate này trên active preview trước khi ghi manifest/scene: AnimatorController bật đồng thời `animation`,
`skeletal-animation`, `marionette`; Spine bật `spine` + backend đúng version skeleton (`spine-3.8`/`spine-4.2`);
Physics2D bật `physics-2d` + exact backend; Physics3D chọn backend theo hành vi. Parent `_option`, cache/include và
active preview phải cùng khớp, đúng một backend được bật. Version thiếu/mâu thuẫn hoặc profile không có exact ID là
blocker, không được workaround trong gameplay code.

Cocos 3.8.8 có thể normalize option parent khỏi `includeModules`; chỉ chấp nhận khi parent cache bật, `_option`
trỏ đúng child duy nhất và child nằm trong cache/include. Preview alias `physics-2d-framework` hoặc generic `spine`
chỉ chứng minh exact backend khi selector khớp và preview mới hơn profile; không dùng alias để bỏ qua uncertainty.

Giữ `primitive`, `occlusion-query`, `geometry-renderer`, `debug-renderer`, `terrain`, `light-probe` tắt mặc định;
chỉ bật module có evidence active/reachable trong playable-core + adapter closure. `m_Mesh` dormant của particle
billboard (không ở mesh render mode), private `Debug.DrawLine` helper không có call site và asset ngoài closure
không phải evidence. Closure mang cả `requiredModules` và `disabledModules`: gate phải gỡ false-positive cũ khỏi
profile cache/include rồi chờ preview mới chứng minh module không còn active; repair chỉ thêm feature là chưa đủ.
Incremental Unity index cache lưu `engineFeatureEvidence`, vì vậy fingerprint cache bắt buộc bao gồm detector
producer. Direct preflight và core init với cùng source/tool fingerprint phải cho cùng closure; khác nhau là cache
corruption/staleness blocker, không được chọn kết quả “có vẻ đúng”. Khi code Cocos mới đã sinh thêm component/API, chạy lại
`npm run engine:features -- ensure --project <CocosProjectRoot>` để audit target-induced feature, nhưng không dùng
target token scan để thay thế Unity source closure.

Không chọn physics backend chỉ theo tên engine nguồn. Dùng bằng chứng hành vi: Builtin cho query/trigger với
Box/Sphere/Capsule đơn giản; Cannon cho MeshCollider hoặc rigid-body/constraint cơ bản; Bullet (`physics-ammo`)
cho CCD, sweep, character controller, capsule động và constraint nâng cao. Unity PhysX chỉ là tín hiệu ưu tiên
Bullet khi có hành vi nâng cao, không đủ để tự bật backend nặng. Profile API/engine.json chỉ là trạng thái mong
muốn; chỉ coi feature đã apply khi preview import map và runtime receipt cùng khớp.

Khi sửa camera, transform, shader/material, UI hoặc input, tạo ma trận
`npm run ai:verify:visual -- --config <matrix.json>` và mở ảnh kết quả. Với Cocos Editor preview,
`windowSize` chỉ là kích thước Chrome; muốn kiểm aspect thật phải đặt `previewDevice` (thường là
`WebpageFullScreen`) và đọc `evidence.previewDevice.canvas`. Luôn có ít nhất aspect nguồn và một
aspect rộng/hẹp dễ làm lộ lỗi framing. Mỗi case có hành vi phải kèm `requireEvalOk: true`; ảnh sạch
không thay thế oracle drag/reset/pick.

Khi surface gần đồng phẳng chỉ bị thủng/xuyên màu ở một số góc, đừng mặc định sửa bằng `Offset` hoặc đẩy mesh.
Đọc exact camera prefab/scene của Unity (`near`, `far`, projection), kiểm reversed-Z/depth format của source target,
và đọc đủ `ZTest/ZWrite/Cull/Offset` + render queue của shader hai phía. WebGL conventional depth phụ thuộc mạnh vào
near plane; hạ source near `0.3` xuống `0.1` có thể làm các layer cách nhau dưới millimeter rơi vào cùng depth bin
dù shader và texture đúng. Giữ near/far config-driven, dùng source near trước, rồi A/B cùng level/góc/zoom. Chỉ chấp
nhận khi hai grazing angle sạch, runtime pass vẫn giữ semantics nguồn, tight ROI chặn pixel xuyên màu cũ, và bound
sphere bảo thủ của mọi level ở cả zoom min/max còn cách near/far đủ xa dưới phép xoay tùy ý. Polygon offset,
depthOrder bias và displacement theo màu/level bị cấm nếu source không có evidence tương ứng.

Ngay sau preflight/scaffold, khởi tạo registry regression portable bằng
`npm run ai:verify:regressions:init -- --risk <risk>` và commit
`tools/port-regressions.json` cùng mọi matrix, eval/oracle, ảnh Unity reference và watchFiles. Chọn risk từ
obligation/feature nguồn và bug history, không chỉ từ phần đang sửa. Mỗi bug đã gặp phải trở thành mandatory suite;
đừng giữ checkpoint quan trọng chỉ trong `.unity/` vì máy khác sẽ không nhận được. Trước khi kết luận hoặc handoff,
chạy `npm run ai:verify:regressions`: tool refresh AssetDB/reload preview, chạy đủ rounds, và ghi receipt gắn hash
code/config/effect/font/matrix hiện tại. Nếu `check` báo stale thì phải chạy lại, không được dùng ảnh PASS cũ.

Đừng xem mesh import là kết quả cuối nếu Unity source gọi `meshFilter.mesh`, gán `vertices`, `uv/uv2`,
`colors`, `tangents`, hoặc ghi vertex buffer ở runtime. Truy theo chuỗi producer-consumer: code bake attribute nào,
shader đọc semantic nào, và animation dùng path/normals nào. Ở Cocos phải clone/rebuild runtime mesh rồi bake
attribute tương ứng; trước đó đo vertex FBX và serialized path trong cùng local frame để xác nhận phép đổi trục.
Không tái sử dụng quy tắc flip của scene porter cho một FBX custom nếu chưa có số đo. Thêm fail-fast kiểm path/mesh
alignment và progress span để sai hệ tọa độ không biến thành animation hẹp ngang nhưng vẫn runtime-clean.

Với runtime path/mesh, tạo manifest audit có ít nhất hai case không đối xứng, trong đó có một path cong hoặc lệch
tâm, rồi chạy:

```bash
node playable-shared-kit/tools/runtime-mesh-path-audit.cjs --config docs/porting/mesh-path-audit.json --out docs/porting/mesh-path-audit.report.json --json
```

Tool thử đủ 48 signed-axis permutation. Chỉ `decision=accepted` mới cho phép ghi phép đổi trục vào extractor hoặc
regenerate config/path; `ambiguous` và `rejected` là blocker. `--mesh` + `--path` một case chỉ dùng chẩn đoán,
không đủ để authorize mapping. Commit manifest, point samples và report vì report có `inputDigest`; khi input đổi,
chạy lại thay vì copy mapping cũ. Tool không chứng minh scale/translation, hierarchy, skinning hay world/local parent,
vì vậy phải normalize samples về cùng local frame hoặc bổ sung runtime oracle cho các biến đổi đó.

Với visual chạy dọc mesh/path (peel, zipper, rope, trail), giữ đúng hierarchy của nguồn: root ở parent/path space,
root không bị scale nếu Unity chỉ tween child, child thickness lấy từ ribbon width, và rotation dựng từ tangent +
normal với endpoint reversal đúng source. Registry phải dùng risk `runtime-mesh-animation`, có real gesture cho cả
`linear-path` và `curved-path`, ảnh Unity, `requiredTrace`, cùng `requiredEvalMetrics` tối thiểu cho
`longitudinalUvSpan`, `longitudinalUvMaxError`, `positionError`, `directionDot`, `rootScaleError`,
`thicknessError`. `evalBefore` chỉ được chuẩn bị scene, tuyệt đối không gọi action đang test. Bắt buộc thêm
`requireEvalBeforeOk` + `requiredEvalBeforeMetrics` để chứng minh `actionStarted=0` trước gesture và metric
`actionStarted>=1` sau gesture; nếu không, matrix có gesture vẫn có thể pass giả do direct API call. Mở ảnh giữa
animation; ảnh trước/sau không phát hiện được cuộn sai hướng hoặc scale sai node.

Khi Unity thay material qua vòng lặp `sharedMaterials`, Cocos phải thay/recolor mọi material slot của
renderer; slot 0 không đại diện cho toàn mesh. Khi object được attach vào slot, giữ phép biến đổi tương
đối của nguồn (`slot.worldRotation * localAttachRotation`) thay vì chỉ copy vị trí rồi để rotation identity.
Đối với screen drag, phát gesture thật ở cả ngang và dọc; không suy dấu rotation chỉ từ đổi handedness.
Nếu Unity có các component input độc lập cùng đọc một pointer (ví dụ hold/peek và camera rotate), đừng hạ
chúng thành một enum state loại trừ nhau. Drag threshold chỉ chặn click-release; hold đã active phải được giữ
đến pointer-up trong khi rotation vẫn nhận touch move. Dùng `gestureHoldBeforeMoveMs` trong verify.visual để
phát đúng chuỗi giữ đứng yên rồi kéo, và assert hold còn active ngay tại frame drag bắt đầu.

Khi real-gesture target phụ thuộc viewport/layout runtime, `evalBefore` phải tính authored target qua active UI
camera `worldToScreen` rồi trả tọa độ normalized theo canvas hiện tại. Khai báo `gestureFromEvalBefore` với bốn
path `x1/y1/x2/y2` để preview dispatcher dùng trực tiếp kết quả đó. Không copy một lần các số runtime thành
`gesture` tĩnh: đổi aspect ratio, CanvasScaler hoặc HUD scale sẽ làm positive case trượt dù gameplay vẫn đúng.

Khi Unity chọn whole material từ ScriptableObject theo state/color (ví dụ `ActiveMaterial` và
`DisableMaterial`), không được thay bằng một texture nhúng trong FBX rồi nhân tint. Chạy `shader.chain`
trực tiếp trên file `.asset` để lấy đủ material/texture closure; ở Cocos phải đổi texture/material tương ứng
và giữ base color trắng nếu nguồn làm vậy. Checkpoint runtime phải so identity texture của từng state/color,
không chỉ nhìn một ảnh vì tint trên albedo tối thường biến đỏ thành nâu/đen.

Với gameplay có tween/callback bất đồng bộ, mỗi callback phải giữ cả generation/transition token và đúng
model instance đã sinh ra nó; chỉ kiểm tra `this.model != null` có thể làm callback cũ mutate level mới.
`Node.destroy()` của Cocos được hoàn tất cuối frame, vì vậy sau khi gọi destroy phải xóa reference sở hữu ngay
(`this.board = null`) trước mọi `update()`/await. Nếu input có nhiều pha peel/flight/box-close/box-appear,
theo dõi từng pending phase; callback của một pha không được bật input trong khi pha khác còn chạy.

Với object được đưa vào holder/slot qua reparent + tween + animation callback, đọc riêng transform sample mà
Unity dùng để tính scale, `worldPositionStays`, CanvasScaler/camera conversion, movement duration và clip
duration. Sample transform là contract khác với phép fit renderer vào bounds. Nếu port tách một source await
thành flight rồi reflow, reflow không được stop tween sở hữu callback drop/settle; bỏ qua object còn flight-active
hoặc chuyển ownership có evidence tương đương. Nghiệm thu bằng hai gesture thật có overlap, kiểm center/rotation/
scale/size ratio khi đã settle ở viewport nguồn và viewport thấp-rộng, kèm ordered trace và console sạch.

Với Unity `Image.Type.Sliced`, giữ nguyên `TextureImporter.spriteBorder` theo pixel của texture nguồn khi nhập
vào Cocos. Không nhân các inset với CanvasScaler hay tỉ lệ 1080→720: Cocos dùng cùng `SpriteFrame.inset*` để
tính UV cắt texture và vertex local, nên scale inset sẽ làm méo góc dù `Sprite.type` đã là `SLICED`. Khi cần đổi
kích thước UI, tạo border node ở kích thước nguồn rồi scale node/parent. Qua AssetDB phải kiểm lại exact raw
inset; regression kiểm runtime type, inset, node scale, rendered width/height ở viewport nguồn và thấp-rộng.

Web Audio unlock thường được gọi từ mọi pointer để đáp ứng autoplay policy, nhưng `AudioSource.play()` của
Cocos Web sẽ đưa clip đang phát về đầu. Vì vậy `resumeBGM()` phải idempotent: chỉ gọi `play()` khi source thực
sự paused/stopped, còn source đang `playing` phải được giữ nguyên. Regression phải phát ít nhất ba touch
lifecycle thật trong cùng một browser session và assert `currentTime` tăng nghiêm ngặt qua từng tap; một tap
mỗi lần reload không thể phát hiện lỗi restart này. Kiểm tra pause/resume thật bằng một case riêng.

Auto-driver dùng để nghiệm thu nhiều lượt phải serialize qua các lifecycle phase này và ghi receipt win bất biến
theo `pass:level`; đừng suy level đã thắng từ một snapshot trong loading transition. Chọn deadline từ một lượt đo
thực tế rồi cộng headroom, và chỉ coi pass khi đủ receipt mong đợi, modal cuối đúng, cùng console/runtime sạch.

Với asset đánh số (`level_1`, `level_10`, `level_20`), mọi lookup định danh FBX/model/prefab phải so exact stem
sau normalize; fuzzy prefix chỉ được dùng cho tìm kiếm gợi ý, không được chọn asset để link hoặc overwrite.
Sau batch port, hash từng FBX nguồn/đích và assert report `NESTED_MODEL_PREFAB_LINKED` trỏ đúng exact level.
Unity còn có thể override `m_Name` của một child trong model instance trong khi Cocos giữ tên gốc khi import FBX;
extractor phải lưu cả tên instance và tên source do `PrefabUtility.GetCorrespondingObjectFromSource` trả về,
rồi runtime resolve exact theo hai identity đó. Không suy source name bằng cách cắt hậu tố như `_Multi` hay `.001`.
Regression bắt buộc gồm một cặp prefix nguy hiểm (`level_2`/`level_20`) và một child bị rename, sau đó chạy full
level inventory tới final win với receipt không thiếu/trùng và mọi pending lifecycle counter bằng 0.

Bảng lệnh dưới đây được **sinh tự động** từ `playable-shared-kit/ai/capabilities.def.cjs`
và được `npm run ai:contract:verify` đối chiếu với CLI thật.

<!-- BEGIN:GENERATED:commands -->
<!-- END:GENERATED:commands -->

### Giới hạn bắt buộc phải biết

<!-- BEGIN:GENERATED:limits -->
<!-- END:GENERATED:limits -->

---

## 2. Unity C# to Cocos TypeScript Translation Matrix

| Unity Concept (C#) | Cocos Creator 3.8.8+ (TypeScript) | Key Difference / Notes |
| :--- | :--- | :--- |
| `MonoBehaviour` | `Component` | Decorated with `@ccclass('MyClass')` |
| `[SerializeField] private float speed;` | `@property(CCFloat) public speed: number = 0;` | Use `@property` decorator |
| `GameObject` / `Transform` | `Node` | In Cocos, Transform is built into `Node` |
| `transform.position` | `this.node.worldPosition` / `this.node.position` | In Cocos 3.8, always use `Vec3` methods |
| `transform.localPosition` | `this.node.position` | Returns `Vec3` |
| `transform.eulerAngles` | `this.node.eulerAngles` | In degrees |
| `transform.localScale` | `this.node.scale` | `Vec3` |
| `Vector3.MoveTowards()` | `Vec3.lerp()` or `Vec3.moveTowards()` | Avoid allocating new `new Vec3()` in `update()` |
| `Quaternion.Euler()` | `Quat.fromEuler()` | Always reuse temp Quat objects |
| `GetComponent<T>()` | `this.getComponent(T)` | Type-safe in TS |
| `Instantiate(prefab, parent)` | `instantiate(prefab)` + `node.setParent(parent)` | Use `ObjectPool` for hypercasual bullets/items |
| `Destroy(gameObject)` | `node.destroy()` / `node.removeFromParent()` | Or return to `ObjectPool` |
| `StartCoroutine(MyRoutine())` | `async/await` or `scheduleOnce()` / `tween()` | Use `cc.tween` for sequenced animations |
| `DOTween.To()` / `DOMove()` | `tween(this.node).to(duration, { position: targetVec3 }).start()` | Cocos Tween system |
| `OnCollisionEnter` / `OnTriggerEnter` | `collider.on('onCollisionEnter', callback)` | Enable Collider event listener in `start()` |
| `Time.deltaTime` | `dt` (passed into `update(dt: number)`) | Delta time in seconds |

---

## 3. High Performance Cocos TypeScript Rules

1. **Zero Garbage Collection in `update(dt)`**:
   - Never use `new Vec3()`, `new Color()`, or `new Quat()` inside `update()` loops.
   - Declare static cached variables:
     ```ts
     const _tempVec3 = new Vec3();
     const _tempQuat = new Quat();
     ```
2. **Node Pooling (`ObjectPool`)**:
   - Hypercasual games generate many particles, floating texts, coins, or obstacles.
   - Use `ObjectPool` from `playable-core/utils/pool/ObjectPool` or `NodePoolAdapter` instead of `instantiate()` during gameplay.
3. **Cocos Event System**:
   - Use `this.node.on(NodeEventType.TOUCH_START, this.onTouchStart, this);`
   - Always unregister events in `onDestroy()`: `this.node.off(NodeEventType.TOUCH_START, this.onTouchStart, this);`

---

## 4. Playable Ads Lifecycle Integration

All game managers must inherit or wire into `GameManager` from the concrete module `playable-core/GameManager` (never a Component barrel):
- `GameManager.instance.onGameReady()`: Ready for player input.
- `GameManager.instance.onGameStart()`: Player performed first touch.
- `GameManager.instance.onGameWin()`: Trigger EndCard & CTA button.
- `GameManager.instance.onGameLose()`: Trigger EndCard & CTA retry.
- `SuperHtmlPlayable.download()`: Redirect player to App Store / Google Play.

---

## 5. Nguyên tắc bất biến & cổng xác minh

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->
