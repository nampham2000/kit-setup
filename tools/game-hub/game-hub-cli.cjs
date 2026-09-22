#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadMergedConfigFromFile } = require('../../packages/extensions/json-scriptable-inspector/config-fragments.cjs');

const TOOL_ROOT = __dirname;
const TEMPLATE_ROOT = path.join(TOOL_ROOT, 'template');
const OWNERSHIP_FILE = '.game-hub.json';
const GENERATED_FILES = ['index.html', 'hub.css', 'hub.js', 'manifest.json', '_headers', '404.html', OWNERSHIP_FILE];
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const USE = `Game Hub generator

Usage:
  node playable-shared-kit/tools/game-hub.cjs create --brief <id> [--brief <id> ...] [options]
  node playable-shared-kit/tools/game-hub.cjs create --all [options]
  node playable-shared-kit/tools/game-hub.cjs verify --out <dir> [--project <dir>] [--json]

Create options:
  --project <dir>       Playable project root. Default: current directory.
  --brief <id>          Gameplay brief to include, in playlist order. Repeatable.
  --all                 Include every gameplay.briefs entry in config order.
  --title <text>        Hub title. Default: project package name or "Game Hub".
  --subtitle <text>     Header subtitle. Default: "PLAYABLE / BRIEF REVIEW".
  --out <dir>           Output directory. Default: game-hubs/<title-slug>.
  --build               Build selected briefs before staging.
  --jobs <n>            Parallel build jobs passed to playable-build.
  --force               Replace a non-owned output directory.
  --json                Print machine-readable result.

The generator reads assets/resources/playable-config.json (including $fragments),
requires configs/<brief>.json, stages exact *_common_min.html builds, and writes a
portable hub with Previous, Replay, Next, selector, query deep links and hashes.
verify checks manifest.json, staged game bytes and every generated SHA-256.`;

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slug(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game-hub';
}

function titleCase(id) {
  return id.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const command = argv[0];
  if (!['create', 'verify'].includes(command)) throw new Error('Expected create or verify. Use --help for usage.');
  const options = { command, project: process.cwd(), briefs: [], all: false, build: false, force: false, json: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      return value;
    };
    if (arg === '--project') options.project = take();
    else if (arg === '--brief') options.briefs.push(take());
    else if (arg === '--all') options.all = true;
    else if (arg === '--title') options.title = take();
    else if (arg === '--subtitle') options.subtitle = take();
    else if (arg === '--out') options.out = take();
    else if (arg === '--jobs') options.jobs = Number(take());
    else if (arg === '--build') options.build = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (command === 'verify' && (options.briefs.length || options.all || options.build || options.force || options.title || options.subtitle || options.jobs)) {
    throw new Error('verify accepts only --project, --out and --json.');
  }
  if (command === 'verify' && !options.out) throw new Error('verify requires --out <dir>.');
  if (command === 'create' && options.all === (options.briefs.length > 0)) throw new Error('create requires either repeatable --brief or --all.');
  if (options.jobs !== undefined && (!Number.isInteger(options.jobs) || options.jobs < 1)) throw new Error('--jobs must be a positive integer.');
  return options;
}

function resolveWithin(root, target, label) {
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the project: ${target}`);
  }
  return resolved;
}

function loadProject(projectInput) {
  const root = fs.realpathSync(path.resolve(projectInput));
  const configFile = path.join(root, 'assets', 'resources', 'playable-config.json');
  if (!fs.existsSync(configFile)) throw new Error('Missing assets/resources/playable-config.json.');
  const config = loadMergedConfigFromFile(configFile).merged;
  const briefs = config?.gameplay?.briefs;
  if (!briefs || typeof briefs !== 'object' || Array.isArray(briefs) || !Object.keys(briefs).length) {
    throw new Error('playable-config.json must define gameplay.briefs.');
  }
  let packageName = '';
  const packageFile = path.join(root, 'package.json');
  if (fs.existsSync(packageFile)) packageName = readJson(packageFile).name || '';
  return { root, briefs, packageName };
}

function readBrief(project, id) {
  if (!ID.test(id)) throw new Error(`Invalid brief id: ${id}.`);
  if (!Object.prototype.hasOwnProperty.call(project.briefs, id)) throw new Error(`Unknown gameplay brief: ${id}.`);
  const configFile = path.join(project.root, 'configs', `${id}.json`);
  if (!fs.existsSync(configFile)) throw new Error(`Missing build config: configs/${id}.json.`);
  const config = readJson(configFile);
  if (config?.packages?.['gameplay-briefs']?.activeBundle !== id) {
    throw new Error(`configs/${id}.json does not select gameplay brief ${id}.`);
  }
  const buildPath = String(config.buildPath || '');
  if (!buildPath.startsWith('project://')) throw new Error(`configs/${id}.json must use a project:// buildPath.`);
  const buildDir = resolveWithin(project.root, buildPath.slice('project://'.length), `buildPath for ${id}`);
  const authored = project.briefs[id];
  const label = typeof authored?.hubLabel === 'string' ? authored.hubLabel
    : typeof authored?.label === 'string' ? authored.label
      : typeof authored?.title === 'string' ? authored.title : titleCase(id);
  return { id, label, buildName: String(config.name || id), buildDir };
}

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, result);
    else result.push(file);
  }
  return result;
}

