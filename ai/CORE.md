# CORE — Nguyên tắc bất biến của cc_playable_framework

> Sinh tự động từ `playable-shared-kit/ai/capabilities.def.cjs`. Không sửa tay.
> Mọi AI agent (Claude, Codex, Gemini, Copilot, Cursor) đều nạp cùng file này
> để ra quyết định giống nhau khi tool không nói rõ.

1. **config-driven** — Mọi tham số gameplay/CTA nằm trong `assets/resources/playable-config.json`, đọc qua `PlayableConfigManager.instance`. Không hardcode trong TS hay trên node của scene.
2. **zero-gc** — Không cấp phát trong `update(dt)`. Khai báo sẵn `Vec3` / `Quat` / `Color` ở module scope và tái sử dụng. Dùng `ObjectPool` cho spawner.
3. **verify-gate** — Sau mọi lần sửa code hoặc port: chạy `npm run ai:verify` và `npm run ai:lint`. Với port core Unity, còn phải chạy `npm run ai:port:core:verify` và chỉ kết luận runnable/fidelity khi acceptance pass.
4. **canonical-paths** — Script vào `assets/script/`, effect vào `assets/effects/`, config vào `assets/resources/`. Không tự tạo biến thể như `assets/scripts/`.
5. **severity** — Ngữ nghĩa severity trong report: `high` = mất hành vi hoặc mất hình ảnh, phải xử lý; `medium` = cần người quyết định; `low` = ghi chú thông tin. Không bỏ qua `high`.
6. **trust-but-verify** — Tool báo thành công KHÔNG đồng nghĩa kết quả đúng. Luôn mở ít nhất một file sinh ra để đối chiếu với nguồn trước khi kết luận.
7. **visual-checkpoints** — Khi port thay đổi camera, transform, material/shader, UI layout hoặc input fidelity, phải chạy `npm run ai:verify:visual -- --config <matrix.json>` trên Cocos preview với ảnh nguồn/các checkpoint phù hợp và mở ảnh kết quả. Với hành vi có oracle, dùng `requireEvalOk: true`; runtime-clean không được diễn giải thành pixel parity.
8. **camera-input-parity** — Khi port camera controls, phải mang đủ chuỗi nguồn: normalized slider, min/max multiplier dùng khi reset, mapping real zoom, camera position/FOV/pitch và transform scale/rotation listener. Reset rotation phải theo source (ví dụ Quaternion.identity), không chụp một runtime rotation làm mặc định. Drag Space.World phải kiểm chứng riêng thao tác sang phải và lên bằng gesture thật; không suy dấu chỉ từ handedness.
9. **async-lifecycle** — Tween/schedule/async callback phải giữ transition generation và đúng model instance; callback cũ không được mutate level mới. Sau `Node.destroy()` phải xóa reference sở hữu ngay vì Cocos destroy cuối frame. Input/QA auto-driver phải theo dõi và serialize mọi pending phase liên quan (peel, flight, close, appear), rồi nghiệm thu nhiều lượt bằng receipt win bất biến theo pass/level thay vì suy từ snapshot lúc loading.
10. **playable-core-first** — Mặc định chỉ port core gameplay closure từ `coreGameplay`: input, luật/state, movement/physics, spawn/timing, win-lose-restart và feedback cần để đạt fidelity. Main menu, shop/IAP, meta screen, persistence dài hạn và online SDK phải defer/replace; không đưa source implementation đó vào playable. Chỉ dùng full-project khi user yêu cầu rõ.
11. **static-first-resume** — Port mới bắt đầu bằng `ai:port:core:scaffold` (static provider mặc định); lượt tiếp tục bắt đầu bằng `ai:port:core:resume`. Agent phải đọc resume packet + wiring/report digest trước raw source, chỉ query bounded evidence cần thiết, và chạy resume `--write` trước interruption/handoff để lưu phase, blockers và nextActions.
12. **meta-files** — Không sửa tay file `.meta`. Luôn đi qua tool hoặc Cocos editor để giữ UUID nhất quán.
13. **unity-preflight** — Trước khi agent đọc raw Unity source hoặc chạy bất kỳ port tool có ghi output, BẮT BUỘC chạy `npm run ai:port:preflight -- --project <UnityProjectRoot>` (hoặc MCP `scanUnityProject`) và đọc `decision`, `coreGameplay`, `features`, `obligationIndex`, `coreObligationIndex`, `obligations`. Chỉ query evidence bounded khi brief yêu cầu. Hard blocker chặn implement; source high trong core/adapter phải được giải quyết, source high deferred phải có explicit out-of-scope disposition. Mutation receipt chỉ áp dụng cho Assets/package root đã khai báo; closure staging ngoài project phải có exact provenance và explicit --unity-project.

## Hợp đồng lệnh

Danh sách lệnh hợp lệ duy nhất nằm ở `playable-shared-kit/ai/CAPABILITIES.json`.
Nếu một lệnh trong tài liệu khác mâu thuẫn với file đó, **file đó đúng**.
Chạy `npm run ai:contract:verify` để chứng minh manifest khớp với CLI thật.

### Onboarding (chạy trước tiên)

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Bước đầu tiên của mọi task. Thay cho việc quét cây thư mục. | `npm run ai:map` | — |
| Cần biết cấu trúc scene trước khi sửa node/component. | `npm run ai:scene -- <sceneName>` | Component script hiện UUID thô, chưa giải ra tên class. |
| Trước khi giải một vấn đề nghe quen; sau khi giải xong thì ghi lại. | `npm run memory:query -- <keyword>` | Semantic recall cần `sqlite-vec` + `@xenova/transformers` (nặng ~283MB); thiếu thì tự động lùi về keyword. |
| Khi cần biết project có thể attach Editor đang mở hay chạy batch bằng đúng Unity version trước khi setup live scanner. | `npm run unity:intel:doctor -- --project <UnityProjectRoot>` | — |

