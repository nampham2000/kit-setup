#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = 'tools/resource-boundary.json';
const CATALOG_SCHEMA_VERSION = 1;

const USAGE = `Cocos Resources Boundary

Usage:
  node playable-shared-kit/tools/resource-boundary.cjs [options]

Options:
  --project <dir>         Cocos project root. Default: auto-detect.
  --config <file>         Boundary manifest. Default: tools/resource-boundary.json.
  --write-catalog         Generate/update the serialized static catalog prefab.
  --check, --verify       Read-only strict verification; fail on pending moves or drift.
  --json                  Print machine-readable JSON.
  --verbose               Include the complete catalog entry list in JSON.
  --help                  Print help without reading or writing project files.

The tool never moves assets or edits .meta files. Apply manifest moves through
Cocos AssetDB/MCP, then run --verify and ai:verify:assets.`;

function fail(message) {
  const error = new Error(message);
  error.code = 'RESOURCE_BOUNDARY_INVALID';
  throw error;
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, 'assets')) && fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseArgs(argv) {
  const options = {
    project: '',
    config: DEFAULT_CONFIG,
    writeCatalog: false,
    verify: false,
    json: false,
    verbose: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project') options.project = argv[++index] || fail('--project requires a value.');
    else if (arg === '--config') options.config = argv[++index] || fail('--config requires a value.');
    else if (arg === '--write-catalog') options.writeCatalog = true;
    else if (arg === '--check' || arg === '--verify') options.verify = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else fail(`Unknown argument: ${arg}`);
  }
  if (options.writeCatalog && options.verify) fail('--write-catalog conflicts with --check/--verify.');
  return options;
}

function resolveInside(projectRoot, relativePath, label) {
  if (!relativePath || path.isAbsolute(relativePath)) fail(`${label} must be project-relative: ${relativePath}`);
  const absolute = path.resolve(projectRoot, relativePath);
  const rel = toPosix(path.relative(projectRoot, absolute));
  if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    fail(`${label} escapes the project root: ${relativePath}`);
  }
  return { absolute, relative: rel };
}

function readJson(file, label = file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`Cannot parse ${label}: ${error.message}`);
  }
}

function validateEvidence(projectRoot, value, label) {
  const raw = String(value || '').trim();
  if (!raw) fail(`${label} must not be empty.`);
  const separator = raw.indexOf('#');
  const filePart = separator >= 0 ? raw.slice(0, separator) : raw;
  const token = separator >= 0 ? raw.slice(separator + 1) : '';
  const resolved = resolveInside(projectRoot, filePart, label);
  if (!fs.existsSync(resolved.absolute) || !fs.statSync(resolved.absolute).isFile()) {
    fail(`${label} evidence file does not exist: ${resolved.relative}`);
  }
  if (token) {
    const content = fs.readFileSync(resolved.absolute, 'utf8');
    if (!content.includes(token)) fail(`${label} token '${token}' is absent from ${resolved.relative}.`);
  }
  return raw;
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else output.push(full);
    }
  }
  return output.sort((a, b) => a.localeCompare(b));
}

