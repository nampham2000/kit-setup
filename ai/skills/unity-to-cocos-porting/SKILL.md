---
name: unity-to-cocos-porting
description: "Use when porting Unity assets, prefabs, components, transforms, physics, particle systems, or C# scripts to Cocos Creator 3.8.8+ Playable Ads."
argument-hint: "Unity asset or script to port"
---

# Unity to Cocos Creator 3.8.8+ Porting Skill

Creator 3.8 skyboxes require the `primitive` engine feature: activation calls
`cclegacy.primitives.box()` even when no authored scene mesh is a primitive.
Include this dependency when deriving cropping from a nonzero Unity
`RenderSettings.m_SkyboxMaterial`. A profile-only change is insufficient:
regenerate the Preview engine, restart the target project if required, and
verify the live Preview scene activates without a Skybox `reading 'box'` error.

This skill provides step-by-step guidance and architectural rules for converting Unity hypercasual/casual gameplay into Cocos Creator 3.8.8+ TypeScript playable ads.

## 1. Automated Tooling First

### Preview combat and filesystem pitfalls

- Keep gameplay delivery first. For explicit preview-only acceptance use core verify with --preview-only --preview-url; keep all runtime, regression and evidence gates, exclude only packaged build. Never invent a build receipt.
- On exFAT, run portable-npm-policy before install. Internal dependencies must be copied, never symlinked. Audio conversion must stage on the destination volume; publishing a C: temp file with rename into D: fails EXDEV. A failed publish must preserve the source and any existing destination.
- Long combat tests may use gestureDelaysMs (0–60000 ms each, <=180000 ms total) with separate real touch lifecycles. Verify heal-drop positive/negative, pause/resume, loss/retry and two wins without changing HP or invoking gameplay methods.
- Native Unity render baking is an alternative for SpriteSkin/IK/Timeline closures: keep gameplay/state in TypeScript, record every relevant clip at >=30 fps with source hashes and frame digests, and preserve animation signal/sound times. Do not relabel incomplete curve extraction as complete. Use a unity-rendered-animation-oracle plus measured frame/state/position/timing checks, >=80 runtime samples, ordered trace and Unity ROI similarity >=0.90. Keep every atlas/config watched; registry supports up to 512 files per suite. Environment/feedback animation and PSD half-banner mirroring remain source obligations.
- For Cocos canvas drag, do not pass design-space getUILocation coordinates to a world-space UITransform conversion. Bind the moving control's touch end/cancel as well as global movement and test that releasing really consumes or rejects the item and restores its position.

### Diagnose port blockers before stopping

- Setup indexes Unity source before installing MCP. On large asset-library projects,
  a Node heap failure in this phase is a scanner failure, not a Unity connection
  failure. Persisted regex captures (GUID, fileID, field path) must own their small
  strings instead of retaining the full YAML backing buffer. Keep the GC regression
  in `tools/unity-intel/guid-index.test.cjs`; avoid concurrent scans of the same
  project while the first cache is being built.

- Use one npm forwarding separator: `npm run unity:intel:doctor -- --project <root>`.
  An extra standalone `--` is passed to the parser and fails before probing Unity;
  classify that as a command contract defect, not an Editor or MCP failure.

- Start with `unity:intel:doctor`. Check installation, connection and an actual
  `playable-port-scan` response separately. A visible Unity MCP window or a ping
  is not scan evidence. If the package is missing, use the documented setup within
  the authorized port scope; do not ask the user to restart or install blindly.
- For scan failures, report the exact diagnostic and bounded evidence. Distinguish
  package/TLS/compile/import failures from a main-thread timeout. Wait for import
  or domain reload and retry readiness within its deadline. Do not kill the user's
  Editor, launch a second instance, expose tokens, or claim a provider fix merely
  because setup/retry restored this particular project.
- A generic `Curl error 35` / `UnityTls error code: 7` in Editor.log may come from
  unrelated Unity services. Require nearby Package Manager attribution before
  diagnosing package TLS failure; otherwise preserve the scanner timeout and
  inspect the project-owned UPM log. Do not assert MCP could not download without
  evidence identifying that package.
- A scan timeout is not proof that Unity gameplay cannot run. Continue independent
  static work only when preflight authorizes it. Keep unresolved source-integrity
  blockers and missing live visual acceptance evidence explicit.
