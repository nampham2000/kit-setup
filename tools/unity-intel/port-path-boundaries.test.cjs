'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { findShadersInDir } = require('../shader-compiler/unity-shader-compiler.cjs');
const { findBatchShaderFiles } = require('../unity-hlsl-to-cocos-effect.cjs');
const { findFiles } = require('../unity-cocos-port.cjs');
const {
  buildGuidIndex,
  guidCacheContext,
} = require('../shader-compiler/prefab-shader-chain.cjs');
const { createUnityFixture, isLinkUnavailableError } = require('./test-fixture.cjs');

function tempDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFile(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function createLinkOrSkip(t, target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if (isLinkUnavailableError(error)) {
      t.skip(`Host filesystem does not support the symlink needed by this security regression: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function tryCreateFileLink(target, link) {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch (error) {
    if (isLinkUnavailableError(error)) {
      return false;
    }
    throw error;
  }
}

function mockPathsAsSymlinks(t, files) {
  if (files.length === 0) return;
  const originals = new Set(files.map(file => path.resolve(file).toLowerCase()));
  const originalLstat = fs.lstatSync;
  fs.lstatSync = function mockedLstat(candidate, ...args) {
    const stat = originalLstat.call(fs, candidate, ...args);
    if (originals.has(path.resolve(candidate).toLowerCase())) {
      Object.defineProperty(stat, 'isSymbolicLink', { value: () => true });
    }
    return stat;
  };
  t.after(() => { fs.lstatSync = originalLstat; });
}

function prepareGuidCache(t, setup) {
  const fixture = createUnityFixture(t);
  if (setup) setup(fixture);
  const cacheRoot = tempDirectory(t, 'shader-guid-boundary-');
  const cachePath = path.join(cacheRoot, 'shader-guid.json');
  const first = buildGuidIndex(fixture.assets, { cachePath });
  assert.equal(first.fromCache, false);
  assert.equal(fs.existsSync(cachePath), true);
  const context = guidCacheContext(fixture.assets, { cachePath });
  const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return { fixture, cachePath, context, payload };
}

test('shader and prefab directory scans skip child symlinks', t => {
  const root = tempDirectory(t, 'port-walk-boundary-');
  const outside = path.join(root, 'outside');
  const canonicalRoot = path.join(root, 'canonical');
  const legacyRoot = path.join(root, 'legacy');
  const prefabRoot = path.join(root, 'prefabs');

  const outsideShader = writeFile(path.join(outside, 'Escape.shader'), 'Shader "Escape" {}\n');
  const outsidePrefab = writeFile(path.join(outside, 'Escape.prefab'), '%YAML 1.1\n');
  const localCanonical = writeFile(path.join(canonicalRoot, 'Local.shader'), 'Shader "Local" {}\n');
  const localLegacy = writeFile(path.join(legacyRoot, 'Local.shader'), 'Shader "Local" {}\n');
  const localPrefab = writeFile(path.join(prefabRoot, 'Local.prefab'), '%YAML 1.1\n');

  const simulatedSymlinks = [];
  for (const [target, link] of [
    [outsideShader, path.join(canonicalRoot, 'Linked.shader')],
    [outsideShader, path.join(legacyRoot, 'Linked.shader')],
    [outsidePrefab, path.join(prefabRoot, 'Linked.prefab')],
  ]) {
    if (!tryCreateFileLink(target, link)) {
      writeFile(link, fs.readFileSync(target, 'utf8'));
      simulatedSymlinks.push(link);
    }
  }
  mockPathsAsSymlinks(t, simulatedSymlinks);

  assert.deepEqual(findShadersInDir(canonicalRoot), [localCanonical]);
  assert.deepEqual(findBatchShaderFiles(legacyRoot), [localLegacy]);
  assert.deepEqual(
    findFiles(prefabRoot, file => file.endsWith('.prefab')),
    [localPrefab],
  );
});

test('shader GUID cache rejects traversal and absolute asset entries', t => {
  const escapeGuid = 'abababababababababababababababab';
  const prepared = prepareGuidCache(t, fixture => {
    const escape = fixture.write('Escape.asset', 'value: external\n');
    fixture.write('Escape.asset.meta', 'fileFormatVersion: 2\nguid: ' + escapeGuid + '\n');
    fixture.escapeAsset = escape;
  });

  const maliciousPaths = [
    '../Escape.asset',
    path.resolve(prepared.fixture.escapeAsset),
  ];
  for (const maliciousPath of maliciousPaths) {
    fs.writeFileSync(prepared.cachePath, JSON.stringify({
      ...prepared.payload,
      guids: { [escapeGuid]: maliciousPath },
    }), 'utf8');
    const result = buildGuidIndex(prepared.fixture.assets, { cachePath: prepared.cachePath });
    assert.equal(result.fromCache, false, maliciousPath);
    assert.equal(result.guidToFile.has(escapeGuid), false, maliciousPath);
  }
});

test('shader GUID cache never reads through a cache-file symlink', t => {
  const prepared = prepareGuidCache(t);
  const target = path.join(path.dirname(prepared.cachePath), 'attacker-controlled.json');
  fs.writeFileSync(target, JSON.stringify(prepared.payload), 'utf8');
  fs.unlinkSync(prepared.cachePath);
  if (!tryCreateFileLink(target, prepared.cachePath)) {
    fs.copyFileSync(target, prepared.cachePath);
    mockPathsAsSymlinks(t, [prepared.cachePath]);
  }
  const before = fs.readFileSync(target, 'utf8');

  const result = buildGuidIndex(prepared.fixture.assets, { cachePath: prepared.cachePath });

  assert.equal(result.fromCache, false);
  assert.equal(fs.lstatSync(prepared.cachePath).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), before);
});

test('shader GUID cache rejects an asset whose realpath escapes Assets', t => {
  const escapeGuid = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
  let redirect;
  const prepared = prepareGuidCache(t, fixture => {
    const outside = tempDirectory(t, 'shader-guid-external-');
    writeFile(path.join(outside, 'Escape.asset'), 'value: external\n');
    writeFile(
      path.join(outside, 'Escape.asset.meta'),
      'fileFormatVersion: 2\nguid: ' + escapeGuid + '\n',
    );
    redirect = path.join(fixture.assets, 'Redirect');
    if (!createLinkOrSkip(t, outside, redirect, process.platform === 'win32' ? 'junction' : 'dir')) return;
  });
  if (!redirect || !fs.existsSync(redirect)) return;

  fs.writeFileSync(prepared.cachePath, JSON.stringify({
    ...prepared.payload,
    guids: { [escapeGuid]: 'Redirect/Escape.asset' },
  }), 'utf8');

  const result = buildGuidIndex(prepared.fixture.assets, { cachePath: prepared.cachePath });
  assert.equal(result.fromCache, false);
  assert.equal(result.guidToFile.has(escapeGuid), false);
});
