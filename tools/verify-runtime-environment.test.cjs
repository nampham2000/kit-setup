'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeEnvironmentHosts, isEnvironmentError } = require('./verify-runtime.cjs');

const PREVIEW = 'http://localhost:7506/';
const AV = 'gc.kis.v2.scr.kaspersky-labs.com';

test('environment hosts must be exact external hostnames, never the preview or local hosts', () => {
  assert.deepEqual(normalizeEnvironmentHosts(undefined, PREVIEW), []);
  assert.deepEqual(normalizeEnvironmentHosts([AV, AV.toUpperCase()], PREVIEW), [AV]);
  for (const bad of ['*.kaspersky-labs.com', 'localhost', 'app.localhost', '127.0.0.1', 'kaspersky', 'a b.com', '']) {
    assert.throws(() => normalizeEnvironmentHosts([bad], PREVIEW), /environmentHosts/);
  }
  assert.throws(() => normalizeEnvironmentHosts(['cdn.example.com'], 'http://cdn.example.com:8080/'), /environmentHosts/);
  assert.throws(() => normalizeEnvironmentHosts('x', PREVIEW), /environmentHosts/);
  assert.throws(() => normalizeEnvironmentHosts(Array.from({ length: 9 }, (_, i) => `h${i}.example.com`), PREVIEW), /environmentHosts/);
});

test('only errors naming a declared injected host (plus the preview origin) are environment noise', () => {
  const hosts = [AV];
  const cors = `Access to XMLHttpRequest at 'http://${AV}/A4CA8DDB/from?get&nocache=13b13' from origin 'http://localhost:7506' has been blocked by CORS policy`;
  assert.equal(isEnvironmentError([cors, PREVIEW], hosts, PREVIEW), true);
  assert.equal(isEnvironmentError(['Failed to load resource: net::ERR_FAILED', `http://${AV}/x/from?get`], hosts, PREVIEW), true);
  // the game's own errors, other external hosts and mixed references stay console errors
  assert.equal(isEnvironmentError(['TypeError: x is undefined', 'http://localhost:7506/assets/main.js'], hosts, PREVIEW), false);
  assert.equal(isEnvironmentError(['Failed to load resource: 400', 'http://localhost:7506/socket.io/?EIO=4'], hosts, PREVIEW), false);
  assert.equal(isEnvironmentError(['Failed to load resource', 'https://analytics.example.com/collect'], hosts, PREVIEW), false);
  assert.equal(isEnvironmentError([`fetch https://analytics.example.com/c after http://${AV}/main.js`], hosts, PREVIEW), false);
  assert.equal(isEnvironmentError([cors], [], PREVIEW), false);
  // a look-alike subdomain of the declared host is not the declared host
  assert.equal(isEnvironmentError(['x', `http://evil.${AV}/p`], hosts, PREVIEW), false);
});

test('--url preview identity: mismatch throws PREVIEW_PROJECT_MISMATCH unless --allow-foreign-preview', async () => {
  const { parseArgs, guardRuntimePreviewProject } = require('./verify-runtime.cjs');
  assert.equal(parseArgs(['--url', PREVIEW, '--allow-foreign-preview']).allowForeignPreview, true);
  const probe = async () => ({ status: 'mismatch', origin: 'http://localhost:7506', url: PREVIEW,
    expectedProjectRoot: 'D:/games/screw', servedProjectRoot: 'C:/cc_worktrees/harvest-full-port',
    signal: 'import-map-project-root', strength: 'strong', message: 'served by harvest' });
  await assert.rejects(guardRuntimePreviewProject(PREVIEW, { probe, scanOnMismatch: false }),
    error => error.code === 'PREVIEW_PROJECT_MISMATCH');
  const allowed = await guardRuntimePreviewProject(PREVIEW, { probe, allowForeignPreview: true });
  assert.equal(allowed.overridden, true);
  const match = await guardRuntimePreviewProject(PREVIEW, { probe: async () => ({ ...(await probe()), status: 'match' }) });
  assert.equal(match.status, 'match');
});
