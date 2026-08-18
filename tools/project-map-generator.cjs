#!/usr/bin/env node
'use strict';

/**
 * Project Map Generator for AI Agents
 *
 * Scans the Cocos Creator 3.8.x Playable project and produces a high-density,
 * low-token JSON summary (ai/PROJECT_MAP.json). This allows AI agents (Codex,
 * Claude, Gemini, Copilot) to instantly understand project architecture, assets,
 * config schemas, and available CLI tools in a single step (<500 tokens).
 */

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
  ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
  : (findProjectRoot(process.cwd()) || process.cwd());

const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const RESOURCES_DIR = path.join(ASSETS_DIR, 'resources');
const CONFIG_FILE = path.join(RESOURCES_DIR, 'playable-config.json');
const SHARED_KIT_AI_DIR = path.join(ROOT_DIR, 'playable-shared-kit', 'ai');
const OUTPUT_MAP_FILE = path.join(SHARED_KIT_AI_DIR, 'PROJECT_MAP.json');

function walkDir(dir, filterFn, maxDepth = 6, currentDepth = 0) {
  if (!fs.existsSync(dir) || currentDepth > maxDepth) return [];
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'library' || entry.name === 'temp' || entry.name === 'local') {
          continue;
        }
        results = results.concat(walkDir(fullPath, filterFn, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        if (!filterFn || filterFn(entry.name, fullPath)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Ignore unreadable dirs
  }
  return results;
}

function getFileSizeKb(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return Math.round((stats.size / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

function scanProjectMeta() {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  } catch {}

  let orientation = 'landscape';
  try {
    const projSettings = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'settings', 'v2', 'packages', 'project.json'), 'utf8'));
    if (projSettings && projSettings.general && projSettings.general.designResolution) {
      const res = projSettings.general.designResolution;
      orientation = res.height > res.width ? 'portrait' : 'landscape';
    }
  } catch {}

  return {
    projectName: pkg.name || 'cc_playable_framework',
    cocosVersion: (pkg.creator && pkg.creator.version) || '3.8.8',
    orientation,
    designResolution: orientation === 'portrait' ? '720x1280' : '1280x720',
    configPath: 'assets/resources/playable-config.json'
  };
}

function scanScenes() {
  const sceneFiles = walkDir(ASSETS_DIR, (name) => name.endsWith('.scene'));
  return sceneFiles.map((fullPath) => {
    const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
    const name = path.basename(fullPath, '.scene');
    return {
      name,
      path: relPath,
      sizeKb: getFileSizeKb(fullPath)
    };
  });
}

function scanPrefabs() {
  const prefabFiles = walkDir(ASSETS_DIR, (name) => name.endsWith('.prefab'));
  return prefabFiles.map((fullPath) => {
    const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
    const name = path.basename(fullPath, '.prefab');
    return {
      name,
      path: relPath,
      sizeKb: getFileSizeKb(fullPath)
    };
  });
}

function scanScripts() {
  const scriptFiles = walkDir(ASSETS_DIR, (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
  return scriptFiles.map((fullPath) => {
    const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
    const name = path.basename(fullPath, '.ts');
    return {
      name,
      path: relPath
    };
  });
}

function scanAssets() {
  const audioFiles = walkDir(ASSETS_DIR, (name) => /\.(mp3|ogg|wav|m4a)$/i.test(name));
  const modelFiles = walkDir(ASSETS_DIR, (name) => /\.(fbx|gltf|glb|obj)$/i.test(name));
  const shaderFiles = walkDir(ASSETS_DIR, (name) => /\.(effect|chunk)$/i.test(name));

  return {
    audioCount: audioFiles.length,
    audioList: audioFiles.map((p) => path.relative(ROOT_DIR, p).replace(/\\/g, '/')),
    modelCount: modelFiles.length,
    models: modelFiles.map((p) => path.relative(ROOT_DIR, p).replace(/\\/g, '/')),
    shaderCount: shaderFiles.length,
    shaders: shaderFiles.map((p) => path.relative(ROOT_DIR, p).replace(/\\/g, '/'))
  };
}

function scanConfigSummary() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { error: 'Missing assets/resources/playable-config.json' };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      ctaKeys: raw.cta ? Object.keys(raw.cta) : [],
      audioKeys: raw.audio ? Object.keys(raw.audio) : [],
      gameplayKeys: raw.gameplay ? Object.keys(raw.gameplay) : [],
      cameraKeys: raw.camera ? Object.keys(raw.camera) : [],
      customKeys: raw.custom ? Object.keys(raw.custom) : [],
      rawPreview: {
        cta: raw.cta,
        audio: raw.audio,
        gameplay: raw.gameplay,
        camera: raw.camera
      }
    };
  } catch (err) {
    return { error: `Failed to parse config: ${err.message}` };
  }
}

