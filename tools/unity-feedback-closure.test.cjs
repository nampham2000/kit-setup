'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseArgs,
  analyzeFeedbackClosure,
  expandCoreAllowedPaths,
  validateDispositionContract,
} = require('./unity-feedback-closure.cjs');

function fixture() {
  const records = [
    ['Assets/Scenes/Loading.unity', 'scene'],
    ['Assets/Resources/GUIHandlers/ClickEffectOverlay_GUIHandler.asset', 'asset'],
    ['Assets/Audio/AudioSfxConfigurationSO.asset', 'asset'],
    ['Assets/Scripts/GUIHandler.cs', 'script'],
    ['Assets/Scripts/AudioSfxConfigurationSO.cs', 'script'],
    ['Assets/Prefabs/UI/ClickEffectOverlay.prefab', 'prefab'],
    ['Assets/Prefabs/Common/VfxClickItem.prefab', 'prefab'],
    ['Assets/VFX/par_click.prefab', 'prefab'],
    ['Assets/VFX/par_click.mat', 'material'],
    ['Assets/VFX/spr_flower.png', 'texture'],
    ['Assets/Audio/click.wav', 'audio'],
    ['Assets/Orphan/VfxDecoy.prefab', 'prefab'],
    ['Assets/Resources/Gameplay/feedback.json', 'data'],
    ['Assets/VFX/combo_star.png', 'texture'],
    ['Assets/Spine/title.json', 'data'],
  ].map(([assetPath, type]) => ({ assetPath, type }));
  const pairs = [
    [0, 1], [0, 2], [0, 12], [0, 14], [1, 3], [1, 5], [2, 4], [2, 10], [5, 6], [6, 7], [7, 8], [8, 9],
  ];
  return {
    scanId: 'fixture-scan',
    stateFingerprint: 'fixture-state',
    buildScenes: [{ path: records[0].assetPath, enabled: true }],
    assets: { records },
    dependencies: { edges: pairs.map(([from, to]) => ({ from: records[from].assetPath, to: records[to].assetPath })) },
    scriptIndex: {
      scripts: [
        { assetPath: records[3].assetPath, scriptableObjectTypes: ['GUIHandler'] },
        { assetPath: records[4].assetPath, scriptableObjectTypes: ['AudioSfxConfigurationSO'] },
      ],
    },
  };
}

test('feedback closure finds bootstrap ScriptableObject/audio/pool/particle/material/texture chain and excludes orphan decoys', () => {
  const report = analyzeFeedbackClosure(fixture(), {
    readAssetText(assetPath) {
      if (assetPath.endsWith('/feedback.json')) {
        return '{"combo":{"vfx":"Assets/VFX/combo_star.png","sfx":"Assets/Audio/click.wav"}}';
      }
      if (assetPath.endsWith('/title.json')) return '{"skeleton":{},"bones":[],"slots":[],"skins":[]}';
      throw new Error('unexpected text asset');
    },
  });
  const paths = report.candidates.map(candidate => candidate.assetPath);
  assert.equal(report.source.entries[0], 'Assets/Scenes/Loading.unity');
  assert.ok(paths.includes('Assets/Resources/GUIHandlers/ClickEffectOverlay_GUIHandler.asset'));
  assert.ok(paths.includes('Assets/Audio/AudioSfxConfigurationSO.asset'));
  assert.ok(paths.includes('Assets/Prefabs/Common/VfxClickItem.prefab'));
  assert.ok(paths.includes('Assets/VFX/par_click.mat'));
  assert.ok(paths.includes('Assets/VFX/spr_flower.png'));
  assert.ok(paths.includes('Assets/Audio/click.wav'));
  assert.ok(paths.includes('Assets/Resources/Gameplay/feedback.json'));
  assert.ok(paths.includes('Assets/VFX/combo_star.png'));
  assert.equal(paths.includes('Assets/Orphan/VfxDecoy.prefab'), false);
  assert.equal(paths.includes('Assets/Scripts/GUIHandler.cs'), false);
  assert.equal(paths.includes('Assets/Spine/title.json'), false);
  assert.deepEqual(
    report.candidates.find(candidate => candidate.assetPath.endsWith('/spr_flower.png')).sourceChain,
    [
      'Assets/Scenes/Loading.unity',
      'Assets/Resources/GUIHandlers/ClickEffectOverlay_GUIHandler.asset',
      'Assets/Prefabs/UI/ClickEffectOverlay.prefab',
      'Assets/Prefabs/Common/VfxClickItem.prefab',
      'Assets/VFX/par_click.prefab',
      'Assets/VFX/par_click.mat',
      'Assets/VFX/spr_flower.png',
    ],
  );
  const spec = report.candidates.find(candidate => candidate.assetPath.endsWith('/feedback.json'));
  assert.equal(spec.kind, 'gameplay-spec-data');
  assert.equal(spec.specEvidence.valid, true);
  assert.deepEqual(spec.specEvidence.assetReferences.map(item => item.fieldPath), ['/combo/sfx', '/combo/vfx']);
});

