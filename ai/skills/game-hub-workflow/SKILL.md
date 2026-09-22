---
name: game-hub-workflow
description: Create or refresh portable game hubs and run the batch build, package, and Netlify or GitHub Pages delivery pipeline for selected playable briefs. Use when a developer asks for a game hub, brief review page, sequential playable gallery, CI/CD delivery, parallel brief builds, or one-command deployment.
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

## Batch build and delivery

When the user asks to build several briefs, package one or more hubs, and deploy
them as one operation, use the delivery pipeline instead of chaining ad-hoc
commands:

```powershell
npm run delivery:init
# Edit configs/playable-delivery.json once.
npm run delivery
```

- `delivery:init` discovers current `gameplay.briefs` and creates the config,
  `.github/workflows/playable-delivery.yml`, and `PLAYABLE_DELIVERY.md` without
  overwriting customized files.
- `npm run delivery` validates the complete config before writes, builds every
  unique brief in one parallel invocation, creates all configured hubs, verifies
  their hashes, assembles `.delivery/site`, then deploys to Netlify or GitHub
  Pages only after all gates pass.
- Use `npm run delivery:prepare` for package-only output and
  `npm run delivery:verify` for read-only verification. Use `--dry-run` before a
  first deployment or credential change.
- Netlify requires `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`. GitHub Actions
  build jobs require a Windows self-hosted runner with Cocos Creator installed;
  the Pages and Netlify publish jobs use hosted runners.