function generateProjectMap() {
  const meta = scanProjectMeta();
  const scenes = scanScenes();
  const prefabs = scanPrefabs();
  const scripts = scanScripts();
  const assets = scanAssets();
  const config = scanConfigSummary();

  const projectMap = {
    _meta: {
      generatedAt: new Date().toISOString(),
      description: 'Compact project manifest for AI Agents. Use this instead of scanning file trees.',
      project: meta
    },
    architecture: {
      coreLibraries: [
        'playable-core (GameManager, SoundManager, ObjectPool, PlayableConfigManager)',
        'playable-sdk (Analytics, SuperHtmlPlayable store redirection)'
      ],
      configMechanism: 'Single Scriptable JSON (assets/resources/playable-config.json) via PlayableConfigManager.instance',
      performanceRule: 'Zero GC in update(dt) loops - Reuse temp Vec3/Quat/Color static objects'
    },
    scenes,
    prefabs,
    scripts,
    assetsSummary: assets,
    configSummary: config,
    cliCheatSheet: {
      "fastOnboarding": "node playable-shared-kit/tools/project-map-generator.cjs --stdout",
      "buildPlayable": "npm run build",
      "deployPreview": "npm run deploy",
      "portUnityPrefab": "node playable-shared-kit/tools/unity-cocos-port.cjs convert-prefab --source <unity_path> --dest assets/prefabs/",
      "portUnityShader": "node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs <shader.shader> assets/effects/<name>.effect",
      "stripFbx": "node playable-shared-kit/tools/strip-fbx-textures.cjs assets/models/",
      "optimizeAudio": "npm run sound:optimize",
      "workMemoryQuery": "node playable-shared-kit/tools/work-memory.cjs stats",
      "syncAiKnowledge": "npm run ai:sync"
    }
  };

  // Ensure output directory
  if (!fs.existsSync(SHARED_KIT_AI_DIR)) {
    fs.mkdirSync(SHARED_KIT_AI_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_MAP_FILE, JSON.stringify(projectMap, null, 2), 'utf8');

  // Also write to root for fast lookup if needed
  const rootMapFile = path.join(ROOT_DIR, 'PROJECT_MAP.json');
  fs.writeFileSync(rootMapFile, JSON.stringify(projectMap, null, 2), 'utf8');

  return projectMap;
}

function main() {
  const args = process.argv.slice(2);
  const isStdout = args.includes('--stdout');
  const isCompact = args.includes('--compact');

  const map = generateProjectMap();

  if (isStdout) {
    if (isCompact) {
      console.log(JSON.stringify(map));
    } else {
      console.log(JSON.stringify(map, null, 2));
    }
  } else {
    console.log(`[project-map] Generated project map at:\n  - ${path.relative(ROOT_DIR, OUTPUT_MAP_FILE)}\n  - ${path.relative(ROOT_DIR, path.join(ROOT_DIR, 'PROJECT_MAP.json'))}`);
    console.log(`[project-map] Summary: ${map.scenes.length} scene(s), ${map.prefabs.length} prefab(s), ${map.scripts.length} script(s), ${map.assetsSummary.audioCount} audio, ${map.assetsSummary.modelCount} model(s).`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateProjectMap };
