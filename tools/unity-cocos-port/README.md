# Unity to Cocos Creator Porting Guide

Công cụ chuyển đổi tự động Prefabs, Meshes, Materials và C# Scripts từ Unity sang Cocos Creator 3.8.8+.

---

## ⚡ Các Lệnh Sử Dụng

### 1. Smart Port (Khuyên Dùng - Tự Động Toàn Diện)
Chuyển đổi trọn gói cả Prefabs, Materials và C# Scripts trong 1 lệnh duy nhất:
```bash
npm run port:smart -- --src <unity_folder> --out assets/
```

### 2. Scaffold C# Scripts sang TypeScript
Tự động dịch mã C# sang Cocos 3.8 TypeScript kèm chuẩn Zero-GC:
```bash
npm run port:script -- --src <file.cs_or_dir> --out assets/script/
```

### 3. Port Riêng Lẻ Prefab
```bash
node playable-shared-kit/tools/unity-cocos-port.cjs port --src <unity_prefab> --out assets/prefabs/ --overwrite
```

### 4. Kiểm Tra Môi Trường & Kết Nối (Doctor)
```bash
node playable-shared-kit/tools/unity-cocos-port.cjs doctor
```

---

## 📋 Thành Phần Tự Động Chuyển Đổi

| Unity Component | Cocos Creator 3.8.8+ |
| :--- | :--- |
| `GameObject` / `Transform` | `Node` + `UITransform` |
| `MeshRenderer` / `MeshFilter` | `MeshRenderer` + Built-in / Custom Mesh |
| `SpriteRenderer` | `Sprite` |
| `BoxCollider` / `SphereCollider` | `BoxCollider` / `SphereCollider` 3D |
| `Rigidbody2D` / `BoxCollider2D` | `RigidBody2D` / `BoxCollider2D` |
| `Camera` / `Light` | `Camera` / `DirectionalLight` |
| `MonoBehaviour` (C#) | `@ccclass` Component (TypeScript) |
| `[SerializeField]` fields | `@property` decorators |
| `DOTween` animations | `cc.tween(this.node)` |
