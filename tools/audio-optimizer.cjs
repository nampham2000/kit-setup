#!/usr/bin/env node
'use strict';

/**
 * Cocos Playable Offline Audio Optimizer (FFmpeg)
 *
 * Features:
 * - Portable playable profile: MP3, quality 30%, source channel count preserved.
 * - Optimization quality presets: 20%, 30%, 40%, 50%, 60%, 70%, 80% (or custom 10..100).
 * - Explicit bitrate & sample rate overrides.
 * - Intelligent sample rate scaling with explicit preserve/mono/stereo channel policy.
 * - Cocos Asset DB rename/reimport transaction: preserves UUIDs without editing .meta files directly.
 * - Multi-tier offline FFmpeg resolver (CLI arg, env, local dependency folder, ffmpeg-static, system PATH, standard paths).
 * - Dry-run mode by default with detailed size reduction report; requires --write to apply.
 * - Skip if larger option to prevent accidental file bloating.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const os = require('os');
const { createClient, unwrapToolResult } = require('./texture-compression-policy.cjs');

const IS_WIN = process.platform === 'win32';
const HOME_DIR = os.homedir();
const SHARED_KIT_DIR = path.resolve(__dirname, '..');
const DEPENDENCY_DIR = path.join(__dirname, 'dependency');
const SUPPORTED_AUDIO_EXTS = new Set([
  '.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac', '.aiff', '.aif', '.wma'
]);

// Quality Presets Map
const QUALITY_PRESETS = {
  80: { label: '80% (High Quality)', mp3Bitrate: '128k', mp3Vbr: 2, oggQuality: 4, oggBitrate: '128k', sampleRate: 44100 },
  70: { label: '70% (Balanced BGM)', mp3Bitrate: '112k', mp3Vbr: 3, oggQuality: 3, oggBitrate: '112k', sampleRate: 44100 },
  60: { label: '60% (Playable Standard)', mp3Bitrate: '96k', mp3Vbr: 4, oggQuality: 2, oggBitrate: '96k', sampleRate: 32000 },
  50: { label: '50% (Compact SFX)', mp3Bitrate: '64k', mp3Vbr: 6, oggQuality: 1, oggBitrate: '64k', sampleRate: 32000 },
  40: { label: '40% (Aggressive Save)', mp3Bitrate: '48k', mp3Vbr: 7, oggQuality: 0, oggBitrate: '48k', sampleRate: 24000 },
  30: { label: '30% (Portable Playable)', mp3Bitrate: '32k', mp3Vbr: 8, oggQuality: -1, oggBitrate: '32k', sampleRate: 22050 },
  20: { label: '20% (Micro Playable <2MB)', mp3Bitrate: '24k', mp3Vbr: 9, oggQuality: -1, oggBitrate: '24k', sampleRate: 16000 },
};

function fail(message) {
  console.error(`[audio-optimizer] ERROR: ${message}`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MB`;
}

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

/**
 * Multi-tier Offline FFmpeg Resolver
 */
function resolveFfmpeg(explicitPath) {
  // 1. Explicit path parameter
  if (explicitPath) {
    const absPath = path.resolve(explicitPath);
    if (fs.existsSync(absPath)) {
      const ver = testFfmpeg(absPath);
      if (ver) return { ok: true, path: absPath, version: ver, source: 'cli-option' };
    }
  }

  // 2. Environment variable
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    const ver = testFfmpeg(process.env.FFMPEG_PATH);
    if (ver) return { ok: true, path: process.env.FFMPEG_PATH, version: ver, source: 'env-FFMPEG_PATH' };
  }

  // 3. Local dependency directory (portable ffmpeg in playable-shared-kit/tools/dependency/)
  const depPaths = [
    path.join(DEPENDENCY_DIR, 'ffmpeg', 'bin', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(DEPENDENCY_DIR, 'ffmpeg', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(DEPENDENCY_DIR, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg'),
  ];
  for (const depPath of depPaths) {
    if (fs.existsSync(depPath)) {
      const ver = testFfmpeg(depPath);
      if (ver) return { ok: true, path: depPath, version: ver, source: 'local-dependency' };
    }
  }

  // 4. npm module: ffmpeg-static
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      const ver = testFfmpeg(ffmpegStatic);
      if (ver) return { ok: true, path: ffmpegStatic, version: ver, source: 'ffmpeg-static-module' };
    }
  } catch (_) {}

  // 5. System PATH
  try {
    const cmd = IS_WIN ? 'where.exe ffmpeg' : 'which ffmpeg';
    const whereResult = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (whereResult) {
      const firstLine = whereResult.split(/\r?\n/)[0].trim();
      const ver = testFfmpeg(firstLine);
      if (ver) return { ok: true, path: firstLine, version: ver, source: 'system-path' };
    }
  } catch (_) {}

  // 6. Standard OS Installation Paths
  const standardPaths = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    path.join(HOME_DIR, 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe'),
    path.join(HOME_DIR, 'AppData', 'Local', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    path.join(HOME_DIR, 'bin', 'ffmpeg'),
  ];

  for (const p of standardPaths) {
    if (fs.existsSync(p)) {
      const ver = testFfmpeg(p);
      if (ver) return { ok: true, path: p, version: ver, source: 'standard-os-path' };
    }
  }

  return { ok: false, path: null, version: null, source: null };
}

function testFfmpeg(ffmpegPath) {
  try {
    const res = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 5000 });
    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split('\n')[0].trim();
      return firstLine;
    }
  } catch (_) {}
  return null;
}

