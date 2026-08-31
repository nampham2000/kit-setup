'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PLAYABLE_TRANSPARENT_PRESET_ID,
  TextureCompressionPolicy,
  isPlayableTextureUrl,
  normalizeWebpQuality,
} = require('../dist/texture-compression-policy.js');

function makeEditor({ preset = null } = {}) {
  let profile = { userPreset: preset ? { [preset.id]: preset.value } : {}, genMipmaps: false };
  let profileWrites = 0;
  const assets = [
    { uuid: 'png', url: 'db://assets/a.png' },
    { uuid: 'jpg', url: 'db://assets/B.JPG' },
    { uuid: 'jpeg', url: 'db://assets/nested/c.JpEg' },
    { uuid: 'webp', url: 'db://assets/excluded.webp' },
    { uuid: 'text', url: 'db://assets/excluded.txt' },
  ];
  const byId = new Map(assets.flatMap((asset) => [[asset.uuid, asset], [asset.url, asset]]));
  const metas = new Map(assets.filter((asset) => /\.(?:png|jpe?g)$/i.test(asset.url)).map((asset) => [asset.uuid, {
    ver: '1.0.27', importer: 'image', imported: true, uuid: asset.uuid,
    files: ['.json'], subMetas: {}, userData: { type: 'texture', keepMe: true },
  }]));
  const calls = [];
  return {
    editor: {
      Profile: {
        async getProject(name, key) {
          assert.equal(name, 'builder');
          assert.equal(key, 'textureCompressConfig');
          return structuredClone(profile);
        },
        async setProject(name, key, next) {
          assert.equal(name, 'builder');
          assert.equal(key, 'textureCompressConfig');
          profileWrites += 1;
          profile = structuredClone(next);
        },
      },
      Message: {
        async request(packageName, message, ...args) {
          assert.equal(packageName, 'asset-db');
          calls.push([message, ...args]);
          if (message === 'query-ready') return true;
          if (message === 'query-assets') return assets;
          if (message === 'query-asset-info') {
            const asset = byId.get(args[0]);
            return asset ? { ...asset, path: asset.url, isDirectory: false, importer: 'image' } : null;
          }
          if (message === 'query-asset-meta') return structuredClone(metas.get(args[0]) || null);
          if (message === 'save-asset-meta') {
            metas.set(args[0], JSON.parse(args[1]));
            return { uuid: args[0] };
          }
          throw new Error(`Unexpected Asset DB message: ${message}`);
        },
      },
    },
    get profile() { return profile; },
    get profileWrites() { return profileWrites; },
    metas,
    calls,
  };
}

test('extension policy creates WebP 50 fallback and applies it to PNG/JPG/JPEG only', async () => {
  const fixture = makeEditor();
  global.Editor = fixture.editor;
  try {
    const policy = new TextureCompressionPolicy();
    const first = await policy.enforceAll();
    assert.equal(first.complete, true);
    assert.equal(first.preset.created, true);
    assert.equal(first.preset.id, PLAYABLE_TRANSPARENT_PRESET_ID);
    assert.equal(first.preset.webpQuality, 50);
    assert.equal(first.eligible, 3);
    assert.equal(first.updated, 3);
    assert.equal(first.failed, 0);
    assert.equal(fixture.profileWrites, 1);
    assert.equal(fixture.profile.userPreset[PLAYABLE_TRANSPARENT_PRESET_ID].options.web.webp.quality, 50);
    for (const id of ['png', 'jpg', 'jpeg']) {
      assert.equal(fixture.metas.get(id).userData.useCompressTexture, true);
      assert.equal(fixture.metas.get(id).userData.presetId, PLAYABLE_TRANSPARENT_PRESET_ID);
      assert.equal(fixture.metas.get(id).userData.keepMe, true);
    }
    assert.equal(fixture.metas.has('webp'), false);

    const second = await policy.enforceAll();
    assert.equal(second.complete, true);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 3);
    assert.equal(fixture.profileWrites, 1);
  } finally {
    delete global.Editor;
  }
});

test('extension policy reuses a spaced Playable Transparent alias without rewriting it', async () => {
  const fixture = makeEditor({
    preset: {
      id: 'existing-preset-id',
      value: { name: 'Playable Transparent', options: { web: { webp: { quality: 72 } } } },
    },
  });
  global.Editor = fixture.editor;
  try {
    const report = await new TextureCompressionPolicy().enforceAll({ presetName: 'PlayableTransparent' });
    assert.equal(report.complete, true);
    assert.equal(report.preset.id, 'existing-preset-id');
    assert.equal(report.preset.created, false);
    assert.equal(report.preset.webpQuality, 72);
    assert.equal(fixture.profileWrites, 0);
    assert.equal(fixture.metas.get('png').userData.presetId, 'existing-preset-id');
  } finally {
    delete global.Editor;
  }
});

test('extension policy refuses to alias a colliding stable ID to another preset', async () => {
  const fixture = makeEditor({
    preset: {
      id: PLAYABLE_TRANSPARENT_PRESET_ID,
      value: { name: 'DifferentPreset', options: { web: { webp: { quality: 9 } } } },
    },
  });
  global.Editor = fixture.editor;
  try {
    await assert.rejects(
      () => new TextureCompressionPolicy().enforceAll(),
      /already occupied by preset DifferentPreset/,
    );
    assert.equal(fixture.profileWrites, 0);
  } finally {
    delete global.Editor;
  }
});

test('texture extension and quality normalization are case-insensitive and bounded', () => {
  assert.equal(isPlayableTextureUrl('db://assets/A.PNG'), true);
  assert.equal(isPlayableTextureUrl('db://assets/A.JpEg?cache=1'), true);
  assert.equal(isPlayableTextureUrl('db://assets/A.webp'), false);
  assert.equal(normalizeWebpQuality(0.5), 50);
  assert.equal(normalizeWebpQuality(250), 100);
  assert.equal(normalizeWebpQuality(0), 1);
  assert.equal(normalizeWebpQuality(undefined), 50);
});
