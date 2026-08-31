'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildFfmpegArgs,
  commitOptimizedAsset,
  fileToDbUrl,
  getQualityConfig,
  parseArgs,
  targetPathFor,
} = require('./audio-optimizer.cjs');

test('portable audio defaults are MP3 quality 30 with original channels', () => {
  const options = parseArgs([]);
  assert.equal(options.format, 'mp3');
  assert.equal(options.quality, 30);
  assert.equal(options.channelMode, 'preserve');
  assert.equal(options.skipIfLarger, false);
  const quality = getQualityConfig(options.quality, options.channelMode, options.sampleRate, options.bitrate);
  assert.equal(quality.mp3Bitrate, '32k');
  assert.equal(quality.sampleRate, 22050);
  assert.equal(quality.channelMode, 'preserve');
});

test('preserve mode omits -ac while explicit mono and stereo remain opt-in', () => {
  const base = { bitrate: null };
  const preserve = buildFfmpegArgs('in.wav', 'out.mp3', '.mp3', base, getQualityConfig(30, 'preserve', null, null));
  assert.equal(preserve.includes('-ac'), false);
  assert.deepEqual(preserve.slice(-5), ['libmp3lame', '-b:a', '32k', '-map_metadata', '-1', 'out.mp3'].slice(-5));

  const mono = buildFfmpegArgs('in.wav', 'out.mp3', '.mp3', base, getQualityConfig(30, 'mono', null, null));
  assert.deepEqual(mono.slice(mono.indexOf('-ac'), mono.indexOf('-ac') + 2), ['-ac', '1']);
  const stereo = buildFfmpegArgs('in.wav', 'out.mp3', '.mp3', base, getQualityConfig(30, 'stereo', null, null));
  assert.deepEqual(stereo.slice(stereo.indexOf('-ac'), stereo.indexOf('-ac') + 2), ['-ac', '2']);
});

test('Cocos URL mapping and target extension are portable', () => {
  const project = path.resolve('C:/work/game');
  const source = path.join(project, 'assets', 'resources', 'sound', 'tap.wav');
  assert.equal(fileToDbUrl(source, project), 'db://assets/resources/sound/tap.wav');
  assert.equal(targetPathFor(source, { format: 'mp3', outputDir: '' }), path.join(project, 'assets', 'resources', 'sound', 'tap.mp3'));
  assert.equal(fileToDbUrl(path.resolve('C:/outside/tap.wav'), project), '');
});

test('legacy force channel flags are unambiguous', () => {
  assert.equal(parseArgs(['--mono']).channelMode, 'mono');
  assert.equal(parseArgs(['--stereo']).channelMode, 'stereo');
  assert.equal(parseArgs(['--stereo', '--preserve-channels']).channelMode, 'preserve');
});

test('extension changes use an Asset DB move and preserve UUID without touching meta directly', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-policy-test-'));
  const soundDir = path.join(project, 'assets', 'sound');
  fs.mkdirSync(soundDir, { recursive: true });
  const source = path.join(soundDir, 'tap.wav');
  const target = path.join(soundDir, 'tap.mp3');
  const encoded = path.join(project, 'encoded.mp3');
  fs.writeFileSync(source, 'original');
  fs.writeFileSync(encoded, 'mp3-data');
  const uuid = 'stable-audio-uuid';
  const calls = [];
  const client = {
    async call(name, args) {
      calls.push([name, args]);
      if (name === 'project_query_asset_uuid') return { structuredContent: { success: true, data: { uuid } } };
      if (name === 'project_move_asset') {
        fs.renameSync(source, target);
        return { structuredContent: { success: true, data: { uuid, url: args.target } } };
      }
      if (name === 'project_reimport_asset') return { structuredContent: { success: true, data: { url: args.url } } };
      throw new Error(`unexpected tool ${name}`);
    },
  };
  try {
    const report = await commitOptimizedAsset(source, target, encoded, {
      project,
      outputDir: '',
      updateMeta: true,
      backup: false,
      assetDbClient: client,
    });
    assert.equal(report.uuidPreserved, true);
    assert.equal(report.uuid, uuid);
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'mp3-data');
    assert.deepEqual(calls.map((entry) => entry[0]), [
      'project_query_asset_uuid',
      'project_move_asset',
      'project_reimport_asset',
      'project_query_asset_uuid',
    ]);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