function findPlayable(brief) {
  const expected = `${brief.buildName}_common_min.html`;
  const matches = walk(brief.buildDir).filter(file => path.basename(file) === expected);
  if (matches.length !== 1) {
    throw new Error(`${brief.id}: expected exactly one ${expected} below ${path.relative(path.dirname(brief.buildDir), brief.buildDir)}, found ${matches.length}. Build with --build or npm run build -- --brief ${brief.id}.`);
  }
  return matches[0];
}

function runBuild(project, briefs, jobs) {
  const tool = path.join(project.root, 'playable-shared-kit', 'tools', 'playable-build.cjs');
  if (!fs.existsSync(tool)) throw new Error('Missing playable-shared-kit/tools/playable-build.cjs.');
  const args = [tool, 'build', '--no-clean', jobs ? '--jobs' : '--parallel'];
  if (jobs) args.push(String(jobs));
  for (const brief of briefs) args.push('--brief', brief.id);
  const result = spawnSync(process.execPath, args, { cwd: project.root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Selected brief build failed: ${result.error?.message || `exit ${result.status}`}.`);
}

function desiredFiles(project, options, briefs, outDir) {
  const games = briefs.map(brief => {
    const source = findPlayable(brief);
    const data = fs.readFileSync(source);
    const stat = fs.statSync(source);
    return {
      id: brief.id,
      label: brief.label,
      buildName: brief.buildName,
      path: `games/${brief.id}.html`,
      bytes: data.length,
      sha256: digest(data),
      builtAt: stat.mtime.toISOString(),
      source,
      data,
    };
  });
  const title = options.title || titleCase(project.packageName) || 'Game Hub';
  const subtitle = options.subtitle || 'PLAYABLE / BRIEF REVIEW';
  const manifest = {
    schemaVersion: 1,
    title,
    subtitle,
    mark: title.trim().charAt(0).toUpperCase() || 'G',
    games: games.map(({ source, data, ...game }) => game),
  };
  const files = new Map();
  for (const name of ['index.html', 'hub.css', 'hub.js']) files.set(name, fs.readFileSync(path.join(TEMPLATE_ROOT, name)));
  files.set('manifest.json', Buffer.from(stableJson(manifest)));
  files.set('_headers', Buffer.from('/*\n  X-Frame-Options: SAMEORIGIN\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=0, must-revalidate\n'));
  files.set('404.html', Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Game not found</title><h1>Game not found</h1><a href="./">Back to game hub</a></html>\n'));
  for (const game of games) files.set(game.path, game.data);
  const ownership = {
    schemaVersion: 1,
    generator: 'playable-shared-kit/tools/game-hub.cjs',
    files: [...files.entries()].map(([file, data]) => ({ file, sha256: digest(data) })),
  };
  files.set(OWNERSHIP_FILE, Buffer.from(stableJson(ownership)));
  return { files, manifest, outDir };
}

function assertWritableOutput(outDir, force) {
  if (!fs.existsSync(outDir)) return;
  const entries = fs.readdirSync(outDir);
  if (!entries.length) return;
  const owner = path.join(outDir, OWNERSHIP_FILE);
  if (!fs.existsSync(owner) && !force) throw new Error(`Output is not an owned game hub: ${outDir}. Use a new --out or explicit --force.`);
}

function writeIfChanged(file, data) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(data)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return true;
}

function writeHub(desired, force) {
  assertWritableOutput(desired.outDir, force);
  fs.mkdirSync(desired.outDir, { recursive: true });
  const previousOwner = path.join(desired.outDir, OWNERSHIP_FILE);
  if (fs.existsSync(previousOwner)) {
    for (const entry of readJson(previousOwner).files || []) {
      if (!desired.files.has(entry.file)) {
        const obsolete = resolveWithin(desired.outDir, entry.file, 'Owned hub file');
        if (fs.existsSync(obsolete)) fs.rmSync(obsolete, { force: true });
      }
    }
  }
  let changed = 0;
  for (const [relative, data] of desired.files) if (writeIfChanged(resolveWithin(desired.outDir, relative, 'Hub file'), data)) changed += 1;
  return changed;
}

function verifyHub(projectRoot, outInput) {
  const outDir = resolveWithin(projectRoot, outInput, 'Hub output');
  const issues = [];
  const ownerFile = path.join(outDir, OWNERSHIP_FILE);
  const manifestFile = path.join(outDir, 'manifest.json');
  if (!fs.existsSync(ownerFile)) issues.push(`Missing ${OWNERSHIP_FILE}.`);
  if (!fs.existsSync(manifestFile)) issues.push('Missing manifest.json.');
  let manifest = null;
  if (fs.existsSync(manifestFile)) {
    try { manifest = readJson(manifestFile); } catch (error) { issues.push(`Invalid manifest.json: ${error.message}`); }
  }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest?.games) || !manifest.games.length) issues.push('manifest.json must contain schemaVersion=1 and at least one game.');
  const tracked = fs.existsSync(ownerFile) ? readJson(ownerFile).files || [] : [];
  for (const entry of tracked) {
    let file;
    try { file = resolveWithin(outDir, entry.file, 'Owned hub file'); }
    catch (error) { issues.push(error.message); continue; }
    if (!fs.existsSync(file)) issues.push(`Missing generated file: ${entry.file}.`);
    else if (digest(fs.readFileSync(file)) !== entry.sha256) issues.push(`Generated file hash mismatch: ${entry.file}.`);
  }
  for (const game of manifest?.games || []) {
    if (!ID.test(game.id || '')) issues.push(`Invalid game id: ${String(game.id)}.`);
    let file;
    try { file = resolveWithin(outDir, game.path, `Game path for ${game.id}`); }
    catch (error) { issues.push(error.message); continue; }
    if (!fs.existsSync(file)) issues.push(`Missing staged game: ${game.path}.`);
    else {
      const data = fs.readFileSync(file);
      if (data.length !== game.bytes || digest(data) !== game.sha256) issues.push(`Staged game mismatch: ${game.id}.`);
    }
  }
  return { ok: issues.length === 0, outDir, games: manifest?.games?.length || 0, issues };
}

function create(options) {
  const project = loadProject(options.project);
  const ids = options.all ? Object.keys(project.briefs) : options.briefs;
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate --brief values are not allowed.');
  const briefs = ids.map(id => readBrief(project, id));
  if (options.build) runBuild(project, briefs, options.jobs);
  const defaultTitle = options.title || titleCase(project.packageName) || 'Game Hub';
  const outInput = options.out || path.join('game-hubs', slug(defaultTitle));
  const outDir = resolveWithin(project.root, outInput, 'Hub output');
  const desired = desiredFiles(project, options, briefs, outDir);
  const changedFiles = writeHub(desired, options.force);
  const verification = verifyHub(project.root, path.relative(project.root, outDir));
  if (!verification.ok) throw new Error(verification.issues.join('\n'));
  return { ok: true, mode: 'create', outDir, games: briefs.map(item => item.id), changedFiles };
}

function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) { console.error(`[game-hub] ${error.message}`); return 1; }
  if (options.help) { console.log(USE); return 0; }
  try {
    const project = fs.realpathSync(path.resolve(options.project));
    const result = options.command === 'create' ? create(options) : verifyHub(project, options.out);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok) console.log(`[game-hub] ${options.command} passed: ${result.games.length ?? result.games} game(s), ${result.outDir}.`);
    else for (const issue of result.issues) console.error(`[game-hub] ${issue}`);
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[game-hub] ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { parseArgs, loadProject, readBrief, findPlayable, create, verifyHub, main, slug, titleCase };
