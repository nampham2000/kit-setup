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
  readOpenUnityEditorInstance,
  refreshOpenUnityEditor,
  readUnityCompileDiagnostics,
  readUnityPackageDiagnostics,
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

test('reads an exact project-owned Editor instance and dispatches bounded Windows refresh', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  fixture.write('Library/EditorInstance.json', `${JSON.stringify({
    process_id: 4242,
    version: PROJECT_VERSION,
    app_path: 'D:/Unity/Editor/Unity.exe',
  })}\n`);
  const instance = readOpenUnityEditorInstance(fixture.root);
  assert.equal(instance.status, 'ready');
  assert.equal(instance.processId, 4242);

  let invocation = null;
  const result = refreshOpenUnityEditor(fixture.root, {
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', SAFE_SENTINEL: 'kept' },
    spawnSync: (executable, args, options) => {
      invocation = { executable, args, options };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.dispatched, true);
  assert.equal(result.processId, 4242);
  assert.equal(invocation.executable,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(invocation.options.env.CC_PLAYABLE_REFRESH_PID, '4242');
  assert.equal(invocation.options.env.CC_PLAYABLE_REFRESH_PROJECT, fs.realpathSync(fixture.root));
  assert.equal(invocation.options.env.SAFE_SENTINEL, 'kept');
  assert.match(invocation.args.at(-1), /Get-CimInstance Win32_Process/);
  assert.match(invocation.args.at(-1), /SetForegroundWindow/);
});

test('never dispatches refresh for stale or version-mismatched EditorInstance metadata', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  let calls = 0;
  const options = {
    platform: 'win32',
    spawnSync: () => { calls += 1; return { status: 0 }; },
  };
  assert.equal(refreshOpenUnityEditor(fixture.root, options).dispatched, false);
  fixture.write('Library/EditorInstance.json', '{"process_id":1,"version":"6000.3.1f1"}\n');
  const result = refreshOpenUnityEditor(fixture.root, options);
  assert.equal(result.reason, 'editor-instance-version-mismatch');
  assert.equal(calls, 0);
});

test('extracts only project-owned compile errors from a bounded shared Editor log tail', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-editor-log-'));
  t.after(() => fs.rmSync(logRoot, { recursive: true, force: true }));
  const editorLog = path.join(logRoot, 'Editor.log');
  fs.writeFileSync(editorLog, [
    'WorkingDir: D:/Other/UnityProject',
    'Assets/Other.cs(1,2): error CS0001: unrelated',
    `WorkingDir: ${fixture.root.replace(/\\/g, '/')}`,
    'Assets/Game/Main.cs(10,20): error CS0103: missing symbol',
    'Assets/Game/Main.cs(10,20): error CS0103: missing symbol',
    'Packages/com.example/Runtime.cs(3,4): error CS0117: missing member',
    '',
  ].join('\n'));
  const result = readUnityCompileDiagnostics(fixture.root, { editorLog, maxBytes: 64 * 1024 });
  assert.equal(result.code, 'UNITY_PROJECT_COMPILE_ERRORS');
  assert.equal(result.count, 2);
  assert.deepEqual(result.evidence, [
    'Assets/Game/Main.cs(10,20): error CS0103: missing symbol',
    'Packages/com.example/Runtime.cs(3,4): error CS0117: missing member',
  ]);
});

test('extracts project-owned Unity Package Manager TLS failure without reading another project section', t => {
  const fixture = createUnityFixture(t);
  setProjectRevision(fixture);
  const editorLog = path.join(fixture.root, 'Editor.log');
  fs.writeFileSync(editorLog, [
    'WorkingDir: D:/Other/UnityProject',
    'Curl error 35: Cert verify failed. Certificate could not be verified',
    `WorkingDir: ${fixture.root.replace(/\\/g, '/')}`,
    'Curl error 35: Cert verify failed. Certificate could not be verified (either omitted or unsupported).',
    'UnityTls error code: 7',
    '',
  ].join('\n'));
  const result = readUnityPackageDiagnostics(fixture.root, { editorLog, maxBytes: 64 * 1024 });
  assert.equal(result.code, 'UNITY_PACKAGE_TLS_CERTIFICATE_ERROR');
  assert.equal(result.count, 2);
  assert.equal(result.evidence.some(line => /Other/.test(line)), false);
});
