'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const extension = path.resolve(__dirname, '../packages/extensions/super-html');
const buildPolicy = require(path.join(extension, 'custom-build-policy'));
const engineSupport = require(path.join(extension, 'custom-engine-support'));
const wasmSupport = require(path.join(extension, 'custom-wasm-support'));

test('Super HTML build policy scopes obfuscation to one constructor', () => {
  const original = () => ({ enable_obfuscator: true, other: 7 });
  const cache = { get: original };
  assert.equal(buildPolicy.obfuscationPolicy({ build: { obfuscateJavaScript: false } }), false);
  assert.throws(() => buildPolicy.obfuscationPolicy({ build: { obfuscateJavaScript: 'false' } }), TypeError);
  assert.throws(() => buildPolicy.withObfuscationPolicy(cache, false, () => {
    assert.deepEqual(cache.get(), { enable_obfuscator: false, other: 7 });
    throw new Error('build failed');
  }), /build failed/);
  assert.equal(cache.get, original);
});

test('Super HTML restores the virtual engine alias without replacing the engine payload', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-kit-engine-alias-'));
  try {
    const cocosJs = path.join(root, 'cocos-js');
    fs.mkdirSync(cocosJs);
    const payload = path.join(cocosJs, '_virtual_cc-test.js');
    fs.writeFileSync(payload, 'System.register([], function () {});');
    const first = engineSupport.prepareEngineAlias(root);
    assert.equal(first.virtualCcName, '_virtual_cc-test.js');
    assert.equal(fs.readFileSync(payload, 'utf8'), 'System.register([], function () {});');
    assert.match(fs.readFileSync(path.join(cocosJs, 'cc.js'), 'utf8'), /_virtual_cc-test\.js/);
    const second = engineSupport.prepareEngineAlias(root);
    assert.deepEqual(second.engineModules.created, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Super HTML embedded WASM runtime remains parseable', () => {
  new vm.Script(wasmSupport.runtimeScript({ 'assets/sample.wasm': 'AGFzbQEAAAA=' }));
});

test('automatic store navigation uses mraid or current-tab Preview fallback', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../packages/playable-sdk/platform/SuperHtmlPlayable.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exported = {};
  new Function('exports', compiled)(exported);
  const playable = new exported.SuperHtmlPlayable();
  playable.set_google_play_url('https://example.com/store');
  const saved = { super_html: globalThis.super_html, mraid: globalThis.mraid, location: globalThis.location };
  try {
    const visited = [];
    globalThis.super_html = undefined;
    globalThis.mraid = undefined;
    globalThis.location = { assign: url => visited.push(url) };
    playable.download();
    assert.deepEqual(visited, []);
    playable.download({ automatic: true });
    assert.deepEqual(visited, ['https://example.com/store']);
    globalThis.mraid = { open: url => visited.push(`mraid:${url}`) };
    playable.download({ automatic: true });
    assert.equal(visited[1], 'mraid:https://example.com/store');
  } finally {
    Object.assign(globalThis, saved);
  }
});
