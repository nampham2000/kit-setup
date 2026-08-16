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
  node playable-shared-kit/tools/work-memory.cjs query --keyword "shader"
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