function normalizeManifest(projectRoot, configPath) {
  const resolved = resolveInside(projectRoot, configPath, 'config');
  if (!fs.existsSync(resolved.absolute)) fail(`Boundary manifest does not exist: ${resolved.relative}`);
  const manifest = readJson(resolved.absolute, resolved.relative);
  if (manifest.schemaVersion !== 1) fail(`Unsupported schemaVersion: ${manifest.schemaVersion}`);
  if (!Array.isArray(manifest.dynamicRoots) || !Array.isArray(manifest.staticMoves)) {
    fail('Manifest requires dynamicRoots[] and staticMoves[].');
  }
  if (!manifest.catalog || typeof manifest.catalog !== 'object') fail('Manifest requires catalog.');
  const resourcesRoot = resolveInside(projectRoot, manifest.resourcesRoot || 'assets/resources', 'resourcesRoot');
  if (!resourcesRoot.relative.startsWith('assets/')) fail('resourcesRoot must be under assets/.');
  const dynamicRoots = manifest.dynamicRoots.map((entry, index) => {
    const raw = typeof entry === 'string' ? { path: entry } : entry;
    if (!String(raw.reason || '').trim()) fail(`dynamicRoots[${index}].reason is required.`);
    if (!Array.isArray(raw.evidence) || !raw.evidence.length) fail(`dynamicRoots[${index}].evidence[] is required.`);
    const evidence = raw.evidence.map((item, evidenceIndex) => validateEvidence(
      projectRoot,
      item,
      `dynamicRoots[${index}].evidence[${evidenceIndex}]`,
    ));
    const target = resolveInside(projectRoot, raw.path, `dynamicRoots[${index}].path`);
    if (!(target.relative === resourcesRoot.relative || target.relative.startsWith(`${resourcesRoot.relative}/`))) {
      fail(`Dynamic root must be inside ${resourcesRoot.relative}: ${target.relative}`);
    }
    return { ...raw, evidence, ...target };
  });
  const staticMoves = manifest.staticMoves.map((move, index) => {
    if (!move || typeof move !== 'object') fail(`staticMoves[${index}] must be an object.`);
    if (!String(move.reason || '').trim()) fail(`staticMoves[${index}].reason is required.`);
    const from = resolveInside(projectRoot, move.from, `staticMoves[${index}].from`);
    const to = resolveInside(projectRoot, move.to, `staticMoves[${index}].to`);
    if (!(from.relative === resourcesRoot.relative || from.relative.startsWith(`${resourcesRoot.relative}/`))) {
      fail(`Static move source must be inside ${resourcesRoot.relative}: ${from.relative}`);
    }
    if (to.relative === resourcesRoot.relative || to.relative.startsWith(`${resourcesRoot.relative}/`)) {
      fail(`Static move destination must be outside ${resourcesRoot.relative}: ${to.relative}`);
    }
    const rules = move.catalog === false ? [] : (move.rules || []);
    if (!Array.isArray(rules)) fail(`staticMoves[${index}].rules must be an array.`);
    return { ...move, from, to, rules };
  });
  const catalog = {
    ...manifest.catalog,
    prefab: resolveInside(projectRoot, manifest.catalog.prefab, 'catalog.prefab'),
    script: resolveInside(projectRoot, manifest.catalog.script, 'catalog.script'),
  };
  if (!String(catalog.resourcePath || '').trim()) fail('catalog.resourcePath is required.');
  if (!(catalog.prefab.relative === resourcesRoot.relative || catalog.prefab.relative.startsWith(`${resourcesRoot.relative}/`))) {
    fail('catalog.prefab must be a dynamic root under resourcesRoot.');
  }
  return {
    raw: manifest,
    config: resolved,
    resourcesRoot,
    dynamicRoots,
    staticMoves,
    catalog,
    digest: sha256(`${stableJson(manifest)}\n`),
  };
}

