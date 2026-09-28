'use strict';
// Unity birth/death sub-emitters replay the sub system's own emission once per parent
// event. Hovl "Magic shield 3": 8/s parents over 1.1 s; Glow = 1 burst, Bubbles = 30 x 0.1 s.
const fs = require('node:fs'), path = require('node:path'), test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(v, y, z) { if (typeof v === 'number') { this.x = v; this.y = y; this.z = z; } else { this.x = v.x; this.y = v.y; this.z = v.z; } return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  static transformMat4() {}
  static lerp(o, a, b, t) { return o.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  static scaleAndAdd(o, a, b, s) { return o.set(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s); }
  static lengthSqr(a) { return a.x * a.x + a.y * a.y + a.z * a.z; }
  static normalize(o, a) { const l = Math.sqrt(Vec3.lengthSqr(a)) || 1; return o.set(a.x / l, a.y / l, a.z / l); }
  static transformQuat(o, a) { return o.set(a); }
}
class Quat {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  set(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  static rotationTo(o) { return o; }
  static multiply(o) { return o; }
}
class CurveRange { constructor(constant = 0) { this.mode = 0; this.constant = constant; this.multiplier = 1; } evaluate() { return this.constant; } }
const decorator = () => (target) => target;
const cc = {
  _decorator: { ccclass: decorator, executeInEditMode: (t) => t, executionOrder: decorator, playOnFocus: (t) => t, property: () => () => undefined },
  Component: class { constructor() { this.enabled = true; } }, Enum: (e) => e, Mat4: class {}, Node: class {}, ParticleSystem: class {}, Vec3, Quat, CurveRange,
};

function load(editor = false) {
  const out = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleSubEmitterFollower.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true } }).outputText;
  new Function('exports', 'require', source)(out, (id) => (id === 'cc/env' ? { EDITOR_NOT_IN_PREVIEW: editor } : cc));
  return out;
}

function target(name, { duration = 6, loop = false, rate = 0, bursts = [] } = {}) {
  const node = { name, active: true, position: new Vec3(), worldRotation: new Quat(), setWorldPosition(v) { this.position.set(v); }, setWorldRotation(q) { this.worldRotation.set(q); } };
  return {
    node, duration, loop, rateOverTime: new CurveRange(rate), rateOverDistance: new CurveRange(0), _isPlaying: false,
    bursts: bursts.map(([time, count, repeatCount = 1, repeatInterval = 0.01]) => ({ time, repeatCount, repeatInterval, count: new CurveRange(count) })),
    emitted: [], play() { this._isPlaying = true; }, emit(n) { this.emitted.push({ n, x: node.position.x }); },
    total() { return this.emitted.reduce((s, e) => s + e.n, 0); },
  };
}

function rig(mod, targets, types) {
  const pool = { data: [], length: 0 };
  const source = { simulationSpace: 0, node: { worldRotation: new Quat() }, processor: { _particles: pool } };
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

test('a birth instance ends when its parent leaves the pool without a lifetime change (stop/clear, collision kill)', () => {
  const mod = load();
  const trail = target('Trail', { duration: 5, loop: true, rate: 60 });
  const { follower, pool, spawn } = rig(mod, [trail]);
  spawn(0);
  for (let i = 0; i < 10; i++) follower.lateUpdate(1 / 60);
  const before = trail.total();
  assert.ok(before > 0);
  pool.length = 0; // ParticleSystem.clear(): the pool empties, particle objects keep their lifetime
  for (let i = 0; i < 60; i++) follower.lateUpdate(1 / 60);
  assert.ok(trail.total() - before <= 1, `looping birth sub-emitter kept emitting after the parent was cleared (${trail.total() - before})`);
});

test('a repeating burst landing exactly on the duration belongs to the next loop', () => {
  const mod = load();
  // Unity: burst at 0 x 8 every 0.25 s in a 1 s loop emits 4 cycles per loop, never 5.
  const ring = target('Ring', { duration: 1, loop: true, bursts: [[0, 1, 8, 0.25]] });
  const { follower, spawn } = rig(mod, [ring]);
  spawn(0);
  for (let i = 0; i <= 120; i++) follower.lateUpdate(1 / 60);
  // Frames 0..120 cover t = 0..2 s: cycles at 0, .25, .5, .75 in each of two loops, plus t = 2's cycle 0.
  assert.equal(ring.total(), 9);
});

test('instance-mode targets are silenced when the follower loads, before any parent event', () => {
  const mod = load();
  const trail = target('Trail', { duration: 2, loop: true, rate: 30, bursts: [[0, 5]] });
  const { follower } = rig(mod, [trail]);
  follower.onLoad();
  assert.equal(trail.rateOverTime.constant, 0);
  assert.equal(trail.bursts.length, 0);
  assert.equal(trail.total(), 0);
});

// Tanks! shell sparks: a moving parent's Birth instance leaves a continuous trail. Particles sit at their
// sub-frame point along the parent's path, not one clump at the parent's end-of-frame position.
test('birth rate emission is placed along the parent path within the step', () => {
  const mod = load();
  const trail = target('Trail', { rate: 600, duration: 1, loop: true });
  const { follower, spawn } = rig(mod, [trail]);
  const p = spawn(0);
  p.velocity = new Vec3(60, 0, 0); p.startLifetime = 5; // 1 unit per 1/60 s frame
  const dt = 1 / 60;
  follower.lateUpdate(dt); // instance starts; the parent's age is 0 here
  trail.emitted.length = 0;
  p.remainingLifetime -= dt; p.position.x += 1;
  follower.lateUpdate(dt);
  const xs = trail.emitted.map((e) => e.x);
  assert.equal(xs.length, 10, '600/s over one frame');
  assert.ok(Math.min(...xs) > 0 && Math.min(...xs) <= 0.11 && Math.max(...xs) === 1, JSON.stringify(xs));
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 0.1) < 1e-9, 'evenly spaced along the path');
});

