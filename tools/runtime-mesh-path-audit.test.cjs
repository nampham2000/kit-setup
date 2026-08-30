'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  generateCandidates,
  transformPoints,
  loadAuditCases,
  auditCases,
  USAGE,
} = require('./runtime-mesh-path-audit.cjs');

const MEASURED_MAPPING = generateCandidates().find(candidate => candidate.name === '-x,+y,+z');

function ribbonFromPath(points, width, axis = 1) {
  const output = [];
  for (let offset = 0; offset < points.length; offset += 3) {
    const low = [points[offset], points[offset + 1], points[offset + 2]];
    const high = low.slice();
    low[axis] -= width;
    high[axis] += width;
    output.push(...low, ...high);
  }
  return output;
}

function representativeCases() {
  const sourceA = [
    1.2, -0.3, 0.4,
    1.8, 0.1, 0.9,
    2.4, 0.7, 1.8,
    3.1, 1.1, 2.1,
  ];
  const sourceB = [
    -0.6, 0.4, 2.7,
    -0.2, 0.9, 2.2,
    0.5, 1.5, 1.4,
    1.4, 1.8, 0.8,
  ];
  const targetA = transformPoints(sourceA, MEASURED_MAPPING);
  const targetB = transformPoints(sourceB, MEASURED_MAPPING);
  return [
    { name: 'offset-curve-a', weight: 1, pathPoints: sourceA, meshPositions: ribbonFromPath(targetA, 0.025, 1) },
    { name: 'offset-curve-b', weight: 1, pathPoints: sourceB, meshPositions: ribbonFromPath(targetB, 0.03, 2) },
  ];
}

test('selects a measured signed-axis mapping from multiple non-symmetric cases', () => {
  const result = auditCases(representativeCases());
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'accepted');
  assert.equal(result.selected.mapping, '-x,+y,+z');
  assert.equal(result.candidateCount, 48);
  assert.ok(result.selected.cases.every(entry => entry.progressSpan > 0.99));
  assert.ok(result.separationRatio > result.thresholds.minSeparationRatio);
});

test('fails closed when a centred straight path cannot distinguish direction or reflection', () => {
  const points = [-2, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0];
  const result = auditCases([{
    name: 'centred-straight',
    weight: 1,
    pathPoints: points,
    meshPositions: ribbonFromPath(points, 0.02, 1),
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'ambiguous');
  assert.equal(result.separationRatio, 1);
  assert.match(result.reason, /do not guess/);
});

test('treats one otherwise unique case as diagnostic evidence only', () => {
  const result = auditCases([representativeCases()[0]]);
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'ambiguous');
  assert.match(result.reason, /not representative/);
});

test('rejects duplicated evidence even when the candidate is uniquely aligned', () => {
  const source = representativeCases()[0];
  const result = auditCases([
    source,
    { ...source, name: 'renamed-copy' },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'ambiguous');
  assert.equal(result.caseDiversity.uniqueCaseCount, 1);
});

test('rejects samples that no signed-axis mapping can align', () => {
  const result = auditCases([{
    name: 'unrelated-cloud',
    weight: 1,
    pathPoints: [1, 1, 1, 2, 1.5, 1.2, 3, 2, 1.6],
    meshPositions: [100, 100, 100, 101, 100, 100, 102, 101, 100],
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'rejected');
  assert.equal(result.selected.alignmentOk, false);
});

test('loads a portable manifest with paths relative to the manifest', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-path-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = representativeCases();
  fs.mkdirSync(path.join(root, 'samples'));
  fs.writeFileSync(path.join(root, 'samples', 'mesh-a.json'), JSON.stringify({ positions: cases[0].meshPositions }));
  fs.writeFileSync(path.join(root, 'samples', 'path-a.json'), JSON.stringify({ points: cases[0].pathPoints }));
  fs.writeFileSync(path.join(root, 'samples', 'mesh-b.json'), JSON.stringify(cases[1].meshPositions));
  fs.writeFileSync(path.join(root, 'samples', 'path-b.json'), JSON.stringify(cases[1].pathPoints));
  const config = path.join(root, 'audit.json');
  fs.writeFileSync(config, JSON.stringify({
    schemaVersion: 1,
    cases: [
      { name: 'a', meshFile: 'samples/mesh-a.json', pathFile: 'samples/path-a.json' },
      { name: 'b', meshFile: 'samples/mesh-b.json', pathFile: 'samples/path-b.json' },
    ],
  }));
  const options = parseArgs(['--config', config, '--json']);
  const loaded = loadAuditCases(options);
  assert.equal(loaded.length, 2);
  assert.equal(auditCases(loaded, options).selected.mapping, '-x,+y,+z');
});

test('CLI help documents portable output and argument parsing rejects incomplete direct input', () => {
  assert.match(USAGE, /--out <file>/);
  assert.match(USAGE, /at least two non-symmetric cases/);
  assert.throws(() => parseArgs(['--mesh', 'mesh.json']), /complete --mesh \+ --path/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('writes a digest-bound report atomically', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-path-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reportFile = path.join(root, 'reports', 'coordinate-audit.json');
  const { writeJsonAtomic } = require('./runtime-mesh-path-audit.cjs');
  const result = auditCases(representativeCases());
  writeJsonAtomic(reportFile, result);
  writeJsonAtomic(reportFile, { ...result, rerun: true });
  const stored = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(stored.decision, 'accepted');
  assert.equal(stored.rerun, true);
  assert.match(stored.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(`${reportFile}.tmp`), false);
});
