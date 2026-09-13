#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { scanUnityProject } = require('./unity-intel/service.cjs');
const { buildCoreGameplayScope } = require('./unity-intel/core-gameplay-scope.cjs');

const SCHEMA_VERSION = 1;
const DISPOSITIONS = new Set(['implemented', 'replaced', 'deferred', 'dormant']);
const FEEDBACK_NAME = /(?:audio|bgm|sfx|sound|vfx|particle|effect|feedback|click|touch|confetti)/i;

const USAGE = `Unity feedback closure

Usage:
  node playable-shared-kit/tools/unity-feedback-closure.cjs --project <UnityProjectRoot> [options]

Options:
  --entry <AssetPath>       Bootstrap/gameplay scene or prefab; repeatable. Defaults to enabled build scenes.
  --profile <name>          playable-core (default) | full-project.
  --dispositions <file>     Portable implementation/disposition + feedback-walkthrough contract.
  --out <file>              Write deterministic closure JSON. Omit for stdout-only discovery.
  --check                   Read-only gate; require complete dispositions and gameplay walkthrough evidence.
  --no-cache                Disable Unity static index cache.
  --refresh-cache           Refresh Unity static index cache.
  --json                    Print JSON.
  --help                    Print this help without scanning or writing.

The static result proves binding reachability, not behavioral reachability. A candidate must be
implemented/replaced/deferred/dormant explicitly; implemented feedback roots must be connected to
a gameplay phase containing Unity owner, state mutation, animation/VFX/SFX mapping, Cocos callsite,
and regression evidence.`;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
  return output;
}

function stableStringify(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function parseArgs(argv) {
  const options = { entries: [], profile: 'playable-core', cache: true, check: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--check') { options.check = true; continue; }
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--no-cache') { options.cache = false; continue; }
    if (argument === '--refresh-cache') { options.refreshCache = true; continue; }
    const match = /^--(project|entry|profile|dispositions|out)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Option không hỗ trợ: ${argument}`);
    const value = match[2] !== undefined ? match[2] : argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${match[1]} cần một giá trị.`);
    if (match[1] === 'entry') options.entries.push(slash(value));
    else options[match[1]] = value;
  }
  if (!options.help && !options.project) throw new Error('--project là bắt buộc.');
  if (!['playable-core', 'full-project'].includes(options.profile)) throw new Error('--profile phải là playable-core hoặc full-project.');
  if (options.check && options.out) throw new Error('--check là read-only và không được dùng cùng --out.');
  return options;
}

function shortestPaths(entries, edges) {
  const outgoing = new Map();
  for (const edge of edges || []) {
    const from = slash(edge.from);
    const to = slash(edge.to);
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(to);
  }
  for (const values of outgoing.values()) values.sort();
  const distance = new Map();
  const previous = new Map();
  const queue = [];
  for (const entry of entries) {
    if (distance.has(entry)) continue;
    distance.set(entry, 0);
    queue.push(entry);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const next of outgoing.get(current) || []) {
      if (distance.has(next)) continue;
      distance.set(next, distance.get(current) + 1);
      previous.set(next, current);
      queue.push(next);
    }
  }
  function chainTo(assetPath) {
    if (!distance.has(assetPath)) return [];
    const chain = [assetPath];
    while (previous.has(chain[0])) chain.unshift(previous.get(chain[0]));
    return chain;
  }
  return { distance, chainTo, outgoing };
}

function scriptableTypeForAsset(assetPath, record, edgeTargets, scriptByPath) {
  if (!/\.asset$/i.test(assetPath) || record && record.type === 'script') return [];
  const types = [];
  for (const target of edgeTargets.get(assetPath) || []) {
    const script = scriptByPath.get(target);
    for (const typeName of script && script.scriptableObjectTypes || []) types.push(typeName);
  }
  return [...new Set(types)].sort();
}

