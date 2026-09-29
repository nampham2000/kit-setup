'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseBootTimeoutSeconds, resolveBootTimeoutSeconds, waitForRuntimeBoot, captureUniformFrame,
  DEFAULT_BOOT_TIMEOUT_SECONDS,
} = require('./lib/runtime-boot.cjs');
const {
  parseArgs, runBootPhase, runtimeVerdict, measureWindowFps, RUNTIME_BOOT_TIMEOUT,
} = require('./verify-runtime.cjs');

/**
 * Fake CDP session: `stateAt(poll)` returns the page state for the n-th boot probe (1-based);
 * `uniformAt(poll)` decides whether that poll's screenshot patches are identical.
 */
function fakeSession({ stateAt, uniformAt, clock }) {
  let polls = 0;
  let patch = 0;
  return {
    get polls() { return polls; },
    send(method) {
      if (method === 'Runtime.evaluate') {
        polls += 1;
        clock.now += 20;
        return Promise.resolve({ result: { value: JSON.stringify({ ...stateAt(polls), now: 1000 + clock.now }) } });
      }
      if (method === 'Page.captureScreenshot') {
        patch += 1;
        return Promise.resolve({ data: uniformAt(polls) ? 'SAME' : `patch-${patch}` });
      }
      return Promise.resolve({});
    },
  };
}

function fakeTiming(clock) {
  return {
    now: () => clock.now,
    wait: async (ms) => { clock.now += ms; },
  };
}

const booted = { hasCocos: true, sceneRunning: true, canvasWidth: 720, canvasHeight: 1280, frames: 300 };

function baseResult() {
  return {
    exceptions: [], consoleErrors: [], frames: 400, fps: 50, uniformFrame: false,
    bootMs: null, bootTimedOut: false,
  };
}

test('slow boot: no cc, no scene, then uniform frames, then a real frame passes and records bootMs', async () => {
  const clock = { now: 0 };
  const session = fakeSession({
    clock,
    stateAt: (poll) => (poll <= 4 ? { hasCocos: false }
      : poll <= 8 ? { hasCocos: true, sceneRunning: false, canvasWidth: 720, canvasHeight: 1280 }
        : booted),
    uniformAt: (poll) => poll <= 20,
  });
  const result = baseResult();
  const baseline = await runBootPhase(session, 's', true, { bootTimeout: 30 }, result, fakeTiming(clock));
  assert.equal(result.bootTimedOut, false);
  assert.equal(result.bootStage, 'booted');
  assert.equal(result.bootPolls, 21);
  assert.ok(result.bootMs >= 20 * 250, `bootMs=${result.bootMs}`);
  assert.ok(result.bootMs < 30000);
  assert.equal(result.code, undefined);
  assert.deepEqual(baseline, { frames: 300, now: 1000 + 21 * 20 + 20 * 250 });
  assert.equal(runtimeVerdict(result, { minFps: 20 }), true);
});

