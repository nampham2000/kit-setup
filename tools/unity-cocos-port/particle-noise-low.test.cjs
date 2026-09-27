'use strict';
// Unity Noise quality Low. Native oracle fixtures/particle-noise-low-native.json
// (capture-noise-low.cs): 768 line-sweep samples at lattice points and at 1/4 and 1/2
// cells, plus 384 random 3D holdouts across seeds, frequency, scroll, octaves and damping.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const m = { exports: {} };
new Function('exports', 'module', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityNoiseKernel.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)(m.exports, m);
const { UnityNoiseKernel } = m.exports;
const fixture = require('./fixtures/particle-noise-low-native.json');
const spec = (frequency = 1, damping = false, octaves = 1) => ({ quality: 0, frequency, damping, octaves, octaveMultiplier: 0.5, octaveScale: 2 });

test('native Low fixture binds its portable capture producer', () => {
  const producer = fs.readFileSync(path.join(__dirname, 'fixtures/capture-noise-low.cs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'), fixture.sourceProbeSha256);
  assert.equal(fixture.quality, 0);
});
test('Low lattice slopes are +-2 from the Perlin permutation parity; X follows Y, Y follows Z, Z follows X', () => {
  const kernel = new UnityNoiseKernel(1);
  assert.deepEqual(Array.from(kernel.phase, v => Math.fround(v)), fixture.seed1Phase.map(v => Math.fround(v)), 'same seeded phase as Medium/High');
  const lattice = fixture.lattice.find(l => l.fraction === 0).rows;
  // Rows 0-255 sweep x (read out.z), 256-511 sweep y (out.x), 512-767 sweep z (out.y).
  lattice.forEach((row, i) => {
    const component = [2, 0, 1][Math.floor(i / 256)];
    assert.ok(Math.abs(Math.abs(row.field[component]) - 2) < 1e-3, `lattice slope ${row.field[component]}`);
    assert.equal(Math.sign(row.field[component]), Math.sign(kernel.slope(i % 256 + 256)), `parity of lattice ${i % 256}`);
  });
});
test('Low analytic slope matches every native sweep sample (lattice, 1/4 and 1/2 cells)', () => {
  const kernel = new UnityNoiseKernel(1), out = new Float64Array(3);
  let worst = 0;
  for (const lattice of fixture.lattice) for (const row of lattice.rows) {
    kernel.sample(out, ...row.position, 0, spec());
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(out[i] - row.field[i]));
  }
  assert.ok(worst < 5e-4, `worst sweep error ${worst}`);
});
test('Low passes 384 independent native holdouts across seed, frequency, scroll, octaves and damping', () => {
  let error = 0, energy = 0, worst = 0, count = 0;
  const out = new Float64Array(3);
  for (const holdout of fixture.holdouts) {
    const kernel = new UnityNoiseKernel(holdout.seed);
    const s = { ...spec(holdout.frequency, holdout.damping, holdout.octaves), octaveMultiplier: holdout.octaveMultiplier, octaveScale: holdout.octaveScale };
    for (const row of holdout.rows) {
      kernel.sample(out, ...row.position, holdout.scroll, s); count++;
      for (let i = 0; i < 3; i++) { const d = out[i] - row.field[i]; error += d * d; energy += row.field[i] ** 2; worst = Math.max(worst, Math.abs(d)); }
    }
  }
  assert.equal(count, 384);
  assert.ok(Math.sqrt(error / energy) < 1e-4, `NRMSE ${Math.sqrt(error / energy)}`);
  assert.ok(worst < 2e-3, `worst holdout error ${worst}`);
});
test('Low differs from Medium: a Medium kernel cannot stand in for it', () => {
  const kernel = new UnityNoiseKernel(1), low = new Float64Array(3), medium = new Float64Array(3);
  let difference = 0;
  for (const row of fixture.holdouts[0].rows) {
    kernel.sample(low, ...row.position, 0, spec()); kernel.sample(medium, ...row.position, 0, { ...spec(), quality: 1 });
    difference = Math.max(difference, Math.hypot(low[0] - medium[0], low[1] - medium[1], low[2] - medium[2]));
  }
  assert.ok(difference > 1, `Low vs Medium ${difference}`);
});
