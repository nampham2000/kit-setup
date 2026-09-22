'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { create, verifyHub } = require('./game-hub/game-hub-cli.cjs');

const cli = path.join(__dirname, 'game-hub.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-hub-project-'));
  fs.mkdirSync(path.join(root, 'assets/resources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-playable' }));
  fs.writeFileSync(path.join(root, 'assets/resources/playable-config.json'), JSON.stringify({
    gameplay: {
      activeBundle: 'brief-a',
      briefs: {
        'brief-a': { hubLabel: 'Easy Brief' },
        'brief-b': {},
      },
    },
  }));
  for (const [id, buildName] of [['brief-a', 'A_Build'], ['brief-b', 'B_Build']]) {
    fs.writeFileSync(path.join(root, 'configs', `${id}.json`), JSON.stringify({
      name: buildName,
      buildPath: `project://build/${id}/`,
      packages: { 'gameplay-briefs': { activeBundle: id } },
    }));
    const output = path.join(root, 'build', id, 'common');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${buildName}_common_min.html`), `<html>${id}</html>`);
  }
  return root;
}

test('creates a portable ordered hub and verifies staged hashes', () => {
  const root = fixture();
  try {
    const result = create({ command: 'create', project: root, briefs: ['brief-b', 'brief-a'], all: false, build: false, force: false, json: false, title: 'QA Hub', out: 'review/hub' });
    assert.equal(result.ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'review/hub/manifest.json')));
    assert.deepEqual(manifest.games.map(game => game.id), ['brief-b', 'brief-a']);
    assert.deepEqual(manifest.games.map(game => game.label), ['Brief B', 'Easy Brief']);
    assert.equal(verifyHub(root, 'review/hub').ok, true);
    fs.appendFileSync(path.join(root, 'review/hub/games/brief-a.html'), 'tampered');
    assert.match(verifyHub(root, 'review/hub').issues.join('\n'), /hash mismatch|Staged game mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unchanged create is idempotent and preserves mtimes', async () => {
  const root = fixture();
  try {
    const options = { command: 'create', project: root, briefs: ['brief-a'], all: false, build: false, force: false, json: false, title: 'QA Hub', out: 'game-hubs/qa' };
    create(options);
    const file = path.join(root, 'game-hubs/qa/manifest.json');
    const before = fs.statSync(file).mtimeMs;
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = create(options);
    assert.equal(second.changedFiles, 0);
    assert.equal(fs.statSync(file).mtimeMs, before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('help and invalid arguments do not create project output', () => {
  const root = fixture();
  try {
    const help = spawnSync(process.execPath, [cli, '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--brief <id>/);
    const invalid = spawnSync(process.execPath, [cli, 'create', '--brief', 'brief-a', '--unknown'], { cwd: root, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.equal(fs.existsSync(path.join(root, 'game-hubs')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses unknown briefs and non-owned output without explicit force', () => {
  const root = fixture();
  try {
    assert.throws(() => create({ command: 'create', project: root, briefs: ['missing'], all: false, build: false, force: false, json: false }), /Unknown gameplay brief/);
    fs.mkdirSync(path.join(root, 'review'), { recursive: true });
    fs.writeFileSync(path.join(root, 'review/notes.txt'), 'keep');
    assert.throws(() => create({ command: 'create', project: root, briefs: ['brief-a'], all: false, build: false, force: false, json: false, out: 'review' }), /not an owned game hub/);
    assert.equal(fs.readFileSync(path.join(root, 'review/notes.txt'), 'utf8'), 'keep');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
