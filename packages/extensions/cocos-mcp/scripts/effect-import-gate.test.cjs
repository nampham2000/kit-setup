'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AssetAdvancedTools } = require('../dist/tools/asset-advanced-tools.js');

function editorFixture(t, behavior = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-effect-gate-'));
  const logDir = path.join(root, 'temp', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'project.log');
  fs.writeFileSync(logFile, 'existing unrelated log\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  global.Editor = {
    Project: { path: root },
    Message: {
      request: async (_channel, action, url) => {
        if (action === 'reimport-asset') {
          if (behavior.appendError) {
            fs.appendFileSync(logFile, '[ERROR] shader syntax invalid while compiling CCEffect\n');
          }
          if (behavior.throwOnReimport) throw new Error('EFX import failed');
          return undefined;
        }
        if (action === 'query-asset-info') {
          const effect = /\.effect$/i.test(url);
          return {
            uuid: effect ? 'effect-uuid' : 'material-uuid',
            type: effect ? 'cc.EffectAsset' : 'cc.Material',
            meta: { importer: behavior.wrongImporter ? 'unknown' : (effect ? 'effect' : 'material') },
          };
        }
        throw new Error(`unexpected action: ${action}`);
      },
    },
  };
  t.after(() => { delete global.Editor; });
}

test('effect import gate proves only AssetDB/importer/log scope', async t => {
  editorFixture(t);
  const result = await new AssetAdvancedTools().execute('validate_effect_import', {
    effectUrl: 'db://assets/effects/Holder.effect',
    materialUrls: ['db://assets/materials/Holder.mtl'],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.complete, true);
  assert.equal(result.data.scope.assetTypesAndImporters, 'passed');
  assert.equal(result.data.scope.newProjectLogShaderErrors, 'passed');
  assert.equal(result.data.scope.runtimeVariant, 'unverified');
  assert.equal(result.data.scope.unityVisualParity, 'unverified');
});

test('effect import gate fails on shader errors appended by this reimport generation', async t => {
  editorFixture(t, { appendError: true });
  const result = await new AssetAdvancedTools().execute('validate_effect_import', {
    effectUrl: 'db://assets/effects/Broken.effect',
  });
  assert.equal(result.success, false);
  assert.equal(result.data.scope.newProjectLogShaderErrors, 'failed');
  assert.match(result.data.shaderErrors[0], /syntax invalid/i);
});

test('effect import gate rejects the wrong Cocos importer and unbounded paths', async t => {
  editorFixture(t, { wrongImporter: true });
  const tool = new AssetAdvancedTools();
  const wrongImporter = await tool.execute('validate_effect_import', {
    effectUrl: 'db://assets/effects/Holder.effect',
  });
  assert.equal(wrongImporter.success, false);
  assert.equal(wrongImporter.data.scope.assetTypesAndImporters, 'failed');
  const outside = await tool.execute('validate_effect_import', { effectUrl: 'C:/tmp/Holder.effect' });
  assert.equal(outside.success, false);
  assert.match(outside.error, /db:\/\/assets/);
});