function expandCoreAllowedPaths(snapshot, basePaths, entries) {
  const records = snapshot && snapshot.assets && snapshot.assets.records || [];
  const edges = snapshot && snapshot.dependencies && snapshot.dependencies.edges || [];
  const recordByPath = new Map(records.map(record => [slash(record.assetPath), record]));
  const scriptByPath = new Map(
    (snapshot.scriptIndex && snapshot.scriptIndex.scripts || []).map(script => [slash(script.assetPath), script]),
  );
  const outgoing = new Map();
  const edgeTargets = new Map();
  for (const edge of edges) {
    const from = slash(edge.from);
    const to = slash(edge.to);
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push({ ...edge, from, to });
    if (!edgeTargets.has(from)) edgeTargets.set(from, []);
    edgeTargets.get(from).push(to);
  }
  const allowed = new Set([...basePaths].map(slash));
  const feedbackSeeds = new Set();
  for (const entry of entries.map(slash)) {
    allowed.add(entry);
    for (const edge of outgoing.get(entry) || []) {
      if (edge.kind === 'code-type-reference') continue;
      const target = recordByPath.get(edge.to);
      if (!target) continue;
      const scriptableTypes = scriptableTypeForAsset(edge.to, target, edgeTargets, scriptByPath);
      const directScriptableObject = scriptableTypes.length > 0;
      const directFeedback = target.type === 'audio' || target.type === 'prefab' && FEEDBACK_NAME.test(edge.to) ||
        scriptableTypes.some(typeName => FEEDBACK_NAME.test(typeName)) || FEEDBACK_NAME.test(edge.to);
      if (!directScriptableObject && !directFeedback) continue;
      allowed.add(edge.to);
      if (directFeedback) feedbackSeeds.add(edge.to);
      if (directScriptableObject) {
        for (const child of outgoing.get(edge.to) || []) {
          if (scriptByPath.has(child.to)) allowed.add(child.to);
        }
      }
    }
  }
  const queue = [...feedbackSeeds].sort();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const edge of outgoing.get(queue[cursor]) || []) {
      if (edge.kind === 'code-type-reference') continue;
      if (allowed.has(edge.to)) continue;
      allowed.add(edge.to);
      queue.push(edge.to);
    }
  }
  return allowed;
}

