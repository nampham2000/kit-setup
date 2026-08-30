---
name: work-memory-workflow
description: "Use when querying past project solutions, bug traps, porting lessons, or storing new reusable discoveries into the Work Memory SQLite database."
argument-hint: "Query topic or lesson to remember"
---

# Work Memory Workflow Skill

Work Memory is a local SQLite database that stores architectural rules, debugging solutions, and porting lessons across projects for AI agents.

## 1. How to Query Work Memory

When starting a new task or encountering a tricky bug in Cocos 3.8:
- Use the `queryWorkMemory` MCP tool (available in Claude, Gemini, Copilot, Codex).
- Or query via CLI:
  ```bash
  npm run memory:stats
  npm run memory:query -- "shader"
  ```

---

## 2. How to Save New Lessons / Traps

Whenever you resolve a tricky bug or discover a reusable porting pattern:
1. **Via MCP Tool**: Call `rememberWorkMemory` with category, title, content, tags, and importance (0.0 - 1.0).
2. **Via HTML Comment in Chat**:
   Append a single-line hidden HTML comment to your response:
   ```html
   <!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"Cocos 3.8 Vec3 Math","content":"Never allocate new Vec3 in update() loops; reuse static temp variables.","tags":["cocos3.8","performance","memory"],"importance":0.9} -->
   ```
   - `scope: "global"`: Reusable across all playable projects.
   - `scope: "repo"`: Specific to the current game project.

3. **Via CLI file input** (ưu tiên khi JSON dài để tránh shell quoting):
   ```bash
   npm run memory:remember -- --memory-file .unity/work-memory-lessons.json --json
   ```

## 3. Correct a Disproven Memory

When runtime or visual evidence proves an existing lesson is wrong or too broad, do not append a competing lesson. Query with `--json` to obtain the exact memory id, then replace that row while preserving its scope:

```bash
npm run memory:query -- "renderer ownership transparent hold" --json
npm run memory:correct -- --id <memory-id> --scope global --category porting-note --title "Corrected lesson" --content-file .unity/corrected-memory.txt --json
npm run memory:doctor -- --json
```

Use `global` only for a lesson reusable by every project. The corrected content must name the disproven assumption and the evidence or regression oracle that replaces it.

## 4. Database Integrity and Portable Runtime

- Node 20 không có `node:sqlite`; project template phải khai báo `better-sqlite3` để keyword memory vẫn chạy.
- Khi query/stats có count mâu thuẫn hoặc DB được copy từ máy khác, chạy read-only doctor:
  ```bash
  npm run memory:doctor -- --json
  ```
- Nếu corrupt, luôn dry-run trước. Repair chỉ giữ row hợp lệ, di chuyển DB/WAL/SHM cũ nguyên byte vào backup directory,
  tạo DB mới, rebuild FTS, kiểm `integrity_check`, rồi mới có thể reindex semantic:
  ```bash
  npm run memory:repair -- --scope repo --dry-run --json
  npm run memory:repair -- --scope repo --reindex-semantic true --json
  ```
