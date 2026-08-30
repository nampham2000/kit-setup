'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EVIDENCE_KIND,
  EVIDENCE_SCHEMA_VERSION,
  DEFAULT_RESUME_PACKET,
  RESUME_PACKET_KIND,
  REQUIRED_SCRIPTS,
  atomicWriteJson,
  buildResumePacket,
  currentTargetHashes,
  evaluateFidelity,
  hashFile,
  initCorePort,
  parseArgs,
  persistStaticScaffoldReceipt,
  resumeCorePort,
  resolveContained,
  runRequiredGates,
  scaffoldCorePort,
  validateManifest,
  verifyCorePort,
} = require('./core-gameplay-port.cjs');

function projectFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-port-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unity = path.join(root, 'Unity');
  const cocos = path.join(root, 'Cocos');
  fs.mkdirSync(path.join(unity, 'Assets', 'Game'), { recursive: true });
  fs.mkdirSync(path.join(unity, 'Assets', 'Scenes'), { recursive: true });
  fs.mkdirSync(path.join(unity, 'ProjectSettings'), { recursive: true });
  fs.writeFileSync(path.join(unity, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.3.1f1\n');
  fs.writeFileSync(path.join(unity, 'Assets', 'Game', 'Gameplay.cs'), 'class Gameplay {}\n');
  fs.writeFileSync(path.join(unity, 'Assets', 'Scenes', 'Gameplay.unity'), '%YAML 1.1\n');
  fs.mkdirSync(path.join(cocos, 'assets', 'script'), { recursive: true });
  fs.mkdirSync(path.join(cocos, 'assets', 'resources'), { recursive: true });
  fs.mkdirSync(path.join(cocos, 'build', 'common'), { recursive: true });
  fs.writeFileSync(path.join(cocos, 'package.json'), JSON.stringify({
    scripts: Object.fromEntries(REQUIRED_SCRIPTS.map(item => [item.script, 'node -e "process.exit(0)"'])),
  }));
  fs.writeFileSync(path.join(cocos, 'assets', 'Gameplay.scene'), '[]');
  fs.writeFileSync(path.join(cocos, 'assets', 'script', 'Gameplay.ts'), 'export class Gameplay {}\n');
  fs.writeFileSync(path.join(cocos, 'assets', 'resources', 'playable-config.json'), '{}\n');
  fs.writeFileSync(path.join(cocos, 'build', 'common', 'index.html'), '<canvas></canvas>');
  return { root, unity, cocos };
}

function writeCheckpointEvidence(fixture, manifest, checkpoint, method = 'runtime') {
  const relative = `.ai/port/evidence/${checkpoint.id}.json`;
  const file = path.join(fixture.cocos, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: EVIDENCE_KIND,
    ok: true,
    checkpoint: checkpoint.id,
    briefId: manifest.source.briefId,
    stateFingerprint: manifest.source.stateFingerprint,
    method,
    observations: {
      source: `Unity observation for ${checkpoint.id}`,
      target: `Cocos runtime observation for ${checkpoint.id}`,
    },
    targetHashes: currentTargetHashes(fixture.cocos, checkpoint.targetEvidence),
  }));
  return relative;
}

function fakeBrief() {
  const weights = [
    ['input-response', 15], ['core-rules-state', 20], ['interaction-motion', 15],
    ['spawn-timing', 10], ['win-lose-restart', 15], ['camera-layout', 5],
    ['animation-vfx-feedback', 10], ['audio-feedback', 5], ['playable-lifecycle-cta', 5],
  ];
  return {
    briefId: 'brf:test', receiptId: 'rcp:test',
    project: { projectFingerprint: 'project', stateFingerprint: 'state' },
    decision: { implementationAllowed: true, coreEntryReady: true, hardBlockerCount: 0 },
    features: [{ id: 'input', evidence: ['Assets/Game/Gameplay.cs'] }],
    coreGameplay: {
      entry: { primary: 'Assets/Scenes/Gameplay.unity' },
      closure: { pathCount: 3, includedCount: 2, adapterCount: 1 },
      coreScripts: ['Assets/Game/Gameplay.cs'],
      adapters: [{ id: 'online-services', disposition: 'replace', count: 1 }],
      excluded: [{ id: 'commerce', disposition: 'defer', count: 2 }],
      acceptance: {
        minimumFidelity: 80, targetFidelity: 90,
        mandatory: ['input-response', 'core-rules-state', 'win-lose-restart'],
        weights,
      },
    },
  };
}

