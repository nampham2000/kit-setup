'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  auditResourceBoundary,
  parseArgs,
  writeCatalog,
} = require('./resource-boundary.cjs');
const { run: verifyAssets } = require('./verify-assets.cjs');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function meta(uuid, extra = {}) {
  return `${JSON.stringify({
    ver: '1.0.0',
    importer: extra.importer || 'asset',
    imported: true,
    uuid,
    files: [],
    subMetas: extra.subMetas || {},
    userData: {},
  }, null, 2)}\n`;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-boundary-'));
  write(path.join(root, 'package.json'), '{}\n');
  write(path.join(root, 'assets/resources/playable-config.json'), '{}\n');
  write(path.join(root, 'assets/resources/sound/tap.mp3'), 'audio');
  write(path.join(root, 'assets/resources/game/textures/icon.png'), 'png');
  write(path.join(root, 'assets/resources/game/textures/icon.png.meta'), meta(
    '11111111-1111-4111-8111-111111111111',
    {
      importer: 'image',
      subMetas: {
        sprite: {
          importer: 'sprite-frame',
          imported: true,
          uuid: '11111111-1111-4111-8111-111111111111@f9941',
          name: 'spriteFrame',
          subMetas: {},
        },
      },
    },
  ));
  write(path.join(root, 'assets/script/StaticAssetCatalog.ts'), 'export class StaticAssetCatalog {}\n');
  write(path.join(root, 'assets/script/StaticAssetCatalog.ts.meta'), meta(
    '22222222-2222-4222-8222-222222222222',
    { importer: 'typescript' },
  ));
  write(path.join(root, 'tools/resource-boundary.json'), `${JSON.stringify({
    schemaVersion: 1,
    resourcesRoot: 'assets/resources',
    dynamicRoots: [
      { path: 'assets/resources/playable-config.json', kind: 'json', reason: 'Runtime config.', evidence: ['assets/script/StaticAssetCatalog.ts#StaticAssetCatalog'] },
      { path: 'assets/resources/sound', kind: 'audio-directory', reason: 'Runtime audio.', evidence: ['assets/script/StaticAssetCatalog.ts#StaticAssetCatalog'] },
      { path: 'assets/resources/game/static-assets.prefab', kind: 'prefab', reason: 'Static catalog root.', evidence: ['assets/script/StaticAssetCatalog.ts#StaticAssetCatalog'] },
    ],
    catalog: {
      prefab: 'assets/resources/game/static-assets.prefab',
      resourcePath: 'game/static-assets',
      script: 'assets/script/StaticAssetCatalog.ts',
    },
    staticMoves: [
      {
        from: 'assets/resources/game/textures',
        to: 'assets/game/textures',
        reason: 'Fixed sprite dependency.',
        rules: [{ extensions: ['.png'], type: 'cc.SpriteFrame', subAsset: 'spriteFrame', keySuffix: '/spriteFrame' }],
      },
    ],
  }, null, 2)}\n`);
  return root;
}

test('parseArgs rejects conflicting and unknown modes before writes', () => {
  assert.throws(() => parseArgs(['--write-catalog', '--verify']), /conflicts/);
  assert.throws(() => parseArgs(['--wat']), /Unknown argument/);
  assert.equal(parseArgs(['--help']).help, true);
});

test('catalog generation is deterministic and boundary passes only after AssetDB-equivalent move/import', () => {
  const root = fixture();
  try {
    const before = auditResourceBoundary(root);
    assert.equal(before.status, 'FAIL');
    assert.equal(before.misplacedStatic.length, 1);

    const generated = writeCatalog(root);
    assert.equal(generated.changed, true);
    assert.equal(generated.entryCount, 1);
    const prefab = path.join(root, generated.output);
    const firstContent = fs.readFileSync(prefab, 'utf8');
    const firstMtime = fs.statSync(prefab).mtimeMs;
    const generatedAgain = writeCatalog(root);
    assert.equal(generatedAgain.changed, false);
    assert.equal(fs.readFileSync(prefab, 'utf8'), firstContent);
    assert.equal(fs.statSync(prefab).mtimeMs, firstMtime);

    write(`${prefab}.meta`, meta('33333333-3333-4333-8333-333333333333', { importer: 'prefab' }));
    fs.mkdirSync(path.join(root, 'assets/game'), { recursive: true });
    fs.renameSync(
      path.join(root, 'assets/resources/game/textures'),
      path.join(root, 'assets/game/textures'),
    );

    const after = auditResourceBoundary(root);
    assert.equal(after.status, 'PASS', after.errors.join('\n'));
    assert.equal(after.staticCatalogEntryCount, 1);
    assert.equal(after.entries[0].key, 'game/textures/icon/spriteFrame');
    assert.equal(after.entries[0].uuid, '11111111-1111-4111-8111-111111111111@f9941');
    assert.equal(after.moveStates[0].state, 'moved');

    const importGate = verifyAssets({ projectRoot: root });
    assert.equal(importGate.resourceBoundary.status, 'PASS');
    assert.equal(importGate.resourceBoundary.staticCatalogEntryCount, 1);
    assert.equal(importGate.status, 'PASS', importGate.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unclassified resources fail closed even when their extension is commonly dynamic', () => {
  const root = fixture();
  try {
    write(path.join(root, 'assets/resources/game/undeclared.prefab'), '[]\n');
    const report = auditResourceBoundary(root);
    assert.ok(report.unclassified.includes('assets/resources/game/undeclared.prefab'));
    assert.equal(report.status, 'FAIL');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
