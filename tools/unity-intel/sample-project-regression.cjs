#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildUnityProjectSnapshot } = require('./index.cjs');
const { scanUnityProject } = require('./service.cjs');
const { PREFLIGHT_MAX_BYTES, createImplementationBrief } = require('./preflight.cjs');

const DEFAULT_ROOT = 'D:/Work/Unity/@Puzzle/unity_games_2026';
const PROJECTS = [
  {
    name: 'HarvestTile',
    unityVersion: '6000.3.1f1',
    enabledScenes: ['Assets/Project/Scene/Loading.unity', 'Assets/Project/Scene/Gameplay.unity'],
    coreEntry: 'Assets/Project/Scene/Gameplay.unity',
    packages: {
      'com.unity.addressables': '2.8.1',
      'com.unity.inputsystem': '1.18.0',
    },
    rawMinimums: { scenes: 30, prefabs: 180, scripts: 800 },
    minimumEdges: 3000,
    maximumWarmMs: 20000,
    maximumCoreRatio: 0.2,
  },
  {
    name: 'CatSmash',
    unityVersion: '6000.3.1f1',
    enabledScenes: [
      'Assets/_Game/Scenes/1.entry.unity',
      'Assets/_Game/Scenes/2.loading.unity',
      'Assets/_Game/Scenes/3.mainmenu.unity',
      'Assets/_Game/Scenes/4.gameplay.unity',
      'Assets/_Game/Scenes/LevelDesign/SceneLevelDesigner.unity',
      'Assets/Plugins/MobileConsoleKit/Assets/LogConsole.unity',
    ],
    coreEntry: 'Assets/_Game/Scenes/4.gameplay.unity',
    packages: {
      'com.unity.render-pipelines.universal': '17.3.0',
      'com.unity.ai.navigation': '2.0.9',
      'com.unity.timeline': '1.8.10',
    },
    rawMinimums: { scenes: 35, prefabs: 220, scripts: 500, models: 80 },
    minimumEdges: 3000,
    maximumWarmMs: 20000,
    maximumCoreRatio: 0.2,
    requiredResolvedPackages: ['com.google.firebase.analytics', 'com.google.firebase.app'],
  },
  {
    name: 'TapeJam',
    unityVersion: '6000.3.1f1',
    enabledScenes: ['Assets/_Game/Scenes/MainScene.unity', 'Assets/_Game/Scenes/GameplayScene.unity'],
    coreEntry: 'Assets/_Game/Scenes/GameplayScene.unity',
    packages: {
      'com.unity.addressables': '2.8.1',
      'com.unity.render-pipelines.universal': '17.3.0',
      'com.unity.timeline': '1.8.10',
      'com.unity.ai.navigation': '2.0.9',
    },
    rawMinimums: { scenes: 15, prefabs: 350, scripts: 800, sceneObjects: 19000 },
    minimumEdges: 12000,
    maximumWarmMs: 20000,
    maximumCoreRatio: 0.2,
    requiredResolvedPackages: ['com.google.external-dependency-manager'],
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

async function main() {
  const corpusRoot = path.resolve(parseRoot(process.argv.slice(2)) || '');
  if (!fs.existsSync(corpusRoot)) throw new Error(`Không tìm thấy Unity sample root: ${corpusRoot}`);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-samples-'));
  const results = [];
  try {
    for (const expected of PROJECTS) {
      const projectStartedAt = Date.now();
      console.error(`[unity-intel-samples] ${expected.name}:cold-scan:start`);
      const projectRoot = path.join(corpusRoot, expected.name);
      const assets = path.join(projectRoot, 'Assets');
      assert.ok(fs.existsSync(assets), `Thiếu sample ${expected.name}: ${assets}`);
      const options = { projectRoot, sourceRoot: assets, cacheDir };
      const cold = buildUnityProjectSnapshot(options);
      console.error(`[unity-intel-samples] ${expected.name}:cold-scan:complete ${Math.round(cold.metrics.durationMs)}ms`);
      const phase3Scan = await scanUnityProject({ project: projectRoot, provider: 'static', cacheDir });
      const warm = phase3Scan.snapshot;
      console.error(`[unity-intel-samples] ${expected.name}:warm-scan:complete ${Math.round(warm.metrics.durationMs)}ms`);
      const briefInput = { project: projectRoot, intent: 'project', now: 0 };
      const brief = createImplementationBrief(phase3Scan, briefInput);
      const repeatedBrief = createImplementationBrief(phase3Scan, briefInput);
      const briefJson = JSON.stringify(brief);

      assert.equal(cold.project.unityVersion, expected.unityVersion);
      assert.deepEqual(stableSummary(warm), stableSummary(cold));
      assert.equal(warm.cache.mode, 'warm');
      assert.equal(warm.cache.misses, 0);
      assert.equal(warm.cache.hits, cold.assets.count);
      assert.ok(warm.metrics.durationMs <= expected.maximumWarmMs,
        `${expected.name}: warm scan ${warm.metrics.durationMs}ms > ${expected.maximumWarmMs}ms`);
      assert.deepEqual(
        cold.buildScenes.filter(scene => scene.enabled).map(scene => scene.path),
        expected.enabledScenes
      );
      assert.equal(cold.buildScenes.filter(scene => scene.enabled).every(scene => scene.indexed), true);
      for (const [packageName, version] of Object.entries(expected.packages)) {
        assert.equal(cold.project.packages[packageName], version, `${expected.name}: ${packageName}`);
      }
      for (const packageName of expected.requiredResolvedPackages || []) {
        assert.equal(cold.project.layout.unavailablePackages.includes(packageName), false,
          `${expected.name}: package resolution làm rơi ${packageName}`);
        assert.equal(cold.project.layout.roots.some(root => root.packageName === packageName), true,
          `${expected.name}: package root không bind được ${packageName}`);
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
      assert.equal(brief.kind, 'unity-port-implementation-brief');
      assert.equal(brief.briefId, repeatedBrief.briefId, `${expected.name}: brief không deterministic`);
      assert.ok(Buffer.byteLength(briefJson, 'utf8') <= PREFLIGHT_MAX_BYTES,
        `${expected.name}: compact brief vượt ${PREFLIGHT_MAX_BYTES} bytes`);
      assert.equal(briefJson.toLowerCase().includes(projectRoot.replace(/\\/g, '/').toLowerCase()), false,
        `${expected.name}: compact brief lộ absolute project path`);
      assert.ok(brief.features.length > 0, `${expected.name}: Phase 3 không phác thảo được feature`);
      assert.equal(brief.intent.profile, 'playable-core', `${expected.name}: preflight không default playable-core`);
      assert.equal(brief.coreGameplay.entry.primary, expected.coreEntry, `${expected.name}: chọn sai core gameplay scene`);
      assert.equal(brief.decision.coreEntryReady, true, `${expected.name}: core gameplay entry còn mơ hồ`);
      assert.deepEqual(brief.implementation.slice(0, 2).map(item => item.capabilityId), ['port.core.init', 'port.scene'],
        `${expected.name}: core route không bắt đầu từ manifest + gameplay scene`);
      assert.equal(brief.coreGameplay.acceptance.minimumFidelity, 80);
      assert.equal(brief.coreGameplay.acceptance.targetFidelity, 90);
      assert.equal(brief.coreGameplay.acceptance.weights.reduce((sum, item) => sum + item[1], 0), 100);
      assert.ok(brief.coreGameplay.closure.includedCount < cold.assets.projectCount,
        `${expected.name}: core closure không giảm scope project`);
      const coreRatio = brief.coreGameplay.closure.includedCount / cold.assets.projectCount;
      assert.ok(coreRatio <= expected.maximumCoreRatio,
        `${expected.name}: core closure ratio ${coreRatio.toFixed(3)} > ${expected.maximumCoreRatio}`);
      const routedEvidence = JSON.stringify(brief.features.flatMap(feature => feature.evidence || [])).toLowerCase();
      for (const forbidden of ['/editor/', '/dailylogin/', '/shop/', 'mainmenu']) {
        assert.equal(routedEvidence.includes(forbidden), false,
          `${expected.name}: core feature evidence còn non-playable path ${forbidden}`);
      }
      const hardCodes = brief.obligationIndex.filter(item => item[2] === 1).map(item => item[0]);
      assert.equal(
        brief.decision.implementationAllowed,
        true,
        `${expected.name}: Phase 3 bị deadlock bởi hard blocker: ${hardCodes.join(', ') || '(unknown)'}`,
      );
      assert.equal(
        brief.decision.hardBlockerCount,
        0,
        `${expected.name}: hardBlockerCount không khớp: ${hardCodes.join(', ') || '(unknown)'}`,
      );
      const sourceHighCodes = [...new Set(warm.diagnostics
        .filter(item => item.severity === 'high')
        .map(item => item.code))].sort();
      const routedHighCodes = brief.obligationIndex.map(item => item[0]).sort();
      assert.deepEqual(routedHighCodes, sourceHighCodes,
        `${expected.name}: Phase 3 làm rơi hoặc tự thêm source high obligation`);
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
        phase3: {
          briefBytes: Buffer.byteLength(briefJson, 'utf8'),
          status: brief.decision.status,
          implementationAllowed: brief.decision.implementationAllowed,
          features: brief.features.length,
          obligations: brief.decision.obligationCount,
          hardBlockers: brief.decision.hardBlockerCount,
          coreEntry: brief.coreGameplay.entry.primary,
          corePaths: brief.coreGameplay.closure.includedCount,
          coreObligations: brief.decision.coreObligationCount,
          coreRatio: Number(coreRatio.toFixed(4)),
        },
        warmSpeedup: Number((cold.metrics.durationMs / Math.max(1, warm.metrics.durationMs)).toFixed(1)),
      });
      console.error(`[unity-intel-samples] ${expected.name}:pass ${Date.now() - projectStartedAt}ms`);
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, corpusRoot: corpusRoot.replace(/\\/g, '/'), projects: results }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[unity-intel-samples] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { PROJECTS, stableSummary };
