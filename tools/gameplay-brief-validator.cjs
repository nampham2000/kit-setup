'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadMergedConfigFromFile } = require('../packages/extensions/json-scriptable-inspector/config-fragments.cjs');

const RESERVED_BUNDLES = new Set(['main', 'internal', 'resources', 'start-scene']);
const NAME = /^[a-z0-9][a-z0-9_-]*$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function validateGameplayBriefs(projectRoot = process.cwd()) {
  const root = fs.realpathSync(projectRoot);
  const configPath = path.join(root, 'assets', 'resources', 'playable-config.json');
  const config = loadMergedConfigFromFile(configPath).merged;
  const gameplay = config.gameplay;
  const issues = [];
  const briefs = gameplay?.briefs;
  const activeBundle = gameplay?.activeBundle;

  if (!briefs || typeof briefs !== 'object' || Array.isArray(briefs) || Object.keys(briefs).length === 0) {
    issues.push('playable-config.json must define gameplay.briefs.');
  }
  const names = briefs && typeof briefs === 'object' && !Array.isArray(briefs) ? Object.keys(briefs).sort() : [];
  if (typeof activeBundle !== 'string' || !names.includes(activeBundle)) {
    issues.push(`gameplay.activeBundle must select one configured brief; received ${String(activeBundle)}.`);
  }

  for (const name of names) {
    if (!NAME.test(name) || RESERVED_BUNDLES.has(name)) {
      issues.push(`Invalid gameplay brief name: ${name}.`);
      continue;
    }
    const bundleDir = path.join(root, 'assets', 'gameplay-bundles', name);
    const metaPath = `${bundleDir}.meta`;
    const buildPath = path.join(root, 'configs', `${name}.json`);
    if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
      issues.push(`Missing gameplay bundle directory: assets/gameplay-bundles/${name}.`);
    }
    if (!fs.existsSync(metaPath)) {
      issues.push(`Missing Cocos bundle metadata: assets/gameplay-bundles/${name}.meta.`);
    } else {
      const meta = readJson(metaPath);
      if (meta?.userData?.isBundle !== true || meta?.userData?.bundleName !== name) {
        issues.push(`assets/gameplay-bundles/${name}.meta must declare isBundle=true and bundleName=${name}.`);
      }
    }
    if (!fs.existsSync(buildPath)) {
      issues.push(`Missing build config: configs/${name}.json.`);
      continue;
    }
    const build = readJson(buildPath);
    if (build?.packages?.['gameplay-briefs']?.activeBundle !== name) {
      issues.push(`configs/${name}.json must stamp packages.gameplay-briefs.activeBundle=${name}.`);
    }
    const bundles = Array.isArray(build.bundleConfigs) ? build.bundleConfigs : [];
    const expectedRoot = `db://assets/gameplay-bundles/${name}`;
    const gameplayBundles = bundles.filter(item => String(item?.root ?? '').startsWith('db://assets/gameplay-bundles/'));
    if (!bundles.some(item => item?.root === 'db://assets/resources' && item?.name === 'resources')) {
      issues.push(`configs/${name}.json must include the resources bundle.`);
    }
    if (gameplayBundles.length !== 1 || gameplayBundles[0]?.root !== expectedRoot || gameplayBundles[0]?.name !== name) {
      issues.push(`configs/${name}.json must include only ${expectedRoot} as its gameplay bundle.`);
    }
  }

  return { ok: issues.length === 0, activeBundle, briefs: names, issues };
}

function parseArgs(argv) {
  let project = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') project = argv[++i];
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: gameplay-brief-validator [--project <dir>] [--json]');
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!project) throw new Error('Missing value for --project.');
  return { project, json };
}

module.exports = { validateGameplayBriefs };

if (require.main === module) {
  try {
    const { project, json } = parseArgs(process.argv.slice(2));
    const result = validateGameplayBriefs(project);
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok) console.log(`[gameplay-briefs] ${result.briefs.length} brief(s); preview=${result.activeBundle}.`);
    else result.issues.forEach(issue => console.error(`[gameplay-briefs] ${issue}`));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[gameplay-briefs] ${error.message}`);
    process.exitCode = 1;
  }
}
