#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const gameHub = require('../game-hub/game-hub-cli.cjs');

const KIT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_TEMPLATE = path.join(KIT_ROOT, 'template-config', 'playable-delivery_TEMPLATE.json');
const WORKFLOW_TEMPLATE = path.join(KIT_ROOT, 'template-config', 'github-actions', 'playable-delivery.yml');
const GUIDE_TEMPLATE = path.join(KIT_ROOT, 'template-config', 'PLAYABLE_DELIVERY_TEMPLATE.md');
const DEFAULT_CONFIG = 'configs/playable-delivery.json';
const SITE_OWNER = '.playable-delivery.json';
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const USE = `Playable delivery pipeline

Usage:
  node playable-shared-kit/tools/delivery-pipeline.cjs init [options]
  node playable-shared-kit/tools/delivery-pipeline.cjs prepare [options]
  node playable-shared-kit/tools/delivery-pipeline.cjs run [options]
  node playable-shared-kit/tools/delivery-pipeline.cjs deploy [options]
  node playable-shared-kit/tools/delivery-pipeline.cjs verify [options]

Commands:
  init       Create config, GitHub Actions workflow and visual guide.
  prepare    Build every unique brief once, create hubs and package the site.
  run        Prepare and deploy using the configured provider.
  deploy     Verify and deploy an already prepared site.
  verify     Read-only verification of hubs, inventory and SHA-256 hashes.

Options:
  --project <dir>       Project root. Default: current directory.
  --config <file>       Config inside project. Default: configs/playable-delivery.json.
  --jobs <n>            Override parallel Cocos workers.
  --provider <name>     Override: none, netlify or github-pages.
  --skip-build          Package existing fresh artifacts without building.
  --dry-run             Prepare and verify, but do not publish.
  --force               init only: replace generated setup files.
  --json                Print machine-readable result.

The pipeline validates every brief before mutation, invokes playable-build once
for all unique briefs, generates every configured hub, verifies hashes, assembles
one static site, then publishes only after all gates pass.`;

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const command = argv[0];
  if (!['init', 'prepare', 'run', 'deploy', 'verify'].includes(command)) throw new Error('Expected init, prepare, run, deploy or verify. Use --help.');
  const options = { command, project: process.cwd(), config: DEFAULT_CONFIG, dryRun: false, skipBuild: false, force: false, json: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      return value;
    };
    if (arg === '--project') options.project = take();
    else if (arg === '--config') options.config = take();
    else if (arg === '--jobs') options.jobs = Number(take());
    else if (arg === '--provider') options.provider = take();
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.jobs !== undefined && (!Number.isInteger(options.jobs) || options.jobs < 1)) throw new Error('--jobs must be a positive integer.');
  if (options.provider && !['none', 'netlify', 'github-pages', 'github'].includes(options.provider)) throw new Error('--provider must be none, netlify or github-pages.');
  if (command !== 'init' && options.force) throw new Error('--force is accepted only by init.');
  if (['init', 'deploy', 'verify'].includes(command) && options.skipBuild) throw new Error(`--skip-build is not valid for ${command}.`);
  return options;
}

function resolveWithin(root, target, label) {
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} must stay inside the project: ${target}`);
  return resolved;
}

function writeSetupFile(target, source, force) {
  const data = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target).equals(data)) return false;
    if (!force) return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return true;
}

function ensureDeliveryIgnore(projectRoot) {
  const file = path.join(projectRoot, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).includes('/.delivery/')) return false;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${prefix}/.delivery/\n`);
  return true;
}

function init(options) {
  const project = gameHub.loadProject(options.project);
  const configFile = resolveWithin(project.root, options.config, 'Delivery config');
  let changed = 0;
  if (!fs.existsSync(configFile) || options.force) {
    const template = readJson(CONFIG_TEMPLATE);
    template.jobs = Math.min(Math.max(os.cpus().length > 2 ? os.cpus().length - 1 : 1, 1), 8);
    template.hubs[0].briefs = Object.keys(project.briefs);
    template.hubs[0].title = project.packageName ? gameHub.titleCase(project.packageName) : 'Playable Review';
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, stableJson(template));
    changed += 1;
  }
  changed += Number(writeSetupFile(path.join(project.root, '.github', 'workflows', 'playable-delivery.yml'), WORKFLOW_TEMPLATE, options.force));
  changed += Number(writeSetupFile(path.join(project.root, 'PLAYABLE_DELIVERY.md'), GUIDE_TEMPLATE, options.force));
  changed += Number(ensureDeliveryIgnore(project.root));
  return { ok: true, mode: 'init', changedFiles: changed, configFile };
}

function normalizeProvider(value) {
  return value === 'github' ? 'github-pages' : value;
}

