'use strict';
// Unity birth/death sub-emitters replay the sub system's own emission once per parent
// event. Hovl "Magic shield 3": 8/s parents over 1.1 s; Glow = 1 burst, Bubbles = 30 x 0.1 s.
const fs = require('node:fs'), path = require('node:path'), test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');

class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } clone() { return new Vec3(this.x, this.y, this.z); } static transformMat4() {} }
class CurveRange { constructor(constant = 0) { this.mode = 0; this.constant = constant; this.multiplier = 1; } evaluate() { return this.constant; } }
const decorator = () => (target) => target;
const cc = {
  _decorator: { ccclass: decorator, executeInEditMode: (t) => t, executionOrder: decorator, playOnFocus: (t) => t, property: () => () => undefined },
  Component: class { constructor() { this.enabled = true; } }, Enum: (e) => e, Mat4: class {}, Node: class {}, ParticleSystem: class {}, Vec3, CurveRange,
};

function load(editor = false) {
  const out = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleSubEmitterFollower.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true } }).outputText;
  new Function('exports', 'require', source)(out, (id) => (id === 'cc/env' ? { EDITOR_NOT_IN_PREVIEW: editor } : cc));
  return out;
}

function target(name, { duration = 6, loop = false, rate = 0, bursts = [] } = {}) {
  const node = { name, active: true, position: new Vec3(), setWorldPosition(v) { this.position.set(v); } };
  return {
    node, duration, loop, rateOverTime: new CurveRange(rate), rateOverDistance: new CurveRange(0), _isPlaying: false,
    bursts: bursts.map(([time, count, repeatCount = 1, repeatInterval = 0.01]) => ({ time, repeatCount, repeatInterval, count: new CurveRange(count) })),
    emitted: [], play() { this._isPlaying = true; }, emit(n) { this.emitted.push({ n, x: node.position.x }); },
    total() { return this.emitted.reduce((s, e) => s + e.n, 0); },
  };
}

function rig(mod, targets, types) {
  const pool = { data: [], length: 0 };
  const source = { simulationSpace: 0, processor: { _particles: pool } };
  const follower = new mod.UnityParticleSubEmitterFollower();
  follower.source = source;
  follower.entries = targets.map((t, i) => Object.assign(new mod.UnityParticleSubEmitterEntry(), {
    type: types?.[i] ?? 0, subEmitter: t, subEmitterNode: t.node, emitProbability: 1, maxSourceParticles: 32, unityInstances: true,
  }));
  let seed = 1;
  const spawn = (x) => { const p = { position: new Vec3(x, 0, 0), remainingLifetime: 5, randomSeed: seed++ }; pool.data[pool.length++] = p; return p; };
  const kill = (p) => { const i = pool.data.indexOf(p); pool.data.splice(i, 1); pool.data.push(p); pool.length--; p.remainingLifetime = 0; };
  return { follower, pool, spawn, kill };
}

test('each parent birth replays the sub system bursts once, not per frame', () => {
  const mod = load();
  const glow = target('Glow', { bursts: [[0, 1]] });
  const bubbles = target('Bubbles', { bursts: [[0, 1, 30, 0.1]] });
  const { follower, spawn } = rig(mod, [glow, bubbles]);
  const dt = 1 / 60, births = [];
  for (let frame = 0; frame <= 96; frame++) {
    const t = frame * dt;
    // Unity rate 8/s over a 1.1 s duration: births at 0.125, 0.25, ... 1.0.
    while (births.length < 8 && (births.length + 1) / 8 <= t + 1e-9) births.push({ t, p: spawn(births.length) });
    follower.lateUpdate(dt);
  }
  assert.equal(glow.total(), 8, 'one Glow per parent');
  const now = 96 * dt;
  const expected = births.reduce((n, b) => n + Math.min(30, Math.floor((now - b.t) / 0.1 + 1e-6) + 1), 0);
  assert.ok(Math.abs(bubbles.total() - expected) <= births.length, `bubbles ${bubbles.total()} vs ${expected}`);
  // The target no longer emits by itself but keeps simulating.
  assert.equal(glow.bursts.length, 0);
  assert.equal(glow.rateOverTime.constant, 0);
  assert.equal(glow.loop, true);
  assert.equal(glow._isPlaying, true);
  // Emission follows each parent particle.
  assert.deepEqual([...new Set(glow.emitted.map((e) => e.x))].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('a birth instance stops with its parent and a death instance fires at the last position', () => {
  const mod = load();
  const trail = target('Trail', { rate: 60, loop: true });
  const burst = target('Burst', { bursts: [[0, 12]] });
  const { follower, spawn, kill } = rig(mod, [trail, burst], [0, 2]);
  const p = spawn(3);
  for (let i = 0; i < 30; i++) follower.lateUpdate(1 / 60);
  const alive = trail.total();
  assert.ok(alive >= 28 && alive <= 30, `rate emission while alive: ${alive}`);
  assert.equal(burst.total(), 0);
  p.position.x = 9;
  follower.lateUpdate(1 / 60);
  kill(p);
  for (let i = 0; i < 30; i++) follower.lateUpdate(1 / 60);
  assert.ok(trail.total() - alive <= 1, 'birth instance ends with the parent');
  assert.deepEqual(burst.emitted, [{ n: 12, x: 9 }]);
});

test('a recycled particle object ends the old instance and starts a new one', () => {
  const mod = load();
  const glow = target('Glow', { bursts: [[0, 1]] });
  const { follower, spawn } = rig(mod, [glow]);
  const p = spawn(0);
  follower.lateUpdate(1 / 60);
  p.randomSeed = 99;
  follower.lateUpdate(1 / 60);
  assert.equal(glow.total(), 2);
});

test('edit mode never rewrites the authored sub system', () => {
  const mod = load(true);
  const glow = target('Glow', { bursts: [[0, 1]] });
  const { follower, spawn } = rig(mod, [glow]);
  spawn(0);
  follower.lateUpdate(1 / 60);
  assert.equal(glow.bursts.length, 1);
  assert.equal(glow.loop, false);
  assert.equal(glow.total(), 0);
});
