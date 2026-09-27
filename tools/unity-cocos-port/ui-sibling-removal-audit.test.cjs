'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { auditPrefabText, parseArgs, runAudit } = require('./ui-sibling-removal-audit.cjs');

const TOOL = path.join(__dirname, 'ui-sibling-removal-audit.cjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'ui-sibling-removal');
const read = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const audit = (name, removed, adapters = []) => auditPrefabText(read(name), { label: name, removed, adapters });
const codes = result => result.findings.map(item => `${item.severity}:${item.code}`);

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-sibling-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(args, cwd = FIXTURES) {
  return spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8' });
}

test('pair with one member removed flags the lone survivor that keeps its pair-relative x', () => {
  const result = audit('pair-one-removed.prefab', ['Content/HomeBtn']);
  assert.deepEqual(codes(result), ['high:UI_SIBLING_REMOVED_UNBALANCED']);
  const [finding] = result.findings;
  assert.equal(finding.parent, 'PopupLose/Content');
  assert.equal(finding.axis, 'x');
  assert.deepEqual(finding.removed, ['PopupLose/Content/HomeBtn']);
  assert.deepEqual(finding.survivors, [{ path: 'PopupLose/Content/TryAgainButton', centerX: 191 }]);
  // Home [-409.5,-76.5] + TryAgain [-29.5,411.5]: the authored pair was centred at x=1.
  assert.equal(finding.originalGroupCenter, 1);
  assert.equal(finding.survivorCenter, 191);
  assert.equal(finding.survivorCenterOffsetPx, 190);
  // Serialized pop-in scale 0 is treated as the animated-in scale 1 and reported.
  assert.deepEqual(finding.zeroScaleAssumedOne, ['PopupLose/Content/HomeBtn']);
});

test('a valid adapter declaration marks the group resolved; an incomplete one is high', () => {
  const adapter = {
    removed: 'Content/HomeBtn', strategy: 'recenter',
    reason: 'HomeBtn deferred as meta; TryAgain re-centred on the pair centre',
    sourceValues: { 'HomeBtn.x': -243, 'TryAgainButton.x': 191 },
    configPath: 'ui.lose.tryAgainX',
  };
  const resolved = audit('pair-one-removed.prefab', ['HomeBtn'], [adapter]);
  assert.deepEqual(codes(resolved), ['low:UI_SIBLING_REMOVED_RESOLVED']);
  assert.equal(resolved.findings[0].adapter.configPath, 'ui.lose.tryAgainX');

  const byGroup = audit('pair-one-removed.prefab', ['HomeBtn'], [{ ...adapter, removed: undefined, group: 'Content' }]);
  assert.deepEqual(codes(byGroup), ['low:UI_SIBLING_REMOVED_RESOLVED']);

  const invalid = audit('pair-one-removed.prefab', ['HomeBtn'], [{ removed: 'HomeBtn', strategy: 'recenter', reason: 'x' }]);
  assert.deepEqual(codes(invalid).sort(), ['high:UI_SIBLING_ADAPTER_INVALID', 'high:UI_SIBLING_REMOVED_UNBALANCED']);
});

test('3-wide row with the middle removed stays balanced but reports the gap as medium', () => {
  const result = audit('row3-middle-removed.prefab', ['Middle']);
  assert.deepEqual(codes(result), ['medium:UI_SIBLING_REMOVED_GAP']);
  assert.equal(result.findings[0].survivorCenterOffsetPx, 0);
  assert.equal(result.findings[0].survivors.length, 2);
});

test('3-wide row with an edge removed is unbalanced', () => {
  const result = audit('row3-middle-removed.prefab', ['Right']);
  assert.deepEqual(codes(result), ['high:UI_SIBLING_REMOVED_UNBALANCED']);
  assert.equal(result.findings[0].survivorCenterOffsetPx, -150);
});

test('LayoutGroup parent losing a child requires re-flow and reports the expected positions', () => {
  const result = audit('layout-child-removed.prefab', ['Shop']);
  assert.deepEqual(codes(result), ['high:UI_SIBLING_REMOVED_LAYOUT_REFLOW']);
  const [finding] = result.findings;
  assert.equal(finding.layoutGroup, 'HorizontalLayoutGroup');
  assert.deepEqual(finding.expectedReflow.positions, [
    { path: 'Popup/Buttons/Revive', centerX: -110 },
    { path: 'Popup/Buttons/Retry', centerX: 110 },
  ]);
  const resolved = audit('layout-child-removed.prefab', ['Shop'], [{
    group: 'Popup/Buttons', strategy: 'source-layout',
    reason: 'UnityFixedLayoutGroup ported from the source HorizontalLayoutGroup',
    sourceValues: { spacing: 20, childAlignment: 4 },
  }]);
  assert.deepEqual(codes(resolved), ['low:UI_SIBLING_REMOVED_RESOLVED']);
});

test('no removal produces no finding; a lone removed node without row siblings is low only', () => {
  assert.deepEqual(audit('balanced-no-removal.prefab', []).findings, []);
  assert.deepEqual(codes(audit('balanced-no-removal.prefab', ['Badge'])), ['low:UI_SIBLING_REMOVED_ALONE']);
});

test('unresolved or ambiguous removed entries fail closed', () => {
  assert.deepEqual(codes(audit('pair-one-removed.prefab', ['Content/NoSuchButton'])), ['high:UI_SIBLING_REMOVED_NODE_MISSING']);
});

test('nested PrefabInstance survivors use their overridden anchoredPosition and size', () => {
  const text = `${read('pair-one-removed.prefab').replace(/--- !u!1 &51[\s\S]*$/, '')}`
    .replace('  - {fileID: 52}', '  - {fileID: 900}')
    + [
      '--- !u!1001 &800',
      'PrefabInstance:',
      '  m_Modification:',
      '    m_TransformParent: {fileID: 22}',
      '    m_Modifications:',
      '    - target: {fileID: 7000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '      propertyPath: m_Name',
      '      value: TryAgainNested',
      '      objectReference: {fileID: 0}',
      '    - target: {fileID: 7001, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '      propertyPath: m_AnchoredPosition.x',
      '      value: 191',
      '      objectReference: {fileID: 0}',
      '    - target: {fileID: 7001, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '      propertyPath: m_AnchoredPosition.y',
      '      value: -560',
      '      objectReference: {fileID: 0}',
      '    - target: {fileID: 7001, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '      propertyPath: m_SizeDelta.x',
      '      value: 441',
      '      objectReference: {fileID: 0}',
      '  m_SourcePrefab: {fileID: 100100000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '--- !u!224 &900 stripped',
      'RectTransform:',
      '  m_CorrespondingSourceObject: {fileID: 7001, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '  m_PrefabInstance: {fileID: 800}',
      '',
    ].join('\n');
  const result = auditPrefabText(text, { label: 'nested', removed: ['HomeBtn'], adapters: [] });
  assert.deepEqual(codes(result), ['high:UI_SIBLING_REMOVED_UNBALANCED']);
  assert.deepEqual(result.findings[0].survivors, [{ path: 'PopupLose/Content/TryAgainNested', centerX: 191 }]);
});

test('manifest mode resolves portable Assets paths and aggregates prefabs', t => {
  const dir = tempDir(t);
  const project = path.join(dir, 'Unity');
  fs.mkdirSync(path.join(project, 'Assets', 'UI'), { recursive: true });
  for (const name of ['pair-one-removed.prefab', 'balanced-no-removal.prefab']) {
    fs.copyFileSync(path.join(FIXTURES, name), path.join(project, 'Assets', 'UI', name));
  }
  const manifest = path.join(dir, 'audit.json');
  fs.writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1, kind: 'ui-sibling-removal-audit',
    prefabs: [
      { prefab: 'Assets/UI/pair-one-removed.prefab', removed: ['HomeBtn'] },
      { prefab: 'Assets/UI/balanced-no-removal.prefab', removed: [] },
    ],
  }));
  const report = runAudit(parseArgs(['--config', manifest, '--unity-project', project]));
  assert.equal(report.decision, 'fail');
  assert.deepEqual(report.counts, { high: 1, medium: 0, low: 0 });
  assert.equal(report.prefabs[1].findings.length, 0);
  assert.match(report.inputDigest, /^[a-f0-9]{64}$/);

  fs.writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1, kind: 'ui-sibling-removal-audit',
    prefabs: [{ prefab: '../outside.prefab', removed: [] }],
  }));
  assert.throws(() => runAudit(parseArgs(['--config', manifest, '--unity-project', project])),
    error => error.code === 'UI_AUDIT_MANIFEST_INVALID');
});