/**
 * Argument Parser
 */
function parseArgs(argv) {
  const options = {
    targets: [],
    format: 'mp3', // portable playable default
    quality: 30,
    bitrate: null, // explicit bitrate e.g. '48k'
    channelMode: 'preserve', // preserve | mono | stereo
    sampleRate: null, // number in Hz or null
    write: false,
    backup: false,
    skipIfLarger: false, // Policy mode converts every non-compliant source to MP3.
    updateMeta: true,
    recursive: true,
    ffmpegPath: '',
    outputDir: '',
    doctor: false,
    json: false,
    help: false,
    verify: false,
    project: process.cwd(),
    mcpUrl: '',
    timeoutMs: 300_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--doctor') {
      options.doctor = true;
    } else if (arg === '--write') {
      options.write = true;
    } else if (arg === '--verify') {
      options.verify = true;
    } else if (arg === '--backup') {
      options.backup = true;
    } else if (arg === '--skip-if-larger' || arg === '--only-if-smaller') {
      options.skipIfLarger = true;
    } else if (arg === '--no-skip-if-larger' || arg === '--force' || arg === '--allow-larger') {
      options.skipIfLarger = false;
    } else if (arg === '--no-meta') {
      options.updateMeta = false;
    } else if (arg === '--mono') {
      options.channelMode = 'mono';
    } else if (arg === '--stereo') {
      options.channelMode = 'stereo';
    } else if (arg === '--preserve-channels' || arg === '--original-channels') {
      options.channelMode = 'preserve';
    } else if (arg === '--no-recursive') {
      options.recursive = false;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--format' || arg === '-f') {
      options.format = (argv[++i] || '').toLowerCase();
    } else if (arg === '--bitrate' || arg === '-b') {
      options.bitrate = argv[++i] || null;
    } else if (arg === '--quality' || arg === '-q') {
      const rawQ = argv[++i];
      const parsedQ = parseInt(rawQ, 10);
      if (isNaN(parsedQ) || parsedQ < 10 || parsedQ > 100) {
        fail(`Invalid quality level: "${rawQ}". Must be a number between 10 and 100 (e.g., 20, 30, 40, 50, 60, 70, 80).`);
      }
      options.quality = parsedQ;
    } else if (arg === '--sample-rate' || arg === '-r') {
      const rawRate = argv[++i];
      const parsedRate = parseInt(rawRate, 10);
      if (isNaN(parsedRate) || parsedRate < 8000 || parsedRate > 96000) {
        fail(`Invalid sample rate: "${rawRate}". Expected value between 8000 and 96000 (e.g. 22050, 32000, 44100).`);
      }
      options.sampleRate = parsedRate;
    } else if (arg === '--ffmpeg-path' || arg === '--ffmpeg') {
      options.ffmpegPath = argv[++i] || '';
    } else if (arg === '--project') {
      options.project = argv[++i] || process.cwd();
    } else if (arg === '--mcp-url') {
      options.mcpUrl = argv[++i] || '';
    } else if (arg === '--timeout') {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === '--output' || arg === '-o') {
      options.outputDir = argv[++i] || '';
    } else if (arg === '--source' || arg === '-s') {
      options.targets.push(argv[++i]);
    } else if (arg.startsWith('-')) {
      fail(`Unknown option: ${arg}. Use --help for usage.`);
    } else {
      options.targets.push(arg);
    }
  }

  const validFormats = ['mp3', 'ogg', 'wav', 'keep', 'same'];
  if (!validFormats.includes(options.format)) {
    fail(`Invalid format "${options.format}". Supported: ${validFormats.join(', ')}`);
  }
  if (options.format === 'same') options.format = 'keep';
  options.project = path.resolve(options.project);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 900_000) {
    fail('Invalid --timeout. Expected 1000..900000 milliseconds.');
  }
  if (options.verify && options.write) fail('--verify and --write are mutually exclusive.');

  return options;
}

