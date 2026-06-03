# Work Memory CLI

Local-first memory storage for bug-fix notes, implementation lessons, commands, and Unity-to-Cocos porting knowledge.

Design goals:

- SQLite as the canonical local database.
- Hybrid scope: one shared DB plus one repo-partitioned DB under the shared kit.
- Startup warmup that builds a ranked hot working set for RAM preload.
- CLI-first workflow with a thin MCP wrapper so the same behavior is available from chat tools without duplicating storage logic.
- Optional semantic indexing and retrieval using `sqlite-vec` plus a real local multilingual embedding model, while SQLite remains the canonical store.

## Default storage locations

- Shared DB: `<repo>/playable-shared-kit/tools/work-memory/data/shared-memory.db`
- Repo DB: `<repo>/playable-shared-kit/tools/work-memory/data/repo/<repo-id>.db`
- Warm cache: `<repo>/playable-shared-kit/tools/work-memory/data/cache/<repo-id>-hot-cache.json`
- Shared capture inbox: `<repo>/playable-shared-kit/tools/work-memory/shared-capture.md`

The warm cache is written as portable JSON. Repo-local paths are emitted with a `<repo-root>/...` token so the cache can be reviewed or moved without embedding a developer-specific absolute folder.

With this layout, the tracked DB files stay inside `playable-shared-kit`, the repo DB is fragmented by `repo-id`, and the cache is fragmented by `repo-id` as well.

## Commands

Initialize databases:

```powershell
node playable-shared-kit/tools/work-memory.cjs init
```

Remember one note manually:

```powershell
node playable-shared-kit/tools/work-memory.cjs remember `
  --scope repo `
  --category bug-fix `
  --title "Sprite effect trap" `
  --content "Start from builtin-sprite.effect semantics or the sprite can disappear in preview." `
  --tags cocos,sprite,effect,preview `
  --source-path assets/effects/TestSpriteNodeShine.effect `
  --importance 0.9 `
  --confidence 0.95 `
  --pinned true
```

Save AI-generated memories directly:

```powershell
node playable-shared-kit/tools/work-memory.cjs remember-auto `
  --memory '{"scope":"global","category":"tip","title":"Preserve sprite semantics","content":"Preserve builtin sprite semantics when porting sprite effects.","tags":["shader","cocos","porting"]}'
```

Import hidden agent markers from a transcript:

```powershell
node playable-shared-kit/tools/work-memory.cjs import-agent-memories --transcript c:/tmp/session-transcript.json
```

Import an existing markdown or TODO file:

```powershell
node playable-shared-kit/tools/work-memory.cjs import-markdown `
  --file playable-shared-kit/tools/unity-cocos-port.TODO.md `
  --scope repo `
  --category porting-note `
  --tags unity,cocos,porting
```

Auto-discover and import repo note sources:

```powershell
node playable-shared-kit/tools/work-memory.cjs import-sources --scope repo
node playable-shared-kit/tools/work-memory.cjs import-sources --scope repo --include-reference true
```

Query memories:

```powershell
node playable-shared-kit/tools/work-memory.cjs query --text "particle rotation" --scope repo
node playable-shared-kit/tools/work-memory.cjs query --text "sprite effect preview" --scope hybrid --semantic hybrid --json
node playable-shared-kit/tools/work-memory.cjs query --text "preview sprites shader semantics" --scope repo --semantic only --prefer-cache false --json
```

Build a startup warm cache:

```powershell
node playable-shared-kit/tools/work-memory.cjs warmup --repo-limit 20 --global-limit 10
node playable-shared-kit/tools/work-memory.cjs inspect-cache --items true
```

Start a session in one command:

```powershell
node playable-shared-kit/tools/work-memory.cjs session-start --sync-sources true --hot-limit 8
```

Start the background watcher:

```powershell
node playable-shared-kit/tools/work-memory.cjs watch --poll-seconds 15
node playable-shared-kit/tools/work-memory.cjs watch --once --json
```

Rebuild semantic vectors explicitly:

```powershell
node playable-shared-kit/tools/work-memory.cjs reindex-semantic --force false
```

Show counts:

