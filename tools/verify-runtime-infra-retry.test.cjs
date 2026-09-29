'use strict';

// A loaded machine (several Cocos editors + headless Chromes) occasionally fails to transfer the
// editor preview's engine bundle; SystemJS then throws "Error loading cce:/internal/x/cc-fu/2d from
// .../scripting/x/chunks/... (SystemJS Error#3 ...)" and every case of the matrix run failed as
// not-playing. Such a case is retried once in a fresh browser; product failures never are.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  runOne, classifyInfraChunkLoadFailure, isEngineChunkUrl, PREVIEW_INFRA_CHUNK_LOAD,
} = require('./verify-runtime.cjs');
const { infraCaseFields, infraManifestFields } = require('./preview-checkpoints.cjs');
const gate = require('./port-regression-gate.cjs');

const CHUNK_ERROR = 'Error: Error loading cce:/internal/x/cc-fu/2d from '
  + 'http://localhost:7458/scripting/x/chunks/93/93ba276ea7b26ffcdc433fab14afc1ed6f05647b.js '
  + '(SystemJS Error#3 https://git.io/JvFET#3)';

const passing = () => ({
  ok: true, exceptions: [], exceptionDetails: [], consoleErrors: [], consoleErrorDetails: [], frames: 600, fps: 40,
});
const failing = (patch = {}) => ({ ...passing(), ok: false, frames: 0, fps: 0, ...patch });
const infraFailure = () => failing({ exceptions: [`Uncaught (in promise) ${CHUNK_ERROR}`] });

/** A stubbed page: each call returns the next scripted attempt result. */
function scriptedAttempts(...results) {
  const calls = [];
  return {
    calls,
    attempt: async (target, options) => {
      calls.push({ target, options });
      if (!results.length) throw new Error('unexpected extra attempt');
      return results.shift();
    },
  };
}

test('engine/editor chunk URLs are infra; project assets are not', () => {
  assert.equal(isEngineChunkUrl('cce:/internal/x/cc-fu/2d'), true);
  assert.equal(isEngineChunkUrl('q-bundled:///fs/exports/2d.js'), true);
  assert.equal(isEngineChunkUrl('http://localhost:7458/scripting/x/chunks/93/93ba.js'), true);
  assert.equal(isEngineChunkUrl('http://127.0.0.1:7456/scripting/engine/bin/.cache/dev/preview/bundled/index.js'), true);
  assert.equal(isEngineChunkUrl('http://example.com/scripting/x/chunks/93/93ba.js'), false);
  assert.equal(isEngineChunkUrl('file:///D:/game/assets/script/Game.ts'), false);
  assert.equal(isEngineChunkUrl('db://assets/script/Game.ts'), false);
  assert.equal(isEngineChunkUrl('http://localhost:7458/scripting/x/import-map.json'), false);
});

test('an infra chunk-load failure is retried once and the passing retry is recorded', async () => {
  const stub = scriptedAttempts(infraFailure(), passing());
  const result = await runOne('http://localhost:7458/', { seconds: 4 }, { attempt: stub.attempt });
  assert.equal(stub.calls.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.code, undefined);
  assert.deepEqual(result.infraRetry, {
    reason: 'systemjs-chunk-load',
    firstError: `Uncaught (in promise) ${CHUNK_ERROR}`,
    attempts: 2,
    recovered: true,
  });
});