function printHelp() {
  console.log(`
Cocos Playable Offline Audio Optimizer (FFmpeg)
================================================
Compresses and converts audio/SFX assets for lightweight Playable Ads.

Usage:
  node playable-shared-kit/tools/audio-optimizer.cjs [options] [files/directories...]

Options:
  -f, --format <mp3|ogg|wav|keep>  Target audio format. Default: mp3.
  -q, --quality <20..80>           Optimization level percentage. Default: 30.
  -b, --bitrate <rate>             Explicit audio bitrate (e.g. 32k, 48k, 64k, 96k, 128k).
  --preserve-channels              Preserve each source file's original mono/stereo channel count (default).
  --mono                           Force downmixing audio to Mono (1 channel).
  --stereo                         Force Stereo (2 channels); this does not mean preserve.
  -r, --sample-rate <Hz>           Override sample rate (e.g. 16000, 22050, 32000, 44100).
  --skip-if-larger                 Opt in to keeping a larger non-compliant source file.
  --force, --allow-larger          Force re-encoding even if output is larger than source.
  --write                          Apply changes to disk. (Default is safe dry-run mode).
  --verify                         Fail unless every selected audio asset is compliant MP3 at quality 30.
  --backup                         Create a .bak copy before modifying files.
  --no-meta                        Allow standalone conversion without Cocos Asset DB path/UUID migration.
  --project <dir>                  Cocos project root used for Asset DB URL mapping.
  --mcp-url <url>                  Override Cocos MCP URL.
  --no-recursive                   Do not scan directories recursively.
  -o, --output <dir>               Save optimized files to a custom directory instead of in-place.
  --ffmpeg-path <path>             Explicit path to ffmpeg executable.
  --doctor                         Diagnose FFmpeg environment and paths.
  --json                           Output result summary in JSON format.
  -h, --help                       Show this help menu.

Quality Levels & Playable Recommendations:
  80%  -> 128 kbps, 44.1 kHz, original channels
  70%  -> 112 kbps, 44.1 kHz, original channels
  60%  ->  96 kbps, 32.0 kHz, original channels
  50%  ->  64 kbps, 32.0 kHz, original channels
  40%  ->  48 kbps, 24.0 kHz, original channels
  30%  ->  32 kbps, 22.05 kHz, original channels (portable playable default)
  20%  ->  24 kbps, 16.0 kHz, original channels

Examples:
  # 1. Check environment and FFmpeg resolution:
  node playable-shared-kit/tools/audio-optimizer.cjs --doctor

  # 2. Dry-run all game audio with the portable MP3/30/original-channel policy:
  node playable-shared-kit/tools/audio-optimizer.cjs assets

  # 3. Optimize and write changes to MP3:
  node playable-shared-kit/tools/audio-optimizer.cjs --write assets

  # 4. Convert all sounds to OGG format with 40% quality:
  node playable-shared-kit/tools/audio-optimizer.cjs --format ogg -q 40 --write assets/resources/sound

  # 5. Compress a single audio file to MP3 with backup:
  node playable-shared-kit/tools/audio-optimizer.cjs --format mp3 -q 60 --write --backup assets/resources/sound/bgm_main.mp3
`);
}

function runDoctor(explicitPath) {
  console.log('==> Audio Optimizer: FFmpeg Environment Doctor\n');
  const res = resolveFfmpeg(explicitPath);

  if (res.ok) {
    console.log(`  [OK] FFmpeg found!`);
    console.log(`       Source  : ${res.source}`);
    console.log(`       Path    : ${res.path}`);
    console.log(`       Version : ${res.version}`);
    console.log('\nAudio optimization tools are fully operational!');
    return 0;
  }

  console.log(`  [FAIL] FFmpeg could not be found automatically.`);
  console.log('\nHow to make FFmpeg available:');
  console.log('  1. Place portable ffmpeg executable in:');
  console.log(`     ${path.join(DEPENDENCY_DIR, 'ffmpeg', IS_WIN ? 'bin/ffmpeg.exe' : 'ffmpeg')}`);
  console.log('  2. Install via package manager:');
  console.log('     Windows: winget install Gyan.FFmpeg  OR  choco install ffmpeg  OR  scoop install ffmpeg');
  console.log('     macOS  : brew install ffmpeg');
  console.log('     Linux  : sudo apt install ffmpeg');
  console.log('  3. Or pass custom path via CLI:');
  console.log('     node playable-shared-kit/tools/audio-optimizer.cjs --ffmpeg-path "C:\\path\\to\\ffmpeg.exe" ...');
  console.log('  4. Or set FFMPEG_PATH environment variable.');
  return 1;
}

/**
 * Get Quality Parameters based on percentage
 */