```powershell
node playable-shared-kit/tools/work-memory.cjs stats
```

## Recommended startup flow

At the beginning of a work session:

```powershell
node playable-shared-kit/tools/work-memory.cjs watch --poll-seconds 15
node playable-shared-kit/tools/work-memory.cjs query --text "current porting traps" --scope hybrid --semantic hybrid --prefer-cache true
```

`watch` runs the initial session sync once, keeps the warm cache fresh, and re-imports note sources whenever matching markdown files change.

For reusable cross-project lessons, append them to `playable-shared-kit/tools/work-memory/shared-capture.md`. The watcher imports that file into the shared DB automatically.

## MCP server

Workspace MCP config now lives in `.vscode/mcp.json` and starts `playable-shared-kit/tools/work-memory-mcp.cjs` as a local stdio server.

Available MCP tools:

- `queryWorkMemory` for lexical and semantic search.
- `rememberWorkMemory` for saving one or more memories through the same `remember-auto` normalization path.
- `workMemoryStats` for repo/shared counts and semantic status.

The MCP wrapper shells into `work-memory.cjs`, so query/save behavior stays aligned with the CLI, watcher, and hook flows.

## Auto-import source discovery

`import-sources` looks for workspace-visible markdown sources such as:

- `playable-shared-kit/tools/**/*.TODO.md`
- `**/*CHANGELOG*.md`
- `**/*summary*.md`, `**/*bugfix*.md`, `**/*postmortem*.md`
- `playable-shared-kit/tools/**/README*.md`
- `extensions/**/README*.md`
- `extensions/**/FEATURE_GUIDE*.md`

Large folders like `node_modules`, `library`, `temp`, and `assets` are skipped.

Default behavior favors high-signal sources only: TODOs, changelogs, summaries, and overrides. Reference docs are opt-in via `--include-reference true` so your hot cache does not get drowned by large manuals.

`watch` polls the discovered source set plus `shared-capture.md`. Any change in those files triggers a fresh import, semantic reindex attempt, and warm-cache rebuild.

## Agent autosave

Workspace hooks in `.github/hooks/work-memory.json` import hidden agent markers on `PreCompact`, `SubagentStop`, and `Stop`.

Future Copilot/Codex responses can append invisible HTML comments like:

```html
<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"Short title","content":"Concrete reusable lesson","tags":["cocos","porting"],"importance":0.85,"confidence":0.95} -->
```

The hook reads the transcript, extracts these markers, and saves them into the shared or repo DB automatically.

Optional override file:

- `.local-memory/source-overrides.json`

Example format:

```json
[
  {
    "path": "C:/notes/shared-porting-lessons.md",
    "sourceKind": "override-markdown",
    "category": "tip",
    "tags": ["shared", "porting"],
    "importance": 0.8,
    "confidence": 0.9
  }
]
```

This is the bridge to include extra local files that are outside the repo tree.

## Semantic layer

Phase 2 now uses `sqlite-vec` in the same SQLite database.

- Canonical records stay in `memory_items`.
- Semantic metadata is stored in `memory_embeddings`.
- Vector search lives in the `memory_vec` `vec0` virtual table.
- The default embedder is `@xenova/transformers` with `Xenova/paraphrase-multilingual-MiniLM-L12-v2` in quantized mode.
- Model files are cached locally under `%USERPROFILE%/.copilot-work-memory/models` by default.

This keeps the full semantic path local and works better for mixed English and Vietnamese notes than the old hash bootstrap.

## Ranking model

`warmup` and `query` both favor:

- pinned items
- higher importance
- higher confidence
- recent updates
- recent accesses
- FTS matches for exact terms, paths, and symbols
- semantic matches from the `sqlite-vec` index when enabled

## Workspace integration

- A workspace task now auto-runs `memory:watch` on folder open.
- Workspace setting `task.allowAutomaticTasks` should stay `on` so the watcher starts without prompting in a trusted workspace.
- `.vscode/mcp.json` exposes the `workMemory` MCP server for chat tools in this workspace.
- The `vscode-mcp-autostart` helper now starts all immediate workspace MCP servers and still delays `cocos-mcp` until `localhost:3000` is ready.
