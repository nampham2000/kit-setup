# Playable Build Guide

Run commands from the project root:

```powershell
cd D:\_Projects\CC3\@puzzle\GrillFever-Playable-Cocos
```

## 1. Check Environment

```powershell
npm run doctor
```

The doctor command checks the project root, Cocos Creator discovery, build configs, builder profile, install folders, and git status. If Cocos is not found automatically, set one of these:

```powershell
$env:COCOS_CREATOR = "C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe"
npm run doctor
```

or pass it directly:

```powershell
node playable-shared-kit/tools/playable-build.cjs doctor --cocos "C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe"
```

## 2. Install Dependencies

Clean install all configured project folders:

```powershell
npm run setup
```

Fast install without removing `node_modules` first:

```powershell
npm run setup:fast
```

Configured install folders are in `playable-shared-kit/tools/playable-build/playable-cli.config.cjs`.

## 3. Export Build Configs

If `profiles/v2/packages/builder.json` contains Cocos builder tasks, export them into `configs/*.json`:

```powershell
node playable-shared-kit/tools/playable-build.cjs export-build-configs
```

The generated configs are the inputs for the build commands.

## 4. Build Playables

Build every config under `configs/`:

```powershell
npm run build
```

Useful variants:

```powershell
npm run build:fast
npm run build:seq
npm run build:maxcpu
```

Brief-specific shortcuts:

```powershell
npm run build:Short
npm run build:Mid
npm run build:Long
```

You can also run a custom brief name directly:

```powershell
node playable-shared-kit/tools/playable-build.cjs build --brief brief1
```

## 5. Pull Playable Core

```powershell
npm run subtree:pull
```

Subtree defaults are in `playable-shared-kit/tools/playable-build/playable-cli.config.cjs`.
