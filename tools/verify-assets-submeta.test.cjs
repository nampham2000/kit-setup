'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectImportFailures } = require('./verify-assets.cjs');

test('root imported=true does not hide a failed Cocos sub-asset', () => {
  const inspected = collectImportFailures({
    imported: true,
    subMetas: {
      texture: { importer: 'texture', imported: false, uuid: 'texture-uuid', subMetas: {} },
      sprite: { importer: 'sprite-frame', imported: true, uuid: 'sprite-uuid', subMetas: {} },
    },
  });
  assert.equal(inspected.checked, 3);
  assert.equal(inspected.failures.length, 1);
  assert.deepEqual(inspected.failures[0].subPath, ['texture']);
  assert.equal(inspected.failures[0].meta.uuid, 'texture-uuid');
});

test('failed root is reported once without flooding nested failures', () => {
  const inspected = collectImportFailures({
    imported: false,
    subMetas: { mesh: { imported: false, subMetas: {} } },
  });
  assert.equal(inspected.checked, 1);
  assert.equal(inspected.failures.length, 1);
  assert.deepEqual(inspected.failures[0].subPath, []);
});

test('legacy root without imported still scans modern subMetas', () => {
  const inspected = collectImportFailures({
    subMetas: { mesh: { imported: false, importer: 'gltf-mesh', subMetas: {} } },
  });
  assert.equal(inspected.checked, 1);
  assert.deepEqual(inspected.failures[0].subPath, ['mesh']);
});
