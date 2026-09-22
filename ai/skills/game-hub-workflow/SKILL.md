---
name: game-hub-workflow
description: Create or refresh a portable browser game hub from selected playable brief builds in a Cocos playable framework project. Use when a developer asks for a game hub, brief review page, sequential playable gallery, or a hub containing named gameplay briefs.
---

# Game Hub Workflow

Use the shared generator instead of copying a project-specific hub by hand:

```powershell
node playable-shared-kit/tools/game-hub.cjs create `
  --brief <first-brief> --brief <second-brief> `
  --title "<review title>" --out game-hubs/<hub-id>
```

Brief order on the command line is playlist order. The tool reads merged
`gameplay.briefs`, validates each `configs/<brief>.json`, and stages the exact
`<config.name>_common_min.html` output. Use `--all` only when the request truly
includes every brief.

## Build and verification

- If any selected artifact is missing or stale, rerun with `--build`; use
  `--jobs <n>` only when parallel Cocos builds are appropriate for the project.
- Run `node playable-shared-kit/tools/game-hub.cjs verify --out <hub-dir>` after
  generation. Open `index.html` through an HTTP server and exercise selection,
  Previous, Replay, Next, query deep linking, iframe load, and CTA interception
  before claiming browser acceptance.
- `create` is idempotent and only removes files recorded in `.game-hub.json`.
  A non-owned output directory requires explicit `--force`; inspect it first.
- Keep the generated hub in the project when it is a reusable QA/delivery
  artifact. The shared template remains in `playable-shared-kit`.

Generating a hub does not authorize deployment. Use the project's configured
deployment workflow only when the user asks to publish, and keep local staging,
live HTTP checks, and bundle-size acceptance as separate evidence.
