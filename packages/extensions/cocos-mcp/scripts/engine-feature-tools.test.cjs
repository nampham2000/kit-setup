'use strict';

const assert = require('node:assert/strict');
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
        },
        includeModules: ['physics', 'physics-builtin'],
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