function freshReceipt() {
  return { receipt: { receiptId: 'rcp:test', briefId: 'brf:test', stateFingerprint: 'state' } };
}

test('init dry-run is write-free and real init writes a compact manifest inside Cocos root', async t => {
  const fixture = projectFixture(t);
  const dependencies = { runPreflight: async () => ({ brief: fakeBrief() }) };
  const dry = await initCorePort({
    unityProject: fixture.unity, cocosProject: fixture.cocos, provider: 'static', dryRun: true,
  }, dependencies);
  assert.equal(dry.ok, true);
  assert.equal(fs.existsSync(path.join(fixture.cocos, '.ai')), false);
  const created = await initCorePort({
    unityProject: fixture.unity, cocosProject: fixture.cocos, provider: 'static',
  }, dependencies);
  assert.equal(created.manifest, '.ai/port/core-gameplay.json');
  const manifestFile = path.join(fixture.cocos, created.manifest);
  assert.equal(fs.existsSync(manifestFile), true);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.checkpoints.length, 9);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.delivery.targetEntryScene, 'assets/Gameplay.scene');
  assert.equal(manifest.checkpoints.find(item => item.id === 'input-response').sourceEvidence[0], 'Assets/Game/Gameplay.cs');
  const regressionFile = path.join(fixture.cocos, 'tools', 'port-regressions.json');
  assert.equal(fs.existsSync(regressionFile), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(regressionFile, 'utf8')).requiredRisks, ['input-response', 'level-lifecycle']);
});

test('fidelity score counts only checkpoints grounded by source, target and checkpoint JSON', t => {
  const fixture = projectFixture(t);
  const target = 'assets/script/Gameplay.ts';
  const evidenceDir = path.join(fixture.cocos, '.ai', 'port', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const manifest = {
    source: { briefId: 'brf:test', stateFingerprint: 'state' },
    delivery: { minimumFidelity: 80, targetFidelity: 90 },
    checkpoints: fakeBrief().coreGameplay.acceptance.weights.map(([id, weight]) => ({
      id, weight,
      mandatory: fakeBrief().coreGameplay.acceptance.mandatory.includes(id),
      status: 'pass',
      sourceEvidence: id === 'playable-lifecycle-cta' ? [] : ['Assets/Game/Gameplay.cs'],
      targetEvidence: [target], verificationEvidence: [],
    })),
  };
  for (const checkpoint of manifest.checkpoints) {
    checkpoint.verificationEvidence = [writeCheckpointEvidence(fixture, manifest, checkpoint)];
  }
  const accepted = evaluateFidelity(manifest, fixture.unity, fixture.cocos);
  assert.equal(accepted.score, 100);
  assert.equal(accepted.mandatoryPassed, true);

  manifest.checkpoints.find(item => item.id === 'input-response').verificationEvidence = [];
  const missing = evaluateFidelity(manifest, fixture.unity, fixture.cocos);
  assert.equal(missing.score, 85);
  assert.equal(missing.mandatoryPassed, false);
});

test('verify accepts only a fresh matching receipt, all runtime gates, artifacts and >=80 fidelity', async t => {
  const fixture = projectFixture(t);
  await initCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
  });
  const manifestFile = path.join(fixture.cocos, '.ai', 'port', 'core-gameplay.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.mkdirSync(path.join(fixture.cocos, '.ai', 'port', 'evidence'), { recursive: true });
  for (const checkpoint of manifest.checkpoints) {
    checkpoint.status = 'pass';
    if (checkpoint.id !== 'playable-lifecycle-cta') checkpoint.sourceEvidence = ['Assets/Game/Gameplay.cs'];
    checkpoint.targetEvidence = ['assets/script/Gameplay.ts'];
    checkpoint.verificationEvidence = [writeCheckpointEvidence(fixture, manifest, checkpoint)];
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const result = verifyCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos, runGates: true }, {
    assertPreflight: () => ({ receipt: {
      receiptId: 'rcp:test', briefId: 'brf:test', stateFingerprint: 'state',
    } }),
    runGates: () => REQUIRED_SCRIPTS.map(item => ({ id: item.id, ok: true })),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.runnable.passed, true);
  assert.equal(result.fidelity.score, 100);
});

