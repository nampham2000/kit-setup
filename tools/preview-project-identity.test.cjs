'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MISMATCH_CODE,
  projectRootsFromImportMap,
  parsePreviewTitle,
  probePreviewProjectIdentity,
  assertPreviewProjectIdentity,
  findPreviewPortsForProject,
  identityReceipt,
  parseCliArgs,
} = require('./preview-project-identity.cjs');

const ENGINE_KEY = 'file:///C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine/editor/assets/tools/debug-view-runtime-control.ts';

function fileUrl(root, relative) {
  return `file:///${root.replace(/\\/g, '/').replace(/^\//, '')}/${relative}`;
}

function importMapFor(root, scripts = ['assets/script/Game.ts', 'assets/script/Board.ts']) {
  const imports = { 'cce:/internal/x/cc': './chunks/93/x.js', [ENGINE_KEY]: './chunks/62/y.js' };
  for (const script of scripts) imports[fileUrl(root, script)] = `./chunks/aa/${script.length}.js`;
  return JSON.stringify({ imports, scopes: {} });
}

function page(name) {
  return `<html><head><meta charset="utf-8" /><title>Cocos Creator - ${name}</title></head><body></body></html>`;
}

function projectFixture(t, name = 'screw-out') {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-identity-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  return fs.realpathSync.native(root);
}

/** Stub preview server: routes map path -> { status, body }. */
async function stubPreview(t, routes) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    const route = routes[request.url.split('?')[0]];
    if (!route) { response.writeHead(404, { 'content-type': 'text/html' }); response.end('404 - Not Found'); return; }
    response.writeHead(route.status || 200, { 'content-type': route.type || 'application/json' });
    response.end(route.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, requests };
}

test('import map roots ignore engine-internal keys and count project scripts', () => {
  const roots = projectRootsFromImportMap(JSON.parse(importMapFor('C:/cc_worktrees/harvest-full-port')));
  assert.deepEqual(roots, [{ root: 'C:/cc_worktrees/harvest-full-port', scripts: 2 }]);
  assert.deepEqual(parsePreviewTitle(page('harvest-full-port')), {
    title: 'Cocos Creator - harvest-full-port', projectName: 'harvest-full-port',
  });
});

test('match: import map names the expected project root', async t => {
  const root = projectFixture(t);
  const preview = await stubPreview(t, {
    '/scripting/x/import-map.json': { body: importMapFor(root) },
    '/': { body: page('screw-out'), type: 'text/html' },
  });
  const result = await probePreviewProjectIdentity({ url: `${preview.url}?level=2`, projectRoot: root });
  assert.equal(result.status, 'match');
  assert.equal(result.signal, 'import-map-project-root');
  assert.equal(result.strength, 'strong');
  assert.ok(preview.requests.every(request => request.method === 'GET'), 'probe must only read');
  const record = await assertPreviewProjectIdentity({ url: preview.url, projectRoot: root });
  assert.equal(record.status, 'match');
  assert.equal(record.warning, undefined);
});

test('mismatch: another worktree with the same package name fails fast with PREVIEW_PROJECT_MISMATCH', async t => {
  const root = projectFixture(t, 'screw-out');
  const foreign = 'C:/cc_worktrees/harvest-full-port';
  const preview = await stubPreview(t, {
    '/scripting/x/import-map.json': { body: importMapFor(foreign) },
    '/': { body: page('harvest-full-port'), type: 'text/html' },
  });
  const result = await probePreviewProjectIdentity({ url: preview.url, projectRoot: root });
  assert.equal(result.status, 'mismatch');
  assert.equal(result.servedProjectRoot, foreign);
  await assert.rejects(assertPreviewProjectIdentity({ url: preview.url, projectRoot: root, scanPorts: [] }), error => {
    assert.equal(error.code, MISMATCH_CODE);
    assert.match(error.message, /PREVIEW_PROJECT_MISMATCH/);
    assert.ok(error.message.includes(root.replace(/\\/g, '/')), 'names expected project root');
    assert.ok(error.message.includes(foreign), 'names what the URL serves');
    assert.match(error.message, /server_query_server_port/);
    assert.equal(error.details.servedProjectRoot, foreign);
    return true;
  });
});

test('mismatch hint lists the port that serves this project when a scan finds it', async t => {
  const root = projectFixture(t);
  const wrong = await stubPreview(t, { '/scripting/x/import-map.json': { body: importMapFor('C:/other/game') } });
  const right = await stubPreview(t, { '/scripting/x/import-map.json': { body: importMapFor(root) } });
  const found = await findPreviewPortsForProject({ projectRoot: root, host: '127.0.0.1', ports: [wrong.port, right.port] });
  assert.deepEqual(found.map(entry => [entry.port, entry.status]), [[wrong.port, 'mismatch'], [right.port, 'match']]);
  await assert.rejects(assertPreviewProjectIdentity({
    url: wrong.url, projectRoot: root, scanPorts: [right.port],
    fetchImpl: (url, init) => fetch(String(url).replace('localhost', '127.0.0.1'), init),
  }), error => error.code === MISMATCH_CODE && error.message.includes(`:${right.port}`)
    && error.details.candidates.some(entry => entry.status === 'match'));
});

