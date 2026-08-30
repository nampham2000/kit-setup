#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_CASES = 32;
const MAX_SOURCE_POINTS = 4096;
const DEFAULT_SAMPLE_LIMIT = 2048;
const EPSILON = 1e-12;

const USAGE = `Runtime Mesh / Path Coordinate Audit

Find the measured signed-axis mapping from Unity serialized path points into
the local frame of an imported Cocos mesh. The command is read-only unless
--out is provided.

Usage:
  node playable-shared-kit/tools/runtime-mesh-path-audit.cjs --config <audit.json> [--out <report.json>] [--json]

  node playable-shared-kit/tools/runtime-mesh-path-audit.cjs --mesh <mesh.json> --path <path.json> [options]

Options:
  --config <file>                    Manifest with 1-32 representative cases.
  --mesh <file>                      Direct-case mesh positions JSON.
  --path <file>                      Direct-case Unity path points JSON.
  --out <file>                       Atomically write the bounded JSON report.
  --sample-limit <n>                 Max mesh vertices per case (64-8192, default 2048).
  --min-progress-span <n>            Required nearest-path progress span (default 0.85).
  --max-normalized-median <n>        Median deviation / path scale limit (default 0.08).
  --min-separation-ratio <n>         second-best / best score (default 1.25).
  --top <n>                          Candidate mappings to report (1-16, default 5).
  --json                             Print compact JSON only.
  --help                             Show this help.

Manifest schema:
  {
    "schemaVersion": 1,
    "cases": [
      {
        "name": "curved-offset-tape",
        "meshFile": "samples/mesh.json",
        "pathFile": "samples/unity-path.json"
      }
    ]
  }

Each JSON file may be a flat numeric array, an array of [x,y,z], an array of
{x,y,z}, or an object containing positions/vertices (mesh) or points/path
(path). Acceptance requires at least two non-symmetric cases, including one
curved or off-centre path. Direct mode is diagnostic and cannot authorize a
mapping by itself. A centred straight path is expected to fail as ambiguous.`;

function auditError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function parseFinite(value, label, fallback, min, max) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw auditError('MESH_PATH_ARGUMENT_INVALID', `${label} must be within ${min}-${max}.`);
  }
  return parsed;
}

