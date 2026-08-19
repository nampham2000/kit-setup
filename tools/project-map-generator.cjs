#!/usr/bin/env node
'use strict';


// Bỏ escape ANSI khi output bị pipe (tiết kiệm token cho AI agent).
require('./lib/auto-strip-ansi.cjs');
/**
 * Project Map Generator for AI Agents
 *
 * Scans the Cocos Creator 3.8.x Playable project and produces a high-density,
 * low-token JSON summary (ai/PROJECT_MAP.json). This allows AI agents (Codex,
 * Claude, Gemini, Copilot) to instantly understand project architecture, assets,
 * config schemas, and available CLI tools in a single step (~3k tokens, do duoc).
 */

const fs = require('fs');
const path = require('path');

/**
 * Cheat-sheet lệnh lấy từ capability manifest (single source of truth).
 * Nếu manifest lỗi thì trả về rỗng chứ KHÔNG fallback sang lệnh chép tay —
 * lệnh sai còn nguy hiểm hơn không có lệnh.
 */
function buildCliCheatSheet() {
  try {
    const { buildCheatSheet } = require('./capability-manifest.cjs');
    return buildCheatSheet();
  } catch (error) {
    console.warn(`[project-map] WARN: không đọc được capability manifest (${error.message}); cliCheatSheet để trống.`);
    return {};
  }
}

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

/**
 * Gom script theo thu muc: dang cu lap lai tien to duong dan cho tung file
 * (44 script = 3.704 ky tu, gan mot nua ban do). Dang gom giu du thong tin
 * agent can nhung nho hon nhieu.
 */
function scanScripts() {
  const scriptFiles = walkDir(ASSETS_DIR, (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
  const byDir = {};
  for (const fullPath of scriptFiles) {
    const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
    const dir = path.dirname(relPath);
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(path.basename(fullPath, '.ts'));
  }
  // Tra ve OBJECT, khong phai array: JSON.stringify bo moi thuoc tinh khong phai
  // index cua array, nen `count` gan vao array se mat khi ghi ra file.
  return {
    count: scriptFiles.length,
    byDir: Object.entries(byDir).map(([dir, names]) => ({ dir, names: names.sort() })),
  };
}

/**
 * MAP-01: ban do cu chi co audio/model/shader nen agent muon biet da co
 * material/effect/texture nao thi phai tu quet lai cay thu muc - dung thu ma ban
 * do sinh ra de tranh. Danh sach dai duoc rut gon (dem + vai mau) de khong phinh token.
 */
const MAX_LIST = 6;

function summarizeGroup(files) {
  const rel = files.map((f) => path.relative(ROOT_DIR, f).replace(/\\/g, '/'));
  const totalKb = files.reduce((sum, f) => sum + getFileSizeKb(f), 0);
  return {
    count: rel.length,
    totalKb: Math.round(totalKb * 10) / 10,
    sample: rel.slice(0, MAX_LIST),
    truncated: rel.length > MAX_LIST ? rel.length - MAX_LIST : 0,
  };
}

function scanAssets() {
  const audioFiles = walkDir(ASSETS_DIR, (name) => /\.(mp3|ogg|wav|m4a)$/i.test(name));
  const modelFiles = walkDir(ASSETS_DIR, (name) => /\.(fbx|gltf|glb|obj)$/i.test(name));
  const shaderFiles = walkDir(ASSETS_DIR, (name) => /\.(effect|chunk)$/i.test(name));
  const materialFiles = walkDir(ASSETS_DIR, (name) => /\.mtl$/i.test(name));
  const textureFiles = walkDir(ASSETS_DIR, (name) => /\.(png|jpg|jpeg|webp|tga)$/i.test(name));
  const animFiles = walkDir(ASSETS_DIR, (name) => /\.anim$/i.test(name));
  const prefabFiles = walkDir(ASSETS_DIR, (name) => /\.prefab$/i.test(name));

  // Noi dung da port tu Unity - truoc day hoan toan vang mat trong ban do.
  const importedRoot = path.join(ASSETS_DIR, 'unity_imported');
  const importedFiles = fs.existsSync(importedRoot)
    ? walkDir(importedRoot, (name) => !name.endsWith('.meta'))
    : [];

  return {
    audioCount: audioFiles.length,
    audio: summarizeGroup(audioFiles),
    modelCount: modelFiles.length,
    models: summarizeGroup(modelFiles),
    shaderCount: shaderFiles.length,
    shaders: summarizeGroup(shaderFiles),
    materials: summarizeGroup(materialFiles),
    textures: summarizeGroup(textureFiles),
    animations: summarizeGroup(animFiles),
    prefabsInAssets: summarizeGroup(prefabFiles),
    unityImported: {
      exists: importedFiles.length > 0,
      root: 'assets/unity_imported',
      ...summarizeGroup(importedFiles),
    },
  };
}

/**
 * Bay da biet, lay tu work-memory. Giup agent khong lap lai loi cu ma khong
 * phai chay them mot lenh query rieng.
 */
function scanKnownIssues() {
  const dbFile = path.join(ROOT_DIR, 'playable-shared-kit', 'ai', 'knowledge', 'work-memory-records.json');
  try {
    const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const records = Array.isArray(raw) ? raw : (raw.records || []);
    return records
      .filter((r) => /trap|bug|pitfall|issue|porting-note|tip/i.test(String(r.category || '')))
      .slice(0, 10)
      .map((r) => ({ title: r.title, tags: r.tags || [] }));
  } catch (_) {
    return [];
  }
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
    knownIssues: scanKnownIssues(),
    // Sinh từ playable-shared-kit/ai/capabilities.def.cjs — không chép tay.
    // `npm run ai:contract:verify` đối chiếu từng lệnh với CLI thật.
    cliCheatSheet: buildCliCheatSheet()
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

const USAGE = `Playable Project Map Generator

Usage:
  node playable-shared-kit/tools/project-map-generator.cjs [options]

Options:
  --stdout    Print the map as JSON instead of writing files.
  --compact   With --stdout, emit minified JSON (ít token hơn).
  --help      Show this help and exit WITHOUT writing PROJECT_MAP.json.

Writes PROJECT_MAP.json and playable-shared-kit/ai/PROJECT_MAP.json.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
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
    console.log(`[project-map] Summary: ${map.scenes.length} scene(s), ${map.prefabs.length} prefab(s), ${map.scripts.count} script(s), ${map.assetsSummary.audioCount} audio, ${map.assetsSummary.modelCount} model(s).`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateProjectMap };
