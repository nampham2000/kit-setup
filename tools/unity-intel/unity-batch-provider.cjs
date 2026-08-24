'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertUnityLiveSnapshotPatch } = require('./live-schema.cjs');

const BATCH_METHOD = 'CcPlayable.UnityIntelligence.BatchEntry.Scan';
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BATCH_RESULT_BYTES = 2 * 1024 * 1024;

function tail(value, max = 4000) {
  const text = String(value || '').replace(/\r\n/g, '\n');
  return text.length <= max ? text : text.slice(text.length - max);
}

function buildUnityBatchInvocation(input) {
  if (!input || !input.editorExe || !input.projectRoot || !input.outputFile || !input.logFile || !input.upmLogFile) {
    throw new Error('Unity batch invocation thiếu editorExe/projectRoot/output/log path.');
  }
  const projectRoot = path.resolve(input.projectRoot);
  return {
    executable: path.resolve(input.editorExe),
    args: [
      '-batchmode',
      '-nographics',
      '-projectPath', projectRoot,
      '-executeMethod', BATCH_METHOD,
      '-quit',
      '-logFile', path.resolve(input.logFile),
      '-upmLogFile', path.resolve(input.upmLogFile),
      '-timestamps',
    ],
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(input.env || {}),
      CC_PLAYABLE_UNITY_SCAN_OUTPUT: path.resolve(input.outputFile),
      CC_PLAYABLE_UNITY_PROJECT_FINGERPRINT: String(input.projectFingerprint || ''),
    },
  };
}

function parseBatchResult(outputFile, expectedFingerprint, fsImpl = fs) {
  if (!fsImpl.existsSync(outputFile)) {
    const error = new Error('Unity batch kết thúc nhưng không tạo compact scan marker.');
    error.code = 'UNITY_BATCH_RESULT_MISSING';
    throw error;
  }
  let patch;
  try {
    const size = fsImpl.statSync(outputFile).size;
    if (size > MAX_BATCH_RESULT_BYTES) {
      const error = new Error('Unity batch result vượt compact payload limit.');
      error.code = 'UNITY_BATCH_RESULT_TOO_LARGE';
      throw error;
    }
    patch = JSON.parse(fsImpl.readFileSync(outputFile, 'utf8'));
  } catch (cause) {
    if (cause.code === 'UNITY_BATCH_RESULT_TOO_LARGE') throw cause;
    const error = new Error(`Unity batch result JSON không hợp lệ: ${cause.message}`);
    error.code = 'UNITY_BATCH_RESULT_INVALID';
    throw error;
  }
  return assertUnityLiveSnapshotPatch(patch, { expectedProjectFingerprint: expectedFingerprint });
}

function waitForChild(child, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceTimer = null;
    let unconfirmedTimer = null;
    const terminationGraceMs = options.terminationGraceMs || 5000;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try { child.kill(); } catch (_) { /* owned child, best effort */ }
      forceTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill('SIGKILL'); } catch (_) { /* exact owned PID, best effort */ }
        unconfirmedTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const error = new Error(`Unity batch scan timeout sau ${timeoutMs} ms; không xác nhận được process đã đóng.`);
          error.code = 'UNITY_BATCH_TIMEOUT';
          error.processStillRunning = true;
          error.stdout = tail(stdout);
          error.stderr = tail(stderr);
          reject(error);
        }, terminationGraceMs);
      }, terminationGraceMs);
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout = tail(stdout + chunk, 16_000); });
    child.stderr?.on('data', chunk => { stderr = tail(stderr + chunk, 16_000); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (unconfirmedTimer) clearTimeout(unconfirmedTimer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (unconfirmedTimer) clearTimeout(unconfirmedTimer);
      if (timedOut) {
        const error = new Error(`Unity batch scan timeout sau ${timeoutMs} ms; process đã đóng.`);
        error.code = 'UNITY_BATCH_TIMEOUT';
        error.stdout = tail(stdout);
        error.stderr = tail(stderr);
        error.exit = { code, signal };
        reject(error);
        return;
      }
      resolve({ code, signal, stdout: tail(stdout), stderr: tail(stderr) });
    });
  });
}

function readFileTail(filePath, maxBytes, fsImpl = fs) {
  if (!fsImpl.existsSync(filePath)) return null;
  const size = fsImpl.statSync(filePath).size;
  const length = Math.min(size, maxBytes);
  const descriptor = fsImpl.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fsImpl.readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    return buffer.toString('utf8');
  } finally {
    fsImpl.closeSync(descriptor);
  }
}

async function runUnityBatchScan(input, options = {}) {
  const fsImpl = options.fs || fs;
  const tempRoot = fsImpl.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), 'cc-playable-unity-scan-'));
  const outputFile = path.join(tempRoot, 'result.json');
  const logFile = path.join(tempRoot, 'unity.log');
  const upmLogFile = path.join(tempRoot, 'upm.log');
  const invocation = buildUnityBatchInvocation({ ...input, outputFile, logFile, upmLogFile });
  const spawnImpl = options.spawn || spawn;
  let processResult;
  let succeeded = false;
  try {
    const child = spawnImpl(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processResult = await waitForChild(child, input.timeoutMs || DEFAULT_TIMEOUT_MS, {
      terminationGraceMs: options.terminationGraceMs,
    });
    const patch = parseBatchResult(outputFile, input.projectFingerprint, fsImpl);
    succeeded = true;
    return {
      patch,
      process: processResult,
      artifacts: input.keepArtifacts ? { tempRoot, logFile, upmLogFile } : null,
    };
  } catch (error) {
    error.process = processResult || null;
    error.unityLog = readFileTail(logFile, 8000, fsImpl);
    error.upmLog = readFileTail(upmLogFile, 4000, fsImpl);
    error.artifacts = tempRoot;
    throw error;
  } finally {
    if (succeeded && !input.keepArtifacts && fsImpl.existsSync(tempRoot)) {
      try { fsImpl.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) { /* temp cleanup only */ }
    }
  }
}

module.exports = {
  BATCH_METHOD,
  DEFAULT_TIMEOUT_MS,
  MAX_BATCH_RESULT_BYTES,
  tail,
  buildUnityBatchInvocation,
  parseBatchResult,
  waitForChild,
  readFileTail,
  runUnityBatchScan,
};
