'use strict';

/**
 * Boot phase for the runtime smoke test.
 *
 * A fixed wait after navigation is not proof that the page has booted: a fresh headless Chrome must download
 * the ~19 MB editor-preview engine bundle and the game's preload, which on a loaded machine can take longer
 * than the measurement window. The page was then judged while still a uniform loading frame and failed
 * core acceptance although the preview was healthy. The boot phase polls until Cocos is present, a scene is
 * running and the canvas frame is not uniform (the same three-patch detector the verdict uses), or until the
 * bounded boot timeout expires. Only then does the caller start its measurement window, evalBefore and gestures.
 */

const { contentProbeClips } = require('./runtime-content-probes.cjs');

const RUNTIME_BOOT_TIMEOUT = 'RUNTIME_BOOT_TIMEOUT';
const DEFAULT_BOOT_TIMEOUT_SECONDS = 30;
const MIN_BOOT_TIMEOUT_SECONDS = 5;
const MAX_BOOT_TIMEOUT_SECONDS = 120;
const BOOT_POLL_MS = 250;

/** Strict parser shared by verify-runtime and core acceptance: a plain number of seconds in [5, 120]. */
function parseBootTimeoutSeconds(value, flag = '--boot-timeout') {
  const text = String(value === undefined || value === null ? '' : value).trim();
  const seconds = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!Number.isFinite(seconds) || seconds < MIN_BOOT_TIMEOUT_SECONDS || seconds > MAX_BOOT_TIMEOUT_SECONDS) {
    const error = new Error(`${flag} must be a number of seconds in ${MIN_BOOT_TIMEOUT_SECONDS}..${MAX_BOOT_TIMEOUT_SECONDS}`);
    error.code = 'RUNTIME_BOOT_TIMEOUT_INVALID';
    throw error;
  }
  return seconds;
}

/** Programmatic callers (preview-checkpoints) may omit the value; anything given must still be valid. */
function resolveBootTimeoutSeconds(value) {
  return value === undefined || value === null || value === ''
    ? DEFAULT_BOOT_TIMEOUT_SECONDS
    : parseBootTimeoutSeconds(value);
}

const BOOT_PROBE = `JSON.stringify((function () {
  var canvas = document.querySelector('canvas');
  var hasCocos = typeof window.cc !== 'undefined';
  var scene = false;
  try { scene = !!(hasCocos && cc.director && cc.director.getScene && cc.director.getScene()); } catch (e) {}
  return {
    hasCocos: hasCocos,
    sceneRunning: scene,
    canvasWidth: canvas ? canvas.width : 0,
    canvasHeight: canvas ? canvas.height : 0,
    frames: window.__playableFrames || 0,
    now: Date.now()
  };
})())`;

/**
 * The monochrome-frame detector: three (or more, with source-derived probe points) small PNG patches;
 * byte-identical patches mean the canvas shows a single colour. `samples` counts patches actually captured.
 */
async function captureUniformFrame(session, sessionId, width, height, probePoints) {
  const w = Math.max(1, Math.round(Number(width)) || 720);
  const h = Math.max(1, Math.round(Number(height)) || 1280);
  const clips = contentProbeClips(w, h, probePoints || []);
  const patches = [];
  for (const clip of clips) {
    try {
      const patch = await session.send('Page.captureScreenshot', { format: 'png', clip }, sessionId);
      if (patch && patch.data) patches.push(patch.data);
    } catch (_) { /* clip outside the viewport */ }
  }
  return { clips, samples: patches.length, uniform: patches.length >= 2 && patches.every((p) => p === patches[0]) };
}

async function readBootState(session, sessionId, timeoutMs) {
  const evaluated = await session.send('Runtime.evaluate', {
    expression: BOOT_PROBE, returnByValue: true, awaitPromise: false,
  }, sessionId, timeoutMs);
  if (evaluated && evaluated.exceptionDetails) {
    throw new Error(String(evaluated.exceptionDetails.text || 'boot probe failed'));
  }
  return JSON.parse((evaluated && evaluated.result && evaluated.result.value) || '{}');
}

/**
 * Poll every ~250 ms until booted or the timeout expires. Never throws for page state; returns
 * { booted, timedOut, bootMs, polls, stage, baseline, message? }. `baseline` ({frames, now} in page time)
 * lets the caller measure FPS over the post-boot window instead of the loading period.
 */
async function waitForRuntimeBoot(session, sessionId, options = {}, timing = {}) {
  const now = timing.now || Date.now;
  const waitFor = timing.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollMs = Math.max(1, Number(timing.pollMs) || BOOT_POLL_MS);
  const timeoutSeconds = resolveBootTimeoutSeconds(options.bootTimeout);
  const timeoutMs = timeoutSeconds * 1000;
  const started = now();
  let polls = 0;
  let stage = 'not-started';
  let lastError = '';
  for (;;) {
    polls += 1;
    const remaining = Math.max(1000, timeoutMs - (now() - started));
    let state = null;
    try {
      state = await readBootState(session, sessionId, remaining);
    } catch (error) {
      stage = 'evaluate-error';
      lastError = String(error && error.message ? error.message : error);
    }
    if (state) {
      if (!state.hasCocos) stage = 'cocos-missing';
      else if (!state.sceneRunning) stage = 'scene-missing';
      else {
        const frame = await captureUniformFrame(session, sessionId, state.canvasWidth, state.canvasHeight,
          options.contentProbePoints);
        if (frame.samples < 2) stage = 'frame-unavailable';
        else if (frame.uniform) stage = 'uniform-frame';
        else {
          return {
            booted: true, timedOut: false, bootMs: Math.max(0, now() - started), polls, stage: 'booted',
            timeoutSeconds, baseline: { frames: Number(state.frames) || 0, now: Number(state.now) || 0 },
          };
        }
      }
    }
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      const detail = stage === 'uniform-frame' ? 'uniform frame' : stage;
      return {
        booted: false, timedOut: true, bootMs: Math.max(0, elapsed), polls, stage, timeoutSeconds, baseline: null,
        message: `${RUNTIME_BOOT_TIMEOUT}: page not booted after ${Math.round(elapsed / 100) / 10}s `
          + `(last stage: ${detail}${lastError && stage === 'evaluate-error' ? ` — ${lastError.slice(0, 200)}` : ''}; `
          + `${polls} polls; --boot-timeout ${timeoutSeconds}s)`,
      };
    }
    await waitFor(Math.min(pollMs, Math.max(1, timeoutMs - elapsed)));
  }
}

module.exports = {
  RUNTIME_BOOT_TIMEOUT,
  DEFAULT_BOOT_TIMEOUT_SECONDS,
  MIN_BOOT_TIMEOUT_SECONDS,
  MAX_BOOT_TIMEOUT_SECONDS,
  BOOT_POLL_MS,
  BOOT_PROBE,
  parseBootTimeoutSeconds,
  resolveBootTimeoutSeconds,
  captureUniformFrame,
  waitForRuntimeBoot,
};
