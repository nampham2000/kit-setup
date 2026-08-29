'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const createRuntimeComponentPorter = require('./runtime-component-porter');
const { compressUuid } = require('./core-utils');

const EXPECTED_ADAPTER_UUID = 'da442ca6-9109-44ca-9d06-c8e0f53e149d';
const EXPECTED_ADAPTER_CLASS_ID = 'da442ymkQlEyp0GyOD1PhSd';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-component-porter-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  return root;
}

function makePorter() {
  return createRuntimeComponentPorter({
    ensureDirectoryMetas() {},
    syncImportedMaterialLibraryCache() {},
  });
}

function makeReporter() {
  const events = [];
  return {
    events,
    high(code) { events.push({ severity: 'high', code }); },
    medium(code) { events.push({ severity: 'medium', code }); },
    low(code) { events.push({ severity: 'low', code }); },
  };
}

test('writes generated runtime adapters to canonical assets/script with stable UUID', () => {
  const root = makeProject();
  try {
    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    const target = path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts');
    const meta = JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8'));
    assert.equal(fs.existsSync(target), true);
    assert.equal(meta.uuid, EXPECTED_ADAPTER_UUID);
    assert.equal(compressUuid(meta.uuid), EXPECTED_ADAPTER_CLASS_ID);
    assert.equal(fs.existsSync(path.join(root, 'assets', 'scripts')), false);
    assert.deepEqual(reporter.events, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrates an exact legacy adapter and preserves the UUID used by existing prefabs', () => {
  const root = makeProject();
  try {
    const template = path.join(__dirname, 'runtime', 'UnitySpriteRendererColorAdapter.ts');
    const legacy = path.join(root, 'assets', 'scripts', 'UnitySpriteRendererColorAdapter.ts');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.copyFileSync(template, legacy);
    fs.writeFileSync(`${legacy}.meta`, `${JSON.stringify({
      ver: '4.0.24', importer: 'typescript', imported: true, uuid: EXPECTED_ADAPTER_UUID, files: [], subMetas: {}, userData: {},
    }, null, 2)}\n`);

    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    const target = path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts');
    const meta = JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8'));
    assert.equal(meta.uuid, EXPECTED_ADAPTER_UUID);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.existsSync(`${legacy}.meta`), false);
    assert.equal(reporter.events.some((event) => event.code === 'RUNTIME_SCRIPT_CANONICAL_PATH_MIGRATED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to overwrite a customized legacy adapter', () => {
  const root = makeProject();
  try {
    const legacy = path.join(root, 'assets', 'scripts', 'UnitySpriteRendererColorAdapter.ts');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '// project-specific adapter\n');

    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    assert.equal(fs.existsSync(path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts')), false);
    assert.equal(fs.readFileSync(legacy, 'utf8'), '// project-specific adapter\n');
    assert.equal(reporter.events.some((event) => event.code === 'RUNTIME_SCRIPT_LEGACY_CUSTOMIZED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to delete a legacy adapter when canonical and legacy UUIDs conflict', () => {
  const root = makeProject();
  try {
    const template = path.join(__dirname, 'runtime', 'UnitySpriteRendererColorAdapter.ts');
    const legacy = path.join(root, 'assets', 'scripts', 'UnitySpriteRendererColorAdapter.ts');
    const target = path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(template, legacy);
    fs.copyFileSync(template, target);
    fs.writeFileSync(`${legacy}.meta`, JSON.stringify({ uuid: EXPECTED_ADAPTER_UUID }));
    fs.writeFileSync(`${target}.meta`, JSON.stringify({ uuid: '11111111-2222-4333-8444-555555555555' }));

    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    assert.equal(fs.existsSync(legacy), true);
    assert.equal(fs.existsSync(`${legacy}.meta`), true);
    assert.equal(reporter.events.some((event) => event.code === 'RUNTIME_SCRIPT_UUID_CONFLICT'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