test('manifest validation pins the exact 80/90 rubric and evidence paths', async t => {
  const fixture = projectFixture(t);
  await initCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
  });
  const manifestFile = path.join(fixture.cocos, '.ai', 'port', 'core-gameplay.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(validateManifest(fixture.cocos, manifestFile).delivery.minimumFidelity, 80);

  manifest.checkpoints[0].weight = 100;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => validateManifest(fixture.cocos, manifestFile),
    error => error.code === 'CORE_PORT_MANIFEST_INVALID' && /Checkpoint/.test(error.message));

  manifest.checkpoints[0].weight = 15;
  manifest.checkpoints[0].verificationEvidence = ['assets/not-evidence.json'];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => validateManifest(fixture.cocos, manifestFile),
    error => error.code === 'CORE_PORT_MANIFEST_INVALID' && /Verification evidence/.test(error.message));
});

test('checkpoint evidence is stale after target mutation and visual-only cannot satisfy mandatory behavior', async t => {
  const fixture = projectFixture(t);
  await initCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
  });
  const manifestFile = path.join(fixture.cocos, '.ai', 'port', 'core-gameplay.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const checkpoint = manifest.checkpoints.find(item => item.id === 'input-response');
  checkpoint.status = 'pass';
  checkpoint.sourceEvidence = ['Assets/Game/Gameplay.cs'];
  checkpoint.targetEvidence = ['assets/script/Gameplay.ts'];
  checkpoint.verificationEvidence = [writeCheckpointEvidence(fixture, manifest, checkpoint, 'visual')];
  assert.equal(evaluateFidelity(manifest, fixture.unity, fixture.cocos).items[0].grounded, false);

  checkpoint.verificationEvidence = [writeCheckpointEvidence(fixture, manifest, checkpoint, 'runtime')];
  assert.equal(evaluateFidelity(manifest, fixture.unity, fixture.cocos).items[0].grounded, true);
  fs.appendFileSync(path.join(fixture.cocos, 'assets', 'script', 'Gameplay.ts'), '// changed\n');
  assert.equal(evaluateFidelity(manifest, fixture.unity, fixture.cocos).items[0].grounded, false);
  const evidenceFile = path.join(fixture.cocos, ...checkpoint.verificationEvidence[0].split('/'));
  const malformed = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  malformed.targetHashes = [null];
  fs.writeFileSync(evidenceFile, JSON.stringify(malformed));
  assert.doesNotThrow(() => evaluateFidelity(manifest, fixture.unity, fixture.cocos));
});

test('atomic manifest CAS preserves a concurrent edit', t => {
  const fixture = projectFixture(t);
  const file = path.join(fixture.cocos, '.ai', 'port', 'race.json');
  atomicWriteJson(fixture.cocos, file, { generation: 1 });
  const expectedHash = hashFile(file);
  fs.writeFileSync(file, '{"generation":"external"}\n');
  assert.throws(() => atomicWriteJson(fixture.cocos, file, { generation: 2 }, { force: true, expectedHash }),
    error => error.code === 'CORE_PORT_MANIFEST_CONCURRENT');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).generation, 'external');
  atomicWriteJson(fixture.cocos, file, { generation: 2 }, { force: true, expectedHash: hashFile(file) });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).generation, 2);
});

test('atomic manifest publish supports Windows filesystems without hard links', { skip: process.platform !== 'win32' }, t => {
  const fixture = projectFixture(t);
  const file = path.join(fixture.cocos, '.ai', 'port', 'exfat.json');
  t.mock.method(fs, 'linkSync', () => { throw Object.assign(new Error('unsupported hard link'), { code: 'EISDIR' }); });
  atomicWriteJson(fixture.cocos, file, { generation: 1 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).generation, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['exfat.json']);
});

test('scaffold defaults to static provider and resume supports explicit packet persistence', () => {
  assert.equal(parseArgs(['scaffold', '--unity-project', '.']).provider, 'static');
  assert.equal(parseArgs(['scaffold', '--unity-project', '.', '--provider', 'unity-mcp']).provider, 'unity-mcp');
  assert.equal(parseArgs(['resume', '--unity-project', '.', '--write']).write, true);
});

