'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EngineFeatureTools } = require('../dist/tools/engine-feature-tools.js');

function profileFixture() {
  return {
    globalConfigKey: 'defaultConfig',
    configs: {
      defaultConfig: {
        cache: {
          graphics: { _value: false },
          physics: { _value: true, _option: 'physics-builtin' },
          'physics-builtin': { _value: true },
          spine: { _value: false, _option: 'spine-3.8' },
          'spine-3.8': { _value: true },
          'spine-4.2': { _value: false },
          'physics-2d': { _value: false, _option: 'physics-2d-builtin' },
          'physics-2d-box2d': { _value: false },
          'physics-2d-box2d-wasm': { _value: false },
          'physics-2d-builtin': { _value: true },
          'physics-2d-box2d-jsb': { _value: false },
          primitive: { _value: true },
          'occlusion-query': { _value: false },
          'geometry-renderer': { _value: false },
          'debug-renderer': { _value: true },
          terrain: { _value: false },
          'light-probe': { _value: false },
        },
        includeModules: ['physics', 'physics-builtin', 'primitive', 'debug-renderer'],
      },
    },
  };
}

test('ensure_features refuses unknown modules instead of blind-inserting profile keys', async () => {
  const profile = profileFixture();
  let writes = 0;
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject() { writes += 1; },
    },
    Project: {},
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['graphics', 'module-that-does-not-exist'],
      reload: false,
    });
    assert.equal(result.success, false);
    assert.equal(result.data.status, 'unknown-feature-module');
    assert.equal(writes, 0);
    assert.equal(Object.hasOwn(profile.configs.defaultConfig.cache, 'module-that-does-not-exist'), false);
  } finally {
    delete global.Editor;
  }
});

test('ensure_features accepts a versioned Spine feature id and persists the exact selector', async () => {
  let profile = profileFixture();
  let writes = 0;
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject(_packageName, _key, next) { profile = next; writes += 1; },
    },
    Project: {},
  };
  try {
    const tools = new EngineFeatureTools();
    const ensureDefinition = tools.getTools().find(item => item.name === 'ensure_features');
    const pattern = new RegExp(ensureDefinition.inputSchema.properties.modules.items.pattern);
    assert.equal(pattern.test('spine-4.2'), true);
    assert.equal(pattern.test('spine..4'), false);
    assert.equal(pattern.test('../spine-4.2'), false);

    const result = await tools.execute('ensure_features', {
      modules: ['spine', 'spine-4.2'],
      reload: false,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.status, 'profile-persisted-reload-skipped');
    assert.equal(writes, 1);
    const config = profile.configs.defaultConfig;
    assert.equal(config.cache.spine._value, true);
    assert.equal(config.cache.spine._option, 'spine-4.2');
    assert.equal(config.cache['spine-3.8']._value, false);
    assert.equal(config.cache['spine-4.2']._value, true);
    assert.ok(!config.includeModules.includes('spine'));
    assert.ok(config.includeModules.includes('spine-4.2'));
    assert.ok(!config.includeModules.includes('spine-3.8'));
  } finally {
    delete global.Editor;
  }
});

test('ensure_features rejects malformed dotted feature names before reading the profile', async () => {
  let reads = 0;
  global.Editor = {
    Profile: { async getProject() { reads += 1; return profileFixture(); } },
    Project: {},
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['spine..4'],
      reload: false,
    });
    assert.equal(result.success, false);
    assert.equal(reads, 0);
  } finally {
    delete global.Editor;
  }
});

test('ensure_features persists Physics2D parent option and an exclusive Box2D backend', async () => {
  let profile = profileFixture();
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject(_packageName, _key, next) { profile = next; },
    },
    Project: {},
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['physics-2d', 'physics-2d-box2d'],
      reload: false,
    });
    assert.equal(result.success, true);
    const config = profile.configs.defaultConfig;
    assert.equal(config.cache['physics-2d']._value, true);
    assert.equal(config.cache['physics-2d']._option, 'physics-2d-box2d');
    assert.equal(config.cache['physics-2d-box2d']._value, true);
    for (const backend of ['physics-2d-box2d-wasm', 'physics-2d-builtin', 'physics-2d-box2d-jsb']) {
      assert.equal(config.cache[backend]._value, false);
      assert.ok(!config.includeModules.includes(backend));
    }
    assert.ok(!config.includeModules.includes('physics-2d'));
    assert.ok(config.includeModules.includes('physics-2d-box2d'));
  } finally {
    delete global.Editor;
  }
});