test('boot never leaving the uniform frame fails with RUNTIME_BOOT_TIMEOUT, not as an exception', async () => {
  const clock = { now: 0 };
  const session = fakeSession({ clock, stateAt: () => booted, uniformAt: () => true });
  const result = baseResult();
  const baseline = await runBootPhase(session, 's', true, { bootTimeout: 5 }, result, fakeTiming(clock));
  assert.equal(baseline, null);
  assert.equal(result.bootTimedOut, true);
  assert.equal(result.code, RUNTIME_BOOT_TIMEOUT);
  assert.equal(result.bootStage, 'uniform-frame');
  assert.ok(result.bootMs >= 5000 && result.bootMs < 6000, `bootMs=${result.bootMs}`);
  assert.match(result.bootError, /^RUNTIME_BOOT_TIMEOUT: page not booted after 5(\.\d)?s \(last stage: uniform frame/);
  assert.deepEqual(result.exceptions, []);
  assert.equal(runtimeVerdict(result, { minFps: 20 }), false);
});

test('boot timeout reports the missing-scene stage and a hung evaluate cannot overrun the deadline', async () => {
  const clock = { now: 0 };
  const scene = fakeSession({ clock, stateAt: () => ({ hasCocos: true, sceneRunning: false }), uniformAt: () => false });
  const sceneResult = await waitForRuntimeBoot(scene, 's', { bootTimeout: 5 }, fakeTiming(clock));
  assert.equal(sceneResult.timedOut, true);
  assert.equal(sceneResult.stage, 'scene-missing');

  const hungClock = { now: 0 };
  const hung = {
    send(method, _params, _sessionId, timeoutMs) {
      assert.equal(method, 'Runtime.evaluate');
      hungClock.now += timeoutMs;
      return Promise.reject(new Error('CDP command timed out: Runtime.evaluate'));
    },
  };
  const hungResult = await waitForRuntimeBoot(hung, 's', { bootTimeout: 5 }, fakeTiming(hungClock));
  assert.equal(hungResult.timedOut, true);
  assert.equal(hungResult.stage, 'evaluate-error');
  assert.ok(hungResult.bootMs <= 6000, `bootMs=${hungResult.bootMs}`);
  assert.match(hungResult.message, /CDP command timed out/);
});

test('build files keep the fixed wait: boot phase is skipped', async () => {
  const result = baseResult();
  const baseline = await runBootPhase({ send() { throw new Error('must not probe'); } }, 's', false, {}, result);
  assert.equal(baseline, null);
  assert.equal(result.bootSkipped, 'file-target');
  assert.equal(result.bootMs, null);
  assert.equal(runtimeVerdict(result, { minFps: 20 }), true);
});

test('--boot-timeout is strict and bounded 5..120 with default 30', () => {
  assert.equal(DEFAULT_BOOT_TIMEOUT_SECONDS, 30);
  assert.equal(parseArgs([]).bootTimeout, 30);
  assert.equal(parseArgs(['--boot-timeout', '5']).bootTimeout, 5);
  assert.equal(parseArgs(['--boot-timeout=120']).bootTimeout, 120);
  assert.equal(parseArgs(['--boot-timeout', '42.5']).bootTimeout, 42.5);
  for (const bad of ['4', '4.99', '121', '0', '-30', 'abc', '', '1e2', '30s', undefined]) {
    assert.throws(() => parseArgs(['--boot-timeout', bad]), /--boot-timeout must be a number of seconds in 5\.\.120/,
      String(bad));
  }
  assert.throws(() => parseBootTimeoutSeconds('200'), (error) => error.code === 'RUNTIME_BOOT_TIMEOUT_INVALID');
  assert.equal(resolveBootTimeoutSeconds(undefined), 30);
  assert.throws(() => resolveBootTimeoutSeconds(1));
});

test('uniform-frame detector is shared: identical patches are uniform, distinct are not', async () => {
  const same = { send: () => Promise.resolve({ data: 'X' }) };
  let n = 0;
  const distinct = { send: () => Promise.resolve({ data: `p${n += 1}` }) };
  assert.equal((await captureUniformFrame(same, 's', 720, 1280)).uniform, true);
  const frame = await captureUniformFrame(distinct, 's', 720, 1280, [[0.3, 0.3]]);
  assert.equal(frame.uniform, false);
  assert.equal(frame.clips.length, 4);
});

test('FPS is measured over the post-boot window of the same document', () => {
  assert.deepEqual(measureWindowFps({ frames: 700, now: 11000, firstFrameAt: 500 }, { frames: 100, now: 1000 }),
    { frames: 600, seconds: 10 });
  // A reload after the baseline restarts the frame counter: fall back to first-frame timing.
  assert.equal(measureWindowFps({ frames: 50, now: 11000, firstFrameAt: 5000 }, { frames: 100, now: 1000 }), null);
  assert.equal(measureWindowFps({ frames: 50, now: 11000, firstFrameAt: 500 }, null), null);
});