test('death instances of a Local-simulation sub system stay at their own parent positions', () => {
  // PopupWin logo (Candy Pop Sort): trailR rockets die at different points and each par_firework (Local
  // simulation) burst stays where its rocket died; moving the shared node dragged every burst to the last one.
  const mod = load();
  const burst = target('Firework', { bursts: [[0, 3]] });
  burst.simulationSpace = 1;
  const pool = { data: [], length: 0 };
  burst.processor = { _particles: pool };
  burst.emit = function (n) { this.emitted.push({ n, x: this.node.position.x }); for (let i = 0; i < n; i++) pool.data[pool.length++] = { position: new Vec3(0.5 * i, 0, 0) }; };
  burst.node.getWorldMatrix = (out) => out;
  const saved = { transformMat4: Vec3.transformMat4, invert: cc.Mat4.invert };
  Vec3.transformMat4 = (o, a) => o.set(a); // identity emitter frame
  cc.Mat4.invert = (o) => o;
  try {
    const { follower, spawn, kill } = rig(mod, [burst], [2]);
    const a = spawn(4), b = spawn(-7);
    follower.lateUpdate(1 / 60);
    kill(a);
    follower.lateUpdate(1 / 60);
    kill(b);
    follower.lateUpdate(1 / 60);
    assert.equal(burst.total(), 6);
    assert.equal(burst.node.position.x, 0, 'the Local sub system node is not moved');
    assert.deepEqual(pool.data.slice(0, pool.length).map((p) => p.position.x), [4, 4.5, 5, -7, -6.5, -6]);
  } finally { Vec3.transformMat4 = saved.transformMat4; cc.Mat4.invert = saved.invert; }
});

test('instances emit the sub system Rate over Distance along their parent path (Hovl Magic circle 1 SubGlow)', () => {
  const mod = load();
  Vec3.distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const sub = target('SubGlow', { loop: true });
  // The porter binds UnityParticleRateOverDistanceEmitter (15 per unit) on the sub system node.
  const distanceEmitter = { rateOverDistance: 15, enabled: true };
  sub.node.getComponent = (name) => (name === 'UnityParticleRateOverDistanceEmitter' ? distanceEmitter : null);
  const { follower, spawn } = rig(mod, [sub]);
  const dt = 1 / 60;
  const parent = spawn(0);
  follower.lateUpdate(dt);
  // The parent moves 3 units in 60 frames: 15 * 3 = 45 particles, each placed along the path.
  for (let frame = 1; frame <= 60; frame++) { parent.position.x = frame * 0.05; follower.lateUpdate(dt); }
  assert.equal(distanceEmitter.enabled, false, 'the node-bound distance emitter is taken over by the instances');
  assert.ok(Math.abs(sub.total() - 45) <= 1, `emitted ${sub.total()} over 3 units`);
  const xs = sub.emitted.map((e) => e.x);
  assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-9), 'placed in travel order');
  assert.ok(Math.abs(xs[1] - xs[0] - 1 / 15) < 1e-6, 'one particle per 1/15 unit');
  // A static parent emits nothing by distance.
  const idle = target('Idle', { loop: true });
  idle.node.getComponent = () => ({ rateOverDistance: 15, enabled: true });
  const still = rig(mod, [idle]);
  still.spawn(1);
  for (let frame = 0; frame < 30; frame++) still.follower.lateUpdate(dt);
  assert.equal(idle.total(), 0);
});