function loadDelivery(options) {
  const project = gameHub.loadProject(options.project);
  const configFile = resolveWithin(project.root, options.config, 'Delivery config');
  if (!fs.existsSync(configFile)) throw new Error(`Missing ${options.config}. Run npm run delivery:init first.`);
  const config = readJson(configFile);
  const issues = [];
  if (config.schemaVersion !== 1) issues.push('schemaVersion must be 1.');
  const jobs = options.jobs ?? config.jobs ?? 1;
  if (!Number.isInteger(jobs) || jobs < 1) issues.push('jobs must be a positive integer.');
  if (!Array.isArray(config.hubs) || !config.hubs.length) issues.push('hubs must contain at least one hub.');
  const seenHubs = new Set();
  const hubs = [];
  for (const raw of Array.isArray(config.hubs) ? config.hubs : []) {
    if (!ID.test(raw?.id || '')) issues.push(`Invalid hub id: ${String(raw?.id)}.`);
    else if (seenHubs.has(raw.id)) issues.push(`Duplicate hub id: ${raw.id}.`);
    else seenHubs.add(raw.id);
    if (!Array.isArray(raw?.briefs) || !raw.briefs.length) issues.push(`Hub ${raw?.id || '<unknown>'} requires briefs.`);
    const briefs = Array.isArray(raw?.briefs) ? raw.briefs : [];
    if (new Set(briefs).size !== briefs.length) issues.push(`Hub ${raw?.id || '<unknown>'} contains duplicate briefs.`);
    hubs.push({ id: raw?.id, title: raw?.title || gameHub.titleCase(raw?.id || ''), subtitle: raw?.subtitle || 'PLAYABLE / BRIEF REVIEW', briefs, out: raw?.out || path.posix.join('game-hubs', raw?.id || 'invalid') });
  }
  const provider = normalizeProvider(options.provider || config.delivery?.provider || 'none');
  if (!['none', 'netlify', 'github-pages'].includes(provider)) issues.push('delivery.provider must be none, netlify or github-pages.');
  const siteInput = config.delivery?.siteDir || '.delivery/site';
  let siteDir;
  try { siteDir = resolveWithin(project.root, siteInput, 'Delivery siteDir'); } catch (error) { issues.push(error.message); }
  const briefMap = new Map();
  for (const hub of hubs) {
    try { resolveWithin(project.root, hub.out, `Hub output for ${hub.id}`); } catch (error) { issues.push(error.message); }
    for (const id of hub.briefs) {
      try { if (!briefMap.has(id)) briefMap.set(id, gameHub.readBrief(project, id)); }
      catch (error) { issues.push(error.message); }
    }
  }
  if (issues.length) throw new Error(issues.join('\n'));
  return { project, config, configFile, jobs, hubs, briefs: [...briefMap.values()], provider, siteInput, siteDir };
}

