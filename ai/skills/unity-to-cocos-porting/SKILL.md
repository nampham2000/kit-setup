---
name: unity-to-cocos-porting
description: "Use when porting Unity assets, prefabs, components, transforms, physics, particle systems, or C# scripts to Cocos Creator 3.8.8+ Playable Ads."
argument-hint: "Unity asset or script to port"
---

# Unity to Cocos Creator 3.8.8+ Porting Skill

This skill provides step-by-step guidance and architectural rules for converting Unity hypercasual/casual gameplay into Cocos Creator 3.8.8+ TypeScript playable ads.

## 1. Automated Tooling First

Trước khi viết tay bất kỳ prefab / shader / script nào, dùng tool sẵn có.
Luôn hoàn tất rule generated `unity-preflight`: đọc compact `decision`, `features`, `obligationIndex`, `obligations`
và chỉ mở evidence slice được brief yêu cầu trước khi implement.
Khi `port.closure --copy-to` tạo staging ngoài Unity project, giữ nguyên `.unity-port-provenance.json`
và truyền `--unity-project <UnityProjectRoot>` cho `port.compile`; không copy/ghép thêm source vào staging đã ký.
Không đi vòng mutation gate qua symlink/reparse path. `--dry-run` phải hoàn toàn read-only; nếu thấy tool tạo
folder, `.meta`, chạy converter hoặc ghi output thì coi là lỗi gate và dừng workflow.
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