test('title fallback: no project scripts -> folder name decides (weak match or mismatch)', async t => {
  const root = projectFixture(t, 'screw-out');
  const emptyMap = JSON.stringify({ imports: { [ENGINE_KEY]: './x.js' } });
  const same = await stubPreview(t, {
    '/scripting/x/import-map.json': { body: emptyMap },
    '/': { body: page('screw-out'), type: 'text/html' },
  });
  const weak = await probePreviewProjectIdentity({ url: same.url, projectRoot: root });
  assert.equal(weak.status, 'match');
  assert.equal(weak.signal, 'preview-title');
  assert.equal(weak.strength, 'weak');
  const other = await stubPreview(t, { '/': { body: page('hidden-suspect-full-port'), type: 'text/html' } });
  const mismatch = await probePreviewProjectIdentity({ url: other.url, projectRoot: root });
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.servedProjectName, 'hidden-suspect-full-port');
});

test('unknown: older editor / non-Cocos server warns but does not throw', async t => {
  const root = projectFixture(t);
  const preview = await stubPreview(t, {
    '/scripting/x/import-map.json': { status: 500, body: '500 - Web Server Error', type: 'text/html' },
    '/': { body: '<html><title>Some static server</title></html>', type: 'text/html' },
  });
  const record = await assertPreviewProjectIdentity({ url: preview.url, projectRoot: root, retries: 1, retryDelayMs: 10 });
  assert.equal(record.status, 'unknown');
  assert.equal(record.attempts, 2);
  assert.equal(identityReceipt(record).evidence.importMap.httpStatus, 500);
  assert.match(record.warning, /PREVIEW_PROJECT_UNKNOWN/);
  const refused = await assertPreviewProjectIdentity({ url: 'http://127.0.0.1:1/', projectRoot: root, timeoutMs: 1000, retries: 0 });
  assert.equal(refused.status, 'unknown');
  assert.ok(refused.evidence.importMap.error);
});

test('opt-out: --allow-foreign-preview downgrades mismatch to a recorded override', async t => {
  const root = projectFixture(t);
  const preview = await stubPreview(t, { '/scripting/x/import-map.json': { body: importMapFor('C:/cc_worktrees/harvest-full-port') } });
  const record = await assertPreviewProjectIdentity({ url: preview.url, projectRoot: root, allowForeign: true });
  assert.equal(record.status, 'mismatch');
  assert.equal(record.overridden, true);
  assert.match(record.warning, /allow-foreign-preview/);
  const receipt = identityReceipt(record);
  assert.equal(receipt.allowForeignPreview, true);
  assert.equal(receipt.overridden, true);
  assert.equal(receipt.servedProjectRoot, 'C:/cc_worktrees/harvest-full-port');
});

test('project extension scripts under the expected root still count as this project', async t => {
  const root = projectFixture(t);
  const preview = await stubPreview(t, {
    '/scripting/x/import-map.json': { body: importMapFor(root, ['extensions/tool/assets/a.ts']) },
  });
  const result = await probePreviewProjectIdentity({ url: preview.url, projectRoot: root });
  assert.equal(result.status, 'match');
});

test('CLI args require --url or --scan and parse port ranges', () => {
  assert.throws(() => parseCliArgs([]), /--url/);
  assert.deepEqual(parseCliArgs(['--scan', '--ports', '7456-7458']).ports, [7456, 7457, 7458]);
  assert.throws(() => parseCliArgs(['--scan', '--ports', '1-500']), /--ports/);
});

test('a transient unknown is retried so a foreign preview is not waved through', async () => {
  const results = [
    { status: 'unknown', message: 'busy', evidence: { importMap: { httpStatus: null, error: 'timeout after 5000 ms' } } },
    { status: 'mismatch', message: 'served by harvest', url: 'http://localhost:7457/', expectedProjectRoot: 'D:/games/screw',
      servedProjectRoot: 'C:/cc_worktrees/harvest-full-port' },
  ];
  let calls = 0;
  await assert.rejects(assertPreviewProjectIdentity({
    url: 'http://localhost:7457/', projectRoot: 'D:/games/screw', retryDelayMs: 1, scanOnMismatch: false,
    probe: async () => results[Math.min(calls++, results.length - 1)],
  }), error => error.code === MISMATCH_CODE && error.details.attempts === 2);
  assert.equal(calls, 2);
});