test('a Chrome net::ERR_* on a preview chunk URL is an infra failure too', async () => {
  const netFailure = failing({
    consoleErrors: ['[network] Failed to load resource: net::ERR_CONNECTION_RESET'],
    consoleErrorDetails: [{
      message: 'Failed to load resource: net::ERR_CONNECTION_RESET', source: 'network',
      url: 'http://localhost:7458/scripting/engine/bin/.cache/dev/preview/bundled/index.js',
    }],
  });
  const stub = scriptedAttempts(netFailure, passing());
  const result = await runOne('http://localhost:7458/', {}, { attempt: stub.attempt });
  assert.equal(stub.calls.length, 2);
  assert.equal(result.infraRetry.reason, 'net-error-chunk-load');
  assert.match(result.infraRetry.firstError, /ERR_CONNECTION_RESET <http:\/\/localhost:7458\/scripting\/engine\//);
});

test('project-script and assertion failures are never retried', async () => {
  const productFailures = [
    // project module failing to load/execute
    failing({ exceptions: ['Error: Error loading file:///D:/game/assets/script/Game.ts from http://localhost:7458/scripting/x/chunks/aa/aa.js (SystemJS Error#3 https://git.io/JvFET#3)'] }),
    // an engine chunk error mixed with an explicit project script reference stays a product failure
    failing({ exceptions: [CHUNK_ERROR, 'TypeError: cannot read x of undefined (db://assets/script/Game.ts)'] }),
    // ordinary runtime exception
    failing({ exceptions: ['TypeError: Cannot read properties of undefined (reading \'node\')'] }),
    // assertion / eval failure without any chunk-load error
    failing({ frames: 600, fps: 40, evalError: 'assertion failed: expected 3 got 2' }),
    // net error on a non-chunk resource
    failing({ consoleErrorDetails: [{ message: 'Failed to load resource: net::ERR_FAILED', url: 'http://localhost:7458/assets/main/config.json' }] }),
    // chunk error from a non-loopback host
    failing({ exceptions: ['Error: Error loading cce:/internal/x/cc from https://cdn.example.com/scripting/x/chunks/93/93.js (SystemJS Error#3 https://git.io/JvFET#3)'] }),
  ];
  for (const firstResult of productFailures) {
    assert.equal(classifyInfraChunkLoadFailure(firstResult), null, JSON.stringify(firstResult));
    const stub = scriptedAttempts(firstResult);
    const result = await runOne('http://localhost:7458/', {}, { attempt: stub.attempt });
    assert.equal(stub.calls.length, 1);
    assert.equal(result.infraRetry, undefined);
    assert.equal(result.code, undefined);
  }
  // a passing attempt is never classified even if it logged an infra-looking line
  assert.equal(classifyInfraChunkLoadFailure({ ...passing(), exceptions: [CHUNK_ERROR] }), null);
});

test('the retry happens at most once and a second infra failure reports PREVIEW_INFRA_CHUNK_LOAD', async () => {
  const stub = scriptedAttempts(infraFailure(), infraFailure(), passing());
  const result = await runOne('http://localhost:7458/', {}, { attempt: stub.attempt });
  assert.equal(stub.calls.length, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, PREVIEW_INFRA_CHUNK_LOAD);
  assert.equal(result.infraRetry.recovered, false);
  assert.equal(result.infraRetry.attempts, 2);
  assert.match(result.infraRetry.secondError, /cc-fu\/2d/);
});

test('a retry that fails for a product reason keeps the product failure uncoded', async () => {
  const stub = scriptedAttempts(infraFailure(), failing({ exceptions: ['TypeError: boom'] }));
  const result = await runOne('http://localhost:7458/', {}, { attempt: stub.attempt });
  assert.equal(stub.calls.length, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, undefined);
  assert.equal(result.infraRetry.recovered, false);
  assert.deepEqual(result.exceptions, ['TypeError: boom']);
});

test('preview-checkpoints records infraRetry in case evidence and the manifest', () => {
  assert.deepEqual(infraCaseFields(passing()), {});
  const retried = { infraRetry: { reason: 'systemjs-chunk-load', firstError: CHUNK_ERROR, attempts: 2, recovered: true } };
  assert.deepEqual(infraCaseFields(retried), retried);
  assert.deepEqual(infraManifestFields([{ name: 'a', ok: true }]), {});
  const recovered = infraManifestFields([{ name: 'a', ok: true, ...retried }, { name: 'b', ok: true }]);
  assert.deepEqual(recovered, { infraRetries: [{ case: 'a', reason: 'systemjs-chunk-load', firstError: CHUNK_ERROR, recovered: true }] });
  const infraCase = { name: 'c', ok: false, code: PREVIEW_INFRA_CHUNK_LOAD, infraRetry: { ...retried.infraRetry, recovered: false } };
  assert.equal(infraManifestFields([infraCase]).code, PREVIEW_INFRA_CHUNK_LOAD);
  // a product failure in the same run keeps the manifest uncoded
  assert.equal(infraManifestFields([infraCase, { name: 'd', ok: false }]).code, undefined);
});

test('the regression gate marks infra retries in the run without touching the receipt digest', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-infra-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'm'));
  fs.writeFileSync(path.join(root, 'm', 'matrix.json'), JSON.stringify({ url: 'http://127.0.0.1:7458/', cases: [] }));
  const suite = { id: 's', matrix: 'm/matrix.json' };
  const recovered = gate.executeMatrix(root, suite, 1, {
    spawnSync: () => ({ status: 0, stdout: JSON.stringify({ ok: true, cases: [
      { name: 'a', ok: true, infraRetry: { reason: 'systemjs-chunk-load', firstError: CHUNK_ERROR, recovered: true } },
      { name: 'b', ok: true },
    ] }) }),
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.code, undefined);
  assert.deepEqual(recovered.cases, [
    { name: 'a', ok: true, infraRetry: { reason: 'systemjs-chunk-load', firstError: CHUNK_ERROR } },
    { name: 'b', ok: true },
  ]);
  assert.equal(recovered.infraRetries.length, 1);
  const failed = gate.executeMatrix(root, suite, 1, {
    spawnSync: () => ({ status: 1, stdout: JSON.stringify({ ok: false, code: PREVIEW_INFRA_CHUNK_LOAD, cases: [
      { name: 'a', ok: false, code: PREVIEW_INFRA_CHUNK_LOAD, infraRetry: { reason: 'systemjs-chunk-load', firstError: CHUNK_ERROR, recovered: false } },
    ] }) }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, PREVIEW_INFRA_CHUNK_LOAD);
  assert.equal(failed.cases[0].code, PREVIEW_INFRA_CHUNK_LOAD);
});