test('static scaffold creates scene wiring and a bounded resume packet for interrupted agents', async t => {
  const fixture = projectFixture(t);
  fs.unlinkSync(path.join(fixture.cocos, 'assets', 'Gameplay.scene'));
  const result = await scaffoldCorePort({
    command: 'scaffold', unityProject: fixture.unity, cocosProject: fixture.cocos, provider: 'static',
  }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
    assertPreflight: freshReceipt,
    runStaticScene(request) {
      fs.mkdirSync(path.dirname(request.outFile), { recursive: true });
      fs.mkdirSync(path.dirname(request.wiringFile), { recursive: true });
      fs.writeFileSync(request.outFile, '[]\n');
      fs.writeFileSync(request.wiringFile, JSON.stringify({
        stats: { nodes: 12, unresolvedTotal: 3, distinctTasks: 1 },
        unresolved: { scripts: [{}, {}, {}] },
        todo: [{ kind: 'script', label: 'Gameplay.cs', nodeCount: 3 }],
      }));
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.staticFirst.status, 'created');
  const packetFile = path.join(fixture.cocos, DEFAULT_RESUME_PACKET);
  assert.equal(fs.existsSync(packetFile), true);
  assert.ok(fs.statSync(packetFile).size < 64 * 1024);
  const packet = JSON.parse(fs.readFileSync(packetFile, 'utf8'));
  assert.equal(packet.kind, RESUME_PACKET_KIND);
  assert.equal(packet.staticFirst.status, 'complete');
  assert.equal(packet.staticFirst.wiring.todo.length, 1);
  assert.equal(JSON.stringify(packet).includes(fixture.unity), false);
  assert.equal(JSON.stringify(packet).includes(fixture.cocos), false);
});

test('resume digests port failures and refreshes the persisted handoff without raw CSV output', async t => {
  const fixture = projectFixture(t);
  await initCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
  });
  const wiringFile = path.join(fixture.cocos, '.ai', 'port', 'static-scaffold.wiring.json');
  fs.mkdirSync(path.dirname(wiringFile), { recursive: true });
  fs.writeFileSync(wiringFile, JSON.stringify({ stats: { nodes: 1, unresolvedTotal: 0, distinctTasks: 0 }, unresolved: {}, todo: [] }));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.cocos, '.ai', 'port', 'core-gameplay.json'), 'utf8'));
  persistStaticScaffoldReceipt(fixture.cocos, manifest);
  const reportFile = path.join(fixture.cocos, '.unity', 'port-report.csv');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, [
    'severity,code,prefab,source,message',
    'high,CUSTOM_SHADER_NOT_PORTED,Box,Box.mat,shader missing',
    'medium,SCRIPT_CLASS_UNRESOLVED,Box,Box.cs,script missing',
  ].join('\n'));
  const result = resumeCorePort({
    command: 'resume', unityProject: fixture.unity, cocosProject: fixture.cocos, write: true,
  }, { assertPreflight: freshReceipt });
  assert.equal(result.ok, false);
  assert.equal(result.packet.phase, 'repair-static-output');
  assert.equal(result.packet.reports.port.counts.high, 1);
  assert.equal(result.packet.reports.port.codes.length, 2);
  assert.equal(result.packet.nextActions.some(item => item.includes('CUSTOM_SHADER_NOT_PORTED')), true);
  assert.equal(result.packet.persisted, true);
  assert.ok(fs.statSync(path.join(fixture.cocos, DEFAULT_RESUME_PACKET)).size < 64 * 1024);
});