test('argument parsing fails on unknown, conflicting or incomplete modes before any read', () => {
  assert.throws(() => parseArgs(['--prefab', 'x.prefab', '--removed', 'A', '--bogus']), error => error.code === 'UI_AUDIT_ARG_UNKNOWN');
  assert.throws(() => parseArgs(['--config', 'a.json', '--prefab', 'x.prefab']), error => error.code === 'UI_AUDIT_ARG_CONFLICT');
  assert.throws(() => parseArgs(['--prefab', 'x.prefab']), error => error.code === 'UI_AUDIT_ARG_INVALID');
  assert.throws(() => parseArgs(['--config', 'a.json']), error => error.code === 'UI_AUDIT_ARG_INVALID');
  assert.throws(() => parseArgs(['--tolerance', '-1', '--prefab', 'x', '--removed', 'A']), error => error.code === 'UI_AUDIT_ARG_INVALID');
  assert.equal(parseArgs(['--help']).help, true);
});

test('CLI: --help and invalid mode never touch outputs; --out is idempotent; --check is read-only', t => {
  const dir = tempDir(t);
  const out = path.join(dir, 'report.json');
  const help = cli(['--help', '--out', out]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /UI Sibling Removal Audit/);
  assert.equal(fs.existsSync(out), false);

  const invalid = cli(['--prefab', 'pair-one-removed.prefab', '--removed', 'HomeBtn', '--out', out, '--nope']);
  assert.equal(invalid.status, 2);
  assert.equal(fs.existsSync(out), false);

  const checkMissing = cli(['--prefab', 'row3-middle-removed.prefab', '--removed', 'Middle', '--out', out, '--check', '--json']);
  assert.equal(checkMissing.status, 1);
  assert.equal(JSON.parse(checkMissing.stdout).out, 'stale');
  assert.equal(fs.existsSync(out), false);

  const first = cli(['--prefab', 'row3-middle-removed.prefab', '--removed', 'Middle', '--out', out, '--json']);
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).out, 'written');
  const hash = fs.readFileSync(out, 'utf8');
  const past = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(out, past, past);
  const mtime = fs.statSync(out).mtimeMs;

  const again = cli(['--prefab', 'row3-middle-removed.prefab', '--removed', 'Middle', '--out', out, '--json']);
  assert.equal(JSON.parse(again.stdout).out, 'unchanged');
  const check = cli(['--prefab', 'row3-middle-removed.prefab', '--removed', 'Middle', '--out', out, '--check', '--json']);
  assert.equal(check.status, 0);
  assert.equal(JSON.parse(check.stdout).out, 'current');
  assert.equal(fs.readFileSync(out, 'utf8'), hash);
  assert.equal(fs.statSync(out).mtimeMs, mtime);

  const failing = cli(['--prefab', 'pair-one-removed.prefab', '--removed', 'HomeBtn', '--check']);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /UI_SIBLING_REMOVED_UNBALANCED/);
});

test('shown marks a prefab-inactive runtime variant control as a group member', () => {
  const text = read('row3-middle-removed.prefab').replace(/(m_Name: Middle\r?\n  m_IsActive: )1/, '$10');
  const hidden = auditPrefabText(text, { label: 'variant', removed: ['Right'], adapters: [] });
  assert.deepEqual(codes(hidden), ['high:UI_SIBLING_REMOVED_UNBALANCED']);
  assert.equal(hidden.findings[0].survivorCenterOffsetPx, -300);
  const shown = auditPrefabText(text, { label: 'variant', removed: ['Right'], shown: ['Middle'], adapters: [] });
  assert.equal(shown.findings[0].survivorCenterOffsetPx, -150);
  assert.deepEqual(codes(auditPrefabText(text, { label: 'variant', removed: [], shown: ['Nope'], adapters: [] })),
    ['high:UI_SIBLING_SHOWN_NODE_MISSING']);
});