### Port Unity → Cocos

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| Khi live scan cần cài lần đầu. Đây là write boundary rõ ràng: merge manifest atomically, cấu hình loopback, để Editor đang mở tự domain-reload hoặc chạy batch với đúng Editor. | `npm run unity:intel:setup -- --project <UnityProjectRoot>` | Có sửa `Packages/manifest.json` và `UserSettings/AI-Game-Developer-Config.json`; manifest có exact-byte backup + CAS transaction. Không khởi chạy Unity instance thứ hai khi UnityLockfile đang bị giữ và không kill Editor của người dùng. Project đóng chỉ được batch-launch khi có đúng Unity version khai báo; không âm thầm dùng version gần nhất. Compile error có sẵn trong Unity project có thể chặn package import/executeMethod; setup đọc bounded Editor.log tail theo đúng WorkingDir và trả UNITY_PROJECT_COMPILE_ERRORS với evidence gọn, không nạp toàn bộ log. Tool chỉ coi marker JSON hợp lệ là thành công, không tin exit code 0. Bootstrap scan đầu chỉ xác nhận import/domain reload. Tool rebuild static baseline rồi bắt buộc scan xác nhận lần hai; marker đầu không bao giờ authorize implement. Khi manifest/config đổi và Editor Windows đang mở, setup đọc EditorInstance.json rồi kiểm tra lại PID + exact -projectPath trước khi tự gửi Assets > Refresh; không gửi phím nếu metadata stale/mismatch. Platform không hỗ trợ vẫn dùng file watcher/readiness fail-closed. Editor đang mở có thể vẫn trả scanner cũ hoặc HTTP 502/503/504 trong lúc domain reload; readiness call không gửi field candidate mới, retry transient/version/capability mismatch đến deadline và chỉ chấp nhận đúng package 0.3.0, protocol 1, cùng candidateDisposition khi request có candidate. Trước reload, manifest/config rollback theo CAS và chỉ mutate sau khi tất cả target cùng qua validation. Sau khi reload bắt đầu, ownership có thể đã đổi nên tool fail-preserve toàn bộ setup generation; sửa compile/import error rồi chạy lại setup. Unity Editor disposition tối đa 512 unresolved GUID + 96 serialized asset paths; partial/truncated reference evidence không được clear source high. Live scanner duyệt nested/list SerializedProperty trên mọi sub-asset; reference evidence dùng GUID + local file ID, có budget toàn scan 512 reference/256 KiB và candidate array 768 KiB. Non-null reference không biểu diễn được buộc disposition partial. Scanner chỉ quan sát edit-time/imported assets; `playModeCapture=false`, không khẳng định GameObject chỉ sinh ở runtime. |
| BƯỚC DUY NHẤT đầu tiên trước khi agent đọc Unity source hoặc chạy tool có ghi output. Mặc định chọn gameplay scene/closure, loại menu-shop-online khỏi implementation route, giữ full high audit và cấp receipt theo source state. | `npm run ai:port:preflight -- --project <UnityProjectRoot>` | Mặc định không ghi Unity/Cocos project; receipt atomic <=4 KiB nằm trong user-local cache. Chỉ --bootstrap mới cài/reload Unity package. `--cache-dir` chỉ đổi incremental scan index; mutation receipt luôn nằm trong fixed user-local store để mọi port gate cùng đọc được. Hard source-integrity high chặn implement; DOTween/coroutine/animator/shader high trở thành nghĩa vụ implement/verify và không gây deadlock. Receipt hết hạn hoặc tự stale khi C#/prefab/shader/meta/manifest/project settings hay extractor thay đổi. Receipt chỉ authorize source trong Assets hoặc embedded/local/exact PackageCache root do manifest chọn. Temp/UserSettings/arbitrary project file bị từ chối; closure staging ngoài project cần provenance exact-hash do port.closure sinh. Directory walker/cache fail-closed với symlink, reparse point, absolute/traversal path; mọi --dry-run dừng trước mkdir, meta, converter và output write. Live candidate disposition là all-or-nothing theo bounded request: resolved GUID phải có path + complete dependency mappings; serialized asset phải có complete SerializedObject/reference evidence. Missing/partial trở thành authoritative live high. Brief giữ toàn bộ high code/count trong obligationIndex dù phải trim detail/evidence; chỉ query bounded khi evidenceQueries yêu cầu. Mặc định `--profile playable-core`: chỉ route gameplay closure và adapter cần cho playable; main menu/shop/meta/online SDK được explicit defer/replace nhưng vẫn nằm trong full high audit. Dùng `--profile full-project` chỉ khi brief thực sự yêu cầu. Fidelity 80-90 trong brief là acceptance target, không phải kết quả scan. Chỉ port.core.acceptance có runtime/build + checkpoint evidence mới được phép kết luận. Chỉ intent project (mặc định) cấp mutation receipt. Intent scene/prefab/script/shader/feature/diagnostic là focused analysis-only và không thể dùng để mở gate ghi output. Scanner edit-time đặt playModeCapture=false; object chỉ sinh runtime vẫn là coverage gap cần xác minh runtime. |
| Bước đầu implementation core playable. Lệnh tự chạy preflight playable-core, khóa gameplay entry/closure và tạo manifest evidence nhỏ để agent không phải đọc lại toàn project. | `npm run ai:port:core:init -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>` | Chỉ tạo manifest; không tự tuyên bố đã port gameplay. Refuse khi hard blocker hoặc gameplay entry còn mơ hồ. `--dry-run` dừng trước mkdir/write. Không overwrite manifest nếu thiếu `--force`; force dùng lock + compare-and-swap và giữ nguyên concurrent edit. Manifest schema v2 khóa exact gameplay entry output, 9 checkpoint/weight/mandatory, gate 80/90 và evidence contract; agent không thể tự hạ rubric. |
| Lệnh mặc định khi bắt đầu implementation port mới. Dùng static provider trước, sinh scene khung + wiring report, rồi lưu resume packet bounded để agent khác tiếp tục mà không đọc lại toàn source. | `npm run ai:port:core:scaffold -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>` | Mặc định provider=static. Chỉ nâng lên auto/unity-mcp khi preflight có uncertainty cụ thể mà static evidence không giải quyết được. Không overwrite target scene/wiring đang tồn tại; trạng thái một-nửa được report để agent đối chiếu trước khi regenerate. Scene và wiring chỉ được reuse khi receipt bind cùng Unity brief/state fingerprint và SHA-256 hiện tại của cả hai output. Static scene chỉ là geometry/component skeleton. Script, material, shader, prefab instance và runtime-only object vẫn phải xử lý theo wiring/obligation report. `--dry-run` không tạo manifest, scene, wiring, packet hoặc directory. |
| Bước đầu của mọi lượt tiếp tục một port đang dở. Đọc packet compact trước khi mở raw Unity source; dùng --write trước khi handoff/interruption để refresh packet trên disk. | `npm run ai:port:core:resume -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>` | Không scan hoặc dump raw Unity source; chỉ kiểm receipt/fingerprint, manifest, wiring summary và port-report digest. Tối đa 8 wiring task, 8 report code và 8 next action; raw CSV không được đưa vào chat. Exit khác 0 khi source stale, static scaffold chưa đủ hoặc report còn high; JSON vẫn chứa nextActions để agent tiếp tục. Packet không thay thế runtime/visual evidence và không được dùng để tuyên bố runnable/fidelity. |
| Dùng để xem compact inventory/diagnostics thuần khi không chuẩn bị implement. Với port workflow, dùng port.preflight thay vì gọi cả scan và port.plan. | `npm run ai:unity:scan -- --project <UnityProjectRoot>` | Mặc định read-only: provider auto không cài package. Chỉ --bootstrap mới ghi Unity project. Live patch bị từ chối nếu fingerprint project/editor khác static snapshot. Live scan nhận tối đa 512 unresolved GUID và 96 serialized path từ static snapshot. Chỉ disposition đầy đủ mới resolve static uncertainty; partial/truncated evidence vẫn giữ high. Khi --bootstrap, scan đầu chỉ chờ reload; static baseline được rebuild trước scan xác nhận authoritative lần hai. Bootstrap chỉ hoàn tất khi live patch đúng scanner 0.3.0/protocol 1; Editor đang domain-reload được retry có giới hạn thay vì yêu cầu setup thủ công lần hai. Không trả raw YAML/C# hoặc token; absolute filesystem path bị redaction trong compact projection. Edit-time scan không quan sát object chỉ sinh trong Play Mode; `playModeCapture=false`. |
| Sau port.preflight, chỉ gọi khi implementation brief yêu cầu evidence cụ thể. Thay cho việc đọc hàng loạt Unity YAML/C# hoặc dump toàn bộ MCP response. | `npm run ai:unity:query -- --project <UnityProjectRoot> --section <name>` | Cursor gắn với scanId + section + query; scan hoặc query khác làm cursor cũ bị từ chối. Full snapshot chỉ giữ nội bộ; output bỏ secret/raw source/absolute path và giới hạn evidence. |
| Legacy/deep dependency planner, chỉ gọi khi implementation brief của port.preflight chưa đủ. Không gọi mặc định cho cùng task/fingerprint để tránh scan và token lặp. | `npm run ai:port:plan -- --project <UnityProjectRoot>` | Provider auto thử live Unity-MCP rồi fallback static với diagnostic; dùng --provider unity-mcp khi muốn fail-fast nếu live scan thiếu. Mặc định chỉ đọc Unity/Cocos project. Chỉ --bootstrap mới cài package/config và reload Unity. Unity-side scanner chỉ quan sát edit-time; `playModeCapture=false`, không khẳng định object chỉ sinh runtime. Bootstrap dùng scan xác nhận lần hai trên rebuilt baseline; candidate disposition incomplete không được clear diagnostic. Incremental cache mặc định nằm trong user-local cache; dùng --no-cache để tắt. Library/PackageCache được coi là immutable theo contract của Unity Package Manager; nếu sửa tay package cache tại chỗ, chạy --refresh-cache. Registry package chỉ chọn exact manifest/lock version; git/local-tarball package chỉ chọn resolvedPath + fingerprint được context-matched projectResolution.json khóa, không đoán theo sibling cache gần tên. GUID index resolve cả Assets và package source đang cài; vendor/sample/editor vẫn nằm trong raw evidence nhưng mặc định bị lọc khỏi porting view. Dùng --include-vendor nếu chính package/sample đó là mục tiêu port. SerializedFile nhị phân được đọc khi còn type tree; asset bundle/stripped type tree được báo diagnostic và cần Unity-side scanner xác nhận. |
| Khi nguồn là file .unity chứ không phải .prefab — `port.prefab` KHÔNG xử lý scene. Sinh cây node + transform + component không cần asset, rồi để agent nối asset theo file wiring. | `npm run port:scene -- --scene <file.unity> --unity-root <UnityAssetsFolder> --out assets/<Name>.scene` | CHỈ sinh hình học. Mọi tham chiếu asset (sprite, material, font, script, animator, particle) để trống — đó là chủ ý, không phải thiếu sót. SpriteRenderer sinh ra `cc.Sprite` + `cc.UITransform` (giả định 2D). Scene 3D dùng sprite trong không gian thế giới cần agent đổi sang MeshRenderer + quad. MonoBehaviour KHÔNG được sinh component; chỉ ghi vào wiring kèm toàn bộ field đã serialize để agent port bằng `port.compile` rồi gán lại. Toạ độ được lật Z và đảo dấu X/Y của quaternion (Unity thuận tay trái, Cocos thuận tay phải). Script nào tự tính vị trí phải lật theo. Render settings mượn từ một scene có sẵn trong assets/; nếu project chưa có scene nào thì `_globals` để trống. |
| Ngay sau khi port. ĐỌC CÁI NÀY thay vì đọc CSV thô (đo được: 103k token -> 0,7k token). | `npm run ai:port:report` | Mặc định ẩn mã mức low; dùng --all để xem hết. |
| Chuyển prefab Unity thành .prefab của Cocos. Dùng --jobs 4 cho batch lớn. | `node playable-shared-kit/tools/unity-cocos-port.cjs port --src <unity_prefab_or_dir> --out <cocos_prefab_or_dir>` | Shader tuỳ biến KHÔNG được port bởi lệnh này — dùng `shader.chain` (cho cả prefab) hoặc `shader.convert` (cho một shader). Luôn đọc report và xử lý mọi dòng `high` trước khi coi là xong. Nếu Cocos Creator không mở, UUID sub-asset của sprite/model chưa nối được: report ghi rõ, mở editor rồi chạy lại. Cache theo phạm vi --src: sửa MỘT file trong phạm vi sẽ khiến cả phạm vi port lại (đổi lấy việc không bao giờ trả output cũ sai). Sau khi ghi asset, porter yêu cầu Cocos-MCP refresh `db://assets/unity_imported`, rồi kiểm tra cả importer state ở root và mọi `subMetas`; còn trạng thái `imported: false` thì fail thay vì để preview dùng asset hỏng. `--no-import-wait` chỉ dùng khi chủ ý tách bước import/finalize. Sau khi ghi output, porter tự chạy engine.features một lần cho cả batch: Profile API trước, guarded engine.json fallback sau; chỉ complete khi preview import map đã apply. Dùng --no-engine-feature-repair chỉ khi chủ ý tách bước này. |
| Port hàng loạt. Nên chạy `--dry-run` trước để xem report. | `npm run port:smart -- --src <unity_dir> --out assets/` | Cùng giới hạn tốc độ và shader như `port.prefab`. |
| CHẠY TRƯỚC port.compile khi cần port một prefab có gắn C# component: giải m_Script guid ra file .cs rồi mở rộng theo dependency. Đừng port cả Assets/ — closure của một prefab thường 10-50 file. | `npm run port:closure -- --prefab <file.prefab> --unity-root <UnityAssetsFolder>` | Dùng chung ScriptIndex của port.plan: hiểu GUID, partial class và .asmdef; type dependency vẫn suy ra bằng identifier lexical nên thiên về gom THỪA hơn bỏ SÓT. Default `--max-depth 2` là CHỦ Ý: closure bắc cầu hội tụ về gần cả project (đo trên BlastShooter: d1=11, d2=48, d8=400/648 file). Đọc `depthHistogram` + `byTopFolder` rồi quyết định tăng depth hay `--exclude`, đừng tăng bừa. Script nằm trong Packages/ hoặc trong DLL sẽ vào `unresolved` — không có .cs để port, phải tự viết lại bằng TypeScript. `--copy-to` chỉ cấp provenance sau khi từng staged byte khớp origin trong Assets/package root đã khai báo. File thêm/xóa/sửa hoặc marker bị chuyển directory sẽ làm compiler fail-closed. |
| Port script/logic C# sang TS: AI Agent LUÔN CHẠY LỆNH NÀY TRƯỚC TIÊN để tạo static first pass, sau đó đọc report và refine/polish gameplay semantics. | `npm run port:compile -- --src <csharp_path> --out assets/script/` | Output được type-check với `cc.d.ts` thật của engine trước khi chấm confidence, nên `confidence >= 0.9` nghĩa là file COMPILE được — vẫn KHÔNG xác nhận gameplay semantic equivalence. Đọc `validationScope.typescriptTypes` trước khi tin `typeErrorCount`: chỉ giá trị `checked` mới có nghĩa; `unavailable-cc-types` / `skipped-dry-run` / `disabled` nghĩa là KHÔNG BIẾT, không phải 0 lỗi. Type-check thêm ~1s cho 82 file; `--no-typecheck` bỏ qua nhưng khi đó confidence chỉ phản ánh chất lượng emit. Các file có TODO hoặc warning luôn cần AI refine; dùng `--runtime-only` để bỏ Unity Editor code khi port playable runtime. Mặc định giữ cấu trúc thư mục để tránh ghi đè basename; `--flat-output` chỉ dùng khi đã kiểm tra collision. CLI có ghi output bắt buộc receipt từ port.preflight. Khi compile closure staging ngoài Unity project, truyền `--unity-project <UnityProjectRoot>`; compiler kiểm tra project/receipt/provenance và exact hash của toàn bộ subtree trước lần ghi đầu. |
| Cần khung TS + @property từ script Unity. | `npm run port:script -- --src <csharp_path> --out assets/script/` | CHỈ sinh property và method rỗng — 100% logic phải do agent dịch tay từ file .cs gốc. Làm phẳng thư mục theo tên class; trùng tên sẽ ghi đè. Giá trị mặc định C# được chèn nguyên văn, có thể không compile. |
| DÙNG ĐẦU TIÊN khi cần port một prefab hoặc ScriptableObject chứa material-set active/disabled. Tự đi hết chuỗi asset -> material -> shader -> texture, transpile luôn, và chỉ in ra phần cần quyết định. Đừng tự đọc YAML của prefab/.asset/.mat. | `node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs chain --src <file.prefab|file.asset> --unity-root <UnityAssetsFolder>` | Không ghi Unity/Cocos project nếu thiếu --out-dir; mặc định chỉ đọc source, liệt kê và có thể cập nhật user-local incremental cache. Texture và mesh CHỈ được liệt kê, không tự import — phải tự đưa vào Cocos rồi mới bind được UUID. `_effectAsset` của .mtl để rỗng: UUID chỉ tồn tại sau khi Cocos import .effect. Chạy lại `shader.material` với --effect-uuid để bind. Material dùng shader built-in/package của Unity (không có file .shader) chỉ được BÁO TÊN — phải tự viết lại hoặc map sang effect built-in của Cocos. Index GUID được cache; thêm/xoá asset trong Unity thì chạy --no-cache. Cột `mode` của mỗi shader cho biết backend đã chạy (`unlit` hay `surface-pbr/urp\|legacy`). Shader PBR tự chọn surface-pbr — xem thêm giới hạn ở `shader.convert`. Exit code 5 khi còn dòng BLOCKING. |
| Cần dịch một shader Unity cụ thể sang .effect. Thân HLSL ĐƯỢC dịch sang GLSL, không phải template. | `node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs convert --src <unity.shader> --out <assets/effects/X.effect>` | Grade/score chỉ nói code SINH RA compile được, KHÔNG xác nhận đúng hình ảnh như Unity. Vẫn phải mở effect đối chiếu. `--unity-uv` MẶC ĐỊNH TẮT. Gốc texture của Unity ở dưới-trái, của Cocos ở trên-trái; bật cờ này thì texture được lấy mẫu qua texU() theo quy ước Unity. Bật khi shader chạy trên hình học mang UV từ Unity. KHÔNG lật UV của mesh để thay thế: cách đó làm ảnh đúng nhưng lặng lẽ đảo ngược mọi cách dùng uv.y thủ tục (gradient, gió cỏ, sọc hologram, UV clipping). Toán tử `%` trên float và fmod() được hạ thành hmod() (HLSL cắt về 0, GLSL mod() làm tròn xuống — lệch nhau khi toán hạng âm). Constructor ma trận được chuyển vị vì HLSL nhận theo hàng còn GLSL theo cột. Các helper này nằm trong lớp tương thích được inline sẵn vào effect. Shader PBR (URP `SurfaceData` + `UniversalFragmentPBR`, hoặc `#pragma surface` cũ) tự động chuyển sang `--mode surface-pbr`: sinh CCProgram surface-vertex/surface-fragment + include shading-entry của engine. In dòng `Mode:` để biết backend nào đã chạy. Ở surface-pbr, normal map tangent-space KHÔNG được sinh tự động (báo `SURFACE_PBR_NORMAL_MAP_MANUAL`); `GetMainLight().shadowAttenuation` luôn = 1.0 nên shadow của Unity KHÔNG được port. Struct nội bộ của URP ngoài `SurfaceData`/`InputData`/`Light`/`VertexPositionInputs` (ví dụ `InputDataForwardPlusDummy` của Toony Colors Pro) không có shim — sẽ báo `GLSL_UNDECLARED_BASE`, phải tự viết. Không có bản dịch nào cho input engine mà Cocos không cấp: `_CameraDepthTexture` (soft particle) sẽ luôn báo lỗi. DXC/SPIRV-Cross không bắt buộc; thiếu thì dùng AST lowerer thuần Node (xem `doctor`). |
| Chuyển nhiều shader một lượt (đo được: 110 shader trong 0,75s). | `node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs batch --dir <unity_shader_dir> --out-dir <assets/effects>` | Cùng giới hạn với `shader.convert`. In `[v]` cho mọi file GHI ĐƯỢC — KHÔNG phải mọi file đều compile-clean. Phải chạy `shader.validate` trên từng output. |
| Sau khi effect đã được Cocos import và có UUID. Mang color/float/texture + tiling/offset từ Unity sang. | `node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs convert-mat --src <UnityMaterial.mat> --out <assets/materials/X.mtl>` | Thiếu --effect-uuid thì `_effectAsset` rỗng và material rơi về effect mặc định — trông như port hỏng. Thiếu --effect thì GHI HẾT property Unity từng gán (URP Lit có ~50 cái), Cocos sẽ log unknown-property. Luôn truyền --effect để lọc. |
| Sau khi FBX đã nằm trong assets/ của Cocos và có .meta đi kèm. | `npm run fbx:strip -- <file.fbx>` | Nhận MỘT file, không nhận thư mục. Bắt buộc phải có `<file>.fbx.meta` bên cạnh — tức là chỉ chạy được SAU khi Cocos đã import. |

