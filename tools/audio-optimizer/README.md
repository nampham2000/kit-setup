# Cocos Playable Offline Audio Optimizer (FFmpeg)

Bộ công cụ tối ưu hóa âm thanh (SFX & BGM) offline cho playable ads trong Cocos Creator 3.8.x sử dụng FFmpeg.

## Tính năng chính

- **Format Conversion**: Convert hàng loạt SFX/BGM sang `mp3` hoặc `ogg` (hoặc `wav` / giữ nguyên).
- **Mức tối ưu chất lượng linh hoạt**: Hỗ trợ các preset `20%`, `30%`, `40%`, `50%`, `60%`, `70%`, `80%` (hoặc custom 10..100%).
- **Cơ chế tìm FFmpeg Offline đa tầng**: Tự động nhận diện từ CLI flag, biến môi trường, thư mục portable `dependency/ffmpeg`, package `ffmpeg-static`, system PATH hoặc standard OS paths.
- **Đồng bộ Cocos Creator `.meta`**: Khi đổi định dạng (ví dụ `.wav` -> `.mp3` / `.ogg`), tool cập nhật `.meta` và giữ nguyên **UUID** gốc, bảo đảm Scene và Prefab không bao giờ bị đứt reference.
- **Chế độ Mono & Hạ Sample Rate**: Tự động chuyển mono và hạ sample rate (32kHz / 22kHz / 16kHz) giúp giảm 50% - 90% dung lượng âm thanh cho playable ads (<2MB / <5MB).
- **An toàn Dry-Run & Backup**: Chạy preview bảng dung lượng trước khi ghi thật bằng `--write`, hỗ trợ `--backup` và `--skip-if-larger`.

---

## Bảng mức tối ưu hóa (Quality Levels)

| Mức Quality | MP3 Bitrate | OGG Quality | Sample Rate | Kênh (Channels) | Mức giảm dung lượng | Khuyến nghị sử dụng |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **80%** | 128 kbps | q4 (~128k) | 44.1 kHz | Stereo / Source | ~20% - 30% | Nhạc nền BGM chất lượng cao |
| **70%** | 112 kbps | q3 (~112k) | 44.1 kHz | Stereo / Source | ~30% - 40% | BGM thông dụng |
| **60%** | 96 kbps | q2 (~96k) | 32.0 kHz | Mono | ~40% - 50% | Voice & SFX tiêu chuẩn |
| **50%** *(mặc định)* | 64 kbps | q1 (~64k) | 32.0 kHz | Mono | ~50% - 65% | **Chuẩn Playable SFX phổ biến** |
| **40%** | 48 kbps | q0 (~48k) | 24.0 kHz | Mono | ~65% - 75% | Tiếng click/pop ngắn |
| **30%** | 32 kbps | ~32k | 22.05 kHz | Mono | ~75% - 85% | SFX siêu nhẹ cho playable giới hạn |
| **20%** | 20-24 kbps | ~24k | 16.0 kHz | Mono | ~85% - 92% | Playable siêu nhẹ (<2MB, Unity/IronSource) |

---

## Hướng dẫn sử dụng CLI

### 1. Kiểm tra môi trường FFmpeg
```bash
node playable-shared-kit/tools/audio-optimizer.cjs --doctor
```

### 2. Xem trước tối ưu hóa (Dry-Run)
```bash
# Xem trước convert toàn bộ âm thanh trong assets/resources/sound sang MP3 chất lượng 50%
node playable-shared-kit/tools/audio-optimizer.cjs --format mp3 -q 50 assets/resources/sound

# Xem trước convert sang OGG chất lượng 40%
node playable-shared-kit/tools/audio-optimizer.cjs --format ogg -q 40 assets/resources/sound
```

### 3. Thực hiện chuyển đổi và áp dụng thật (`--write`)
```bash
# Convert sang MP3 50% và ghi đè
node playable-shared-kit/tools/audio-optimizer.cjs --format mp3 -q 50 --write assets/resources/sound

# Convert sang OGG 40% và ghi đè
node playable-shared-kit/tools/audio-optimizer.cjs --format ogg -q 40 --write assets/resources/sound
```

### 4. Tối ưu file đơn lẻ có backup
```bash
node playable-shared-kit/tools/audio-optimizer.cjs --format mp3 -q 60 --write --backup assets/resources/sound/BGM.mp3
```

### 5. Tùy chọn nâng cao
- `--mono` / `--stereo`: Ép kênh mono hoặc stereo.
- `-r, --sample-rate <Hz>`: Chỉ định sample rate (ví dụ `16000`, `22050`, `32000`, `44100`).
- `-b, --bitrate <rate>`: Chỉ định bitrate cụ thể (ví dụ `32k`, `48k`, `64k`).
- `--skip-if-larger`: Bỏ qua nếu file sau tối ưu lớn hơn file gốc.
- `--output <dir>`: Xuất ra thư mục riêng biệt thay vì ghi đè.
- `--json`: Xuất kết quả dạng JSON phục vụ CI/CD hoặc AI workflow.

---

## Cài đặt FFmpeg Offline

Tool hỗ trợ nhiều cách kích hoạt FFmpeg:
1. **Qua npm (Đã cài sẵn trong project)**: `ffmpeg-static`.
2. **Portable FFmpeg**: Tải bản build portable của FFmpeg và đặt vào thư mục `playable-shared-kit/tools/dependency/ffmpeg/bin/ffmpeg.exe`.
3. **Cài qua Package Manager**:
   - Windows: `winget install Gyan.FFmpeg` hoặc `choco install ffmpeg` hoặc `scoop install ffmpeg`.
   - macOS: `brew install ffmpeg`.
   - Linux: `sudo apt install ffmpeg`.
4. **Chỉ định đường dẫn trực tiếp**:
   ```bash
   node playable-shared-kit/tools/audio-optimizer.cjs --ffmpeg-path "D:/tools/ffmpeg/bin/ffmpeg.exe" ...
   ```