function getQualityConfig(qualityPercent, channelMode = 'preserve', userSampleRate, explicitBitrate) {
  // Find nearest or interpolated preset
  const presetKeys = Object.keys(QUALITY_PRESETS).map(Number).sort((a, b) => a - b);
  let closest = presetKeys[0];
  for (const k of presetKeys) {
    if (Math.abs(k - qualityPercent) <= Math.abs(closest - qualityPercent)) {
      closest = k;
    }
  }

  const basePreset = QUALITY_PRESETS[closest];
  const sampleRate = userSampleRate != null ? userSampleRate : basePreset.sampleRate;

  let bitrate = explicitBitrate || basePreset.mp3Bitrate;
  let oggQ = basePreset.oggQuality;

  if (!explicitBitrate) {
    // Custom fine-tuning if quality is between presets
    if (qualityPercent <= 25) {
      bitrate = '20k';
      oggQ = -1;
    } else if (qualityPercent <= 35) {
      bitrate = '32k';
      oggQ = -1;
    } else if (qualityPercent <= 45) {
      bitrate = '48k';
      oggQ = 0;
    } else if (qualityPercent <= 55) {
      bitrate = '64k';
      oggQ = 1;
    } else if (qualityPercent <= 65) {
      bitrate = '96k';
      oggQ = 2;
    } else if (qualityPercent <= 75) {
      bitrate = '112k';
      oggQ = 3;
    } else {
      bitrate = '128k';
      oggQ = 4;
    }
  }

  return {
    label: explicitBitrate ? `Custom Bitrate ${explicitBitrate}` : `${qualityPercent}% (Preset: ${basePreset.label})`,
    mp3Bitrate: bitrate,
    oggQuality: oggQ,
    oggBitrate: bitrate,
    sampleRate,
    channelMode,
  };
}

/**
 * Recursively find audio files in given paths
 */
function collectAudioFiles(targetPaths, recursive) {
  const files = [];

  function scan(entryPath) {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isFile()) {
      const ext = path.extname(entryPath).toLowerCase();
      if (SUPPORTED_AUDIO_EXTS.has(ext)) {
        files.push(path.resolve(entryPath));
      }
    } else if (stat.isDirectory()) {
      const entries = fs.readdirSync(entryPath);
      for (const entry of entries) {
        // Skip ignored directories
        if (entry === '.git' || entry === 'node_modules' || entry === 'temp' || entry === 'library' || entry === 'build') {
          continue;
        }
        const fullChild = path.join(entryPath, entry);
        if (fs.statSync(fullChild).isDirectory()) {
          if (recursive) scan(fullChild);
        } else {
          scan(fullChild);
        }
      }
    }
  }

  for (const t of targetPaths) {
    scan(t);
  }

  // Deduplicate
  return [...new Set(files)];
}

function probeAudioFile(ffmpegPath, inputPath) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', inputPath], { encoding: 'utf8', timeout: 15000 });
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  const audioLine = output.split(/\r?\n/).find((line) => /Audio:/.test(line)) || '';
  const sampleRateMatch = audioLine.match(/(\d+)\s*Hz/i);
  const bitrateMatch = audioLine.match(/(\d+)\s*kb\/s/i);
  const channelTokenMatch = audioLine.match(/\b(mono|stereo|[2-9]\.[01](?:\([^)]*\))?)\b/i);
  const channelToken = channelTokenMatch ? channelTokenMatch[1].toLowerCase() : '';
  let channels = 0;
  if (channelToken === 'mono') channels = 1;
  else if (channelToken === 'stereo') channels = 2;
  else if (/^\d+\.[01]/.test(channelToken)) {
    const [whole, sub] = channelToken.match(/^(\d+)\.([01])/)?.slice(1).map(Number) || [0, 0];
    channels = whole + sub;
  }
  return {
    channels,
    channelLabel: channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : channelToken || 'Original',
    sampleRate: sampleRateMatch ? Number(sampleRateMatch[1]) : 0,
    bitrateKbps: bitrateMatch ? Number(bitrateMatch[1]) : 0,
    audioLine: audioLine.trim(),
  };
}

function buildFfmpegArgs(inputPath, tempPath, targetExt, options, qualityConfig) {
  const args = ['-y', '-i', inputPath];
  if (qualityConfig.channelMode === 'mono') args.push('-ac', '1');
  else if (qualityConfig.channelMode === 'stereo') args.push('-ac', '2');
  if (qualityConfig.sampleRate) args.push('-ar', String(qualityConfig.sampleRate));
  if (targetExt === '.mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', qualityConfig.mp3Bitrate);
  } else if (targetExt === '.ogg') {
    args.push('-c:a', 'libvorbis');
    if (qualityConfig.oggQuality >= 0 && !options.bitrate) args.push('-q:a', String(qualityConfig.oggQuality));
    else args.push('-b:a', qualityConfig.oggBitrate);
  } else if (targetExt === '.wav') {
    args.push('-c:a', 'pcm_s16le');
  }
  args.push('-map_metadata', '-1', tempPath);
  return args;
}

