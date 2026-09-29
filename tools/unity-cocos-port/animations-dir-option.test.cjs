'use strict';
// --animations-dir keeps AnimatorController outputs of packs that share controller names
// (KriptoFX v1 and v4 both ship Anim1.controller) in separate folders.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const porter = require('../unity-cocos-port.cjs');
const createAnimationPorter = require('./animation-porter');

test('--animations-dir is parsed and validated', () => {
  const base = ['port', '--src', 'a.prefab', '--out', 'assets/x.prefab'];
  assert.equal(porter.parseArgs(base).animationsDir, undefined);
  assert.equal(porter.parseArgs([...base, '--animations-dir', 'assets/animations/rep1/']).animationsDir, 'assets/animations/rep1');
  assert.equal(porter.parseArgs([...base, '--animations-dir=assets\\animations\\rep1']).animationsDir, 'assets/animations/rep1');
});

test('animation porter writes under the configured root', () => {
  const { animationOutputDirForController } = createAnimationPorter({});
  const cocosRoot = path.resolve('/cocos');
  assert.equal(animationOutputDirForController({ cocosRoot }, { stem: 'Anim1' }), path.join(cocosRoot, 'assets', 'animations', 'anim1'));
  assert.equal(animationOutputDirForController({ cocosRoot, animationsDir: 'assets/animations/rep1' }, { stem: 'Anim1' }),
    path.join(cocosRoot, 'assets', 'animations', 'rep1', 'anim1'));
});