test('resume refuses to reuse static outputs after their source-bound hashes change', async t => {
  const fixture = projectFixture(t);
  await initCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
  });
  const wiringFile = path.join(fixture.cocos, '.ai', 'port', 'static-scaffold.wiring.json');
  fs.mkdirSync(path.dirname(wiringFile), { recursive: true });
  fs.writeFileSync(wiringFile, JSON.stringify({ stats: { nodes: 1, unresolvedTotal: 0, distinctTasks: 0 }, unresolved: {}, todo: [] }));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.cocos, '.ai', 'port', 'core-gameplay.json'), 'utf8'));
  persistStaticScaffoldReceipt(fixture.cocos, manifest);
  fs.appendFileSync(path.join(fixture.cocos, 'assets', 'Gameplay.scene'), '\nexternal edit');
  const packet = buildResumePacket({ unityProject: fixture.unity, cocosProject: fixture.cocos }, { assertPreflight: freshReceipt });
  assert.equal(packet.staticFirst.status, 'partial');
  assert.equal(packet.staticFirst.receipt.code, 'CORE_PORT_STATIC_OUTPUT_CHANGED');
  assert.equal(packet.nextActions.some(item => item.includes('không reuse mù')), true);
});

test('resume marks source stale instead of opening raw Unity files again', async t => {
  const fixture = projectFixture(t);
  await initCorePort({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    runPreflight: async () => ({ brief: fakeBrief() }),
  });
  const packet = buildResumePacket({ unityProject: fixture.unity, cocosProject: fixture.cocos }, {
    assertPreflight: () => { throw Object.assign(new Error('stale'), { code: 'PORT_PREFLIGHT_RECEIPT_STALE' }); },
  });
  assert.equal(packet.phase, 'stale-source');
  assert.equal(packet.sourceFresh.fresh, false);
  assert.equal(packet.nextActions[0].includes('--force'), true);
});

test('Windows publish fallback never overwrites a concurrent destination', { skip: process.platform !== 'win32' }, t => {
  const fixture = projectFixture(t);
  const file = path.join(fixture.cocos, '.ai', 'port', 'exfat-race.json');
  t.mock.method(fs, 'linkSync', () => {
    fs.writeFileSync(file, '{"generation":"external"}\n');
    throw Object.assign(new Error('unsupported hard link'), { code: 'EISDIR' });
  });
  assert.throws(() => atomicWriteJson(fixture.cocos, file, { generation: 1 }),
    error => error.code === 'CORE_PORT_MANIFEST_CONCURRENT');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).generation, 'external');
});

test('gate runner bounds failures and redacts project paths and credentials', t => {
  const fixture = projectFixture(t);
  const result = runRequiredGates(fixture.cocos, {
    timeoutMs: 5,
    redactRoots: [fixture.unity],
    spawnSync: () => ({
      status: null,
      stdout: `at ${fixture.cocos} token=supersecret {"api_key":"alsosecret"}`,
      stderr: `Unity ${fixture.unity}`,
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    }),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].timedOut, true);
  assert.equal(result[0].output.includes(fixture.cocos), false);
  assert.equal(result[0].output.includes(fixture.unity), false);
  assert.equal(result[0].output.includes('supersecret'), false);
  assert.equal(result[0].output.includes('alsosecret'), false);
});

test('gate runner invokes npm.cmd through cmd.exe on Windows without enabling shell mode', t => {
  const fixture = projectFixture(t);
  const invocations = [];
  const result = runRequiredGates(fixture.cocos, {
    platform: 'win32',
    comspec: 'C:\\Windows\\System32\\cmd.exe',
    spawnSync: (executable, args, options) => {
      invocations.push({ executable, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.length, REQUIRED_SCRIPTS.length);
  assert.equal(result.every(item => item.ok), true);
  assert.equal(invocations[0].executable, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocations[0].args, ['/d', '/s', '/c', 'npm.cmd', 'run', 'ai:verify']);
  assert.equal(invocations[0].options.shell, false);
});

test('manifest and evidence paths fail closed on traversal', t => {
  const fixture = projectFixture(t);
  assert.throws(() => resolveContained(fixture.cocos, '../outside.json'), error => error.code === 'CORE_PORT_PATH_ESCAPE');
  assert.throws(() => parseArgs(['init', '--unity-project', fixture.unity, '--provider', 'guess']),
    error => error.code === 'CORE_PORT_PROVIDER_INVALID');
});

test('manifest and evidence paths reject an intermediate symlink or junction', t => {
  const fixture = projectFixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'core-port-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const redirected = path.join(fixture.cocos, '.ai');
  fs.symlinkSync(outside, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveContained(fixture.cocos, '.ai/port/evidence/input.json'),
    error => error.code === 'CORE_PORT_PATH_ESCAPE');
});
