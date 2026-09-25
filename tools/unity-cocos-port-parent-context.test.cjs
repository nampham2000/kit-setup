'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const porter = require('./unity-cocos-port.cjs');

const PORTER = path.join(__dirname, 'unity-cocos-port.cjs');

function unityProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-parent-context-'));
  fs.mkdirSync(path.join(root, 'Assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Assets', 'Fx.prefab'), '%YAML 1.1\n');
  fs.writeFileSync(path.join(root, 'Assets', 'Fx.prefab.meta'), 'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\n');
  return root;
}

function childGuidCount(root, env) {
  const script = `const p=require(${JSON.stringify(PORTER)});process.stdout.write(String(p.scannedUnityAssetDatabase(${JSON.stringify(root)}).byGuid.size));`;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout);
}

test('a direct child reuses the parent GUID index instead of rescanning the Unity project', () => {
  const root = unityProject();
  const env = porter.prepareUnityPortChildEnv({ unityRoot: root }, null);
  try {
    // Delete the source .meta: only the inherited index can still resolve the GUID.
    fs.rmSync(path.join(root, 'Assets', 'Fx.prefab.meta'));
    assert.equal(childGuidCount(root, env), 1);
    // A grandchild (or any process that is not the direct child) must rescan.
    const nested = JSON.parse(env.CC_PLAYABLE_PORT_PARENT_GUID_INDEX);
    nested.parentPid = process.pid + 1;
    assert.equal(childGuidCount(root, { CC_PLAYABLE_PORT_PARENT_GUID_INDEX: JSON.stringify(nested) }), 0);
  } finally {
    porter.cleanupUnityPortChildEnv(env);
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(JSON.parse(env.CC_PLAYABLE_PORT_PARENT_GUID_INDEX).file), false, 'temp index removed');
});

test('an inherited preflight is only trusted by a direct child with a matching receipt', () => {
  const previous = process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT;
  try {
    delete process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT;
    assert.equal(porter.inheritedPreflightStillValid({}), null);
    process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT = JSON.stringify({ parentPid: process.ppid + 1, projectRoot: os.tmpdir(), receiptId: 'r' });
    assert.equal(porter.inheritedPreflightStillValid({}), null, 'wrong parent');
    process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT = JSON.stringify({ parentPid: process.ppid, projectRoot: os.tmpdir(), receiptId: 'r' });
    assert.equal(porter.inheritedPreflightStillValid({}), null, 'no receipt for that project');
    process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT = 'not json';
    assert.equal(porter.inheritedPreflightStillValid({}), null);
  } finally {
    if (previous === undefined) delete process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT;
    else process.env.CC_PLAYABLE_PORT_PARENT_PREFLIGHT = previous;
  }
});
