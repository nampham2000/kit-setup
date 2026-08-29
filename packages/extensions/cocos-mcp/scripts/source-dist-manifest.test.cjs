'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-dist-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'source-dist-manifest.cjs'), path.join(root, 'scripts', 'source-dist-manifest.cjs'));
  for (const file of ['package.json', 'tsconfig.json', 'base.tsconfig.json']) fs.writeFileSync(path.join(root, file), '{}\n');
  fs.writeFileSync(path.join(root, 'source', 'main.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, 'dist', 'main.js'), 'exports.value = 1;\n');
  fs.writeFileSync(path.join(root, 'dist', 'mcp-server.js'), 'exports.server = true;\n');
  return root;
}

function run(root, command) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'source-dist-manifest.cjs'), command], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
}

test('manifest binds both source and the exact clean dist output set', t => {
  const root = fixture(t);
  assert.equal(run(root, 'write').status, 0);
  const firstReceipt = fs.readFileSync(path.join(root, 'dist', '.source-manifest.json'), 'utf8');
  assert.equal(run(root, 'write').status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'dist', '.source-manifest.json'), 'utf8'), firstReceipt);
  assert.equal(run(root, 'verify').status, 0);

  fs.writeFileSync(path.join(root, 'dist', 'orphan.js'), 'exports.orphan = true;\n');
  const orphan = run(root, 'verify');
  assert.notEqual(orphan.status, 0);
  assert.match(`${orphan.stdout}\n${orphan.stderr}`, /output set differs/);

  fs.unlinkSync(path.join(root, 'dist', 'orphan.js'));
  fs.appendFileSync(path.join(root, 'dist', 'main.js'), '// tampered\n');
  const tampered = run(root, 'verify');
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /compiled output changed/);
});

test('clean removes only the extension dist directory', t => {
  const root = fixture(t);
  assert.equal(run(root, 'clean').status, 0);
  assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  assert.equal(fs.existsSync(path.join(root, 'source', 'main.ts')), true);
});
