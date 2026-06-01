# Playable Build Tools

`playable-build` contains the Cocos playable build helper tools.

Run the shared-kit entrypoint from the Cocos project root:

```powershell
node playable-shared-kit/tools/playable-build.cjs doctor
npm run doctor
```

## Layout

- `playable-shared-kit/tools/playable-build.cjs` is the CLI entrypoint used by `package.json`.
- `playable-shared-kit/tools/playable-build/playable-cli.cjs` contains the build, install, config export, and subtree pull logic.
- `playable-shared-kit/tools/playable-build/playable-cli.config.cjs` contains local defaults for Cocos discovery, install folders, ad platform retention, and subtree settings.
- `playable-shared-kit/tools/playable-build/playable-cli.config_TEMPLATE.cjs` is the fallback template used when the config file is missing.
- `playable-shared-kit/tools/playable-build/build_project.*`, `install_all.*`, and `subtree_pull.*` jump back to the project root before invoking the shared-kit CLI.

## NPM Scripts

```powershell
npm run doctor
npm run setup
npm run setup:fast
npm run build
npm run build:fast
npm run build:seq
npm run build:maxcpu
npm run build:Short
npm run build:Mid
npm run build:Long
npm run subtree:pull
```
