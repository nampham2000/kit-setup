# Công cụ Thống kê Tài nguyên & Tối ưu Dung lượng (Resource Stats Tool)

`resource-stats.cjs` là công cụ phân tích và tối ưu hóa dung lượng Playable Ads toàn diện dành cho Cocos Creator 3.8.8, giúp phát hiện sớm các lãng phí tài nguyên, đưa ra cảnh báo kích thước texture vượt chuẩn hiển thị, phát hiện texture trùng lặp bằng thuật toán thị giác (Perceptual Hashing), và bóc tách các bẫy phình size trong file 3D FBX / Audio / Engine.

---

## Tính năng nổi bật

### 1. Phân bổ Dung lượng & Chuẩn Ad Networks (Resource Allocation Breakdown)
- Thống kê chi tiết từng nhóm tài nguyên:
  - **3D Models (ưu tiên FBX)**: Dung lượng, số lượng mesh, tổng số tam giác (triangles) và đỉnh (vertices).
  - **Textures & Sprites**: Kích thước, định dạng (PNG/JPG), kênh alpha (RGBA vs RGB), 9-slice.
  - **Audio Assets**: Định dạng, sample rate, số kênh (Mono/Stereo), bitrate, thời lượng.
  - **Gameplay & Shared Code**: Số dòng code TypeScript, dung lượng mã nguồn, kích thước SDK.
  - **Engine Runtime**: Đọc `settings/v2/packages/engine.json` và ước tính kích thước engine theo các module bật/tắt.
- Đánh giá dung lượng so với hạn mức của các mạng quảng cáo hàng đầu: **Google Ads (5MB)**, **AppLovin (5MB)**, **Unity Ads (5MB)**, **IronSource (2MB)**, **TikTok / Mintegral (2MB)**, **Facebook Ads (2MB)**.

---

### 2. Cảnh báo Texture Quá To so với Node Transform (Wasted Resolution Check)
- Tự động duyệt qua toàn bộ Scene (`.scene`) và Prefab (`.prefab`) trong `assets/`.
- Đối chiếu giữa kích thước thực của Texture gốc ($W_{\text{raw}} \times H_{\text{raw}}$) với kích thước Node hiển thị trên màn hình:
  $$\text{Rendered Size} = \text{UITransform.contentSize} \times \text{Node.scale}$$
- Tính toán tỷ lệ lãng phí diện tích pixel (**Waste Ratio**):
  $$\text{Waste Ratio} = \frac{\text{Texture Area}}{\text{Rendered Display Area}}$$
- Phân loại cảnh báo:
  - ⚠️ **WARN**: Waste Ratio $\ge 2.0\times$
  - 🚨 **CRITICAL**: Waste Ratio $\ge 4.0\times$ (Ví dụ: Texture $512 \times 512$ gắn vào Node $77 \times 77$ $\rightarrow$ Lãng phí **$44.2\times$** diện tích pixel, gây tốn băng thông tải về và bộ nhớ GPU vô ích).
- Đề xuất kích thước texture tối ưu và ước tính số KB tiết kiệm được.

---

### 3. Phát hiện Texture Trùng lặp & Tương đồng Thị giác (Perceptual Similarity $\ge 90\%$)
- **Trùng khớp tuyệt đối 100%**: Sử dụng SHA-256 hash để phát hiện các file giống hệt nhau về nội dung nhưng đặt tên hoặc nằm ở thư mục khác nhau.
- **Tương đồng thị giác $\ge 90\%$ (dHash & aHash)**:
  - Viết bằng **Pure Node.js** (sử dụng core `zlib`), giải nén PNG scanlines và hạ mẫu về thumbnail grid.
  - Tính toán Difference Hash (dHash) và khoảng cách Hamming.
  - Phát hiện các ảnh giống nhau $\ge 90\%$ (icon đổi màu nhẹ, button thêm bớt viền, asset import lặp lại từ nhiều pack).

---

### 4. Phân tích Bẫy Phình Size Chuyên sâu (Deep-Dive Diagnostics)
- **FBX Embedded Textures vs External Material Overrides**:
  - Quét cấu trúc nhị phân FBX (`Objects/Texture`, `Objects/Material`).
  - Kiểm tra xem các node `cc.MeshRenderer` trong game có đang gán vật liệu ngoài (`.mtl`) hay không.
  - Nếu đã gán `.mtl` ngoài, cảnh báo toàn bộ texture/material nhúng bên trong FBX đang là payload thừa và cung cấp lệnh dọn dẹp ngay bằng `strip-fbx-textures.cjs`.
- **Audio MP3/30 giữ nguyên channel**:
  - Phát hiện WAV chưa nén, bitrate hoặc sample rate cao.
  - Gợi ý `npm run sound:optimize -- --write`; tool giữ nguyên mono/stereo thay vì tự downmix.