test('ensure_features accepts Cocos-normalized option parents and fresh preview aliases without rebuilding', async t => {
  let profile = profileFixture();
  const config = profile.configs.defaultConfig;
  config.cache.marionette = { _value: true };
  config.cache.spine = { _value: true, _option: 'spine-4.2' };
  config.cache['spine-3.8']._value = false;
  config.cache['spine-4.2']._value = true;
  config.cache['physics-2d'] = { _value: true, _option: 'physics-2d-box2d' };
  config.cache['physics-2d-builtin']._value = false;
  config.cache['physics-2d-box2d']._value = true;
  config.includeModules = [
    'marionette', 'physics', 'physics-2d-box2d', 'physics-builtin', 'spine-4.2',
  ].sort();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-feature-normalized-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profilePath = path.join(root, 'settings', 'v2', 'packages', 'engine.json');
  const previewDir = path.join(root, 'temp', 'programming', 'packer-driver', 'targets', 'preview');
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(profilePath, '{}\n');
  const scope = {};
  ['spine', 'physics-2d-framework', 'physics-2d-box2d'].forEach((name, index) => {
    scope[`feature_${index}`] = `cce:/internal/x/cc-fu/${name}`;
  });
  const previewPath = path.join(previewDir, 'import-map.json');
  fs.writeFileSync(previewPath, `${JSON.stringify({ scopes: { cc: scope } })}\n`);
  const profileTime = new Date(Date.UTC(2024, 0, 1, 0, 0, 10));
  const previewTime = new Date(Date.UTC(2024, 0, 1, 0, 0, 20));
  fs.utimesSync(profilePath, profileTime, profileTime);
  fs.utimesSync(previewPath, previewTime, previewTime);

  let writes = 0;
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject(_packageName, _key, next) { profile = next; writes += 1; },
    },
    Project: { path: root, tmpDir: path.join(root, 'temp') },
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['marionette', 'spine', 'spine-4.2', 'physics-2d', 'physics-2d-box2d'],
      spineBackend: 'spine-4.2',
      physics2dBackend: 'physics-2d-box2d',
    });
    assert.equal(result.success, true);
    assert.equal(result.data.complete, true);
    assert.equal(result.data.status, 'verified');
    assert.equal(writes, 0);
  } finally {
    delete global.Editor;
  }
});

test('ensure_features removes source-closure-disabled optional modules instead of only adding', async () => {
  let profile = profileFixture();
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject(_packageName, _key, next) { profile = next; },
    },
    Project: {},
  };
  try {
    const disabledModules = [
      'primitive', 'occlusion-query', 'geometry-renderer',
      'debug-renderer', 'terrain', 'light-probe',
    ];
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['graphics'],
      disabledModules,
      reload: false,
    });
    assert.equal(result.success, true);
    const config = profile.configs.defaultConfig;
    assert.equal(config.cache.graphics._value, true);
    for (const moduleName of disabledModules) {
      assert.equal(config.cache[moduleName]._value, false);
      assert.ok(!config.includeModules.includes(moduleName));
    }
  } finally {
    delete global.Editor;
  }
});

test('ensure_features rejects overlap between required and disabled modules before profile mutation', async () => {
  const profile = profileFixture();
  let writes = 0;
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject() { writes += 1; },
    },
    Project: {},
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['primitive'],
      disabledModules: ['primitive'],
      reload: false,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /both required and disabled/);
    assert.equal(writes, 0);
  } finally {
    delete global.Editor;
  }
});

test('ensure_features refuses a backend absent from the current Cocos profile', async () => {
  const profile = profileFixture();
  let writes = 0;
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject() { writes += 1; },
    },
    Project: {},
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      physicsBackend: 'physics-ammo',
      reload: false,
    });
    assert.equal(result.success, false);
    assert.equal(result.data.status, 'unknown-physics-backend');
    assert.equal(writes, 0);
  } finally {
    delete global.Editor;
  }
});

test('ensure_features rejects an orphan include entry without a profile cache record', async () => {
  const profile = profileFixture();
  profile.configs.defaultConfig.includeModules.push('graphics-drawing');
  let writes = 0;
  global.Editor = {
    Profile: {
      async getProject() { return profile; },
      async setProject() { writes += 1; },
    },
    Project: {},
  };
  try {
    const result = await new EngineFeatureTools().execute('ensure_features', {
      modules: ['graphics-drawing'],
      reload: false,
    });
    assert.equal(result.success, false);
    assert.equal(result.data.status, 'unknown-feature-module');
    assert.equal(writes, 0);
  } finally {
    delete global.Editor;
  }
});
