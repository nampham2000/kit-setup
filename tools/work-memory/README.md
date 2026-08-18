# Work Memory Guide (SQLite Persistent Memory)

Hệ thống lưu trữ và truy vấn tri thức, bài học kinh nghiệm và bẫy lỗi (trap prevention) dạng SQLite cục bộ cho AI Agent và Developer.

---

## ⚡ Các Lệnh Thường Dùng

### 1. Truy Vấn Kinh Nghiệm / Bẫy Lỗi (Query Memory)
```bash
npm run memory:query -- <keyword>
# Ví dụ: npm run memory:query -- shader
```

### 2. Xem Thống Kê Dữ Liệu Bộ Nhớ (Memory Stats)
```bash
npm run memory:stats
```

### 3. Ghi Nhớ Bài Học Mới Thủ Công (Remember Note)
```bash
node playable-shared-kit/tools/work-memory.cjs remember \
  --category bug-fix \
  --title "Sprite effect trap" \
  --content "Luôn giữ builtin-sprite semantics khi port shader để tránh mất sprite." \
  --tags cocos,shader,sprite
```

### 4. Tự Động Ghi Nhớ Từ AI Chat Marker
AI Agent chỉ cần chèn marker sau vào câu trả lời để hệ thống tự động nạp vào SQLite:
```html
<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"Tiêu đề","content":"Nội dung kinh nghiệm","tags":["tag1","tag2"]} -->
```