### Xác minh (bắt buộc)

| Khi nào dùng | Lệnh | Giới hạn cần biết |
| --- | --- | --- |
| BẮT BUỘC sau mọi lần `shader.convert` / `shader.batch`. Bắt sai arity intrinsic, vector constructor sai số thành phần, ký hiệu Unity chưa lower, biến chưa khai báo, sampler thiếu ở stage, swizzle vượt số thành phần của input engine. Hiểu cả effect surface-pbr (chấm điểm theo hook + include của engine, không đòi `vec4 frag()`). | `node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs validate <assets/effects/X.effect>` | Phân tích tĩnh, không chạy GLSL compiler thật: chứng minh được là SAI, không chứng minh được là ĐÚNG hình ảnh. Exit code 5 khi FAIL. |
| Sau port hoặc khi preview báo thiếu engine feature/backend. Tool suy luận từ component/API thực dùng, thử Cocos-MCP Profile API tối đa 2 lượt, rồi mới fallback exact-backup + lock + CAS patch engine.json và restart bằng 1_open-project.bat. | `npm run engine:features -- ensure --project <CocosProjectRoot>` | Unity dùng PhysX không tự động ép Cocos dùng backend nặng: Builtin cho collider query/trigger đơn giản; Cannon cho rigid-body/mesh cơ bản; Bullet cho CCD, sweep, character controller, capsule động và constraint nâng cao. Profile write hoặc engine.json patch chưa chứng minh runtime đã đổi. Chỉ complete khi active preview import-map chứa feature/backend yêu cầu. Fallback không blind-insert tên module lạ; schema/version phải hợp lệ, mọi module phải có sẵn trong cache của Cocos profile. Tool restart Editor nhưng không build game. |
| Cổng kết thúc port core. Tự chạy verify/lint/assets/build/runtime và chỉ accept khi score >=80, mọi mandatory behavior checkpoint có evidence. | `npm run ai:port:core:verify -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>` | Score là rubric parity có evidence, không phải pixel-perfect hoặc semantic proof tự động; target 90 và minimum accept 80. Compiler confidence, status boolean hoặc file tồn tại đơn lẻ không được tính điểm. Evidence schema v1 phải bind current brief/state/checkpoint và SHA-256 của từng Cocos target; target đổi làm evidence stale. Mandatory input/rules/win-lose chỉ nhận runtime, không nhận visual-only. Mặc định chạy tuần tự `ai:verify`, `ai:lint`, `ai:verify:assets`, `build`, `ai:verify:runtime`; dừng ở gate đầu thất bại, timeout/output bounded và redacted. `--no-run-gates` không thể trả accepted/runnable. |
| BẮT BUỘC sau mọi lần sửa code hoặc port. Phải sạch trước khi kết thúc lượt. | `npm run ai:verify` | — |
| Ngay sau khi port prefab. Bắt UUID treo, script thiếu, renderer chưa gán asset, node trùng tên. | `npm run ai:verify:prefab` | Đối chiếu script bằng tiền tố 5 hex của UUID; trùng tiền tố thì chấp nhận (thà bỏ sót hơn báo sai). |
| Ngay sau khi sinh/sửa asset (.effect, .mtl, .prefab, texture). Đây là check DUY NHẤT chứng minh editor chấp nhận asset — tsc/lint/build đều xanh mà playable vẫn trắng màn hình nếu importer từ chối. | `npm run ai:verify:assets` | Đọc `"imported": false` trong .meta, nên chỉ có ý nghĩa khi Cocos Creator đã từng quét thư mục. Asset chưa có .meta thuộc về `verify.all` (check Meta Files Integrity). Duyệt đệ quy cả importer state trong `subMetas`; root `imported: true` không được che texture/mesh/material con đang `imported: false`. Lý do lỗi lấy từ log của editor; log bị xoay vòng khi khởi động lại nên có thể chỉ báo được "chưa import" mà không có message. |
| Sau khi build, hoặc trỏ --url vào preview của editor khi chưa muốn build. Đây là bước duy nhất chứng minh playable CHẠY được, không chỉ compile được. | `npm run ai:verify:runtime` | Cần Chrome hoặc Edge trên máy (không dùng puppeteer). --url smoke-test một địa chỉ đang chạy (vd http://localhost:7456/ của editor preview) nên KHÔNG cần build; đổi lại không đo được kích thước file nên sizeKb = null. Mặc định chọn bản `build/common/` vì bản riêng cho từng network (applovin/facebook) luôn console.error do thiếu SDK của host. Dùng --all nếu muốn kiểm tra hết. Cửa sổ mặc định 720x1280 (dọc); nguồn landscape cần --window-size 1366x768 để khung hình so sánh được. Với URL Cocos Editor preview, --window-size chỉ đổi cửa sổ Chrome chứ không đổi device giả lập đang chọn. Dùng --preview-device WebpageFullScreen hoặc field previewDevice của verify.visual để kiểm đúng aspect Game panel; tool ghi device cũ, fail-closed nếu device không tồn tại/không settle và khôi phục device cũ trước khi đóng session. `--eval-before` chụp state trước thao tác; `--gesture` bật touch emulation trước khi tải trang và phát touch thật qua CDP để kiểm tra drag/swipe, gồm cả lỗi browser scroll ở trục dọc. `--gesture-keep-pressed` giữ touch đến sau eval/screenshot để kiểm hold/peek/fade, rồi luôn nhả touch trong cleanup. Phát hiện khung đơn sắc bằng cách so 3 vùng lấy mẫu, là suy luận theo dấu hiệu chứ không phải phân tích ảnh đầy đủ. |
| Khi port/preview có thay đổi camera, transform, material/shader, UI layout hoặc input fidelity và cần mở nhiều ảnh nguồn/candidate cạnh nhau để quyết định. | `npm run ai:verify:visual -- --config <matrix.json>` | Chỉ nhận URL preview http(s), reload từng case trong browser session độc lập và không tìm/chạy build. Mỗi case có thể dùng evalBefore/eval/gesture; ưu tiên evalBeforeFile/evalFile trong manifest để tránh lỗi shell quoting và lưu lại đúng phép thử. Đặt previewDevice ở manifest hoặc từng case khi cần khóa device/aspect của Cocos preview. Đừng dùng windowSize như bằng chứng rằng canvas đã đổi aspect; evidence ghi device/canvas đã settle và receipt khôi phục device trước đó để case không làm bẩn Editor/case sau. Với input/camera/reset có oracle định lượng, đặt `requireEvalOk: true`; eval cuối phải trả `true` hoặc JSON `{ok:true}`. Ảnh đẹp nhưng hướng drag, normalized zoom hoặc reset quaternion sai sẽ làm checkpoint fail. Runtime sạch và ảnh được chụp chỉ là evidence để agent/người dùng mở đối chiếu; tool không tự chứng minh pixel parity hoặc tự chọn candidate đẹp nhất. |
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
| Sau khi giải xong một vấn đề không hiển nhiên. | `npm run memory:remember -- --memory-file <file.json>` | — |
| Khi memory stats/query sai lệch, DB đến từ máy khác, hoặc trước khi sửa database. | `npm run memory:doctor -- --json` | Read-only; exit khác 0 khi một DB corrupt. Chạy memory.repair dry-run trước mọi sửa chữa. |
| Sau memory.doctor báo corrupt; dry-run phải xác nhận số row recover được trước. | `npm run memory:repair -- --scope <repo|global> --dry-run --json` | Bỏ row hỏng/NULL không thể phục hồi; không mutate khi dry-run; từ chối khi không recover được row hợp lệ. |

## Giới hạn đã biết

Những tool sau **không làm được việc mà tên gọi gợi ý**. Đọc kỹ trước khi tin kết quả:

- **`scene.inspect`** (npm run ai:scene -- <sceneName>)
  - Component script hiện UUID thô, chưa giải ra tên class.
- **`memory.query`** (npm run memory:query -- <keyword>)
  - Semantic recall cần `sqlite-vec` + `@xenova/transformers` (nặng ~283MB); thiếu thì tự động lùi về keyword.
- **`unity.intel.setup`** (npm run unity:intel:setup -- --project <UnityProjectRoot>)
  - Có sửa `Packages/manifest.json` và `UserSettings/AI-Game-Developer-Config.json`; manifest có exact-byte backup + CAS transaction.
  - Không khởi chạy Unity instance thứ hai khi UnityLockfile đang bị giữ và không kill Editor của người dùng.
  - Project đóng chỉ được batch-launch khi có đúng Unity version khai báo; không âm thầm dùng version gần nhất.
  - Compile error có sẵn trong Unity project có thể chặn package import/executeMethod; setup đọc bounded Editor.log tail theo đúng WorkingDir và trả UNITY_PROJECT_COMPILE_ERRORS với evidence gọn, không nạp toàn bộ log. Tool chỉ coi marker JSON hợp lệ là thành công, không tin exit code 0.
  - Bootstrap scan đầu chỉ xác nhận import/domain reload. Tool rebuild static baseline rồi bắt buộc scan xác nhận lần hai; marker đầu không bao giờ authorize implement.
  - Khi manifest/config đổi và Editor Windows đang mở, setup đọc EditorInstance.json rồi kiểm tra lại PID + exact -projectPath trước khi tự gửi Assets > Refresh; không gửi phím nếu metadata stale/mismatch. Platform không hỗ trợ vẫn dùng file watcher/readiness fail-closed.
  - Editor đang mở có thể vẫn trả scanner cũ hoặc HTTP 502/503/504 trong lúc domain reload; readiness call không gửi field candidate mới, retry transient/version/capability mismatch đến deadline và chỉ chấp nhận đúng package 0.3.0, protocol 1, cùng candidateDisposition khi request có candidate.
  - Trước reload, manifest/config rollback theo CAS và chỉ mutate sau khi tất cả target cùng qua validation. Sau khi reload bắt đầu, ownership có thể đã đổi nên tool fail-preserve toàn bộ setup generation; sửa compile/import error rồi chạy lại setup.
  - Unity Editor disposition tối đa 512 unresolved GUID + 96 serialized asset paths; partial/truncated reference evidence không được clear source high.
  - Live scanner duyệt nested/list SerializedProperty trên mọi sub-asset; reference evidence dùng GUID + local file ID, có budget toàn scan 512 reference/256 KiB và candidate array 768 KiB. Non-null reference không biểu diễn được buộc disposition partial.
  - Scanner chỉ quan sát edit-time/imported assets; `playModeCapture=false`, không khẳng định GameObject chỉ sinh ở runtime.
- **`port.preflight`** (npm run ai:port:preflight -- --project <UnityProjectRoot>)
  - Mặc định không ghi Unity/Cocos project; receipt atomic <=4 KiB nằm trong user-local cache. Chỉ --bootstrap mới cài/reload Unity package.
  - `--cache-dir` chỉ đổi incremental scan index; mutation receipt luôn nằm trong fixed user-local store để mọi port gate cùng đọc được.
  - Hard source-integrity high chặn implement; DOTween/coroutine/animator/shader high trở thành nghĩa vụ implement/verify và không gây deadlock.
  - Receipt hết hạn hoặc tự stale khi C#/prefab/shader/meta/manifest/project settings hay extractor thay đổi.
  - Receipt chỉ authorize source trong Assets hoặc embedded/local/exact PackageCache root do manifest chọn. Temp/UserSettings/arbitrary project file bị từ chối; closure staging ngoài project cần provenance exact-hash do port.closure sinh.
  - Directory walker/cache fail-closed với symlink, reparse point, absolute/traversal path; mọi --dry-run dừng trước mkdir, meta, converter và output write.
  - Live candidate disposition là all-or-nothing theo bounded request: resolved GUID phải có path + complete dependency mappings; serialized asset phải có complete SerializedObject/reference evidence. Missing/partial trở thành authoritative live high.
  - Brief giữ toàn bộ high code/count trong obligationIndex dù phải trim detail/evidence; chỉ query bounded khi evidenceQueries yêu cầu.
  - Mặc định `--profile playable-core`: chỉ route gameplay closure và adapter cần cho playable; main menu/shop/meta/online SDK được explicit defer/replace nhưng vẫn nằm trong full high audit. Dùng `--profile full-project` chỉ khi brief thực sự yêu cầu.
  - Fidelity 80-90 trong brief là acceptance target, không phải kết quả scan. Chỉ port.core.acceptance có runtime/build + checkpoint evidence mới được phép kết luận.
  - Chỉ intent project (mặc định) cấp mutation receipt. Intent scene/prefab/script/shader/feature/diagnostic là focused analysis-only và không thể dùng để mở gate ghi output.
  - Scanner edit-time đặt playModeCapture=false; object chỉ sinh runtime vẫn là coverage gap cần xác minh runtime.
- **`port.core.init`** (npm run ai:port:core:init -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>)
  - Chỉ tạo manifest; không tự tuyên bố đã port gameplay. Refuse khi hard blocker hoặc gameplay entry còn mơ hồ.
  - `--dry-run` dừng trước mkdir/write. Không overwrite manifest nếu thiếu `--force`; force dùng lock + compare-and-swap và giữ nguyên concurrent edit.
  - Manifest schema v2 khóa exact gameplay entry output, 9 checkpoint/weight/mandatory, gate 80/90 và evidence contract; agent không thể tự hạ rubric.
- **`port.core.scaffold`** (npm run ai:port:core:scaffold -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>)
  - Mặc định provider=static. Chỉ nâng lên auto/unity-mcp khi preflight có uncertainty cụ thể mà static evidence không giải quyết được.
  - Không overwrite target scene/wiring đang tồn tại; trạng thái một-nửa được report để agent đối chiếu trước khi regenerate.
  - Scene và wiring chỉ được reuse khi receipt bind cùng Unity brief/state fingerprint và SHA-256 hiện tại của cả hai output.
  - Static scene chỉ là geometry/component skeleton. Script, material, shader, prefab instance và runtime-only object vẫn phải xử lý theo wiring/obligation report.
  - `--dry-run` không tạo manifest, scene, wiring, packet hoặc directory.
- **`port.core.resume`** (npm run ai:port:core:resume -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>)
  - Không scan hoặc dump raw Unity source; chỉ kiểm receipt/fingerprint, manifest, wiring summary và port-report digest.
  - Tối đa 8 wiring task, 8 report code và 8 next action; raw CSV không được đưa vào chat.
  - Exit khác 0 khi source stale, static scaffold chưa đủ hoặc report còn high; JSON vẫn chứa nextActions để agent tiếp tục.
  - Packet không thay thế runtime/visual evidence và không được dùng để tuyên bố runnable/fidelity.
- **`unity.intel.scan`** (npm run ai:unity:scan -- --project <UnityProjectRoot>)
  - Mặc định read-only: provider auto không cài package. Chỉ --bootstrap mới ghi Unity project.
  - Live patch bị từ chối nếu fingerprint project/editor khác static snapshot.
  - Live scan nhận tối đa 512 unresolved GUID và 96 serialized path từ static snapshot. Chỉ disposition đầy đủ mới resolve static uncertainty; partial/truncated evidence vẫn giữ high.
  - Khi --bootstrap, scan đầu chỉ chờ reload; static baseline được rebuild trước scan xác nhận authoritative lần hai.
  - Bootstrap chỉ hoàn tất khi live patch đúng scanner 0.3.0/protocol 1; Editor đang domain-reload được retry có giới hạn thay vì yêu cầu setup thủ công lần hai.
  - Không trả raw YAML/C# hoặc token; absolute filesystem path bị redaction trong compact projection.
  - Edit-time scan không quan sát object chỉ sinh trong Play Mode; `playModeCapture=false`.
- **`unity.intel.query`** (npm run ai:unity:query -- --project <UnityProjectRoot> --section <name>)
  - Cursor gắn với scanId + section + query; scan hoặc query khác làm cursor cũ bị từ chối.
  - Full snapshot chỉ giữ nội bộ; output bỏ secret/raw source/absolute path và giới hạn evidence.
- **`port.plan`** (npm run ai:port:plan -- --project <UnityProjectRoot>)
  - Provider auto thử live Unity-MCP rồi fallback static với diagnostic; dùng --provider unity-mcp khi muốn fail-fast nếu live scan thiếu.
  - Mặc định chỉ đọc Unity/Cocos project. Chỉ --bootstrap mới cài package/config và reload Unity.
  - Unity-side scanner chỉ quan sát edit-time; `playModeCapture=false`, không khẳng định object chỉ sinh runtime.
  - Bootstrap dùng scan xác nhận lần hai trên rebuilt baseline; candidate disposition incomplete không được clear diagnostic.
  - Incremental cache mặc định nằm trong user-local cache; dùng --no-cache để tắt.
  - Library/PackageCache được coi là immutable theo contract của Unity Package Manager; nếu sửa tay package cache tại chỗ, chạy --refresh-cache.
  - Registry package chỉ chọn exact manifest/lock version; git/local-tarball package chỉ chọn resolvedPath + fingerprint được context-matched projectResolution.json khóa, không đoán theo sibling cache gần tên.
  - GUID index resolve cả Assets và package source đang cài; vendor/sample/editor vẫn nằm trong raw evidence nhưng mặc định bị lọc khỏi porting view. Dùng --include-vendor nếu chính package/sample đó là mục tiêu port.
  - SerializedFile nhị phân được đọc khi còn type tree; asset bundle/stripped type tree được báo diagnostic và cần Unity-side scanner xác nhận.
- **`port.scene`** (npm run port:scene -- --scene <file.unity> --unity-root <UnityAssetsFolder> --out assets/<Name>.scene)
  - CHỈ sinh hình học. Mọi tham chiếu asset (sprite, material, font, script, animator, particle) để trống — đó là chủ ý, không phải thiếu sót.
  - SpriteRenderer sinh ra `cc.Sprite` + `cc.UITransform` (giả định 2D). Scene 3D dùng sprite trong không gian thế giới cần agent đổi sang MeshRenderer + quad.
  - MonoBehaviour KHÔNG được sinh component; chỉ ghi vào wiring kèm toàn bộ field đã serialize để agent port bằng `port.compile` rồi gán lại.
  - Toạ độ được lật Z và đảo dấu X/Y của quaternion (Unity thuận tay trái, Cocos thuận tay phải). Script nào tự tính vị trí phải lật theo.
  - Render settings mượn từ một scene có sẵn trong assets/; nếu project chưa có scene nào thì `_globals` để trống.
- **`port.report`** (npm run ai:port:report)
  - Mặc định ẩn mã mức low; dùng --all để xem hết.
- **`port.prefab`** (node playable-shared-kit/tools/unity-cocos-port.cjs port --src <unity_prefab_or_dir> --out <cocos_prefab_or_dir>)
  - Shader tuỳ biến KHÔNG được port bởi lệnh này — dùng `shader.chain` (cho cả prefab) hoặc `shader.convert` (cho một shader).
  - Luôn đọc report và xử lý mọi dòng `high` trước khi coi là xong.
  - Nếu Cocos Creator không mở, UUID sub-asset của sprite/model chưa nối được: report ghi rõ, mở editor rồi chạy lại.
  - Cache theo phạm vi --src: sửa MỘT file trong phạm vi sẽ khiến cả phạm vi port lại (đổi lấy việc không bao giờ trả output cũ sai).
  - Sau khi ghi asset, porter yêu cầu Cocos-MCP refresh `db://assets/unity_imported`, rồi kiểm tra cả importer state ở root và mọi `subMetas`; còn trạng thái `imported: false` thì fail thay vì để preview dùng asset hỏng. `--no-import-wait` chỉ dùng khi chủ ý tách bước import/finalize.
  - Sau khi ghi output, porter tự chạy engine.features một lần cho cả batch: Profile API trước, guarded engine.json fallback sau; chỉ complete khi preview import map đã apply. Dùng --no-engine-feature-repair chỉ khi chủ ý tách bước này.
- **`port.smart`** (npm run port:smart -- --src <unity_dir> --out assets/)
  - Cùng giới hạn tốc độ và shader như `port.prefab`.
- **`port.closure`** (npm run port:closure -- --prefab <file.prefab> --unity-root <UnityAssetsFolder>)
  - Dùng chung ScriptIndex của port.plan: hiểu GUID, partial class và .asmdef; type dependency vẫn suy ra bằng identifier lexical nên thiên về gom THỪA hơn bỏ SÓT.
  - Default `--max-depth 2` là CHỦ Ý: closure bắc cầu hội tụ về gần cả project (đo trên BlastShooter: d1=11, d2=48, d8=400/648 file). Đọc `depthHistogram` + `byTopFolder` rồi quyết định tăng depth hay `--exclude`, đừng tăng bừa.
  - Script nằm trong Packages/ hoặc trong DLL sẽ vào `unresolved` — không có .cs để port, phải tự viết lại bằng TypeScript.
  - `--copy-to` chỉ cấp provenance sau khi từng staged byte khớp origin trong Assets/package root đã khai báo. File thêm/xóa/sửa hoặc marker bị chuyển directory sẽ làm compiler fail-closed.
- **`port.compile`** (npm run port:compile -- --src <csharp_path> --out assets/script/)
  - Output được type-check với `cc.d.ts` thật của engine trước khi chấm confidence, nên `confidence >= 0.9` nghĩa là file COMPILE được — vẫn KHÔNG xác nhận gameplay semantic equivalence.
  - Đọc `validationScope.typescriptTypes` trước khi tin `typeErrorCount`: chỉ giá trị `checked` mới có nghĩa; `unavailable-cc-types` / `skipped-dry-run` / `disabled` nghĩa là KHÔNG BIẾT, không phải 0 lỗi.
  - Type-check thêm ~1s cho 82 file; `--no-typecheck` bỏ qua nhưng khi đó confidence chỉ phản ánh chất lượng emit.
  - Các file có TODO hoặc warning luôn cần AI refine; dùng `--runtime-only` để bỏ Unity Editor code khi port playable runtime.
  - Mặc định giữ cấu trúc thư mục để tránh ghi đè basename; `--flat-output` chỉ dùng khi đã kiểm tra collision.
  - CLI có ghi output bắt buộc receipt từ port.preflight. Khi compile closure staging ngoài Unity project, truyền `--unity-project <UnityProjectRoot>`; compiler kiểm tra project/receipt/provenance và exact hash của toàn bộ subtree trước lần ghi đầu.
- **`port.script`** (npm run port:script -- --src <csharp_path> --out assets/script/)
  - CHỈ sinh property và method rỗng — 100% logic phải do agent dịch tay từ file .cs gốc.
  - Làm phẳng thư mục theo tên class; trùng tên sẽ ghi đè.
  - Giá trị mặc định C# được chèn nguyên văn, có thể không compile.
- **`shader.chain`** (node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs chain --src <file.prefab|file.asset> --unity-root <UnityAssetsFolder>)
  - Không ghi Unity/Cocos project nếu thiếu --out-dir; mặc định chỉ đọc source, liệt kê và có thể cập nhật user-local incremental cache.
  - Texture và mesh CHỈ được liệt kê, không tự import — phải tự đưa vào Cocos rồi mới bind được UUID.
  - `_effectAsset` của .mtl để rỗng: UUID chỉ tồn tại sau khi Cocos import .effect. Chạy lại `shader.material` với --effect-uuid để bind.
  - Material dùng shader built-in/package của Unity (không có file .shader) chỉ được BÁO TÊN — phải tự viết lại hoặc map sang effect built-in của Cocos.
  - Index GUID được cache; thêm/xoá asset trong Unity thì chạy --no-cache.
  - Cột `mode` của mỗi shader cho biết backend đã chạy (`unlit` hay `surface-pbr/urp|legacy`). Shader PBR tự chọn surface-pbr — xem thêm giới hạn ở `shader.convert`.
  - Exit code 5 khi còn dòng BLOCKING.
- **`shader.convert`** (node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs convert --src <unity.shader> --out <assets/effects/X.effect>)
  - Grade/score chỉ nói code SINH RA compile được, KHÔNG xác nhận đúng hình ảnh như Unity. Vẫn phải mở effect đối chiếu.
  - `--unity-uv` MẶC ĐỊNH TẮT. Gốc texture của Unity ở dưới-trái, của Cocos ở trên-trái; bật cờ này thì texture được lấy mẫu qua texU() theo quy ước Unity. Bật khi shader chạy trên hình học mang UV từ Unity. KHÔNG lật UV của mesh để thay thế: cách đó làm ảnh đúng nhưng lặng lẽ đảo ngược mọi cách dùng uv.y thủ tục (gradient, gió cỏ, sọc hologram, UV clipping).
  - Toán tử `%` trên float và fmod() được hạ thành hmod() (HLSL cắt về 0, GLSL mod() làm tròn xuống — lệch nhau khi toán hạng âm). Constructor ma trận được chuyển vị vì HLSL nhận theo hàng còn GLSL theo cột. Các helper này nằm trong lớp tương thích được inline sẵn vào effect.
  - Shader PBR (URP `SurfaceData` + `UniversalFragmentPBR`, hoặc `#pragma surface` cũ) tự động chuyển sang `--mode surface-pbr`: sinh CCProgram surface-vertex/surface-fragment + include shading-entry của engine. In dòng `Mode:` để biết backend nào đã chạy.
  - Ở surface-pbr, normal map tangent-space KHÔNG được sinh tự động (báo `SURFACE_PBR_NORMAL_MAP_MANUAL`); `GetMainLight().shadowAttenuation` luôn = 1.0 nên shadow của Unity KHÔNG được port.
  - Struct nội bộ của URP ngoài `SurfaceData`/`InputData`/`Light`/`VertexPositionInputs` (ví dụ `InputDataForwardPlusDummy` của Toony Colors Pro) không có shim — sẽ báo `GLSL_UNDECLARED_BASE`, phải tự viết.
  - Không có bản dịch nào cho input engine mà Cocos không cấp: `_CameraDepthTexture` (soft particle) sẽ luôn báo lỗi.
  - DXC/SPIRV-Cross không bắt buộc; thiếu thì dùng AST lowerer thuần Node (xem `doctor`).
- **`shader.batch`** (node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs batch --dir <unity_shader_dir> --out-dir <assets/effects>)
  - Cùng giới hạn với `shader.convert`.
  - In `[v]` cho mọi file GHI ĐƯỢC — KHÔNG phải mọi file đều compile-clean. Phải chạy `shader.validate` trên từng output.
- **`shader.material`** (node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs convert-mat --src <UnityMaterial.mat> --out <assets/materials/X.mtl>)
  - Thiếu --effect-uuid thì `_effectAsset` rỗng và material rơi về effect mặc định — trông như port hỏng.
  - Thiếu --effect thì GHI HẾT property Unity từng gán (URP Lit có ~50 cái), Cocos sẽ log unknown-property. Luôn truyền --effect để lọc.
- **`shader.validate`** (node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs validate <assets/effects/X.effect>)
  - Phân tích tĩnh, không chạy GLSL compiler thật: chứng minh được là SAI, không chứng minh được là ĐÚNG hình ảnh.
  - Exit code 5 khi FAIL.
- **`fbx.strip`** (npm run fbx:strip -- <file.fbx>)
  - Nhận MỘT file, không nhận thư mục.
  - Bắt buộc phải có `<file>.fbx.meta` bên cạnh — tức là chỉ chạy được SAU khi Cocos đã import.
- **`engine.features`** (npm run engine:features -- ensure --project <CocosProjectRoot>)
  - Unity dùng PhysX không tự động ép Cocos dùng backend nặng: Builtin cho collider query/trigger đơn giản; Cannon cho rigid-body/mesh cơ bản; Bullet cho CCD, sweep, character controller, capsule động và constraint nâng cao.
  - Profile write hoặc engine.json patch chưa chứng minh runtime đã đổi. Chỉ complete khi active preview import-map chứa feature/backend yêu cầu.
  - Fallback không blind-insert tên module lạ; schema/version phải hợp lệ, mọi module phải có sẵn trong cache của Cocos profile.
  - Tool restart Editor nhưng không build game.
- **`port.core.acceptance`** (npm run ai:port:core:verify -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>)
  - Score là rubric parity có evidence, không phải pixel-perfect hoặc semantic proof tự động; target 90 và minimum accept 80.
  - Compiler confidence, status boolean hoặc file tồn tại đơn lẻ không được tính điểm. Evidence schema v1 phải bind current brief/state/checkpoint và SHA-256 của từng Cocos target; target đổi làm evidence stale. Mandatory input/rules/win-lose chỉ nhận runtime, không nhận visual-only.
  - Mặc định chạy tuần tự `ai:verify`, `ai:lint`, `ai:verify:assets`, `build`, `ai:verify:runtime`; dừng ở gate đầu thất bại, timeout/output bounded và redacted. `--no-run-gates` không thể trả accepted/runnable.
- **`verify.prefab`** (npm run ai:verify:prefab)
  - Đối chiếu script bằng tiền tố 5 hex của UUID; trùng tiền tố thì chấp nhận (thà bỏ sót hơn báo sai).
- **`verify.assets`** (npm run ai:verify:assets)
  - Đọc `"imported": false` trong .meta, nên chỉ có ý nghĩa khi Cocos Creator đã từng quét thư mục. Asset chưa có .meta thuộc về `verify.all` (check Meta Files Integrity).
  - Duyệt đệ quy cả importer state trong `subMetas`; root `imported: true` không được che texture/mesh/material con đang `imported: false`.
  - Lý do lỗi lấy từ log của editor; log bị xoay vòng khi khởi động lại nên có thể chỉ báo được "chưa import" mà không có message.
- **`verify.runtime`** (npm run ai:verify:runtime)
  - Cần Chrome hoặc Edge trên máy (không dùng puppeteer).
  - --url smoke-test một địa chỉ đang chạy (vd http://localhost:7456/ của editor preview) nên KHÔNG cần build; đổi lại không đo được kích thước file nên sizeKb = null.
  - Mặc định chọn bản `build/common/` vì bản riêng cho từng network (applovin/facebook) luôn console.error do thiếu SDK của host. Dùng --all nếu muốn kiểm tra hết.
  - Cửa sổ mặc định 720x1280 (dọc); nguồn landscape cần --window-size 1366x768 để khung hình so sánh được.
  - Với URL Cocos Editor preview, --window-size chỉ đổi cửa sổ Chrome chứ không đổi device giả lập đang chọn. Dùng --preview-device WebpageFullScreen hoặc field previewDevice của verify.visual để kiểm đúng aspect Game panel; tool ghi device cũ, fail-closed nếu device không tồn tại/không settle và khôi phục device cũ trước khi đóng session.
  - `--eval-before` chụp state trước thao tác; `--gesture` bật touch emulation trước khi tải trang và phát touch thật qua CDP để kiểm tra drag/swipe, gồm cả lỗi browser scroll ở trục dọc.
  - `--gesture-keep-pressed` giữ touch đến sau eval/screenshot để kiểm hold/peek/fade, rồi luôn nhả touch trong cleanup.
  - Phát hiện khung đơn sắc bằng cách so 3 vùng lấy mẫu, là suy luận theo dấu hiệu chứ không phải phân tích ảnh đầy đủ.
- **`verify.visual`** (npm run ai:verify:visual -- --config <matrix.json>)
  - Chỉ nhận URL preview http(s), reload từng case trong browser session độc lập và không tìm/chạy build.
  - Mỗi case có thể dùng evalBefore/eval/gesture; ưu tiên evalBeforeFile/evalFile trong manifest để tránh lỗi shell quoting và lưu lại đúng phép thử.
  - Đặt previewDevice ở manifest hoặc từng case khi cần khóa device/aspect của Cocos preview. Đừng dùng windowSize như bằng chứng rằng canvas đã đổi aspect; evidence ghi device/canvas đã settle và receipt khôi phục device trước đó để case không làm bẩn Editor/case sau.
  - Với input/camera/reset có oracle định lượng, đặt `requireEvalOk: true`; eval cuối phải trả `true` hoặc JSON `{ok:true}`. Ảnh đẹp nhưng hướng drag, normalized zoom hoặc reset quaternion sai sẽ làm checkpoint fail.
  - Runtime sạch và ảnh được chụp chỉ là evidence để agent/người dùng mở đối chiếu; tool không tự chứng minh pixel parity hoặc tự chọn candidate đẹp nhất.
- **`audio.optimize`** (npm run sound:optimize)
  - Mặc định là dry-run; phải thêm `--write` mới ghi đè.
- **`assets.cleanup`** (npm run cleanup:unused)
  - NGUY HIỂM: asset vừa port nhưng chưa được scene/prefab nào tham chiếu sẽ bị liệt kê là unused.
  - KHÔNG chạy `--delete` ngay sau khi port.
- **`build.playable`** (npm run build)
  - Playable nên dưới 3.5 MB; verifier sẽ cảnh báo khi vượt.
- **`memory.doctor`** (npm run memory:doctor -- --json)
  - Read-only; exit khác 0 khi một DB corrupt. Chạy memory.repair dry-run trước mọi sửa chữa.
- **`memory.repair`** (npm run memory:repair -- --scope <repo|global> --dry-run --json)
  - Bỏ row hỏng/NULL không thể phục hồi; không mutate khi dry-run; từ chối khi không recover được row hợp lệ.