- For sample scene selection ties, use an evidenced `--entry-scene` from the indexed
  scene inventory. An explicit vendor/demo scene need not be enabled or listed in
  Build Settings; resolve its canonical `assetPath`, retaining the editor-only and
  missing-scene rejection gates. Do not rename source scenes to satisfy a heuristic.
- For Cocos `marionette` or other missing engine exports, inspect the failing module,
  source dependencies, configured features and applied preview evidence separately.
  Use the engine feature audit/apply workflow and reload preview; a checked Settings
  box alone does not prove the preview engine was regenerated. Do not remove a used
  module or run a game build as a speculative repair.
- Effect validation must read AssetDB asset type and importer metadata separately,
  then inspect compile logs and preview. Read back serialized asset references:
  EffectAsset properties must retain the effect UUID/type, not a URL or SpriteFrame.
- Honor explicit scope exclusions. If the user requests preview only, mark build
  acceptance as outside delivery scope; do not build, fabricate a build receipt or
  claim packaged readiness. Excluded scenes must leave no runtime load dependency;
  document any replacement restart route.
- Choose evidence suited to the source: measured multi-round restarts for a demo
  without win state; GUID/fileID frame and state samples for sprite animation.
  Keep semantic assertions and source references; never relax bounds just to pass.
- After a recurring fix, update shared tool/tests, this source skill and capability
  definitions, regenerate instructions and sync extensions. Commit generated project
  copies and the exact submodule pointer; push shared kit before its consumer.

### UGUI layout and sliced images

- Treat RectTransform/layout bounds separately from Image draw bounds. Unity Sliced/Tiled ignores
  `m_PreserveAspect`; preserve the authored rect, CUSTOM sizeMode, Image type and spriteBorder
  left/bottom/right/top. A valid existing UUID does not prove importer borders were refreshed.
  Refresh through AssetDB, read back metadata and keep the UUID. Do not resize sprite pixels
  without remapping borders and logical sizes.
- Horizontal/VerticalLayoutGroup runs after authored RectTransform serialization. Preserve enabled,
  padding, negative spacing, alignment, pivots, scale flags, reverse order, inactive children and
  LayoutElement.ignoreLayout. Disabled groups keep authored positions. `UnityFixedLayoutGroup`
  handles groups with childControl/forceExpand disabled, including runtime resize/activation.
  Controlled/flexible sizes, Grid and fitters currently report `UI_LAYOUT_UNSUPPORTED` high;
  resolve their source semantics before claiming the HUD is complete.
- Regression: `node --test playable-shared-kit/tools/unity-cocos-port/ui-layout-porter.test.cjs
  playable-shared-kit/tools/unity-cocos-port/sprite-border-import.test.cjs`. Then inspect fresh
  Preview at portrait and landscape; measure slot/icon centers, frame containment, and repeat after
  a child becomes inactive. Fixture adapter tests do not establish rendered Unity/Cocos parity.
- For recurring faults, fix the shared converter and its tests before adding a game-specific offset.
  Keep project layout overrides config-driven; existing approved overrides need a separate runtime
  comparison before removal. Re-port only after the normal Unity source gate passes.

### Portable checkout / cross-PC bootstrap

Shared kit chỉ portable khi source of truth đã được commit và checkout đúng exact submodule pointer. Trên một PC
hoặc project clone mới, chạy chuỗi này trước khi đọc Unity source hay resume implementation:

```bash
git submodule update --init --recursive
node playable-shared-kit/tools/portable-npm-policy.cjs --write
npm ci
npm ci --omit=dev --ignore-scripts --prefix playable-shared-kit/packages/extensions/cocos-mcp
npm run sync:shared
npm ci --omit=dev --ignore-scripts --prefix extensions/cocos-mcp
npm run ai:portable:doctor
npm run ai:sync
npm run ai:contract:verify
npm run memory:doctor -- --json
```

Root `npm ci` does not install extension dependencies. The first extension install
lets the offline schema gate resolve its runtime imports; the second prepares the
synced extension for Editor loading. A failed sync gate must leave target files
intact, including with `--clean`; install missing dependencies and retry sync.

### exFAT: fix dependency policy before retrying installation

