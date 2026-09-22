'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { execute } = require('./delivery-pipeline/delivery-cli.cjs');

const cli = path.join(__dirname, 'delivery-pipeline.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-project-'));
  fs.mkdirSync(path.join(root, 'assets', 'resources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'delivery-fixture' }));
  fs.writeFileSync(path.join(root, 'assets', 'resources', 'playable-config.json'), JSON.stringify({ gameplay: { briefs: { alpha: { hubLabel: 'Alpha' }, beta: { hubLabel: 'Beta' } } } }));
  for (const id of ['alpha', 'beta']) {
    const buildDir = path.join(root, 'build', id);
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'configs', `${id}.json`), JSON.stringify({ name: id, buildPath: `project://build/${id}`, packages: { 'gameplay-briefs': { activeBundle: id } } }));
    fs.writeFileSync(path.join(buildDir, `${id}_common_min.html`), `<html>${id}</html>`);
  }
  fs.writeFileSync(path.join(root, 'configs', 'playable-delivery.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: 2,
    hubs: [
      { id: 'review-a', title: 'Review A', briefs: ['alpha', 'beta'] },
      { id: 'review-b', title: 'Review B', briefs: ['beta'] },
    ],
    delivery: { provider: 'none', siteDir: '.delivery/site' },
  }));
  return root;
}

test('prepare packages multiple hubs from one unique brief inventory and verifies hashes', () => {
  const root = fixture();
  try {
    const result = execute({ command: 'prepare', project: root, config: 'configs/playable-delivery.json', skipBuild: true, dryRun: false, force: false, json: false });
    assert.deepEqual(result.briefs, ['alpha', 'beta']);
    assert.deepEqual(result.hubs, ['review-a', 'review-b']);
    assert.equal(fs.existsSync(path.join(root, '.delivery', 'site', 'hubs', 'review-a', 'games', 'alpha.html')), true);
    assert.equal(fs.existsSync(path.join(root, '.delivery', 'site', 'hubs', 'review-b', 'games', 'beta.html')), true);
    const verified = execute({ command: 'verify', project: root, config: 'configs/playable-delivery.json', dryRun: false, force: false, json: false });
    assert.equal(verified.ok, true);
    const before = fs.statSync(path.join(root, '.delivery', 'site', 'delivery-manifest.json')).mtimeMs;
    const again = execute({ command: 'prepare', project: root, config: 'configs/playable-delivery.json', skipBuild: true, dryRun: false, force: false, json: false });
    assert.equal(again.changedFiles, 0);
    assert.equal(fs.statSync(path.join(root, '.delivery', 'site', 'delivery-manifest.json')).mtimeMs, before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verify detects staged delivery tampering', () => {
  const root = fixture();
  try {
    execute({ command: 'prepare', project: root, config: 'configs/playable-delivery.json', skipBuild: true, dryRun: false, force: false, json: false });
    fs.appendFileSync(path.join(root, '.delivery', 'site', 'hubs', 'review-a', 'games', 'alpha.html'), 'tampered');
    const result = execute({ command: 'verify', project: root, config: 'configs/playable-delivery.json', dryRun: false, force: false, json: false });
    assert.equal(result.ok, false);
    assert.match(result.issues.join('\n'), /hash mismatch/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('init discovers current briefs and does not overwrite existing setup by default', () => {
  const root = fixture();
  try {
    fs.unlinkSync(path.join(root, 'configs', 'playable-delivery.json'));
    const first = execute({ command: 'init', project: root, config: 'configs/playable-delivery.json', dryRun: false, force: false, json: false });
    assert.equal(first.changedFiles, 4);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'configs', 'playable-delivery.json'), 'utf8'));
    assert.deepEqual(config.hubs[0].briefs, ['alpha', 'beta']);
    assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\/\.delivery\/$/m);
    fs.writeFileSync(path.join(root, 'PLAYABLE_DELIVERY.md'), 'custom\n');
    const second = execute({ command: 'init', project: root, config: 'configs/playable-delivery.json', dryRun: false, force: false, json: false });
    assert.equal(second.changedFiles, 0);
    assert.equal(fs.readFileSync(path.join(root, 'PLAYABLE_DELIVERY.md'), 'utf8'), 'custom\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('help and invalid config are fail-closed before output mutation', () => {
  const root = fixture();
  try {
    const help = spawnSync(process.execPath, [cli, '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Playable delivery pipeline/);
    const configFile = path.join(root, 'configs', 'playable-delivery.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.hubs[0].briefs = ['missing'];
    fs.writeFileSync(configFile, JSON.stringify(config));
    assert.throws(() => execute({ command: 'prepare', project: root, config: 'configs/playable-delivery.json', skipBuild: true, dryRun: false, force: false, json: false }), /Unknown gameplay brief/);
    assert.equal(fs.existsSync(path.join(root, '.delivery')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('workflow separates Cocos build from hosted provider publishing', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'template-config', 'github-actions', 'playable-delivery.yml'), 'utf8');
  assert.match(workflow, /runs-on: \[self-hosted, windows\]/);
  assert.match(workflow, /npm run delivery:prepare/);
  assert.match(workflow, /NETLIFY_AUTH_TOKEN: \$\{\{ secrets\.NETLIFY_AUTH_TOKEN \}\}/);
  assert.match(workflow, /uses: actions\/deploy-pages@v4/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  const template = require('../template-config/package.scripts_TEMPLATE.json');
  assert.equal(template.scripts.delivery, 'node playable-shared-kit/tools/delivery-pipeline.cjs run');
  assert.equal(template.scripts['delivery:prepare'], 'node playable-shared-kit/tools/delivery-pipeline.cjs prepare');
});
