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
          if (behavior.appendNonShaderEffectWindowError) {
            fs.appendFileSync(
              logFile,
              '[Window] Can not change the asset "db://assets/effects/Holder.effect", because the original asset does not exist.\n',
            );
          }
          if (behavior.throwOnReimport) throw new Error('EFX import failed');
          return undefined;
        }
        if (action === 'query-asset-info') {
          const effect = /\.effect$/i.test(url);
          return {
            uuid: effect ? 'effect-uuid' : 'material-uuid',
            type: effect ? 'cc.EffectAsset' : 'cc.Material',
            meta: behavior.metaOnlyViaQuery ? undefined : {
              importer: behavior.wrongImporter ? 'unknown' : (effect ? 'effect' : 'material'),
              imported: behavior.notImported ? false : true,
            },
          };
        }
        if (action === 'query-asset-meta') {
          const effect = url === 'effect-uuid' || /\.effect$/i.test(url);
          return {
            importer: behavior.wrongImporter ? 'unknown' : (effect ? 'effect' : 'material'),
            imported: behavior.notImported ? false : true,
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

test('effect import gate queries AssetDB meta when query-asset-info omits nested meta', async t => {
  editorFixture(t, { metaOnlyViaQuery: true });
  const result = await new AssetAdvancedTools().execute('validate_effect_import', {
    effectUrl: 'db://assets/effects/Holder.effect',
    materialUrls: ['db://assets/materials/Holder.mtl'],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.scope.assetTypesAndImporters, 'passed');
  assert.equal(result.data.assets[0].metaSource, 'query-asset-meta');
  assert.equal(result.data.assets[0].imported, true);
  assert.equal(result.data.assets[1].metaSource, 'query-asset-meta');
});

test('effect import gate rejects importer metadata that AssetDB marks unimported', async t => {
  editorFixture(t, { metaOnlyViaQuery: true, notImported: true });
  const result = await new AssetAdvancedTools().execute('validate_effect_import', {
    effectUrl: 'db://assets/effects/Holder.effect',
  });
  assert.equal(result.success, false);
  assert.equal(result.data.assets[0].imported, false);
  assert.equal(result.data.assets[0].importerOk, false);
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

test('effect import gate ignores non-compiler Window errors that merely mention an effect path', async t => {
  editorFixture(t, { appendNonShaderEffectWindowError: true });
  const result = await new AssetAdvancedTools().execute('validate_effect_import', {
    effectUrl: 'db://assets/effects/Holder.effect',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.scope.newProjectLogShaderErrors, 'passed');
  assert.deepEqual(result.data.shaderErrors, []);
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