test('playable-core bootstrap supplement retains direct SO dispositions and feedback descendants without unrelated assets', () => {
  const snapshot = fixture();
  const allowed = expandCoreAllowedPaths(
    snapshot,
    new Set(['Assets/Scenes/Loading.unity']),
    ['Assets/Scenes/Loading.unity'],
  );
  assert.equal(allowed.has('Assets/Resources/GUIHandlers/ClickEffectOverlay_GUIHandler.asset'), true);
  assert.equal(allowed.has('Assets/Audio/AudioSfxConfigurationSO.asset'), true);
  assert.equal(allowed.has('Assets/Prefabs/Common/VfxClickItem.prefab'), true);
  assert.equal(allowed.has('Assets/VFX/par_click.mat'), true);
  assert.equal(allowed.has('Assets/Audio/click.wav'), true);
  assert.equal(allowed.has('Assets/Orphan/VfxDecoy.prefab'), false);
});

test('check contract requires explicit dispositions and feedback-guided gameplay walkthrough evidence', () => {
  const report = analyzeFeedbackClosure(fixture(), {
    readAssetText(assetPath) {
      if (assetPath.endsWith('/feedback.json')) return '{"vfx":"Assets/VFX/combo_star.png"}';
      if (assetPath.endsWith('/title.json')) return '{"skeleton":{},"bones":[],"slots":[],"skins":[]}';
      throw new Error('unexpected text asset');
    },
  });
  const missing = validateDispositionContract(report, null);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(error => error.includes('thiếu disposition')));

  const entries = {};
  for (const candidate of report.candidates) {
    entries[candidate.assetPath] = candidate.feedbackRoot
      ? {
        disposition: 'implemented',
        cocosAssets: ['assets/resources/feedback'],
        cocosCallSites: ['assets/script/FeedbackAdapter.ts'],
        regressions: ['tools/matrices/feedback.preview.json'],
        ...(candidate.kind === 'gameplay-spec-data' ? { fieldBindings: ['vfx -> feedback.vfx'] } : {}),
      }
      : candidate.kind === 'gameplay-spec-data'
        ? {
          disposition: 'implemented',
          cocosAssets: ['assets/resources/feedback'],
          cocosCallSites: ['assets/script/FeedbackAdapter.ts'],
          regressions: ['tools/matrices/feedback.preview.json'],
          fieldBindings: ['vfx -> feedback.vfx'],
        }
        : { disposition: 'deferred', reason: 'Dependency is covered by its implemented feedback root.' };
  }
  const roots = report.candidates.filter(candidate => candidate.feedbackRoot);
  const contract = {
    entries,
    walkthrough: [{
      id: 'pointer-and-audio-feedback',
      unityOwners: ['ClickEffectOverlay_GUIBase.Update', 'AudioManager.PlaySfx'],
      stateMutation: 'Pointer feedback only; gameplay state remains unchanged for empty-screen touch.',
      animations: [],
      vfx: roots.filter(candidate => candidate.kind !== 'audio-clip').map(candidate => candidate.assetPath),
      sfx: roots.filter(candidate => candidate.kind === 'audio-clip').map(candidate => candidate.assetPath),
      cocosCallSites: ['assets/script/FeedbackAdapter.ts'],
      regressions: ['tools/matrices/feedback.preview.json'],
    }],
  };
  const gate = validateDispositionContract(report, contract);
  assert.deepEqual(gate, { ok: true, errors: [] });
});

test('help/check parsing is fail-closed before any write mode', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--project', 'P', '--check', '--out', 'x.json']), /read-only/);
  assert.throws(() => parseArgs(['--project', 'P', '--unknown']), /không hỗ trợ/);
});
