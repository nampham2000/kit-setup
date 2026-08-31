# Cocos Playable Offline Audio Optimizer

`audio-optimizer.cjs` dùng FFmpeg offline để chuẩn hóa audio của playable. Policy mặc định có thể mang sang mọi project/máy qua shared kit:

- MP3;
- quality 30: CBR 32 kbps, 22.05 kHz;
- giữ nguyên số channel của từng nguồn (`mono` vẫn mono, `stereo` vẫn stereo);
- đổi extension bằng Cocos Asset DB move/reimport và xác nhận UUID không đổi;
- không sửa `.meta` trực tiếp.

## Lệnh chuẩn

```powershell
# Kiểm tra FFmpeg portable/system
npm run sound:optimize -- --doctor

# Dry-run toàn bộ audio trong assets
npm run sound:optimize

# Áp policy MP3/30/original-channel
npm run sound:optimize -- --write

# CI/final gate: fail nếu còn file lệch policy
npm run sound:optimize -- --verify
```

Nếu `assets/resources/sound` tồn tại, đó là scope mặc định; nếu không, tool quét toàn bộ `assets`. Có thể truyền file/thư mục cụ thể ở cuối lệnh.

## Channel policy

| Cờ | Hành vi |
| --- | --- |
| không truyền cờ / `--preserve-channels` | Không thêm `-ac`; FFmpeg giữ mono/stereo nguồn. Đây là mặc định. |
| `--mono` | Chủ động downmix mọi nguồn thành 1 channel. |
| `--stereo` | Chủ động ép mọi nguồn thành 2 channel. |

MP3 không biểu diễn được nguồn trên 2 channel. Với policy preserve, tool fail-closed thay vì âm thầm downmix; chỉ dùng `--stereo` khi đã quyết định chấp nhận mất channel.

## Asset DB và UUID

Khi chạy `--write` trên file trong `assets/`, Cocos Creator phải mở đúng project và Cocos MCP phải reachable. Quy trình đổi `.wav` sang `.mp3`:

1. encode ra thư mục temp ngoài Asset DB;
2. query UUID nguồn;
3. gọi `project_move_asset` từ URL `.wav` sang `.mp3`;
4. thay payload bằng MP3 đã encode;
5. gọi `project_reimport_asset`;
6. query lại và assert UUID không đổi;
7. rollback file/path nếu reimport hoặc UUID gate thất bại.

`--no-meta` chỉ dùng cho file standalone ngoài Cocos project. Không dùng nó để lách Asset DB trong playable.

## Các tùy chọn khác

- `--quality <10-100>` và `--bitrate <rate>`: override profile.
- `--sample-rate <Hz>`: override sample rate.
- `--skip-if-larger`: giữ nguồn nếu output lớn hơn; mặc định tắt vì policy yêu cầu mọi asset đúng MP3.
- `--backup`: giữ bản `.bak` của nguồn trước khi ghi.
- `--project <dir>` / `--mcp-url <url>`: chọn project/endpoint rõ ràng.
- `--output <dir>`: xuất bản standalone, không migrate asset gốc.
- `--json`: report máy đọc.

FFmpeg được resolve theo thứ tự: CLI, `FFMPEG_PATH`, `tools/dependency/ffmpeg`, `ffmpeg-static`, PATH hệ thống, đường dẫn cài đặt thông dụng.