function fileToDbUrl(file, projectRoot) {
  const assetsRoot = path.resolve(projectRoot, 'assets');
  const absolute = path.resolve(file);
  const relative = path.relative(assetsRoot, absolute);
  if (!relative || relative === '.') return 'db://assets';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return `db://assets/${toPosix(relative)}`;
}

async function callAssetDb(client, name, args) {
  const payload = unwrapToolResult(await client.call(name, args));
  if (!payload?.success) throw new Error(payload?.error || `${name} failed`);
  return payload.data || {};
}

function uuidFromToolData(data) {
  return String(data?.uuid || data?.data?.uuid || '');
}

async function commitOptimizedAsset(inputPath, targetPath, tempPath, options) {
  const extensionChanged = path.resolve(inputPath) !== path.resolve(targetPath);
  const originalBytes = fs.readFileSync(inputPath);
  if (options.backup) fs.copyFileSync(inputPath, `${inputPath}.bak`);

  if (options.outputDir || !options.updateMeta) {
    if (!options.outputDir && extensionChanged) fs.unlinkSync(inputPath);
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    fs.renameSync(tempPath, targetPath);
    return { assetDb: false, uuidPreserved: null };
  }

  if (!options.assetDbClient) throw new Error('Cocos MCP is required for --write so audio path changes preserve UUIDs through Asset DB. Open the project in Cocos Creator or pass --no-meta for standalone files.');
  const sourceUrl = fileToDbUrl(inputPath, options.project);
  const targetUrl = fileToDbUrl(targetPath, options.project);
  if (!sourceUrl || !targetUrl) throw new Error('Audio files must be inside <project>/assets when metadata migration is enabled.');
  if (extensionChanged && fs.existsSync(targetPath)) throw new Error(`Target already exists; refusing to overwrite another Cocos asset: ${targetPath}`);

  const beforeUuid = uuidFromToolData(await callAssetDb(options.assetDbClient, 'project_query_asset_uuid', { url: sourceUrl }));
  if (!beforeUuid) throw new Error(`Cocos Asset DB did not return a UUID for ${sourceUrl}.`);
  let moved = false;
  try {
    if (extensionChanged) {
      await callAssetDb(options.assetDbClient, 'project_move_asset', { source: sourceUrl, target: targetUrl, overwrite: false });
      moved = true;
    }
    fs.copyFileSync(tempPath, targetPath);
    fs.unlinkSync(tempPath);
    await callAssetDb(options.assetDbClient, 'project_reimport_asset', { url: targetUrl });
    const afterUuid = uuidFromToolData(await callAssetDb(options.assetDbClient, 'project_query_asset_uuid', { url: targetUrl }));
    if (afterUuid !== beforeUuid) throw new Error(`Asset UUID changed during audio conversion (${beforeUuid} -> ${afterUuid || '<missing>'}).`);
    return { assetDb: true, uuid: afterUuid, uuidPreserved: true, sourceUrl, targetUrl };
  } catch (error) {
    try {
      fs.writeFileSync(targetPath, originalBytes);
      if (moved) await callAssetDb(options.assetDbClient, 'project_move_asset', { source: targetUrl, target: sourceUrl, overwrite: false });
      await callAssetDb(options.assetDbClient, 'project_reimport_asset', { url: sourceUrl });
    } catch (rollbackError) {
      throw new Error(`${error.message}; rollback also failed: ${rollbackError.message}`);
    }
    throw error;
  }
}

/**
 * Execute FFmpeg conversion
 */
