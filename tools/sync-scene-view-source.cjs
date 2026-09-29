#!/usr/bin/env node
'use strict';

/**
 * sync-scene-view-source.cjs
 *
 * Pulls the Scene view sources from their own repository into
 * `packages/scene-view/`, one way only.
 *
 * The tool is developed in a standalone repo so it can stay independent of this
 * kit, which means the copy here is a mirror and mirrors drift. This makes the
 * drift visible and fixable with one command instead of leaving two copies to
 * diverge quietly.
 *
 * One way on purpose: edits belong upstream. Anything changed only here is
 * reported and then overwritten, so a local fix cannot silently become the
 * version everyone else gets.
 *
 *   node tools/sync-scene-view-source.cjs                # pull and apply
 *   node tools/sync-scene-view-source.cjs --check        # report drift, change nothing
 *   node tools/sync-scene-view-source.cjs <path-or-url>  # use another source
 *
 * Exit code 1 on drift under --check, so it can gate a commit or CI.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_SOURCE = 'https://github.com/nampham2000/scene-view-kit.git';
const KIT_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(KIT_ROOT, 'packages', 'scene-view');
const SENTINEL = 'SceneViewDebug.ts';

/** Files worth mirroring. Anything else in the source repo stays there. */
function isTracked(name) {
  return name.endsWith('.ts') || name.endsWith('.md');
}

function isGitUrl(value) {
  return /^https?:\/\//i.test(value) || /^git@/i.test(value) || /\.git$/i.test(value);
}

/** Refuse to touch anything outside the directory we own. */
function assertInside(candidate, root, label) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return resolved;
  throw new Error(`[scene-view] refusing ${label} outside ${root}: ${resolved}`);
}

function cloneToTemp(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-view-src-'));
  console.log(`[scene-view] cloning ${url}`);
  const result = spawnSync('git', ['clone', '--depth', '1', url, dir], { stdio: 'pipe', encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`[scene-view] git clone failed: ${result.error?.message || result.stderr.trim()}`);
  }
  return dir;
}

/** The sources may sit at the repo root or under assets/scene-view. */
function locateSources(root) {
  const candidates = [path.join(root, 'assets', 'scene-view'), root];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, SENTINEL))) return candidate;
  }
  throw new Error(`[scene-view] no ${SENTINEL} under ${root}`);
}

function readDir(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const files = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!isTracked(name)) continue;
    files.set(name, fs.readFileSync(path.join(dir, name)));
  }
  return files;
}

function diff(source, target) {
  const added = [];
  const changed = [];
  const removed = [];

  for (const [name, bytes] of source) {
    if (!target.has(name)) added.push(name);
    else if (!bytes.equals(target.get(name))) changed.push(name);
  }
  for (const name of target.keys()) {
    if (!source.has(name)) removed.push(name);
  }
  return { added, changed, removed };
}

function apply(sourceDir, source, result) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  for (const name of [...result.added, ...result.changed]) {
    fs.writeFileSync(assertInside(path.join(TARGET_DIR, name), TARGET_DIR, 'write'), source.get(name));
  }
  for (const name of result.removed) {
    fs.rmSync(assertInside(path.join(TARGET_DIR, name), TARGET_DIR, 'delete'), { force: true });
  }
}

function report(result) {
  for (const name of result.added) console.log(`  [add]    ${name}`);
  for (const name of result.changed) console.log(`  [update] ${name}`);
  for (const name of result.removed) console.log(`  [remove] ${name}`);
}

function main(argv) {
  const check = argv.includes('--check');
  const requested = argv.find(arg => !arg.startsWith('--'))
    || process.env.SCENE_VIEW_SOURCE
    || DEFAULT_SOURCE;

  let clone = null;
  try {
    const root = isGitUrl(requested) ? (clone = cloneToTemp(requested)) : path.resolve(requested);
    const sourceDir = locateSources(root);
    const source = readDir(sourceDir);
    if (!source.size) throw new Error(`[scene-view] nothing to mirror from ${sourceDir}`);

    const target = readDir(TARGET_DIR);
    const result = diff(source, target);
    const total = result.added.length + result.changed.length + result.removed.length;

    console.log(`[scene-view] source: ${isGitUrl(requested) ? requested : sourceDir}`);
    if (!total) {
      console.log('[scene-view] packages/scene-view is already in sync');
      return 0;
    }

    report(result);
    if (check) {
      console.log(`[scene-view] ${total} file(s) out of sync - run without --check to update`);
      return 1;
    }

    apply(sourceDir, source, result);
    console.log(`[scene-view] updated packages/scene-view (${total} file(s))`);
    console.log('[scene-view] run sync-shared-kit to push it into a project');
    return 0;
  } finally {
    if (clone) fs.rmSync(clone, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { diff, locateSources, isGitUrl, TARGET_DIR };