- **Font đang dùng có coverage đa ngôn ngữ**:
  - Chỉ phân tích font được map vào build hoặc được scene/prefab tham chiếu.
  - Đọc Unicode `cmap` của TTF/OTF/WOFF1 và character table của BMFont, báo các script ngoài Basic Latin, glyph thừa so với text được phát hiện và cơ hội subset ước tính.
  - Đây là cảnh báo để tối ưu về sau; phải verify glyph sau khi tạo subset, không tự cắt font mù.
- **Unused Engine Modules**:
  - Phát hiện module 3D Physics hoặc Skeletal Animation được bật trong `engine.json` nhưng không có node nào trong project sử dụng, gợi ý tắt để giảm $200\text{KB} - 400\text{KB}$ engine code.

---

## Hướng dẫn Sử dụng

### 1. Chạy qua NPM Scripts

```powershell
# Báo cáo tổng quan trên Terminal CLI
npm run stats

# Xuất báo cáo HTML trực quan (kèm biểu đồ và bảng so sánh)
npm run stats:html

# Xuất dữ liệu JSON phục vụ CI/CD hoặc automation pipelines
npm run stats:json

# Kiểm tra môi trường và tính toàn vẹn của asset database
npm run stats:doctor
```

---

### 2. Các cờ lệnh tùy chỉnh (CLI Flags)

```powershell
# Chỉ định tỷ lệ lãng phí tối thiểu để cảnh báo (mặc định 2.0x)
node playable-shared-kit/tools/resource-stats.cjs --min-waste 3.0

# Chỉ định độ tương đồng ảnh tối thiểu để bắt duplicate (mặc định 90%)
node playable-shared-kit/tools/resource-stats.cjs --min-similarity 85

# Xuất báo cáo HTML ra đường dẫn tùy ý
node playable-shared-kit/tools/resource-stats.cjs --html build/reports/stats.html

# Bật chế độ verbose xem chi tiết
node playable-shared-kit/tools/resource-stats.cjs -v
```

---

## Ví dụ Báo cáo Terminal

```text
==============================================================================
🚀 COCOS PLAYABLE ADS - RESOURCE ALLOCATION & OPTIMIZATION REPORT
==============================================================================

📊 PLAYABLE HEALTH SCORE: 79/100 | TOTAL ASSETS SIZE: 807.8 KB (Est. Bundle with Engine: 2.27 MB)

🌐 AD NETWORK BUDGET STATUS:
  • Google Ads           Max: 5MB | Usage:  15.8% | ✔ PASS
  • AppLovin             Max: 5MB | Usage:  15.8% | ✔ PASS
  • Unity Ads            Max: 5MB | Usage:  15.8% | ✔ PASS
  • IronSource           Max: 2MB | Usage:  39.4% | ✔ PASS
  • TikTok / Mintegral   Max: 2MB | Usage:  39.4% | ✔ PASS
  • Facebook Ads         Max: 2MB | Usage:  39.4% | ✔ PASS

📦 RESOURCE ALLOCATION BREAKDOWN:
  --------------------------------------------------------------------------
  CATEGORY                      COUNT         SIZE    % TOTAL DETAILS         
  --------------------------------------------------------------------------
  3D Models (FBX/GLTF)              1     324.2 KB      40.1% 1 fbx (4,200 tris)
  Textures & Images                 3     193.5 KB      23.9% 3 images        
  Audio Assets                      4      52.2 KB       6.5% 4 sound files   
  Gameplay Scripts (TS/JS)          7      34.8 KB       4.3% 1133 lines of TS
  Shared Core & SDK                12      52.8 KB       6.5% 1592 lines of TS
  Scenes & Prefabs                  2     144.2 KB      17.8%                 
  Materials & Effects               4       6.2 KB       0.8%                 
  --------------------------------------------------------------------------
  TOTAL ASSET FOOTPRINT            33     807.8 KB     100.0%

⚠️  OVERSIZED TEXTURES VS NODE TRANSFORMS (2 found):
  1. [CRITICAL 44.21x] icon_L11-Pic2.png in assets/Gameplay.scene
     Node: Canvas/TutorialHand (Simple)
     Raw Texture: 512x512 (191.2 KB) -> Display Size: 77x77
     → Recommended: 128x128 (Save ~143.4 KB)

🎯 TOP QUICK WINS (HIGHEST SIZE REDUCTION IMPACT):
  1. [Textures] Downscale 2 Oversized Textures (>= 2x waste ratio) -> Save 286.9 KB
  2. [Engine] Prune Unused Cocos Engine Modules in engine.json -> Save ~250 KB
  3. [Models] Strip Embedded Textures from 1 FBX Model(s) -> Save 129.7 KB
  4. [Audio] Optimize 4 Audio File(s) to 32kHz Mono MP3/OGG -> Save 18.3 KB
==============================================================================
```
