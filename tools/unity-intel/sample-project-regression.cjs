#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildUnityProjectSnapshot } = require('./index.cjs');

const DEFAULT_ROOT = 'D:/Work/Unity/@Puzzle/unity_games_2026';
const PROJECTS = [
  {
    name: 'HarvestTile',
    unityVersion: '6000.0.66f2',
    enabledScenes: ['Assets/Project/Scene/Loading.unity', 'Assets/Project/Scene/Gameplay.unity'],
    packages: {
      'com.unity.addressables': '2.8.1',
      'com.unity.inputsystem': '1.18.0',
    },
    rawMinimums: { scenes: 30, prefabs: 180, scripts: 800 },
    minimumEdges: 3000,
  },
  {
    name: 'CatSmash',
    unityVersion: '6000.0.66f2',
    enabledScenes: [
      'Assets/_Game/Scenes/1.entry.unity',
      'Assets/_Game/Scenes/2.loading.unity',
      'Assets/_Game/Scenes/3.mainmenu.unity',
      'Assets/_Game/Scenes/4.gameplay.unity',
      'Assets/_Game/Scenes/LevelDesign/SceneLevelDesigner.unity',
      'Assets/Plugins/MobileConsoleKit/Assets/LogConsole.unity',
    ],
    packages: {
      'com.unity.render-pipelines.universal': '17.3.0',
      'com.unity.ai.navigation': '2.0.9',
      'com.unity.timeline': '1.8.10',
    },
    rawMinimums: { scenes: 35, prefabs: 220, scripts: 500, models: 80 },
    minimumEdges: 3000,
  },
  {
    name: 'TapeJam',
    unityVersion: '6000.3.1f1',
    enabledScenes: ['Assets/_Game/Scenes/MainScene.unity', 'Assets/_Game/Scenes/GameplayScene.unity'],
    packages: {
      'com.unity.addressables': '2.8.1',
      'com.unity.render-pipelines.universal': '17.3.0',
      'com.unity.timeline': '1.8.10',
      'com.unity.ai.navigation': '2.0.9',
    },
    rawMinimums: { scenes: 15, prefabs: 350, scripts: 800, sceneObjects: 19000 },
    minimumEdges: 12000,
  },
];

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index >= 0) return argv[index + 1];
  const assigned = argv.find(value => value.startsWith('--root='));
  return assigned ? assigned.slice('--root='.length) : process.env.UNITY_INTEL_SAMPLE_ROOT || DEFAULT_ROOT;
}

function stableSummary(snapshot) {
  return {
    version: snapshot.project.unityVersion,
    inventory: snapshot.inventory,
    rawInventory: snapshot.assets.rawInventory,
    buildScenes: snapshot.buildScenes,
    dependencyEdges: snapshot.dependencies.edgeCount,
    unresolved: snapshot.dependencies.unresolvedCount,
    blockers: snapshot.features.blockers,
    entryPrefabs: snapshot.views.entryPrefabs,
  };
}

function main() {
  const corpusRoot = path.resolve(parseRoot(process.argv.slice(2)) || '');
  if (!fs.existsSync(corpusRoot)) throw new Error(`Không tìm thấy Unity sample root: ${corpusRoot}`);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-samples-'));
  const results = [];
  try {
    for (const expected of PROJECTS) {
      const projectRoot = path.join(corpusRoot, expected.name);
      const assets = path.join(projectRoot, 'Assets');
      assert.ok(fs.existsSync(assets), `Thiếu sample ${expected.name}: ${assets}`);
      const options = { projectRoot, sourceRoot: assets, cacheDir };
      const cold = buildUnityProjectSnapshot(options);
      const warm = buildUnityProjectSnapshot(options);

      assert.equal(cold.project.unityVersion, expected.unityVersion);
      assert.deepEqual(stableSummary(warm), stableSummary(cold));
      assert.equal(warm.cache.mode, 'warm');
      assert.equal(warm.cache.misses, 0);
      assert.equal(warm.cache.hits, cold.assets.count);
      assert.deepEqual(
        cold.buildScenes.filter(scene => scene.enabled).map(scene => scene.path),
        expected.enabledScenes
      );
      assert.equal(cold.buildScenes.filter(scene => scene.enabled).every(scene => scene.indexed), true);
      for (const [packageName, version] of Object.entries(expected.packages)) {
        assert.equal(cold.project.packages[packageName], version, `${expected.name}: ${packageName}`);
      }
      for (const [key, minimum] of Object.entries(expected.rawMinimums)) {
        assert.ok(cold.assets.rawInventory[key] >= minimum,
          `${expected.name}: raw ${key} ${cold.assets.rawInventory[key]} < ${minimum}`);
      }
      assert.ok(cold.dependencies.edgeCount >= expected.minimumEdges,
        `${expected.name}: dependency edges ${cold.dependencies.edgeCount} < ${expected.minimumEdges}`);
      assert.ok(cold.views.entryPrefabs.length > 0, `${expected.name}: không resolve được entry prefab từ build scenes`);
      assert.equal(cold.views.entryPrefabs.every(prefab => prefab.scope === 'runtime'), true,
        `${expected.name}: entry recommendation chứa non-runtime prefab`);
      const structuralCodes = new Set(cold.diagnostics.map(item => item.code));
      for (const code of ['UNITY_DUPLICATE_GUID', 'UNITY_BUILD_SCENE_OUTSIDE_SCAN_SCOPE', 'UNITY_BUILD_SCENE_GUID_MISMATCH']) {
        assert.equal(structuralCodes.has(code), false, `${expected.name}: structural diagnostic ${code}`);
      }
      if (expected.name === 'HarvestTile') {
        assert.equal(cold.views.entryPrefabs.some(prefab =>
          /Animation\/Tutorial\/handcursor\.prefab$/i.test(prefab.assetPath)), true,
        'HarvestTile: tutorial gameplay prefab bị classifier lọc nhầm');
        assert.equal(structuralCodes.has('UNITY_ADDRESSABLES_PACKAGE_PRESENT'), true);
      }
      if (expected.name === 'CatSmash') {
        const disabled = cold.buildScenes.find(scene => scene.path.endsWith('100.gameplay test.unity'));
        const consoleScene = cold.buildScenes.find(scene => scene.path.endsWith('LogConsole.unity'));
        assert.equal(disabled.enabled, false);
        assert.equal(consoleScene.scope, 'vendor');
        assert.equal(consoleScene.gameplayCandidate, false);
      }
      results.push({
        project: expected.name,
        coldMs: cold.metrics.durationMs,
        warmMs: warm.metrics.durationMs,
        indexedFiles: cold.assets.count,
        projectFiles: cold.assets.projectCount,
        packageFiles: cold.assets.packageCount,
        runtimeInventory: cold.inventory,
        dependencyEdges: cold.dependencies.edgeCount,
        dependencyClassifications: cold.dependencies.classificationCounts,
        entryPrefabs: cold.views.entryPrefabs.length,
      });
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, corpusRoot: corpusRoot.replace(/\\/g, '/'), projects: results }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[unity-intel-samples] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { PROJECTS, stableSummary };