On exFAT, npm local dependency symlinks fail with EISDIR. This is not a missing
package or an administrator permission problem. Do not repeat the same `npm ci`,
change disks, or recommend Developer Mode. The shared portable policy requires
all three: `file:playable-shared-kit/packages/...` (without `./`), project
`.npmrc` with `install-links=true`, and lockfile entries without `link: true`.
The installed npm 11.6.2 explicitly forces links for internal `file:./...` paths
even with install-links enabled, so that setting alone is insufficient.

For a legacy clone, run the policy tool with `--write`, then
`npm install --package-lock-only --ignore-scripts` to let npm migrate the lockfile,
and `npm ci`. Commit `.npmrc`, package.json and package-lock.json together.
Do not manually flip lockfile link flags. `sync:shared` preserves the policy and
`ai:portable:doctor` rejects regressions. Verify actual package resolution and
that both installed shared package directories are ordinary directories.
These packages are copies: after editing shared package source, sync Cocos assets
and reinstall npm copies when Node consumers require the changed package.

When starting a different game in a clone containing a previous port, use distinct
manifest, wiring, packet and `--scaffold-receipt` paths. Never reuse another game's
receipt. A receipt collision must be rejected before scene/wiring output is written.

Work Memory may create a per-checkout database during initial recall. Shared-kit
Git ignores `tools/work-memory/data/repo/`; keep this local state out of commits.
The pinned global `shared-memory.db` stays tracked and must remain clean unless
the task explicitly updates portable knowledge.

On a fresh Unity project, MCP restores NuGet dependencies during Editor updates
and recompiles before the scanner assembly exists. Batch setup must enter the
independent `BootstrapEntry` assembly and allow updates/domain reloads; do not add
`-quit` or force `UNITY_MCP_READY`/dependency defines to bypass this phase. The
validated scan marker and a confirming scan remain mandatory after restore.

When the source has Android/iOS variants, use the requested variant and exact
Editor version. For unresolved GUIDs on a fresh checkout, finish Unity package
resolution/import on the intended build target before declaring assets missing.
Read `unity:intel:doctor` live `activeBuildTarget` and `editorState`; a directory
name or launch argument is not proof of the active target. Older scanners return
null for these fields, not an idle/Android confirmation. If import changes source
during preflight, let it settle and rerun the scan; do not reuse the stale receipt.
Enter Play Mode through the source boot flow and inspect Game View and Console.
Successful import or a clean compile does not prove gameplay or repair genuinely
missing references. Keep unresolved core dependencies blocked until disposition
is backed by live/source evidence; do not regenerate GUIDs or guess replacements.

For paginated live evidence, retain the exact section/search/filter and cursor.
Invocation timestamps must not invalidate otherwise identical evidence. If a
cursor is stale repeatedly on an idle, unchanged project, inspect the paging
identity and add a regression before retrying; never drop source-state or live
evidence binding to force pagination through. Read all pages before treating a
bounded first page as the complete missing-reference inventory.

If Unity warns that `DontDestroyOnLoad` was called on a child, inspect ownership
before repairing it. Unity already leaves that child scene-owned; a root-only
guard preserves that behavior. Detaching the child or persisting its entire root
changes lifecycle and can leak gameplay into later levels. Verify repeated scene
entry and disposal, not only warning disappearance.

On Windows, Unity helpers can keep inherited stdout/stderr handles open after
the owned Editor exits. Batch waiting uses the Editor's `exit` event and closes
its read pipes; it must still validate the JSON marker and matching fingerprint.
Never kill unrelated Unity helpers to release a pipe, or interpret exit code 0
alone as scanner success. A timeout remains failure even if termination emits exit.

Unity may rewrite `ProjectSettings.asset` or postprocessed Audio Mixer `.mixer`
assets with identical bytes during import. Bounded serialized source files use content hashes for scan identity,
so timestamp-only rewrites do not invalidate confirmation. Real byte changes
still invalidate it, including equal-size changes with restored timestamps;
large and binary files retain conservative size/mtime/ctime checks.

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
Khi tái sử dụng một Cocos port có sẵn, pin commit của donor và bỏ qua dirty working tree.
Giữ config sections/package/TypeScript contract của shared kit hiện tại; merge gameplay đã đối chiếu nguồn,
không chép đè toàn bộ manifest bằng schema cũ. Kiểm tra API library (ví dụ Promise.finally/Array.flatMap)
với tsconfig của target, và di chuyển thư mục script legacy qua Asset DB về assets/script/.
Source levels, tutorial, branding và animation phải bind lại Unity project đang port; receipt/playtest của donor
không nghiệm thu project mới. Sau import/move, chờ Asset DB hoàn tất rồi chạy verify/lint trước Preview.
Với nhiều worktree Cocos mở cùng lúc, giữ port trong settings/mcp-server.json của từng project khi restart;
không reset về 3000. Trên Windows, launcher dùng literal environment path qua PowerShell call operator,
không lồng quote cmd.exe vào spawnSync. Feature profile persisted vẫn cần import-map receipt sau restart.
Physics backend đúng chưa đủ: bind TagManager layers và DynamicsManager collision matrix vào config của target
trước khi tạo collider/body. Khi reuse prefab với group khác Default, thiếu matrix có thể làm cả stack xuyên bàn
và tự win dù console sạch. Khóa regression idle-before-input: đúng level, đủ object, zero shot và không transition.
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
`npm run ai:model:optimize -- --verify`; tool dùng Asset DB để áp Mesh Optimize, Simplify ratio 1, Cluster off và
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
Ngay sau đó, trước gameplay implementation, chạy feedback/spec closure từ mọi bootstrap, persistent và gameplay entry:

```bash
npm run ai:port:feedback:closure -- --project <UnityProjectRoot> --entry Assets/Scenes/Loading.unity --entry Assets/Scenes/Gameplay.unity --out tools/<game>/oracles/feedback-closure.json
```

Không chỉ tìm prefab/clip theo tên. Scanner phải resolve ScriptableObject kế thừa trực tiếp lẫn gián tiếp/generic,
serialized GUID, `Resources.Load<T>("literal")`, JSON/CSV/TextAsset và tiếp tục theo asset key/path chứa trong data.
ScriptableObject và data file là executable gameplay specification: lưu hash + field/key nguồn, rồi map từng field đã
implement sang Cocos config, runtime consumer và regression. Asset binding-reachable chưa chứng minh behavior chạy; mọi
candidate cần disposition `implemented`, `replaced`, `deferred` hoặc `dormant`, và `--check` phải fail-closed khi thiếu.

Dùng VFX/SFX tìm được làm observable checkpoint để walkthrough lại gameplay theo ordered phase, không audit effect riêng
lẻ: input/condition -> state mutation -> animation/tween callback -> particle -> SFX/haptic -> transition/replacement.
Đối chiếu owner C# + ScriptableObject/JSON field với Cocos callsite. Nếu effect xuất hiện nhưng callback commit, combo,
replacement hoặc transition bị thiếu/sai thứ tự thì vẫn là lỗi implementation high. Regression dùng gesture thật,
`requiredTrace` có timestamp, exact số lần VFX/SFX, bounded visible-pixel metrics và console sạch. Một inventory asset hoặc
một screenshot không đủ để kết luận feedback/gameplay parity.

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

Với Unity UI `Text` cũ, các thông số chữ nằm trong `m_FontData`. Khi `m_BestFit=1`, map cỡ nguồn tối đa từ
`m_MaxSize` sang `cc.Label.fontSize`, giữ `Overflow.SHRINK`, và map `m_FontData.m_Font` sang đúng `cc.TTFFont`.
Không dùng field không tồn tại `m_BestFitMaxSize`, system font hoặc mặc định 22; regression phải có fixture
legacy Text với `m_FontSize`, `m_MinSize`, `m_MaxSize` và custom TTF.

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

Import Components from concrete modules, never a Component barrel.
Read the current `GameManager` implementation before wiring lifecycle. Its API is
`init`, `setHooks`, `loadLevel`, `startGame`, `pause`, `resume`, `endGame`, and
`unloadLevel`; do not invent `onGameReady/onGameWin` methods from old examples.

Honor the user's offline scope. If online services, tracking, purchases, or CTA
are excluded, do not start those services through a framework singleton. A local
session controller may own gameplay, transition, final win, and retry. Distinguish
completion of one level from completion of the configured level sequence.

---

## 5. Nguyên tắc bất biến & cổng xác minh

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->

## 6. Visual and runtime parity traps

Use [references/visual-parity.md](references/visual-parity.md) when debugging
sprite FTUE animation, nested HUD prefabs, mirrored hidden objects, or particles.
It explains which serialized values are easy to misinterpret and how to check
the actual runtime path. Keep project-specific sizing in JSON.

AnimationClip sample rate and stop time do not include `AnimatorState.m_Speed`.
Preserve that field on the generated Cocos Motion state. If project runtime
disables AnimationController and calls `cc.Animation.play()` directly, read the
source state speed from game config and assign it through `getState().speed`;
`play()` returns void. Compare every tutorial controller because different hand
and arrow states may intentionally use different speeds.

When a reported defect comes from reusable conversion code, fix that porter path
and add a focused regression alongside the project repair. Do not count a local
workaround as a repaired porter. After tool changes, sync generated AI guidance
and run contract verification; never edit generated command blocks by hand.

Unity FTUE spotlights are often composite UI: a center texture with a transparent
hole plus opaque extension panels on its four sides. Even when every RectTransform
ports correctly, different effective alpha at the center texture's outer pixels
and an adjoining extension creates a hard rectangular seam after Canvas scaling.
Inspect the source texture edge alpha and each panel color, then normalize the
mismatched join to the same effective opacity through game config. Check every
edge at the narrowest supported viewport; do not blindly change panels whose
source opacity already differs intentionally, and do not hide the symptom by
moving the camera, level mesh, focus target, or tutorial hand.
Fixed extension widths that cover a portrait reference can leave bright side
bands after rotation when a height-fitted Canvas becomes much wider. On every
Canvas size change, preserve the center hole dimensions, stretch top and bottom
panels to the Canvas width, and set each side panel width to half the remaining
Canvas width. Stretch solid modal dim sprites too. Validate portrait and landscape
with runtime bounds; a full-screen root RectTransform alone does not resize its
fixed-size composite children.

For a HUD tutorial spotlight, matching the serialized Unity transform can still
produce an opening that is visibly too loose around the current HUD control. Measure
the rendered control and the transparent inner bounds of the focus texture. Keep the
source feathered texture, size it from config into the required oval/rectangle, reset
any authored scale already baked into that size, and move Top/Bot/Left/Right panels to
the new half extents. Resizing only the center node leaves seams or uncovered bands;
changing the whole HUD scale moves the focus and control together without fixing their
relative gap. Validate the opening around the control at portrait and landscape sizes.

For Unity ParticleSystem trails, renderer material slot 0 is the particle and
slot 1 is the trail. Convert slot 1 with Cocos `builtin-particle-trail`, keep its
own texture, and preserve loop per emitter; an EOL prefab may mix looping color
bursts with one-shot launch rays. Unity legacy particle shaders use `_TintColor`;
Standard Particles uses `_Color`, including authored values above one. Resolve
the actual builtin shader file ID before choosing the color key or blend formula.
An unused vendor `_Color` alpha of zero must not erase a legacy particle or trail.
Before emitting
a shared runtime helper, search the complete `assets/script` subtree for the
same ccclass and reuse it to avoid duplicate class and UUID registration.

Cocos Creator 3.8.8 validates a CPU ParticleSystem material with a case-sensitive
substring check on the effect asset name: it must contain lowercase `particle`.
An effect named `HiddenSuspectParticleAlpha` can include the correct
`builtin/internal/particle-vs-legacy` ABI and render in isolation, yet ParticleSystem
still logs warning 6035 and refuses it. Name or rename the `.effect` asset with
lowercase `particle`, move its `.meta` alongside it to preserve UUID references, and
run `shader.validate`; the validator reports `PARTICLE_EFFECT_NAME_CASE` for this trap.

When Unity creates a looping hint with `Instantiate(prefab, worldPosition,
Quaternion.identity, owner)` and then calls `SetWorldScale(Vector3.one)`, preserve
all three semantics in Cocos: attach the effect to the target owner, keep the
authored world position/rotation while reparenting, and restore world scale to one.
Every source emitter with `moveWithTransform: 0` is Unity Local simulation and must
be Cocos Local (`_simulationSpace: 1`). A world-root effect or stale Cocos World
simulation may initially overlap the target but will drift when its owner transforms.
If the converter was fixed after an asset was generated, re-port or migrate that
prefab and audit every emitter; a newer porter does not repair committed old output.

