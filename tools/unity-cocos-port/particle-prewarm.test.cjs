'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const m = { exports: {} };
new Function('exports', 'module', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticlePrewarm.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(m.exports, m, () => ({}));
const { installUnityParticlePrewarm, unityPrewarmSeconds } = m.exports;
const { attachPrewarmRuntime } = require('./particle-prewarm-binding');
const { cases } = require('./fixtures/prewarm-steady-state.json');

const repeat = (t, length) => t - Math.floor(t / length) * length;

// Minimal stand-in for Cocos 3.8.8 ParticleSystem: the Burst.update window test
// and the stock _prewarmSystem are copied from the engine source.
function system({ duration, lifetime, burst }) {
  const ages = [];
  const b = { remaining: 0, cur: 0 };
  const ps = {
    duration, loop: true, _time: 0, startDelay: { mode: 0, constant: 0 },
    startLifetime: { getMax: () => lifetime },
    ages,
    _emit(dt) {
      if (b.remaining === 0) { b.remaining = 1; b.cur = burst.time; }
      let pre = repeat(this._time, this.duration) - dt;
      pre = pre > 0 ? pre : 0;
      const cur = repeat(this._time, this.duration);
      if (b.cur >= pre && b.cur < cur) {
        for (let i = 0; i < burst.count; i++) ages.push(0);
        b.cur += 1; b.remaining--;
      }
    },
    processor: { updateParticles(dt) {
      for (let i = ages.length - 1; i >= 0; i--) { ages[i] += dt; if (ages[i] >= lifetime) ages.splice(i, 1); }
    } },
    _prewarmSystem() {
      const dt = 1.0, cnt = this.duration / dt;
      for (let i = 0; i < cnt; ++i) { this._time += dt; this._emit(dt); this.processor.updateParticles(dt); }
    },
    frame(dt) { this._time += dt; this._emit(dt); this.processor.updateParticles(dt); },
  };
  return ps;
}

for (const sample of cases) {
  test(`${sample.emitter} starts in Unity's prewarmed steady state`, () => {
    const stock = system(sample);
    stock._prewarmSystem();
    stock.frame(1 / 60);
    assert.notEqual(stock.ages.length, sample.agesAfterFirstFrame.length, 'stock Cocos prewarm loses prewarm or first-frame bursts');

    const ps = system(sample);
    installUnityParticlePrewarm(ps); installUnityParticlePrewarm(ps);
    ps._prewarmSystem();
    const start = [...ps.ages].sort((a, b) => b - a);
    assert.equal(start.length, sample.agesAtStart.length);
    start.forEach((age, i) => assert.ok(Math.abs(age - sample.agesAtStart[i]) < 0.05, `start age ${i}: ${age} vs ${sample.agesAtStart[i]}`));

    ps.frame(1 / 60);
    const first = [...ps.ages].sort((a, b) => b - a);
    assert.equal(first.length, sample.agesAfterFirstFrame.length, 'the t=0 burst fires on the first frame');
    first.forEach((age, i) => assert.ok(Math.abs(age - sample.agesAfterFirstFrame[i]) < 0.05, `first-frame age ${i}`));
  });
}

test('prewarm covers whole cycles until the oldest particle could still be alive', () => {
  assert.equal(unityPrewarmSeconds(0.5, 1.2), 1.5);
  assert.equal(unityPrewarmSeconds(0.8, 1.2), 1.6);
  assert.equal(unityPrewarmSeconds(1, 1), 1);
  assert.equal(unityPrewarmSeconds(2, 0.25), 2);
  assert.equal(unityPrewarmSeconds(0, 1), 0);
});

test('porter binds prewarm only on looping systems and reports missing AssetDB registration', () => {
  for (const imported of [true, false]) for (const loop of [true, false]) {
    const objects = [{ __type__: 'cc.Node', _name: 'Glow' }, { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _prewarm: true, loop }];
    const builder = { objects, cocosDb: { findScriptClass: () => imported ? { classId: 'registered' } : null }, addComponent(node, type, props) { objects.push({ node, type, ...props }); } };
    const issues = [];
    attachPrewarmRuntime(builder, { high: code => issues.push(code), medium: code => issues.push(code), low() {} }, { dryRun: true, cocosRoot: path.join(__dirname, 'fixtures/no-project') });
    assert.equal(objects.length, loop && imported ? 3 : 2);
    assert.deepEqual(issues, loop && !imported ? ['PARTICLE_PREWARM_ADAPTER_REQUIRED'] : []);
  }
});
