'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveColorSpace } = require('./unity-shader-compiler.cjs');
const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');

function project(activeColorSpace) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.mkdirSync(path.join(root, 'ProjectSettings'));
  fs.writeFileSync(path.join(root, 'ProjectSettings', 'ProjectSettings.asset'),
    `PlayerSettings:\n  m_ObjectHideFlags: 0\n  m_ActiveColorSpace: ${activeColorSpace}\n`);
  return root;
}

test('colour space: explicit flag, then ProjectSettings m_ActiveColorSpace, then linear', () => {
  assert.deepEqual(resolveColorSpace({ colorSpace: 'gamma', unityProject: project(1) }), { colorSpace: 'gamma', source: '--color-space' });
  assert.equal(resolveColorSpace({ unityProject: project(0) }).colorSpace, 'gamma', 'KriptoFX author project is Gamma');
  assert.equal(resolveColorSpace({ unityProject: project(1) }).colorSpace, 'linear');
  assert.equal(resolveColorSpace({}).colorSpace, 'linear');
});

test('UNITY_COLORSPACE_GAMMA follows the colour space (RFX4_Tornado #ifndef branch)', () => {
  const src = '#ifndef UNITY_COLORSPACE_GAMMA\nx = pow(x, 0.4545);\n#endif';
  assert.match(lowerHlslToGlsl(src, { colorSpace: 'gamma' }), /#ifndef 1/);
  assert.match(lowerHlslToGlsl(src, {}), /#ifndef 0/);
});
