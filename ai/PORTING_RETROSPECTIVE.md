# Consolidated porting experience

Consolidated on 2026-09-13 for the clean `cc_playable_framework/main` starter.
Game scenes, levels, captured art and project-specific acceptance receipts stay
on their game branches. Historical game results are evidence for the lessons,
not a claim that a newly created game has passed those checks.

| Project branch | Project revision | Shared-kit source | Reusable lessons |
| --- | --- | --- | --- |
| `games/tape_jam` | `14e59fd` | `69aac26` | Preserve full animation callback graph, hold/drag composition, first-hit occlusion, pooled attachment scale, material ownership, color-space and audio lifecycle. Validate repeated complete runs. |
| `games/harvest_tile` | `3fd0487` | `04cd5e2` | Preserve staggered indexed match callbacks; audit ScriptableObject feedback dependencies, particle distribution, first-use render cost, actual SFX playback, font glyph coverage and static resource ownership. |
| `games/hidden_suspect` | `d243f96` | `f536fe1` | Preserve RectTransform anchors, Best Fit text, sliced borders, responsive FTUE masks, target-owned looping hints and UI particle camera/order. Measure runtime mesh indices after importer optimization. |
| `codex/port-2d-pixel-light` | `8ff6c2b` | `11be402` | Select indexed sample entry scenes explicitly; replay discrete sprite GUID/fileID and Animator state/transition samples; validate lights, physics and restarts separately. Query AssetDB metadata separately from asset info. |
| `codex/port-dragon-crashers` | `bdce710` | `0723022` | Keep combat live when baking unsupported native character rendering; preserve queues and ordered damage/audio events. Use real potion/pause/retry gestures, isolate capture helpers, retain offline scope and stage audio on the destination volume. |

The integration includes shared-kit `origin/main` at `f9921b4` and both the
Dragon Crashers and Harvest Tile tool histories. Binary Work Memory snapshots
were compared by ID and update date: 104 distinct historical records were
retained, including the newer BGM and regression-closure corrections. Global
records are pinned and have no machine-specific `sourcePath`. Additional
Pixel Light, Dragon Crashers and starter lessons are saved in the same database.

## Lessons to apply before implementing a new port

1. Run `ai:map`, query Work Memory, then scan the Unity project through the
   compact static/live tools. Lock the actual entry scene and dependency closure.
   Naming heuristics and a package-specific TLS warning do not prove that the
   source project or all live evidence is unusable.
2. Apply required Cocos features and verify the active preview. Keep one
   decorated Component per module and import Components from concrete files.
   Use the actual current `GameManager` API; legacy `onGameReady/onGameWin`
   examples do not describe this framework.
3. Keep tuning in JSON. Trace input ownership, lifecycle callbacks, render
   ownership, animation events, audio playback and font/layout semantics from
   source. Importer counts or a requested audio play are not runtime evidence.
4. Preserve topology by default. A previous mesh simplify ratio of 0.8 removed
   half a two-triangle map. The current default is ratio 1; validate actual
   indices and source UUIDs after reimport. Do not resurrect the old workaround.
5. Start regression coverage from the behavior at risk: discrete animation
   identity, callback sequence, real input, lifecycle generations, visible VFX,
   first-use frame cost and source-bound image regions. A narrow image score
   never establishes whole-game parity.
6. Preview acceptance uses `--preview-only --preview-url http://127.0.0.1:7456/`.
   It does not establish packaged readiness. Build acceptance additionally
   requires a current build and runtime smoke of that output.

## Starting a new project

```powershell
git submodule update --init --recursive
npm run setup
# Or run playable-shared-kit/scripts/0_setup-all.bat on Windows.
# Setup also copies all shared BAT/SH launchers to the project root.
```

Setup uses the pinned kit, installs copy-based local packages and extension
runtime dependencies, deploys provider skills, and checks memory/contracts.
It stops on the first failed step. It preserves game identity, scenes and
settings. It does not fetch or replace the pinned shared-kit revision.

Open `1_open-project.bat`, select `assets/Gameplay.scene`, and preview. Then run:

```powershell
npm run ai:portable:doctor
npm run ai:verify
npm run ai:lint
npm run ai:verify:assets
npm run ai:verify:runtime -- --url http://127.0.0.1:7456/
```

Use the actual preview port if another editor already occupies 7456. Each open
project also needs its own MCP port in `settings/mcp-server.json`; never stop an
unrelated editor to free a port. Local cache and repo memory are not portable
source. Commit the shared-kit change first and pin that exact commit in the
framework; use `sync:shared` and `ai:sync` whenever the kit is updated.

## Source references

- Tape Jam: `docs/porting/TAPE_JAM_PORT_REPORT.md` at `14e59fd` and subsequent
  30-level/audio/optimization commits on the same branch.
- Harvest Tile: source tool changes and regression tests in `04cd5e2`,
  `26042d2`, `0998b90`, `46cb374`, `92fbe0d`, `7786c44`, `77545d8`.
- Hidden Suspect: project `reports/hidden-suspect/*work-memory*.json`,
  `.unity/hidden-suspect/work-memory-*.json`, and shared memory at `f536fe1`.
- Pixel Light: `docs/pixel-light-port-status.md` at `8ff6c2b`.
- Dragon Crashers: `docs/dragon-crashers/README.md` and
  `docs/dragon-crashers/validation-summary.json` at `bdce710`.
