'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createUnityFixture } = require('./unity-intel/test-fixture.cjs');
const { buildIndex, resolveClosure } = require('./port-closure.cjs');

test('port-closure consumes the canonical ScriptIndex and resolves attached scripts', t => {
  const fixture = createUnityFixture(t);
  const index = buildIndex(fixture.assets, { cache: false });
  const prefab = path.join(fixture.assets, 'Game', 'Prefabs', 'Main.prefab');
  const closure = resolveClosure([prefab], index, 2);

  assert.equal(index.scriptIndex.guidToScript[fixture.GUIDS.script], 'Assets/Game/Scripts/Gameplay.cs');
  assert.equal(closure.unresolved.length, 0);
  assert.deepEqual(
    [...closure.depthOf.keys()].map(file => path.relative(fixture.assets, file).replace(/\\/g, '/')),
    ['Game/Scripts/Gameplay.cs'],
  );
});
