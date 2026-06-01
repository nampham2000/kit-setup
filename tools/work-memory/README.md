# Work Memory CLI

Local-first memory storage for bug-fix notes, implementation lessons, commands, and Unity-to-Cocos porting knowledge.

Design goals:

- SQLite as the canonical local database.
- Hybrid scope: one global DB plus one repo-local DB.
- Startup warmup that builds a ranked hot working set for RAM preload.
- CLI-first workflow so it can be used before integrating with any MCP server or editor startup hook.
- Optional semantic indexing and retrieval using `sqlite-vec` plus a real local multilingual embedding model, while SQLite remains the canonical store.

## Default storage locations

- Global DB: `%USERPROFILE%/.copilot-work-memory/global-memory.db`
- Repo DB: `<repo>/.local-memory/repo-memory.db`
- Warm cache: `<repo>/.local-memory/hot-cache.json`

The warm cache is written as portable JSON. Repo-local paths are emitted with a `<repo-root>/...` token so the cache can be reviewed or moved without embedding a developer-specific absolute folder.

## Commands

Initialize databases:

```powershell
node tools/work-memory.cjs init
```

Remember one note manually:

```powershell
node tools/work-memory.cjs remember `
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

Import an existing markdown or TODO file:

```powershell
node tools/work-memory.cjs import-markdown `
  --file tools/unity-cocos-port.TODO.md `
  --scope repo `
  --category porting-note `
  --tags unity,cocos,porting
```

Auto-discover and import repo note sources:

```powershell
node tools/work-memory.cjs import-sources --scope repo
node tools/work-memory.cjs import-sources --scope repo --include-reference true
```

Query memories:

```powershell
node tools/work-memory.cjs query --text "particle rotation" --scope repo
node tools/work-memory.cjs query --text "sprite effect preview" --scope hybrid --semantic hybrid --json
node tools/work-memory.cjs query --text "preview sprites shader semantics" --scope repo --semantic only --prefer-cache false --json
```

Build a startup warm cache:

```powershell
node tools/work-memory.cjs warmup --repo-limit 20 --global-limit 10
node tools/work-memory.cjs inspect-cache --items true
```

Start a session in one command:

```powershell
node tools/work-memory.cjs session-start --sync-sources true --hot-limit 8
```

Rebuild semantic vectors explicitly:

```powershell
node tools/work-memory.cjs reindex-semantic --force false
```

Show counts:

```powershell
node tools/work-memory.cjs stats
```

## Recommended startup flow

At the beginning of a work session:

```powershell
node tools/work-memory.cjs session-start --sync-sources true --repo-limit 25 --global-limit 10 --hot-limit 8
node tools/work-memory.cjs query --text "current porting traps" --scope hybrid --semantic hybrid --prefer-cache true
```

This keeps SQLite on disk as the source of truth while loading a ranked working set into process memory for fast first queries.

## Auto-import source discovery

`import-sources` looks for workspace-visible markdown sources such as:

- `tools/**/*.TODO.md`
- `**/*CHANGELOG*.md`
- `**/*summary*.md`, `**/*bugfix*.md`, `**/*postmortem*.md`
- `tools/**/README*.md`
- `extensions/**/README*.md`
- `extensions/**/FEATURE_GUIDE*.md`

Large folders like `node_modules`, `library`, `temp`, and `assets` are skipped.

Default behavior favors high-signal sources only: TODOs, changelogs, summaries, and overrides. Reference docs are opt-in via `--include-reference true` so your hot cache does not get drowned by large manuals.

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

## Suggested next integration

- A workspace task now auto-runs `memory:session-start` on folder open.
- If you later want deeper integration, expose `query` or `remember` through the existing `cocos-mcp-server` startup path after the standalone flow is stable.