Do not infer a lifetime from a looping hint's particle duration. When Unity calls
`SetParticleLoop(effect, true)` and stores the instance on its `FindableObject`,
the target owns that effect: it intentionally remains visible until
`TryMarkFound -> ClearHintEffect -> StopEmittingAndClear`, or until level teardown
destroys the owner. Preserve those release paths in the Cocos pool instead of
adding a timeout. Runtime acceptance should activate the hint, tap the exact hinted
target through the normal input path, and prove the target reference, active-effect
registry, node activity, and emitter playback are all cleared; also verify level
change clears an untouched hint.

Unity UI Particle uses `CanvasRenderer`, so its Canvas sorting can place it over
HUD graphics. Parenting a Cocos `ParticleSystem` under a Canvas does not provide
the same order: the 3D particle pass still runs before the UI batch. When the
effect must cross over HUD sprites, render only that effect through a dedicated
custom layer and an orthographic depth-only camera with priority above the UI
camera. Keep the background on a different layer and match the UI camera's
position, ortho height, near plane, and far plane.

### Preserve planar backdrop topology during import

Mesh Simplify must default to targetRatio=1, matching the importer reference.
A global ratio below 1 with unlocked boundaries can reduce a textured quad from
two triangles to one, cutting half the map while bounds and camera remain valid.
Keep Optimize and Compress enabled. Before approving reduction, compare source
and imported index counts for every submesh, especially planar backdrops; inspect
both levels in Preview. Repair through Asset DB, preserving UUIDs, and reload
the extension before reimport so an old listener cannot reapply the bad policy.

### Unity scene visual closure (source-backed regression gates)

- Preserve TextureImporter alpha source and sampler settings independently. `alphaUsage: 2` requires grayscale-derived alpha in the Cocos copy; `enableMipMap`, `filterMode`, and anisotropy must survive import. Never alter Unity source images. Use `texture-alpha.cjs` and `texture-sampling.cjs`, and keep their visual-import regression tests passing.
- Do not assume Cocos primitive UV0/UV1 matches Unity built-in meshes. For baked scenes, export the active renderer mesh, effective static-batch submesh, renderer matrix and both UV channels from Unity; compare geometry and lightmap UVs before tuning material brightness.
- Cocos EXR imports use RGBE. A Unity lightmap copied as EXR cannot be sampled by the built-in Cocos LDR lightmap decoder without an explicit decode adapter. Directional lightmaps also require Unity's normal-dependent direction decode. Keep visible sky and specular reflection separate.
- Unity SH coefficients and Cocos normalized SH coefficients are different representations. Use `spherical-harmonics.cjs`, flip the Z-odd terms when changing handedness, and verify interpolated samples against Unity. Cocos light-probe consumers must be movable; static default mobility can leave the SH buffer empty.
- Preserve baked-only lights without adding duplicate realtime lighting after baked lightmaps/probes are imported. Do not hide missing baked data by disabling lights without a verified bake replacement.
- Preview evidence must confirm the loaded SceneGlobals values. AssetDB refresh, scene-open and shader import can complete asynchronously; a soft reload response alone is not proof that new serialized state is active.
- RenderSettings fog is not proof of visible fog. Check the active camera rendering path and image effects. Built-in Deferred opaque rendering can ignore scene fog while forward transparent shaders still apply it. Use a source render with fog toggled and state restored to establish behavior before changing Cocos global fog.
### Keep invisible particle drivers running

`ParticleSystemRenderer.enabled=false` and render mode `None` hide geometry only.
They do not stop particle simulation, collision callbacks or sub-emitters. Never
map them to `cc.ParticleSystem.enabled=false`. The porter attaches
`UnityParticleRendererVisibility` to hide CPU particle/trail models separately.
Assert both an active simulation and an invisible renderer in Preview, then verify
that source collision and sub-emitter counts still advance. Birth sub-emitters
using rate-over-distance need an independent distance cursor per parent particle;
a fixed rate per second and a capped sample of parents are not equivalent.