function collectJsonSpecEdges(records, readAssetText) {
  const evidence = new Map();
  if (typeof readAssetText !== 'function') return { edges: [], evidence };
  const byPath = new Map(records.map(record => [slash(record.assetPath).toLowerCase(), record]));
  const resourcesByKey = new Map();
  for (const record of records) {
    const assetPath = slash(record.assetPath);
    const match = /(?:^|\/)Resources\/(.+)$/i.exec(assetPath);
    if (!match) continue;
    resourcesByKey.set(match[1].replace(/\.[^/.]+$/, '').toLowerCase(), record);
  }
  const edges = [];
  function visit(value, fieldPath, strings) {
    if (typeof value === 'string') { strings.push({ value: slash(value), fieldPath }); return; }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${fieldPath}/${index}`, strings));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value).sort()) visit(value[key], `${fieldPath}/${key}`, strings);
  }
  for (const record of records) {
    const assetPath = slash(record.assetPath);
    if (!/\.json$/i.test(assetPath)) continue;
    let text;
    let parsed;
    try {
      text = readAssetText(assetPath);
      parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    } catch (error) {
      evidence.set(assetPath, { valid: false, error: String(error.message || error) });
      continue;
    }
    const strings = [];
    visit(parsed, '', strings);
    const references = [];
    for (const item of strings) {
      const normalized = item.value.replace(/^db:\/\//i, '');
      const target = byPath.get(normalized.toLowerCase()) ||
        resourcesByKey.get(normalized.replace(/\.[^/.]+$/, '').toLowerCase());
      if (!target || slash(target.assetPath) === assetPath) continue;
      const targetPath = slash(target.assetPath);
      edges.push({
        from: assetPath,
        to: targetPath,
        guid: target.guid || null,
        kind: 'json-asset-reference',
        resolution: 'exact',
        objectId: null,
        classId: null,
        fieldPath: item.fieldPath || '/',
        occurrences: 1,
        provider: 'json-spec',
        evidenceLines: [],
      });
      references.push({ fieldPath: item.fieldPath || '/', value: item.value, assetPath: targetPath });
    }
    references.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath) || left.assetPath.localeCompare(right.assetPath));
    const topLevelKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
    const spineSkeleton = topLevelKeys.includes('bones') && topLevelKeys.includes('slots') &&
      (topLevelKeys.includes('skeleton') || topLevelKeys.includes('skins'));
    evidence.set(assetPath, {
      valid: true,
      format: spineSkeleton ? 'spine-skeleton' : 'gameplay-json',
      sha256: sha256(text),
      topLevelKeys,
      assetReferences: references,
    });
  }
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.fieldPath.localeCompare(right.fieldPath));
  return { edges, evidence };
}

function classifyCandidate(record, scriptableTypes, feedbackDescendant, specEvidence) {
  const assetPath = slash(record.assetPath);
  const lower = assetPath.toLowerCase();
  if (scriptableTypes.length) return 'scriptable-object';
  if (/\.json$/i.test(lower) && specEvidence && specEvidence.format === 'gameplay-json') return 'gameplay-spec-data';
  if (/\.(?:csv|txt|bytes)$/i.test(lower) && /(?:^|\/)(?:config|data|db|level|gameplay)(?:\/|[^/]*)/i.test(lower)) {
    return 'gameplay-spec-data';
  }
  if (record.type === 'audio') return 'audio-clip';
  if (record.type === 'prefab' && (FEEDBACK_NAME.test(lower) || feedbackDescendant)) return 'feedback-prefab';
  if (feedbackDescendant && record.type === 'material') return 'feedback-material';
  if (feedbackDescendant && record.type === 'texture') return 'feedback-texture';
  return null;
}

function analyzeFeedbackClosure(snapshot, options = {}) {
  const allRecords = snapshot && snapshot.assets && snapshot.assets.records || [];
  const explicitEntries = new Set((options.entries || []).map(slash));
  const allowedPaths = options.allowedPaths
    ? new Set([...options.allowedPaths].map(slash).concat([...explicitEntries]))
    : null;
  const records = allowedPaths ? allRecords.filter(record => allowedPaths.has(slash(record.assetPath))) : allRecords;
  const indexedEdges = snapshot && snapshot.dependencies && snapshot.dependencies.edges || [];
  const jsonSpecs = collectJsonSpecEdges(records, options.readAssetText);
  const edges = [...indexedEdges, ...jsonSpecs.edges].filter(edge =>
    !allowedPaths || allowedPaths.has(slash(edge.from)) && allowedPaths.has(slash(edge.to)));
  const recordByPath = new Map(records.map(record => [slash(record.assetPath), record]));
  const entries = (options.entries && options.entries.length
    ? options.entries
    : (snapshot.buildScenes || []).filter(scene => scene.enabled !== false).map(scene => slash(scene.path)))
    .filter(assetPath => recordByPath.has(assetPath));
  const paths = shortestPaths(entries, edges);
  const scriptByPath = new Map(
    (snapshot.scriptIndex && snapshot.scriptIndex.scripts || []).map(script => [slash(script.assetPath), script]),
  );
  const edgeTargets = new Map();
  for (const edge of edges) {
    const from = slash(edge.from);
    const to = slash(edge.to);
    if (!edgeTargets.has(from)) edgeTargets.set(from, []);
    edgeTargets.get(from).push(to);
  }

  const feedbackRoots = new Set();
  const specificationRoots = new Set();
  const typeCache = new Map();
  for (const [assetPath, record] of recordByPath.entries()) {
    if (!paths.distance.has(assetPath)) continue;
    const scriptableTypes = scriptableTypeForAsset(assetPath, record, edgeTargets, scriptByPath);
    typeCache.set(assetPath, scriptableTypes);
    const specEvidence = jsonSpecs.evidence.get(assetPath) || null;
    if (specEvidence && specEvidence.format === 'gameplay-json' ||
        /\.(?:csv|txt|bytes)$/i.test(assetPath) && /(?:^|\/)(?:config|data|db|level|gameplay)(?:\/|[^/]*)/i.test(assetPath)) {
      specificationRoots.add(assetPath);
    }
    if (record.type === 'audio' || record.type === 'prefab' && FEEDBACK_NAME.test(assetPath) ||
        scriptableTypes.some(typeName => FEEDBACK_NAME.test(typeName))) feedbackRoots.add(assetPath);
  }

  const feedbackDescendants = new Set([...feedbackRoots, ...specificationRoots]);
  const queue = [...feedbackDescendants].sort();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of paths.outgoing.get(queue[cursor]) || []) {
      if (!paths.distance.has(next) || feedbackDescendants.has(next)) continue;
      feedbackDescendants.add(next);
      queue.push(next);
    }
  }

  const candidates = [];
  for (const [assetPath, record] of recordByPath.entries()) {
    if (!paths.distance.has(assetPath)) continue;
    const scriptableTypes = typeCache.get(assetPath) || [];
    const specEvidence = jsonSpecs.evidence.get(assetPath) || null;
    const kind = classifyCandidate(record, scriptableTypes, feedbackDescendants.has(assetPath), specEvidence);
    if (!kind) continue;
    const feedbackRoot = feedbackRoots.has(assetPath);
    candidates.push({
      assetPath,
      kind,
      scriptableObjectTypes: scriptableTypes,
      reachability: 'binding-reachable',
      distance: paths.distance.get(assetPath),
      sourceChain: paths.chainTo(assetPath),
      feedbackRoot,
      requiresBehavioralDisposition: true,
      specEvidence,
    });
  }
  candidates.sort((left, right) => left.distance - right.distance || left.assetPath.localeCompare(right.assetPath));
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'unity-feedback-closure',
    source: {
      scanId: snapshot.scanId || null,
      stateFingerprint: snapshot.stateFingerprint || snapshot.state && snapshot.state.fingerprint || null,
      profile: options.profile || 'full-project',
      entries,
    },
    semantics: {
      staticReachability: 'binding-reachable-only',
      behavioralReachability: 'requires-source-owner-and-disposition-evidence',
    },
    candidateCount: candidates.length,
    candidates,
  };
}

function nonEmptyList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim());
}

function validateDispositionContract(report, contract) {
  const errors = [];
  const entries = contract && contract.entries && typeof contract.entries === 'object' ? contract.entries : {};
  const phases = Array.isArray(contract && contract.walkthrough) ? contract.walkthrough : [];
  const candidatePaths = new Set(report.candidates.map(candidate => candidate.assetPath));
  const phaseAssets = new Set();
  for (const phase of phases) {
    const id = typeof phase.id === 'string' ? phase.id.trim() : '';
    if (!id) { errors.push('walkthrough phase thiếu id.'); continue; }
    if (!nonEmptyList(phase.unityOwners)) errors.push(`${id}: thiếu unityOwners.`);
    if (typeof phase.stateMutation !== 'string' || !phase.stateMutation.trim()) errors.push(`${id}: thiếu stateMutation.`);
    if (!Array.isArray(phase.animations)) errors.push(`${id}: animations phải là array (được phép rỗng).`);
    if (!Array.isArray(phase.vfx)) errors.push(`${id}: vfx phải là array (được phép rỗng).`);
    if (!Array.isArray(phase.sfx)) errors.push(`${id}: sfx phải là array (được phép rỗng).`);
    if (!nonEmptyList(phase.cocosCallSites)) errors.push(`${id}: thiếu cocosCallSites.`);
    if (!nonEmptyList(phase.regressions)) errors.push(`${id}: thiếu regressions.`);
    for (const assetPath of [...phase.vfx || [], ...phase.sfx || []].map(slash)) {
      phaseAssets.add(assetPath);
      if (!candidatePaths.has(assetPath)) errors.push(`${id}: feedback asset không nằm trong closure: ${assetPath}`);
    }
  }

  for (const candidate of report.candidates) {
    const item = entries[candidate.assetPath];
    if (!item || !DISPOSITIONS.has(item.disposition)) {
      errors.push(`${candidate.assetPath}: thiếu disposition implemented|replaced|deferred|dormant.`);
      continue;
    }
    if (item.disposition === 'implemented') {
      if (!nonEmptyList(item.cocosAssets)) errors.push(`${candidate.assetPath}: implemented thiếu cocosAssets.`);
      if (!nonEmptyList(item.cocosCallSites)) errors.push(`${candidate.assetPath}: implemented thiếu cocosCallSites.`);
      if (!nonEmptyList(item.regressions)) errors.push(`${candidate.assetPath}: implemented thiếu regressions.`);
      if (candidate.kind === 'gameplay-spec-data' && !nonEmptyList(item.fieldBindings)) {
        errors.push(`${candidate.assetPath}: gameplay spec implemented thiếu fieldBindings.`);
      }
      if (candidate.feedbackRoot && !phaseAssets.has(candidate.assetPath)) {
        errors.push(`${candidate.assetPath}: feedback root implemented chưa xuất hiện trong walkthrough vfx/sfx.`);
      }
    } else if (typeof item.reason !== 'string' || !item.reason.trim()) {
      errors.push(`${candidate.assetPath}: ${item.disposition} thiếu reason.`);
    }
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8').replace(/^\uFEFF/, ''));
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  const result = await scanUnityProject({
    project: options.project,
    provider: 'static',
    cache: options.cache,
    refreshCache: options.refreshCache,
  });
  const projectRoot = path.resolve(options.project);
  const coreScope = options.profile === 'playable-core'
    ? buildCoreGameplayScope(result.snapshot, { profile: 'playable-core' })
    : null;
  const coreAllowedPaths = coreScope
    ? expandCoreAllowedPaths(
      result.snapshot,
      new Set([...coreScope.pathSet, ...coreScope.adapterPathSet]),
      options.entries,
    )
    : null;
  const report = analyzeFeedbackClosure(result.snapshot, {
    ...options,
    allowedPaths: coreAllowedPaths,
    readAssetText(assetPath) {
      const target = path.resolve(projectRoot, ...slash(assetPath).split('/'));
      const relative = path.relative(projectRoot, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`JSON spec path vượt Unity project: ${assetPath}`);
      }
      return fs.readFileSync(target, 'utf8');
    },
  });
  if (coreScope) {
    report.source.coreScope = {
      version: coreScope.version,
      entry: coreScope.entry,
      includedCount: coreScope.closure.includedCount,
      adapterCount: coreScope.closure.adapterCount,
    };
  }
  const contract = options.dispositions ? readJson(options.dispositions) : null;
  const gate = contract || options.check
    ? validateDispositionContract(report, contract)
    : { ok: null, errors: [] };
  const output = {
    ...report,
    contract: {
      provided: Boolean(contract),
      digest: contract ? sha256(stableStringify(contract)) : null,
      ok: gate.ok,
      errors: gate.errors,
    },
    ok: options.check ? gate.ok : true,
  };
  const serialized = stableStringify(output);
  if (options.out) {
    const target = path.resolve(options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== serialized) fs.writeFileSync(target, serialized, 'utf8');
  }
  if (options.json || !options.out || options.check) process.stdout.write(serialized);
  return options.check && !gate.ok ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 2;
  });
}

module.exports = {
  SCHEMA_VERSION,
  parseArgs,
  shortestPaths,
  analyzeFeedbackClosure,
  collectJsonSpecEdges,
  expandCoreAllowedPaths,
  validateDispositionContract,
  stableStringify,
};