function matchGlob(relativePath, pattern) {
  const escaped = toPosix(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(toPosix(relativePath));
}

function ruleMatches(rule, relativeFile) {
  const extension = path.posix.extname(toPosix(relativeFile)).toLowerCase();
  if (Array.isArray(rule.extensions) && !rule.extensions.map((item) => item.toLowerCase()).includes(extension)) return false;
  if (Array.isArray(rule.include) && !rule.include.some((item) => matchGlob(relativeFile, item))) return false;
  if (Array.isArray(rule.exclude) && rule.exclude.some((item) => matchGlob(relativeFile, item))) return false;
  return true;
}

function findSubMeta(meta, subAsset) {
  const candidates = Object.values(meta.subMetas || {});
  return candidates.find((item) => item && (item.name === subAsset || item.importer === subAsset || item.displayName === subAsset));
}

function catalogReference(assetFile, rule) {
  const metaFile = `${assetFile}.meta`;
  if (!fs.existsSync(metaFile)) fail(`Missing meta for catalog asset: ${assetFile}`);
  const meta = readJson(metaFile);
  const selected = rule.subAsset ? findSubMeta(meta, rule.subAsset) : meta;
  if (!selected?.uuid) fail(`Cannot resolve ${rule.subAsset || 'root'} UUID for: ${assetFile}`);
  if (selected.imported !== true) fail(`Catalog asset importer is not ready: ${assetFile}`);
  return selected.uuid;
}

function collectCatalogEntries(projectRoot, normalized) {
  const entries = [];
  const errors = [];
  const moveStates = [];
  for (const move of normalized.staticMoves) {
    const fromExists = fs.existsSync(move.from.absolute);
    const toExists = fs.existsSync(move.to.absolute);
    let active = null;
    let state = 'missing';
    if (fromExists && toExists) {
      state = 'conflict';
      errors.push(`Both move source and destination exist: ${move.from.relative} -> ${move.to.relative}`);
    } else if (toExists) {
      state = 'moved';
      active = move.to;
    } else if (fromExists) {
      state = 'pending';
      active = move.from;
    } else {
      errors.push(`Move source and destination are both missing: ${move.from.relative} -> ${move.to.relative}`);
    }
    moveStates.push({ from: move.from.relative, to: move.to.relative, state });
    if (!active || move.catalog === false) continue;
    for (const absoluteFile of walkFiles(active.absolute)) {
      if (absoluteFile.endsWith('.meta')) continue;
      const relativeWithinMove = toPosix(path.relative(active.absolute, absoluteFile));
      const rule = move.rules.find((candidate) => ruleMatches(candidate, relativeWithinMove));
      if (!rule) continue;
      try {
        const logicalSource = toPosix(path.posix.join(move.from.relative, relativeWithinMove));
        const resourcePrefix = `${normalized.resourcesRoot.relative}/`;
        let key = logicalSource.slice(resourcePrefix.length);
        const extension = path.posix.extname(key);
        if (rule.stripExtension !== false && extension) key = key.slice(0, -extension.length);
        key += rule.keySuffix || '';
        entries.push({
          key,
          type: rule.type || 'cc.Asset',
          uuid: catalogReference(absoluteFile, rule),
          asset: toPosix(path.relative(projectRoot, absoluteFile)),
          source: logicalSource,
        });
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1].key === entries[index].key) errors.push(`Duplicate catalog key: ${entries[index].key}`);
  }
  return { entries, errors, moveStates };
}

function compressUuid(uuid) {
  const compact = String(uuid || '').replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return uuid;
  const head = compact.slice(0, 5);
  const rest = compact.slice(5);
  const evenRest = rest.length % 2 === 0 ? rest : `${rest}0`;
  let encoded = Buffer.from(evenRest, 'hex').toString('base64').replace(/=+$/g, '');
  if (rest.length % 2 !== 0) encoded = encoded.slice(0, -1);
  return head + encoded;
}

function catalogComponentType(normalized) {
  const metaFile = `${normalized.catalog.script.absolute}.meta`;
  if (!fs.existsSync(metaFile)) fail(`Catalog script meta does not exist: ${toPosix(path.relative(path.dirname(normalized.config.absolute), metaFile))}`);
  const meta = readJson(metaFile);
  if (!meta.uuid || meta.imported !== true) fail(`Catalog script is not imported: ${normalized.catalog.script.relative}`);
  return compressUuid(meta.uuid);
}

function buildCatalogPrefab(normalized, entries) {
  const componentType = catalogComponentType(normalized);
  const name = path.basename(normalized.catalog.prefab.relative, path.extname(normalized.catalog.prefab.relative));
  const component = {
    __type__: componentType,
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: 1 },
    _enabled: true,
    __prefab: null,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    manifestSha256: normalized.digest,
    keys: entries.map((entry) => entry.key),
    types: entries.map((entry) => entry.type),
    assets: entries.map((entry) => ({ __uuid__: entry.uuid, __expectedType__: entry.type })),
    _id: '',
  };
  const payload = [
    {
      __type__: 'cc.Prefab', _name: name, _objFlags: 0, __editorExtras__: {}, _native: '',
      data: { __id__: 1 }, optimizationPolicy: 0, persistent: false,
    },
    {
      __type__: 'cc.Node', _name: name, _objFlags: 0, __editorExtras__: {}, _parent: null,
      _children: [], _active: true, _components: [{ __id__: 3 }], _prefab: { __id__: 2 },
      _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
      _mobility: 0, _layer: 1073741824,
      _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }, _id: '',
    },
    {
      __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 },
      fileId: `resource-boundary-${normalized.digest.slice(0, 20)}`, instance: null,
      targetOverrides: null, nestedPrefabInstanceRoots: null,
    },
    component,
  ];
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function inspectCatalog(normalized, entries) {
  const errors = [];
  const file = normalized.catalog.prefab.absolute;
  if (!fs.existsSync(file)) return { status: 'missing', errors: [`Catalog prefab is missing: ${normalized.catalog.prefab.relative}`] };
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    return { status: 'invalid', errors: [`Catalog prefab is invalid JSON: ${error.message}`] };
  }
  let expectedType = '';
  try { expectedType = catalogComponentType(normalized); } catch (error) { errors.push(error.message); }
  const component = Array.isArray(payload) ? payload.find((item) => item?.__type__ === expectedType) : null;
  if (!component) errors.push('Catalog prefab does not contain the configured StaticAssetCatalog component.');
  else {
    if (component.schemaVersion !== CATALOG_SCHEMA_VERSION) errors.push('Catalog schemaVersion drift.');
    if (component.manifestSha256 !== normalized.digest) errors.push('Catalog manifest digest is stale.');
    const actual = (component.keys || []).map((key, index) => ({
      key,
      type: component.types?.[index],
      uuid: component.assets?.[index]?.__uuid__,
      expectedType: component.assets?.[index]?.__expectedType__,
    }));
    const expected = entries.map((entry) => ({ key: entry.key, type: entry.type, uuid: entry.uuid, expectedType: entry.type }));
    if (stableJson(actual) !== stableJson(expected)) errors.push('Catalog key/type/UUID wiring differs from the manifest closure.');
  }
  const metaFile = `${file}.meta`;
  if (!fs.existsSync(metaFile)) errors.push('Catalog prefab has not been imported by Cocos AssetDB yet.');
  else {
    const meta = readJson(metaFile);
    if (meta.imported !== true) errors.push('Catalog prefab importer is not ready.');
  }
  return { status: errors.length ? 'invalid' : 'ready', errors };
}

