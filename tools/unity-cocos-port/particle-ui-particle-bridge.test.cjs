'use strict';
// Coffee UIParticle (com.coffee.ui-particle 4.x) bridge math: the unscaled simulation seen by an
// orthographic camera must cover viewHeight / m_Scale3D particle units, and only standard-formula
// SrcAlpha materials move to their premultiplied technique (exact over the transparent target).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const out = {};
const decorator = () => (target) => target;
const cc = { _decorator: { ccclass: decorator, property: () => () => undefined }, Component: class {}, Vec3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }, Vec4: class {} };
new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityUIParticleBridge.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true } }).outputText)(out, () => cc);
const { TECHNIQUE, FORMULA } = require('./unity-particle-material');

test('UIParticle m_Scale3D maps canvas units to particle units', () => {
  // Candy Pop Sort PopupWin: logo UIParticle scale 60 on a 1080x1920 canvas -> 16 units half-height.
  assert.equal(out.uiParticleOrthoHeight(1920, 60), 16);
  assert.equal(out.uiParticleOrthoHeight(1920, 300), 3.2);
  assert.throws(() => out.uiParticleOrthoHeight(1920, 0));
});

test('only standard SrcAlpha materials switch to their premultiplied technique', () => {
  assert.equal(out.premultipliedTechnique(TECHNIQUE.alpha, FORMULA.standard), TECHNIQUE.premultiply);
  assert.equal(out.premultipliedTechnique(TECHNIQUE.additive, FORMULA.standard), TECHNIQUE['additive-one']);
  assert.equal(out.premultipliedTechnique(TECHNIQUE.additive, FORMULA.legacyTinted), -1);
  assert.equal(out.premultipliedTechnique(TECHNIQUE['additive-one'], FORMULA.premultiplyAlpha), -1);
  assert.equal(out.premultipliedTechnique(TECHNIQUE.premultiply, FORMULA.standard), -1);
});