async function optimizeAudioFile(ffmpegPath, inputPath, options, qualityConfig) {
  const origExt = path.extname(inputPath).toLowerCase();
  const baseName = path.basename(inputPath, origExt);
  const inputDir = path.dirname(inputPath);

  let targetExt = origExt;
  if (options.format !== 'keep') {
    targetExt = `.${options.format}`;
  }

  const outDir = options.outputDir ? path.resolve(options.outputDir) : inputDir;
  if (!fs.existsSync(outDir)) {
    if (options.write) fs.mkdirSync(outDir, { recursive: true });
  }

  const targetPath = path.join(outDir, `${baseName}${targetExt}`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playable-audio-'));
  const tempPath = path.join(tempDir, `${baseName}${targetExt}`);

  const origSize = fs.statSync(inputPath).size;

  const sourceInfo = probeAudioFile(ffmpegPath, inputPath);
  if (targetExt === '.mp3' && qualityConfig.channelMode === 'preserve' && sourceInfo.channels > 2) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: false, inputPath, targetPath, error: `MP3 cannot preserve ${sourceInfo.channels} source channels. Use --stereo explicitly to authorize downmixing.` };
  }
  const ffmpegArgs = buildFfmpegArgs(inputPath, tempPath, targetExt, options, qualityConfig);

  // Run conversion
  const runResult = spawnSync(ffmpegPath, ffmpegArgs, { encoding: 'utf8', timeout: 30000 });

  if (runResult.status !== 0 || !fs.existsSync(tempPath)) {
    const errMsg = runResult.stderr || runResult.stdout || 'Unknown FFmpeg execution error';
    fs.rmSync(tempDir, { recursive: true, force: true });
    return {
      success: false,
      inputPath,
      targetPath,
      error: errMsg.trim(),
    };
  }

  const newSize = fs.statSync(tempPath).size;
  const savingsBytes = origSize - newSize;
  const savingsPercent = origSize > 0 ? ((savingsBytes / origSize) * 100) : 0;

  // Check skip if larger (default safe behavior)
  if (options.skipIfLarger && newSize >= origSize) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    const diffPercent = origSize > 0 ? (((newSize - origSize) / origSize) * 100).toFixed(1) : '0.0';
    return {
      success: true,
      skipped: true,
      reason: `Output is larger or equal (${formatBytes(origSize)} -> ${formatBytes(newSize)}, +${diffPercent}%) - kept original`,
      inputPath,
      targetPath,
      origSize,
      newSize: origSize, // Size unchanged because original was preserved
      savingsBytes: 0,
      savingsPercent: 0,
      channels: qualityConfig.channelMode === 'preserve' ? `${sourceInfo.channelLabel} (preserved)` : qualityConfig.channelMode === 'mono' ? 'Mono (forced)' : 'Stereo (forced)',
      sampleRate: qualityConfig.sampleRate,
    };
  }

  if (options.write) {
    let metaReport;
    try {
      metaReport = await commitOptimizedAsset(inputPath, targetPath, tempPath, options);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    return {
      success: true,
      inputPath,
      targetPath,
      origSize,
      newSize,
      savingsBytes,
      savingsPercent,
      channels: qualityConfig.channelMode === 'preserve' ? `${sourceInfo.channelLabel} (preserved)` : qualityConfig.channelMode === 'mono' ? 'Mono (forced)' : 'Stereo (forced)',
      sampleRate: qualityConfig.sampleRate,
      metaReport,
    };
  } else {
    // Dry-run: clean up temp file
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      success: true,
      inputPath,
      targetPath,
      origSize,
      newSize,
      savingsBytes,
      savingsPercent,
      channels: qualityConfig.channelMode === 'preserve' ? `${sourceInfo.channelLabel} (preserved)` : qualityConfig.channelMode === 'mono' ? 'Mono (forced)' : 'Stereo (forced)',
      sampleRate: qualityConfig.sampleRate,
      dryRun: true,
    };
  }
}

function targetPathFor(inputPath, options) {
  const origExt = path.extname(inputPath).toLowerCase();
  const targetExt = options.format === 'keep' ? origExt : `.${options.format}`;
  const outDir = options.outputDir ? path.resolve(options.outputDir) : path.dirname(inputPath);
  return path.join(outDir, `${path.basename(inputPath, origExt)}${targetExt}`);
}

function expectedBitrateKbps(qualityConfig) {
  return Number.parseInt(String(qualityConfig.mp3Bitrate || '').replace(/k$/i, ''), 10) || 0;
}

function checkAudioCompliance(ffmpegPath, inputPath, options, qualityConfig) {
  const reasons = [];
  if (options.format !== 'keep' && path.extname(inputPath).toLowerCase() !== `.${options.format}`) {
    reasons.push(`format is ${path.extname(inputPath).toLowerCase() || '<none>'}, expected .${options.format}`);
  }
  const info = probeAudioFile(ffmpegPath, inputPath);
  if (options.format === 'mp3') {
    const maxBitrate = expectedBitrateKbps(qualityConfig);
    if (!info.bitrateKbps || (maxBitrate && info.bitrateKbps > maxBitrate)) reasons.push(`bitrate is ${info.bitrateKbps || 'unknown'}kbps, expected <=${maxBitrate}kbps`);
  }
  if (qualityConfig.sampleRate && (!info.sampleRate || info.sampleRate > qualityConfig.sampleRate)) {
    reasons.push(`sample rate is ${info.sampleRate || 'unknown'}Hz, expected <=${qualityConfig.sampleRate}Hz`);
  }
  if (qualityConfig.channelMode === 'preserve' && info.channels > 2 && options.format === 'mp3') {
    reasons.push(`MP3 cannot preserve ${info.channels} channels`);
  }
  return { ok: reasons.length === 0, reasons, info };
}

