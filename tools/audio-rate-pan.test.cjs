'use strict';
// AudioSystem playback rate (Unity pitch) + stereo pan, and the CocosAudioBackend Web Audio voice path (decoded
// buffer + context of the Cocos web player, BufferSource -> Gain -> StereoPanner -> destination; pause / resume
// keep the buffer offset; completion reports the original handle; DOM / native clips fall back to AudioSource).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(rel, requireMap) {
  const filename = path.resolve(__dirname, '..', rel);
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', out)(mod.exports, (id) => { if (requireMap[id]) return requireMap[id]; throw new Error(`unexpected require ${id}`); }, mod);
  return mod.exports;
}

const { AudioSystem } = load('packages/playable-core/audio/AudioSystem.ts', {});
const policy = { path: 'p', cooldownMs: 0, maxConcurrent: 1, priority: 1, volume: 1, loop: false, stealable: false };

test('AudioSystem forwards clamped rate and pan, updates pan of a live voice, rejects stale handles', () => {
  const calls = [];
  const backend = { start: (...a) => calls.push(['start', ...a]), stop() {}, pause() {}, resume() {}, volume() {}, pan: (s, p) => calls.push(['pan', s, p]) };
  const sys = new AudioSystem({ maxSfxVoices: 2, sounds: { a: { ...policy, maxConcurrent: 2 } } }, backend, () => 0);
  sys.bind('a', {}); sys.unlockFromGesture();
  const h = sys.play('a', 1, 2 ** (100 / 1200), -0.5);
  assert.ok(h > 0);
  assert.equal(calls[0][0], 'start'); assert.ok(Math.abs(calls[0][6] - 1.0594631) < 1e-6); assert.equal(calls[0][7], -0.5);
  sys.play('a', 1, 100, 5);
  assert.equal(calls[1][6], 16); assert.equal(calls[1][7], 1);
  assert.equal(sys.setPlaybackPan(h, 0.25), true);
  assert.deepEqual(calls[2], ['pan', 0, 0.25]);
  sys.stop(h);
  assert.equal(sys.setPlaybackPan(h, 0), false);
  // defaults keep the old contract: rate 1, pan 0
  sys.play('a');
  assert.equal(calls[calls.length - 1][6], 1); assert.equal(calls[calls.length - 1][7], 0);
});

test('unlockFromGesture calls the backend unlock hook', () => {
  let unlocked = 0;
  const sys = new AudioSystem({ maxSfxVoices: 1, sounds: { a: policy } }, { start() {}, stop() {}, pause() {}, resume() {}, volume() {}, unlock: () => unlocked++ }, () => 0);
  sys.unlockFromGesture();
  assert.equal(unlocked, 1);
});

// ---- CocosAudioBackend with fake Web Audio nodes ----------------------------------------------------------------------
class FakeParam { constructor(v) { this.value = v; } }
class FakeCtx {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = { id: 'dest' }; this.sources = []; this.resumed = 0; }
  createGain() { return { gain: new FakeParam(1), connect: (n) => { this.gainOut = n; }, disconnect() {} }; }
  createStereoPanner() { return { pan: new FakeParam(0), connect: (n) => { this.panOut = n; }, disconnect() {} }; }
  createBufferSource() {
    const s = { playbackRate: new FakeParam(1), loop: false, buffer: null, started: null, stopped: false, onended: null, connect() {}, disconnect() {}, start(when, off) { s.started = off; }, stop() { s.stopped = true; } };
    this.sources.push(s); return s;
  }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
}
class Node { constructor() { this.handlers = {}; } addComponent(T) { const c = new T(); c.node = this; return c; } once(e, f) { this.handlers[e] = f; } off(e) { delete this.handlers[e]; } destroy() {} }
class AudioSource { constructor() { this.played = 0; this.stopped = 0; } play() { this.played++; } stop() { this.stopped++; } pause() {} }
AudioSource.EventType = { ENDED: 'ended' };
class ObjectPool { register(name, o) { return { get: () => o.create(), put() {}, clear() {} }; } }
const { CocosAudioBackend } = load('packages/playable-core/audio/CocosAudioBackend.ts', {
  cc: { AudioSource, Node, AudioClip: class {} }, '../utils/pool/ObjectPool': { ObjectPool }, './AudioSystem': {},
});
const webClip = (ctx, duration) => ({ _nativeAsset: { player: { _player: { _audioBuffer: { duration }, _gainNode: { context: ctx } } } } });

test('web clips play through BufferSource -> Gain -> StereoPanner with rate and pan', () => {
  const ctx = new FakeCtx();
  const done = [];
  const be = new CocosAudioBackend(new Node(), 2, (h) => done.push(h));
  be.start(0, 7, webClip(ctx, 2), false, 0.5, 1.5, -0.8);
  const src = ctx.sources[0];
  assert.equal(src.playbackRate.value, 1.5); assert.equal(src.started, 0);
  assert.equal(be.supportsRatePan, true);
  assert.equal(ctx.panOut, ctx.destination);
  be.pan(0, 0.3); be.volume(0, 0.2);
  // pause at t = 1 s (1.5 s of buffer played), resume from that offset
  ctx.currentTime = 1; be.pause(0);
  assert.equal(src.stopped, true);
  src.onended && src.onended();
  assert.deepEqual(done, []);
  be.resume(0);
  assert.equal(ctx.sources[1].started, 1.5);
  ctx.sources[1].onended();
  assert.deepEqual(done, [7]);
});

test('stop detaches the ended callback; non-web clips fall back to the AudioSource path', () => {
  const ctx = new FakeCtx();
  const done = [];
  const be = new CocosAudioBackend(new Node(), 1, (h) => done.push(h));
  be.start(0, 3, webClip(ctx, 1), false, 1);
  const src = ctx.sources[0];
  be.stop(0);
  assert.equal(src.onended, null); assert.deepEqual(done, []);
  be.start(0, 4, {}, false, 1, 2, 1);
  assert.equal(ctx.sources.length, 1);
  ctx.state = 'suspended'; be.adoptContext(webClip(ctx, 1)); be.unlock();
  assert.equal(ctx.resumed, 1);
});