function runProcess(command, args, cwd, inherit = true) {
  const result = spawnSync(command, args, { cwd, stdio: inherit ? 'inherit' : 'pipe', encoding: inherit ? undefined : 'utf8', windowsHide: true });
  return { ok: !result.error && result.status === 0, status: result.status, error: result.error, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function buildBriefs(context) {
  const started = Date.now();
  const tool = path.join(context.project.root, 'playable-shared-kit', 'tools', 'playable-build.cjs');
  if (!fs.existsSync(tool)) throw new Error('Missing playable-shared-kit/tools/playable-build.cjs.');
  const args = [tool, 'build', '--no-clean', '--jobs', String(context.jobs)];
  for (const brief of context.briefs) args.push('--brief', brief.id);
  const result = runProcess(process.execPath, args, context.project.root);
  const stale = [];
  for (const brief of context.briefs) {
    try {
      const artifact = gameHub.findPlayable(brief);
      if (fs.statSync(artifact).mtimeMs < started - 2000) stale.push(brief.id);
    } catch { stale.push(brief.id); }
  }
  if (stale.length) throw new Error(`Build did not produce fresh common_min artifacts for: ${stale.join(', ')}.`);
  if (!result.ok) console.warn(`[delivery] Build command exited ${result.status ?? 'with an error'}, but every selected artifact is fresh; continuing to hash verification.`);
}

function walk(dir, base = dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, base, result);
    else result.push({ file, relative: path.relative(base, file).split(path.sep).join('/') });
  }
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function landingHtml(context, manifests) {
  const cards = manifests.map(item => `<a class="card" href="./hubs/${encodeURIComponent(item.id)}/"><strong>${escapeHtml(item.title)}</strong><span>${item.games} brief${item.games === 1 ? '' : 's'}</span></a>`).join('\n');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playable Delivery</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0c1210;color:#f5fff8;font:16px/1.5 system-ui,sans-serif}main{width:min(920px,calc(100% - 32px));margin:48px auto}h1{font-size:clamp(2rem,6vw,4rem);margin:0 0 8px}p{color:#aab8af;margin:0 0 28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.card{display:flex;flex-direction:column;gap:8px;padding:22px;border:1px solid #344139;border-radius:16px;background:#17201b;color:inherit;text-decoration:none}.card:hover{border-color:#c9ff62;transform:translateY(-2px)}.card span{color:#aab8af}</style></head><body><main><h1>Playable Delivery</h1><p>${context.briefs.length} unique briefs · ${manifests.length} game hubs</p><div class="grid">${cards}</div></main></body></html>\n`;
}

function writeOwnedSite(context, files) {
  const ownerFile = path.join(context.siteDir, SITE_OWNER);
  if (fs.existsSync(context.siteDir) && fs.readdirSync(context.siteDir).length && !fs.existsSync(ownerFile)) throw new Error(`Delivery site is not generator-owned: ${context.siteInput}.`);
  const previous = fs.existsSync(ownerFile) ? readJson(ownerFile).files || [] : [];
  for (const entry of previous) {
    if (!files.has(entry.file)) {
      const obsolete = resolveWithin(context.siteDir, entry.file, 'Owned delivery file');
      if (fs.existsSync(obsolete)) fs.rmSync(obsolete, { force: true });
    }
  }
  fs.mkdirSync(context.siteDir, { recursive: true });
  let changed = 0;
  for (const [relative, data] of files) {
    const target = resolveWithin(context.siteDir, relative, 'Delivery file');
    if (fs.existsSync(target) && fs.readFileSync(target).equals(data)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    changed += 1;
  }
  const owner = { schemaVersion: 1, generator: 'playable-shared-kit/tools/delivery-pipeline.cjs', files: [...files].map(([file, data]) => ({ file, sha256: digest(data), bytes: data.length })) };
  const ownerData = Buffer.from(stableJson(owner));
  if (!fs.existsSync(ownerFile) || !fs.readFileSync(ownerFile).equals(ownerData)) { fs.writeFileSync(ownerFile, ownerData); changed += 1; }
  return changed;
}

function packageSite(context) {
  const hubManifests = [];
  for (const hub of context.hubs) {
    const result = gameHub.create({ command: 'create', project: context.project.root, briefs: hub.briefs, all: false, build: false, force: false, json: false, title: hub.title, subtitle: hub.subtitle, out: hub.out });
    const verification = gameHub.verifyHub(context.project.root, hub.out);
    if (!verification.ok) throw new Error(verification.issues.join('\n'));
    hubManifests.push({ id: hub.id, title: hub.title, out: hub.out, games: result.games.length });
  }
  const files = new Map();
  files.set('index.html', Buffer.from(landingHtml(context, hubManifests)));
  files.set('404.html', Buffer.from('<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1><a href="./">Open playable delivery</a>\n'));
  files.set('.nojekyll', Buffer.alloc(0));
  files.set('_headers', Buffer.from('/*\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=0, must-revalidate\n'));
  for (const hub of context.hubs) {
    const source = resolveWithin(context.project.root, hub.out, `Hub output for ${hub.id}`);
    for (const entry of walk(source)) files.set(`hubs/${hub.id}/${entry.relative}`, fs.readFileSync(entry.file));
  }
  const manifest = { schemaVersion: 1, uniqueBriefs: context.briefs.map(item => item.id), hubs: hubManifests.map(({ out, ...item }) => ({ ...item, path: `hubs/${item.id}/` })) };
  files.set('delivery-manifest.json', Buffer.from(stableJson(manifest)));
  const changedFiles = writeOwnedSite(context, files);
  return { manifest, changedFiles };
}

function verifyContext(context) {
  const issues = [];
  for (const hub of context.hubs) {
    const result = gameHub.verifyHub(context.project.root, hub.out);
    issues.push(...result.issues.map(issue => `${hub.id}: ${issue}`));
  }
  const ownerFile = path.join(context.siteDir, SITE_OWNER);
  const manifestFile = path.join(context.siteDir, 'delivery-manifest.json');
  if (!fs.existsSync(ownerFile)) issues.push(`Missing ${context.siteInput}/${SITE_OWNER}.`);
  if (!fs.existsSync(manifestFile)) issues.push(`Missing ${context.siteInput}/delivery-manifest.json.`);
  const tracked = fs.existsSync(ownerFile) ? readJson(ownerFile).files || [] : [];
  for (const entry of tracked) {
    let file;
    try { file = resolveWithin(context.siteDir, entry.file, 'Owned delivery file'); } catch (error) { issues.push(error.message); continue; }
    if (!fs.existsSync(file)) issues.push(`Missing delivery file: ${entry.file}.`);
    else {
      const data = fs.readFileSync(file);
      if (data.length !== entry.bytes || digest(data) !== entry.sha256) issues.push(`Delivery hash mismatch: ${entry.file}.`);
    }
  }
  let manifest;
  try { if (fs.existsSync(manifestFile)) manifest = readJson(manifestFile); } catch (error) { issues.push(`Invalid delivery-manifest.json: ${error.message}`); }
  if (manifest && (manifest.hubs?.length !== context.hubs.length || manifest.uniqueBriefs?.length !== context.briefs.length)) issues.push('Delivery manifest inventory does not match config.');
  return { ok: issues.length === 0, mode: 'verify', siteDir: context.siteDir, hubs: context.hubs.length, briefs: context.briefs.length, issues };
}

function deployNetlify(context, dryRun) {
  const envName = context.config.delivery?.netlify?.siteIdEnv || 'NETLIFY_SITE_ID';
  if (dryRun) return { provider: 'netlify', dryRun: true, siteIdEnv: envName };
  const siteId = process.env[envName];
  if (!siteId) throw new Error(`Netlify requires environment variable ${envName}.`);
  if (!process.env.NETLIFY_AUTH_TOKEN) throw new Error('Netlify requires NETLIFY_AUTH_TOKEN.');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = runProcess(npx, ['--yes', 'netlify-cli', 'deploy', '--dir', context.siteDir, '--prod', '--site', siteId], context.project.root, false);
  if (!result.ok) throw new Error(`Netlify deploy failed: ${result.stderr || result.stdout || result.error?.message}`);
  const url = (result.stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.netlify\.app\/?/g) || []).at(-1) || null;
  return { provider: 'netlify', dryRun: false, url, output: result.stdout.trim() };
}

function git(context, args, cwd = context.project.root, inherit = false) {
  const result = runProcess('git', args, cwd, inherit);
  if (!result.ok) throw new Error(`git ${args[0]} failed: ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout.trim();
}

function deployGithubPages(context, dryRun) {
  const remote = git(context, ['remote', 'get-url', 'origin']);
  const branch = context.config.delivery?.githubPages?.branch || 'gh-pages';
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('Invalid GitHub Pages branch.');
  if (dryRun) return { provider: 'github-pages', dryRun: true, branch, remote };
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'playable-pages-publish-'));
  try {
    for (const entry of walk(context.siteDir)) {
      if (entry.relative === SITE_OWNER) continue;
      const target = path.join(staging, ...entry.relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(entry.file, target);
    }
    git(context, ['init'], staging);
    git(context, ['config', 'user.name', 'Playable Delivery'], staging);
    git(context, ['config', 'user.email', 'playable-delivery@users.noreply.github.com'], staging);
    git(context, ['checkout', '-B', branch], staging);
    git(context, ['add', '-A'], staging);
    git(context, ['commit', '-m', `Deploy playable hubs ${new Date().toISOString()}`], staging);
    git(context, ['push', '--force', remote, `${branch}:${branch}`], staging, true);
    const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    const url = match ? `https://${match[1]}.github.io/${match[2]}/` : null;
    return { provider: 'github-pages', dryRun: false, branch, url };
  } finally {
    try {
      for (const entry of walk(staging)) if (fs.statSync(entry.file).isFile()) fs.chmodSync(entry.file, 0o666);
      fs.rmSync(staging, { recursive: true, force: true });
    } catch { /* Temp cleanup failure does not change a completed remote publish. */ }
  }
}

function deploy(context, dryRun) {
  if (context.provider === 'none') return { provider: 'none', dryRun: true };
  return context.provider === 'netlify' ? deployNetlify(context, dryRun) : deployGithubPages(context, dryRun);
}

function execute(options) {
  if (options.command === 'init') return init(options);
  const context = loadDelivery(options);
  if (options.command === 'verify') return verifyContext(context);
  if (options.command === 'deploy') {
    const verification = verifyContext(context);
    if (!verification.ok) throw new Error(verification.issues.join('\n'));
    return { ok: true, mode: 'deploy', verification, deployment: deploy(context, options.dryRun) };
  }
  if (!options.skipBuild) buildBriefs(context);
  const packaged = packageSite(context);
  const verification = verifyContext(context);
  if (!verification.ok) throw new Error(verification.issues.join('\n'));
  const deployment = options.command === 'run' ? deploy(context, options.dryRun) : null;
  return { ok: true, mode: options.command, jobs: context.jobs, briefs: context.briefs.map(item => item.id), hubs: context.hubs.map(item => item.id), siteDir: context.siteDir, changedFiles: packaged.changedFiles, deployment };
}

function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(`[delivery] ${error.message}`); return 1; }
  if (options.help) { console.log(USE); return 0; }
  try {
    const result = execute(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (!result.ok) for (const issue of result.issues || []) console.error(`[delivery] ${issue}`);
    else console.log(`[delivery] ${result.mode} passed${result.siteDir ? `: ${result.siteDir}` : ''}.`);
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[delivery] ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { parseArgs, init, loadDelivery, packageSite, verifyContext, execute, main, landingHtml };