function isInside(relativeFile, root) {
  return relativeFile === root || relativeFile.startsWith(`${root}/`);
}

function auditResourceBoundary(projectRoot, configPath = DEFAULT_CONFIG) {
  const normalized = normalizeManifest(projectRoot, configPath);
  const closure = collectCatalogEntries(projectRoot, normalized);
  const errors = [...closure.errors];
  const warnings = [];
  const dynamicFiles = [];
  const misplacedStatic = [];
  const unclassified = [];
  const resourcesFiles = walkFiles(normalized.resourcesRoot.absolute)
    .filter((file) => !file.endsWith('.meta'))
    .map((file) => toPosix(path.relative(projectRoot, file)));
  for (const file of resourcesFiles) {
    if (normalized.dynamicRoots.some((root) => isInside(file, root.relative))) dynamicFiles.push(file);
    else if (normalized.staticMoves.some((move) => isInside(file, move.from.relative))) misplacedStatic.push(file);
    else unclassified.push(file);
  }
  if (misplacedStatic.length) errors.push(`${misplacedStatic.length} configured static asset(s) are still inside resources.`);
  if (unclassified.length) errors.push(`${unclassified.length} resource asset(s) are not declared as dynamic roots or static moves.`);
  for (const root of normalized.dynamicRoots) {
    if (!fs.existsSync(root.absolute)) errors.push(`Dynamic root is missing: ${root.relative}`);
  }
  const catalog = inspectCatalog(normalized, closure.entries);
  errors.push(...catalog.errors);
  return {
    name: 'Cocos Resources Boundary',
    status: errors.length ? 'FAIL' : 'PASS',
    manifest: normalized.config.relative,
    manifestSha256: normalized.digest,
    resourcesRoot: normalized.resourcesRoot.relative,
    dynamicRootCount: normalized.dynamicRoots.length,
    dynamicFileCount: dynamicFiles.length,
    staticCatalogEntryCount: closure.entries.length,
    moveStates: closure.moveStates,
    catalog: { prefab: normalized.catalog.prefab.relative, status: catalog.status },
    misplacedStatic,
    unclassified,
    errors,
    warnings,
    entries: closure.entries,
  };
}

function writeCatalog(projectRoot, configPath = DEFAULT_CONFIG) {
  const normalized = normalizeManifest(projectRoot, configPath);
  const closure = collectCatalogEntries(projectRoot, normalized);
  if (closure.errors.length) fail(closure.errors.join('\n'));
  if (!closure.entries.length) fail('Catalog closure is empty.');
  const content = buildCatalogPrefab(normalized, closure.entries);
  const output = normalized.catalog.prefab.absolute;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const before = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
  const changed = before !== content;
  if (changed) fs.writeFileSync(output, content, 'utf8');
  return {
    name: 'Cocos Resources Boundary Catalog',
    status: 'PASS',
    changed,
    output: normalized.catalog.prefab.relative,
    manifestSha256: normalized.digest,
    entryCount: closure.entries.length,
    moveStates: closure.moveStates,
    next: 'Reimport the prefab through Cocos AssetDB, apply staticMoves through AssetDB/MCP, then run resources:boundary -- --verify.',
  };
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(`[resource-boundary] ERROR: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const projectRoot = options.project
      ? path.resolve(options.project)
      : (findProjectRoot(process.cwd()) || fail('Cannot find a Cocos project root.'));
    const report = options.writeCatalog
      ? writeCatalog(projectRoot, options.config)
      : auditResourceBoundary(projectRoot, options.config);
    if (options.json) {
      const printable = options.verbose || !Array.isArray(report.entries)
        ? report
        : {
            ...report,
            entrySample: report.entries.slice(0, 8),
            entries: undefined,
          };
      console.log(JSON.stringify(printable, null, 2));
    }
    else {
      console.log(`[resource-boundary] ${report.status}: ${report.staticCatalogEntryCount ?? report.entryCount} static catalog entries.`);
      if (report.errors) for (const error of report.errors) console.log(`  - ${error}`);
      if (report.next) console.log(`  ${report.next}`);
    }
    if (options.verify && report.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    const report = { name: 'Cocos Resources Boundary', status: 'FAIL', error: error.message };
    if (options?.json) console.log(JSON.stringify(report, null, 2));
    else console.error(`[resource-boundary] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_CONFIG,
  CATALOG_SCHEMA_VERSION,
  parseArgs,
  stableJson,
  normalizeManifest,
  collectCatalogEntries,
  buildCatalogPrefab,
  auditResourceBoundary,
  writeCatalog,
};