function parseInteger(value, label, fallback, min, max) {
  const parsed = parseFinite(value, label, fallback, min, max);
  if (!Number.isInteger(parsed)) {
    throw auditError('MESH_PATH_ARGUMENT_INVALID', `${label} must be an integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = { json: false, help: false };
  const valueFlags = new Set([
    'config', 'mesh', 'path', 'out', 'sample-limit', 'min-progress-span',
    'max-normalized-median', 'min-separation-ratio', 'top',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else if (token.startsWith('--')) {
      const name = token.slice(2);
      if (!valueFlags.has(name)) {
        throw auditError('MESH_PATH_ARGUMENT_INVALID', `Unknown option: ${token}`);
      }
      const value = argv[++index];
      if (!value || value.startsWith('--')) {
        throw auditError('MESH_PATH_ARGUMENT_INVALID', `Missing value for ${token}.`);
      }
      options[name] = value;
    } else {
      throw auditError('MESH_PATH_ARGUMENT_INVALID', `Unexpected argument: ${token}`);
    }
  }
  options.sampleLimit = parseInteger(options['sample-limit'], '--sample-limit',
    DEFAULT_SAMPLE_LIMIT, 64, 8192);
  options.minProgressSpan = parseFinite(options['min-progress-span'],
    '--min-progress-span', 0.85, 0.1, 1);
  options.maxNormalizedMedian = parseFinite(options['max-normalized-median'],
    '--max-normalized-median', 0.08, 0.000001, 10);
  options.minSeparationRatio = parseFinite(options['min-separation-ratio'],
    '--min-separation-ratio', 1.25, 1.001, 1000);
  options.top = parseInteger(options.top, '--top', 5, 1, 16);
  if (!options.help) {
    const hasConfig = typeof options.config === 'string';
    const hasDirect = typeof options.mesh === 'string' || typeof options.path === 'string';
    if (hasConfig === hasDirect || (hasDirect && (!options.mesh || !options.path))) {
      throw auditError('MESH_PATH_ARGUMENT_INVALID',
        'Use exactly one of --config or the complete --mesh + --path pair.');
    }
  }
  return options;
}

function readJson(file, label) {
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw auditError('MESH_PATH_INPUT_INVALID', `${label} cannot be read: ${error.message}`,
      { file: resolved });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) {
    throw auditError('MESH_PATH_INPUT_INVALID', `${label} must be a regular JSON file <=8 MiB.`,
      { file: resolved, bytes: stat.size });
  }
  try {
    return { resolved, value: JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '')) };
  } catch (error) {
    throw auditError('MESH_PATH_INPUT_INVALID', `${label} is not valid JSON: ${error.message}`,
      { file: resolved });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function inputDigest(cases) {
  return sha256(JSON.stringify(cases.map(entry => ({
    name: entry.name,
    weight: entry.weight,
    meshPositions: entry.meshPositions,
    pathPoints: entry.pathPoints,
  }))));
}

function pathShapeMetrics(points) {
  const data = buildPath(points);
  const last = points.length - 3;
  const ax = points[0];
  const ay = points[1];
  const az = points[2];
  const dx = points[last] - ax;
  const dy = points[last + 1] - ay;
  const dz = points[last + 2] - az;
  const chordSquared = dx * dx + dy * dy + dz * dz;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let maxChordDeviation = 0;
  const count = points.length / 3;
  for (let offset = 0; offset < points.length; offset += 3) {
    const x = points[offset];
    const y = points[offset + 1];
    const z = points[offset + 2];
    sumX += x;
    sumY += y;
    sumZ += z;
    const projection = chordSquared > EPSILON
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / chordSquared))
      : 0;
    maxChordDeviation = Math.max(maxChordDeviation, Math.hypot(
      x - (ax + dx * projection),
      y - (ay + dy * projection),
      z - (az + dz * projection),
    ));
  }
  const offCentreRatio = Math.hypot(sumX / count, sumY / count, sumZ / count) / data.scale;
  const curvatureRatio = maxChordDeviation / data.scale;
  return {
    offCentreRatio,
    curvatureRatio,
    disambiguating: offCentreRatio > 0.05 || curvatureRatio > 0.01,
  };
}

function caseDiversity(cases) {
  const unique = new Set(cases.map(entry => sha256(JSON.stringify({
    meshPositions: entry.meshPositions,
    pathPoints: entry.pathPoints,
  }))));
  const shapes = cases.map(entry => ({ name: entry.name, ...pathShapeMetrics(entry.pathPoints) }));
  return {
    uniqueCaseCount: unique.size,
    hasCurvedOrOffCentre: shapes.some(shape => shape.disambiguating),
    shapes,
  };
}

function writeJsonAtomic(file, payload) {
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw auditError('MESH_PATH_OUTPUT_INVALID', '--out parent must be a real directory.',
      { file: resolved });
  }
  if (fs.existsSync(resolved)) {
    const outputStat = fs.lstatSync(resolved);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
      throw auditError('MESH_PATH_OUTPUT_INVALID', '--out must be a regular file.',
        { file: resolved });
    }
  }
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, resolved);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  return resolved;
}

function flattenPointArray(value, label) {
  if (!Array.isArray(value)) {
    throw auditError('MESH_PATH_INPUT_INVALID', `${label} must be an array.`);
  }
  const output = [];
  if (value.length > 0 && typeof value[0] === 'number') {
    for (const component of value) output.push(Number(component));
  } else {
    for (let index = 0; index < value.length; index++) {
      const point = value[index];
      if (Array.isArray(point) && point.length >= 3) {
        output.push(Number(point[0]), Number(point[1]), Number(point[2]));
      } else if (point && typeof point === 'object') {
        output.push(Number(point.x), Number(point.y), Number(point.z));
      } else {
        throw auditError('MESH_PATH_INPUT_INVALID', `${label}[${index}] is not a 3D point.`);
      }
    }
  }
  if (output.length < 6 || output.length % 3 !== 0 || output.length / 3 > MAX_SOURCE_POINTS
    || output.some(component => !Number.isFinite(component))) {
    throw auditError('MESH_PATH_INPUT_INVALID',
      `${label} must contain 2-${MAX_SOURCE_POINTS} finite 3D points.`);
  }
  return output;
}

function pointArrayFromPayload(payload, kind, label) {
  if (Array.isArray(payload)) return flattenPointArray(payload, label);
  if (!payload || typeof payload !== 'object') {
    throw auditError('MESH_PATH_INPUT_INVALID', `${label} must contain 3D points.`);
  }
  const keys = kind === 'mesh'
    ? ['positions', 'vertices', 'meshPositions']
    : ['points', 'path', 'pathPoints'];
  for (const key of keys) {
    if (payload[key] !== undefined) return flattenPointArray(payload[key], `${label}.${key}`);
  }
  throw auditError('MESH_PATH_INPUT_INVALID', `${label} is missing ${keys.join('/')}.`);
}

function resolveCasePoints(entry, key, configDir, label) {
  const inlineKeys = key === 'mesh'
    ? ['meshPositions', 'positions', 'vertices']
    : ['pathPoints', 'points', 'path'];
  for (const inlineKey of inlineKeys) {
    if (entry[inlineKey] !== undefined) {
      return flattenPointArray(entry[inlineKey], `${label}.${inlineKey}`);
    }
  }
  const fileKey = key === 'mesh' ? 'meshFile' : 'pathFile';
  if (typeof entry[fileKey] !== 'string' || !entry[fileKey].trim()) {
    throw auditError('MESH_PATH_INPUT_INVALID', `${label}.${fileKey} is required.`);
  }
  const input = readJson(path.resolve(configDir, entry[fileKey]), `${label}.${fileKey}`);
  return pointArrayFromPayload(input.value, key, `${label}.${fileKey}`);
}

function loadAuditCases(options) {
  if (options.config) {
    const input = readJson(options.config, '--config');
    const manifest = input.value;
    if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases)
      || manifest.cases.length < 1 || manifest.cases.length > MAX_CASES) {
      throw auditError('MESH_PATH_CONFIG_INVALID',
        `Manifest requires schemaVersion=1 and 1-${MAX_CASES} cases.`);
    }
    const names = new Set();
    return manifest.cases.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw auditError('MESH_PATH_CONFIG_INVALID', `cases[${index}] must be an object.`);
      }
      const name = String(entry.name || `case-${index + 1}`).trim();
      if (!name || name.length > 120 || names.has(name)) {
        throw auditError('MESH_PATH_CONFIG_INVALID', `cases[${index}].name is invalid or duplicated.`);
      }
      names.add(name);
      const weight = parseFinite(entry.weight, `cases[${index}].weight`, 1, 0.01, 100);
      return {
        name,
        weight,
        meshPositions: resolveCasePoints(entry, 'mesh', path.dirname(input.resolved), `cases[${index}]`),
        pathPoints: resolveCasePoints(entry, 'path', path.dirname(input.resolved), `cases[${index}]`),
      };
    });
  }
  const mesh = readJson(options.mesh, '--mesh');
  const sourcePath = readJson(options.path, '--path');
  return [{
    name: 'direct',
    weight: 1,
    meshPositions: pointArrayFromPayload(mesh.value, 'mesh', '--mesh'),
    pathPoints: pointArrayFromPayload(sourcePath.value, 'path', '--path'),
  }];
}

function permutationParity(permutation) {
  let inversions = 0;
  for (let left = 0; left < permutation.length; left++) {
    for (let right = left + 1; right < permutation.length; right++) {
      if (permutation[left] > permutation[right]) inversions++;
    }
  }
  return inversions % 2 === 0 ? 1 : -1;
}

function generateCandidates() {
  const axes = ['x', 'y', 'z'];
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const output = [];
  for (const permutation of permutations) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const signs = [sx, sy, sz];
          const targetFromSource = signs.map((sign, index) => `${sign < 0 ? '-' : '+'}${axes[permutation[index]]}`);
          output.push({
            name: targetFromSource.join(','),
            permutation: permutation.slice(),
            signs,
            targetFromSource,
            determinant: permutationParity(permutation) * sx * sy * sz,
          });
        }
      }
    }
  }
  return output;
}

function transformPoints(points, candidate) {
  const output = new Array(points.length);
  for (let offset = 0; offset < points.length; offset += 3) {
    for (let targetAxis = 0; targetAxis < 3; targetAxis++) {
      output[offset + targetAxis] = candidate.signs[targetAxis]
        * points[offset + candidate.permutation[targetAxis]];
    }
  }
  return output;
}

function samplePoints(points, limit) {
  const count = points.length / 3;
  if (count <= limit) return points;
  const output = [];
  const denominator = Math.max(1, limit - 1);
  for (let index = 0; index < limit; index++) {
    const sourceIndex = Math.round((index / denominator) * (count - 1)) * 3;
    output.push(points[sourceIndex], points[sourceIndex + 1], points[sourceIndex + 2]);
  }
  return output;
}

function buildPath(points) {
  const cumulative = [0];
  let total = 0;
  let minX = points[0];
  let minY = points[1];
  let minZ = points[2];
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;
  for (let offset = 3; offset < points.length; offset += 3) {
    total += Math.hypot(
      points[offset] - points[offset - 3],
      points[offset + 1] - points[offset - 2],
      points[offset + 2] - points[offset - 1],
    );
    cumulative.push(total);
    minX = Math.min(minX, points[offset]);
    minY = Math.min(minY, points[offset + 1]);
    minZ = Math.min(minZ, points[offset + 2]);
    maxX = Math.max(maxX, points[offset]);
    maxY = Math.max(maxY, points[offset + 1]);
    maxZ = Math.max(maxZ, points[offset + 2]);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (total <= EPSILON || diagonal <= EPSILON) {
    throw auditError('MESH_PATH_INPUT_INVALID', 'Path must contain spatially distinct points.');
  }
  return { points, cumulative, total, scale: Math.max(total, diagonal) };
}

function nearestPathMetrics(meshPositions, pathData) {
  const distances = [];
  let minProgress = 1;
  let maxProgress = 0;
  for (let vertex = 0; vertex < meshPositions.length; vertex += 3) {
    const x = meshPositions[vertex];
    const y = meshPositions[vertex + 1];
    const z = meshPositions[vertex + 2];
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    let bestProgress = 0;
    for (let segment = 0; segment < pathData.cumulative.length - 1; segment++) {
      const offset = segment * 3;
      const ax = pathData.points[offset];
      const ay = pathData.points[offset + 1];
      const az = pathData.points[offset + 2];
      const dx = pathData.points[offset + 3] - ax;
      const dy = pathData.points[offset + 4] - ay;
      const dz = pathData.points[offset + 5] - az;
      const lengthSquared = dx * dx + dy * dy + dz * dz;
      const projection = lengthSquared > EPSILON
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lengthSquared))
        : 0;
      const px = ax + dx * projection;
      const py = ay + dy * projection;
      const pz = az + dz * projection;
      const distanceSquared = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        const distance = pathData.cumulative[segment]
          + (pathData.cumulative[segment + 1] - pathData.cumulative[segment]) * projection;
        bestProgress = distance / pathData.total;
      }
    }
    distances.push(Math.sqrt(bestDistanceSquared));
    minProgress = Math.min(minProgress, bestProgress);
    maxProgress = Math.max(maxProgress, bestProgress);
  }
  distances.sort((left, right) => left - right);
  const median = distances[Math.floor(distances.length / 2)] || 0;
  const p95 = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] || median;
  return {
    medianDeviation: median,
    p95Deviation: p95,
    normalizedMedianDeviation: median / pathData.scale,
    normalizedP95Deviation: p95 / pathData.scale,
    progressSpan: maxProgress - minProgress,
    progressRange: [minProgress, maxProgress],
  };
}

function scoreCandidate(cases, candidate, options) {
  let weightedScore = 0;
  let totalWeight = 0;
  let alignmentOk = true;
  const metrics = [];
  for (const entry of cases) {
    const transformedPath = buildPath(transformPoints(entry.pathPoints, candidate));
    const sampledMesh = samplePoints(entry.meshPositions, options.sampleLimit);
    const result = nearestPathMetrics(sampledMesh, transformedPath);
    const spanPenalty = Math.max(0, options.minProgressSpan - result.progressSpan) * 4;
    const score = result.normalizedMedianDeviation
      + result.normalizedP95Deviation * 0.25 + spanPenalty;
    if (result.progressSpan < options.minProgressSpan
      || result.normalizedMedianDeviation > options.maxNormalizedMedian) alignmentOk = false;
    metrics.push({
      name: entry.name,
      meshVertices: sampledMesh.length / 3,
      pathPoints: entry.pathPoints.length / 3,
      ...result,
      score,
    });
    weightedScore += score * entry.weight;
    totalWeight += entry.weight;
  }
  return {
    mapping: candidate.name,
    targetFromSource: candidate.targetFromSource,
    determinant: candidate.determinant,
    score: weightedScore / totalWeight,
    alignmentOk,
    cases: metrics,
  };
}

function auditCases(cases, options = {}) {
  const normalizedOptions = {
    sampleLimit: options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT,
    minProgressSpan: options.minProgressSpan ?? 0.85,
    maxNormalizedMedian: options.maxNormalizedMedian ?? 0.08,
    minSeparationRatio: options.minSeparationRatio ?? 1.25,
    top: options.top ?? 5,
  };
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > MAX_CASES) {
    throw auditError('MESH_PATH_INPUT_INVALID', `Audit requires 1-${MAX_CASES} cases.`);
  }
  const candidates = generateCandidates()
    .map(candidate => scoreCandidate(cases, candidate, normalizedOptions))
    .sort((left, right) => left.score - right.score || left.mapping.localeCompare(right.mapping));
  const best = candidates[0];
  const second = candidates[1];
  const separationRatio = best.score <= EPSILON
    ? (second.score <= EPSILON ? 1 : Number.POSITIVE_INFINITY)
    : second.score / best.score;
  const ambiguous = !Number.isFinite(separationRatio)
    ? false : separationRatio < normalizedOptions.minSeparationRatio;
  const diversity = caseDiversity(cases);
  const representative = cases.length >= 2
    && diversity.uniqueCaseCount >= 2
    && diversity.hasCurvedOrOffCentre;
  const accepted = representative && best.alignmentOk && !ambiguous;
  const decision = accepted ? 'accepted' : (!best.alignmentOk ? 'rejected' : 'ambiguous');
  const reason = accepted
    ? 'One signed-axis mapping is both aligned and sufficiently separated from the runner-up.'
    : !best.alignmentOk
      ? 'The best mapping still violates progress-span or normalized-deviation thresholds.'
      : !representative
        ? 'Evidence is not representative. Add at least two distinct cases including a curved/off-centre path; do not guess.'
      : 'Multiple mappings explain the samples. Add an off-centre curved/non-symmetric case; do not guess.';
  return {
    ok: accepted,
    tool: 'runtime-mesh-path-audit',
    schemaVersion: 1,
    decision,
    reason,
    inputDigest: inputDigest(cases),
    caseDiversity: diversity,
    thresholds: {
      minProgressSpan: normalizedOptions.minProgressSpan,
      maxNormalizedMedian: normalizedOptions.maxNormalizedMedian,
      minSeparationRatio: normalizedOptions.minSeparationRatio,
    },
    caseCount: cases.length,
    candidateCount: candidates.length,
    selected: best,
    runnerUp: second,
    separationRatio: Number.isFinite(separationRatio) ? separationRatio : null,
    candidates: candidates.slice(0, normalizedOptions.top),
  };
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`Decision: ${result.decision}\n`);
  process.stdout.write(`Mapping:  ${result.selected.mapping}\n`);
  process.stdout.write(`Score:    ${result.selected.score.toFixed(8)}\n`);
  process.stdout.write(`Separation ratio: ${result.separationRatio ?? 'infinite'}\n`);
  process.stdout.write(`${result.reason}\n`);
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const cases = loadAuditCases(options);
    const result = auditCases(cases, options);
    if (options.out) writeJsonAtomic(options.out, result);
    printResult(result, options.json);
    return result.ok ? 0 : 5;
  } catch (error) {
    const payload = {
      ok: false,
      tool: 'runtime-mesh-path-audit',
      code: error.code || 'MESH_PATH_AUDIT_FAILED',
      message: error.message,
      details: error.details || {},
    };
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(payload)}\n`);
    else process.stderr.write(`[${payload.code}] ${payload.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  USAGE,
  parseArgs,
  flattenPointArray,
  generateCandidates,
  transformPoints,
  nearestPathMetrics,
  loadAuditCases,
  auditCases,
  inputDigest,
  pathShapeMetrics,
  caseDiversity,
  writeJsonAtomic,
  main,
};