/**
 * Main Entry Point
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.doctor) {
    const code = runDoctor(options.ffmpegPath);
    process.exit(code);
  }

  // Resolve FFmpeg
  const ffmpegRes = resolveFfmpeg(options.ffmpegPath);
  if (!ffmpegRes.ok) {
    runDoctor(options.ffmpegPath);
    fail('Cannot proceed without FFmpeg. Please install or provide FFmpeg as described above.');
  }

  // Default target paths if none specified: assets/resources/sound or assets/
  if (options.targets.length === 0) {
    const defaultSoundDir = path.resolve(options.project, 'assets', 'resources', 'sound');
    const defaultAssetsDir = path.resolve(options.project, 'assets');
    if (fs.existsSync(defaultSoundDir)) {
      options.targets.push(defaultSoundDir);
    } else if (fs.existsSync(defaultAssetsDir)) {
      options.targets.push(defaultAssetsDir);
    } else {
      fail('No input files or folders specified, and "assets/" directory not found in current workspace. Use --help for usage.');
    }
  }

  const audioFiles = collectAudioFiles(options.targets, options.recursive);
  if (audioFiles.length === 0) {
    console.log(`[audio-optimizer] No supported audio files found in: ${options.targets.join(', ')}`);
    return;
  }

  const qualityConfig = getQualityConfig(options.quality, options.channelMode, options.sampleRate, options.bitrate);

  const targetOwners = new Map();
  for (const file of audioFiles) {
    const target = path.resolve(targetPathFor(file, options)).toLowerCase();
    const previous = targetOwners.get(target);
    if (previous && path.resolve(previous).toLowerCase() !== path.resolve(file).toLowerCase()) {
      fail(`Multiple source files map to the same target: ${previous} and ${file}`);
    }
    targetOwners.set(target, file);
  }

  if (options.verify) {
    const failures = audioFiles.map((file) => ({ file, ...checkAudioCompliance(ffmpegRes.path, file, options, qualityConfig) })).filter((item) => !item.ok);
    const report = {
      mode: 'verify',
      policy: { format: options.format, quality: options.quality, channelMode: qualityConfig.channelMode, sampleRate: qualityConfig.sampleRate, bitrate: qualityConfig.mp3Bitrate },
      totalFiles: audioFiles.length,
      compliant: audioFiles.length - failures.length,
      failed: failures.length,
      failures: failures.map((item) => ({ file: toPosix(path.relative(options.project, item.file)), reasons: item.reasons, probe: item.info })),
    };
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`[audio-optimizer] ${failures.length ? 'AUDIO_POLICY_DRIFT' : 'AUDIO_POLICY_OK'}: ${report.compliant}/${report.totalFiles} compliant`);
      for (const item of report.failures) console.log(`  - ${item.file}: ${item.reasons.join('; ')}`);
    }
    return failures.length ? 1 : 0;
  }

  if (!options.json) {
    console.log('================================================================================');
    console.log(` Cocos Playable Audio Optimizer (${options.write ? 'WRITE MODE' : 'DRY-RUN MODE'})`);
    console.log('================================================================================');
    console.log(` FFmpeg Binary : ${ffmpegRes.path} (${ffmpegRes.source})`);
    console.log(` Target Format : ${options.format.toUpperCase()} ${options.format === 'keep' ? '(preserve original extension)' : ''}`);
    console.log(` Quality Level : ${qualityConfig.label}`);
    console.log(` Configuration : Channels ${qualityConfig.channelMode} | Sample Rate: ${qualityConfig.sampleRate} Hz | MP3: ${qualityConfig.mp3Bitrate} / OGG: q${qualityConfig.oggQuality}`);
    console.log(` Target Files  : ${audioFiles.length} file(s)`);
    if (options.skipIfLarger) {
      console.log(` Safe Mode     : Enabled (skips any file if optimized size increases)`);
    } else {
      console.log(` Policy Mode   : All non-compliant files are converted even when a tiny source grows`);
    }
    console.log('--------------------------------------------------------------------------------\n');
  }

  const results = [];
  let totalOrigSize = 0;
  let totalNewSize = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  if (options.write && options.updateMeta && !options.outputDir) {
    options.assetDbClient = await createClient(options);
  }

  for (const file of audioFiles) {
    const compliance = checkAudioCompliance(ffmpegRes.path, file, options, qualityConfig);
    if (compliance.ok) {
      const stat = fs.statSync(file);
      const report = {
        success: true,
        skipped: true,
        compliant: true,
        reason: 'Already compliant with the selected audio policy',
        inputPath: file,
        targetPath: file,
        origSize: stat.size,
        newSize: stat.size,
        savingsBytes: 0,
        savingsPercent: 0,
        channels: `${compliance.info.channelLabel} (preserved)`,
        sampleRate: compliance.info.sampleRate,
      };
      results.push(report);
      skippedCount++;
      totalOrigSize += stat.size;
      totalNewSize += stat.size;
      if (!options.json) console.log(` [SKIP] ${toPosix(path.relative(options.project, file))}: already compliant`);
      continue;
    }
    let report;
    try {
      report = await optimizeAudioFile(ffmpegRes.path, file, options, qualityConfig);
    } catch (error) {
      report = { success: false, inputPath: file, targetPath: targetPathFor(file, options), error: error?.message || String(error) };
    }
    results.push(report);

    if (report.success) {
      if (report.skipped) {
        skippedCount++;
        totalOrigSize += report.origSize;
        totalNewSize += report.origSize; // Kept original
        if (!options.json) {
          const relInput = toPosix(path.relative(process.cwd(), report.inputPath));
          console.log(` [SKIP] ${relInput}`);
          console.log(`        ${report.reason}`);
        }
      } else {
        successCount++;
        totalOrigSize += report.origSize;
        totalNewSize += report.newSize;

        if (!options.json) {
          const relInput = toPosix(path.relative(process.cwd(), report.inputPath));
          const relTarget = toPosix(path.relative(process.cwd(), report.targetPath));
          const nameDisplay = relInput === relTarget ? relInput : `${relInput} -> ${relTarget}`;

          if (report.savingsBytes >= 0) {
            const absPercent = Math.abs(report.savingsPercent).toFixed(1);
            console.log(` [OK] ${nameDisplay}`);
            console.log(`      Size: ${formatBytes(report.origSize)} -> ${formatBytes(report.newSize)} (-${absPercent}%) | ${report.channels} | ${report.sampleRate}Hz`);
          } else {
            const absPercent = Math.abs(report.savingsPercent).toFixed(1);
            console.log(` [OK] ${nameDisplay} (WARNING: size increased)`);
            console.log(`      Size: ${formatBytes(report.origSize)} -> ${formatBytes(report.newSize)} (+${absPercent}%) | ${report.channels} | ${report.sampleRate}Hz`);
          }
        }
      }
    } else {
      failCount++;
      if (!options.json) {
        const relInput = toPosix(path.relative(process.cwd(), report.inputPath));
        console.error(` [FAIL] ${relInput}: ${report.error}`);
      }
    }
  }

  const totalSavedBytes = totalOrigSize - totalNewSize;
  const totalSavedPercent = totalOrigSize > 0 ? ((totalSavedBytes / totalOrigSize) * 100).toFixed(1) : '0.0';

  if (options.assetDbClient) await options.assetDbClient.close();

  if (options.json) {
    console.log(JSON.stringify({
      mode: options.write ? 'write' : 'dry-run',
      ffmpeg: ffmpegRes,
      qualityConfig,
      summary: {
        totalFiles: audioFiles.length,
        successCount,
        skippedCount,
        failCount,
        totalOriginalBytes: totalOrigSize,
        totalNewBytes: totalNewSize,
        totalSavedBytes,
        totalSavedPercent: Number(totalSavedPercent),
      },
      results,
    }, null, 2));
    return failCount ? 1 : 0;
  }

  console.log('\n================================================================================');
  console.log(' SUMMARY REPORT');
  console.log('================================================================================');
  console.log(` Status         : ${options.write ? 'CHANGES COMMITTED TO DISK' : 'DRY-RUN (Pass --write to apply)'}`);
  console.log(` Total Files    : ${audioFiles.length} (${successCount} optimized, ${skippedCount} skipped, ${failCount} failed)`);
  console.log(` Total Original : ${formatBytes(totalOrigSize)}`);
  console.log(` Total Optimized: ${formatBytes(totalNewSize)}`);
  if (totalSavedBytes >= 0) {
    console.log(` Net Savings    : ${formatBytes(totalSavedBytes)} (${totalSavedPercent}% reduction)`);
  } else {
    const incBytes = Math.abs(totalSavedBytes);
    const incPercent = Math.abs(Number(totalSavedPercent)).toFixed(1);
    console.log(` Net Size Change: +${formatBytes(incBytes)} (+${incPercent}% increase - WARNING: files got larger!)`);
  }
  console.log('================================================================================');

  if (!options.write && successCount > 0) {
    console.log('\n>> To apply these optimizations to your project, add the --write flag:');
    const cmdArgs = process.argv.slice(2).filter(a => a !== '--write').join(' ');
    console.log(`   node playable-shared-kit/tools/audio-optimizer.cjs ${cmdArgs} --write\n`);
  }
  return failCount ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => fail(error?.message || String(error)));
}

module.exports = {
  resolveFfmpeg,
  buildFfmpegArgs,
  checkAudioCompliance,
  collectAudioFiles,
  commitOptimizedAsset,
  fileToDbUrl,
  getQualityConfig,
  parseArgs,
  probeAudioFile,
  optimizeAudioFile,
  targetPathFor,
  QUALITY_PRESETS,
};
