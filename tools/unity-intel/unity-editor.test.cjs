'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  validateUnityProject,
  discoverUnityEditor,
  getUnityProjectLockStatus,
  doctorUnityEditor,
} = require('./unity-editor.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');

const PROJECT_VERSION = '6000.0.66f2';
const PROJECT_REVISION = 'b20bc5da3050';

function setProjectRevision(fixture) {
  fixture.write('ProjectSettings/ProjectVersion.txt', [
    `m_EditorVersion: ${PROJECT_VERSION}`,
    `m_EditorVersionWithRevision: ${PROJECT_VERSION} (${PROJECT_REVISION})`,
    '',
  ].join('\n'));
}

function createEditorRoot(t, versions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-editor-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const version of versions) {
    const editorDir = path.join(root, version, 'Editor');
    fs.mkdirSync(editorDir, { recursive: true });
    fs.writeFileSync(path.join(editorDir, 'Unity.exe'), 'fixture', 'utf8');
  }
  return root;
}

test('validates a complete Unity project and reads exact version revision', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  const project = validateUnityProject(fixture.root);

  assert.equal(project.unityVersion, PROJECT_VERSION);
  assert.equal(project.unityRevision, PROJECT_REVISION);
  assert.equal(project.projectRoot, fs.realpathSync(fixture.root));
  assert.equal(project.assetsPath, path.join(project.projectRoot, 'Assets'));
});

test('rejects directories that are not complete Unity projects', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-unity-project-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Assets'));
  assert.throws(
    () => validateUnityProject(root),
    error => error.code === 'UNITY_PROJECT_INVALID',
  );
});

test('explicit editor environment mismatch is a hard error and never falls back', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  const exactRoot = createEditorRoot(t, [PROJECT_VERSION]);
  const wrongRoot = createEditorRoot(t, ['6000.3.1f1']);
  const wrongEditor = path.join(wrongRoot, '6000.3.1f1', 'Editor', 'Unity.exe');

  const result = discoverUnityEditor(fixture.root, {
    platform: 'win32',
    env: {
      CC_PLAYABLE_UNITY_EDITOR: wrongEditor,
      CC_PLAYABLE_UNITY_EDITOR_VERSION: '6000.3.1f1',
    },
    editorRoots: [exactRoot],
    homeDir: fixture.root,
  });

  assert.equal(result.status, 'mismatch');
  assert.equal(result.code, 'UNITY_EDITOR_VERSION_MISMATCH');
  assert.equal(result.editor.path, wrongEditor);
  assert.equal(result.requiredVersion, PROJECT_VERSION);
});

test('discovers only an exact executable and ignores incomplete or mismatched installs', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  const editorRoot = createEditorRoot(t, [PROJECT_VERSION, '6000.3.1f1']);
  fs.mkdirSync(path.join(editorRoot, '6000.0.65f1', 'Editor'), { recursive: true });

  const result = discoverUnityEditor(fixture.root, {
    platform: 'win32',
    env: {},
    editorRoots: [editorRoot],
    homeDir: fixture.root,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.editor.version, PROJECT_VERSION);
  assert.equal(result.editor.path, path.join(editorRoot, PROJECT_VERSION, 'Editor', 'Unity.exe'));
  assert.equal(result.available.some(item => item.version === '6000.0.65f1'), false);
});

test('reports exact version missing instead of selecting a compatible-looking patch', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  const editorRoot = createEditorRoot(t, ['6000.0.65f1', '6000.3.1f1']);

  const result = discoverUnityEditor(fixture.root, {
    platform: 'win32',
    env: {},
    editorRoots: [editorRoot],
    homeDir: fixture.root,
  });

  assert.equal(result.status, 'missing');
  assert.equal(result.code, 'UNITY_EDITOR_EXACT_VERSION_MISSING');
  assert.equal(result.editor, null);
  assert.deepEqual(result.available.map(item => item.version).sort(), ['6000.0.65f1', '6000.3.1f1']);
});

test('classifies missing, stale, and held UnityLockfile states', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  assert.equal(getUnityProjectLockStatus(fixture.root).state, 'unlocked');

  fixture.write('Temp/UnityLockfile', '');
  assert.equal(getUnityProjectLockStatus(fixture.root).state, 'stale');
  const held = getUnityProjectLockStatus(fixture.root, {
    lockProbe: () => ({ state: 'held', error: 'sharing violation' }),
  });
  assert.equal(held.state, 'held');
  assert.equal(held.locked, true);
});

test('doctor blocks duplicate launch, permits attach, and emits exact Hub remediation', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  fixture.write('Temp/UnityLockfile', '');
  const editorRoot = createEditorRoot(t, [PROJECT_VERSION]);
  const doctor = doctorUnityEditor(fixture.root, {
    platform: 'win32',
    env: { PROGRAMFILES: 'C:\\Program Files' },
    editorRoots: [editorRoot],
    homeDir: fixture.root,
    lockProbe: () => ({ state: 'held' }),
  });

  assert.equal(doctor.ready, true);
  assert.equal(doctor.ok, false);
  assert.equal(doctor.canLaunch, false);
  assert.equal(doctor.canAttach, true);
  assert.equal(doctor.issues.some(issue => issue.code === 'UNITY_PROJECT_ALREADY_OPEN'), true);

  fs.rmSync(path.join(fixture.root, 'Temp', 'UnityLockfile'));
  const missing = doctorUnityEditor(fixture.root, {
    platform: 'win32',
    env: { PROGRAMFILES: 'C:\\Program Files' },
    editorRoots: [],
    homeDir: fixture.root,
  });
  assert.equal(missing.editor.status, 'missing');
  assert.deepEqual(missing.remediation.args, [
    '--', '--headless', 'install', '--version', PROJECT_VERSION,
    '--changeset', PROJECT_REVISION, '--errors',
  ]);
});
