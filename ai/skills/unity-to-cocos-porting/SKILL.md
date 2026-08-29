---
name: unity-to-cocos-porting
description: "Use when porting Unity assets, prefabs, components, transforms, physics, particle systems, or C# scripts to Cocos Creator 3.8.8+ Playable Ads."
argument-hint: "Unity asset or script to port"
---

# Unity to Cocos Creator 3.8.8+ Porting Skill

This skill provides step-by-step guidance and architectural rules for converting Unity hypercasual/casual gameplay into Cocos Creator 3.8.8+ TypeScript playable ads.

## 1. Automated Tooling First

Trước khi viết tay bất kỳ prefab / shader / script nào, dùng tool sẵn có.
Với port mới, golden entry là:

```bash
npm run ai:port:core:scaffold -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>
```

Lệnh dùng static provider trước, tạo core manifest, scene skeleton, wiring report và
`.ai/port/resume-packet.json`. Không mở cả cây Unity source để “lấy context” sau bước này.
Đọc `nextActions`, `staticFirst.wiring.todo` và port-report digest; chỉ mở evidence slice được chỉ định.

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

Sau khi porter sinh component/API mới, chạy `npm run engine:features -- ensure --project <CocosProjectRoot>`.
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

Khi Unity thay material qua vòng lặp `sharedMaterials`, Cocos phải thay/recolor mọi material slot của
renderer; slot 0 không đại diện cho toàn mesh. Khi object được attach vào slot, giữ phép biến đổi tương
đối của nguồn (`slot.worldRotation * localAttachRotation`) thay vì chỉ copy vị trí rồi để rotation identity.
Đối với screen drag, phát gesture thật ở cả ngang và dọc; không suy dấu rotation chỉ từ đổi handedness.

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

Auto-driver dùng để nghiệm thu nhiều lượt phải serialize qua các lifecycle phase này và ghi receipt win bất biến
theo `pass:level`; đừng suy level đã thắng từ một snapshot trong loading transition. Chọn deadline từ một lượt đo
thực tế rồi cộng headroom, và chỉ coi pass khi đủ receipt mong đợi, modal cuối đúng, cùng console/runtime sạch.

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
   - Use `playable-core/ObjectPool` or `NodePoolAdapter` instead of `instantiate()` during gameplay.
3. **Cocos Event System**:
   - Use `this.node.on(NodeEventType.TOUCH_START, this.onTouchStart, this);`
   - Always unregister events in `onDestroy()`: `this.node.off(NodeEventType.TOUCH_START, this.onTouchStart, this);`

---

## 4. Playable Ads Lifecycle Integration

All game managers must inherit or wire into `GameManager` from `playable-core`:
- `GameManager.instance.onGameReady()`: Ready for player input.
- `GameManager.instance.onGameStart()`: Player performed first touch.
- `GameManager.instance.onGameWin()`: Trigger EndCard & CTA button.
- `GameManager.instance.onGameLose()`: Trigger EndCard & CTA retry.
- `SuperHtmlPlayable.download()`: Redirect player to App Store / Google Play.

---

## 5. Nguyên tắc bất biến & cổng xác minh

<!-- BEGIN:GENERATED:core-rules -->
<!-- END:GENERATED:core-rules -->
