#!/usr/bin/env node
'use strict';

/**
 * Cocos Playable Offline Audio Optimizer (FFmpeg)
 *
 * Features:
 * - Convert sound assets to MP3 or OGG (or WAV / keep format).
 * - Optimization quality presets: 20%, 30%, 40%, 50%, 60%, 70%, 80% (or custom 10..100).
 * - Explicit bitrate & sample rate overrides.
 * - Intelligent sample rate scaling & optional mono downmixing (ideal for mobile Playable Ads).
 * - Cocos Creator .meta synchronization: preserves asset UUIDs and updates the "files" list when changing extensions.
 * - Multi-tier offline FFmpeg resolver (CLI arg, env, local dependency folder, ffmpeg-static, system PATH, standard paths).
 * - Dry-run mode by default with detailed size reduction report; requires --write to apply.
 * - Skip if larger option to prevent accidental file bloating.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const HOME_DIR = os.homedir();
const SHARED_KIT_DIR = path.resolve(__dirname, '..');
const DEPENDENCY_DIR = path.join(__dirname, 'dependency');
const SUPPORTED_AUDIO_EXTS = new Set([
  '.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac', '.aiff', '.aif', '.wma'
]);

// Quality Presets Map
const QUALITY_PRESETS = {
  80: { label: '80% (High Quality)', mp3Bitrate: '128k', mp3Vbr: 2, oggQuality: 4, oggBitrate: '128k', sampleRate: 44100, mono: false },
  70: { label: '70% (Balanced BGM)', mp3Bitrate: '112k', mp3Vbr: 3, oggQuality: 3, oggBitrate: '112k', sampleRate: 44100, mono: false },
  60: { label: '60% (Playable Standard)', mp3Bitrate: '96k', mp3Vbr: 4, oggQuality: 2, oggBitrate: '96k', sampleRate: 32000, mono: true },
  50: { label: '50% (Compact SFX)', mp3Bitrate: '64k', mp3Vbr: 6, oggQuality: 1, oggBitrate: '64k', sampleRate: 32000, mono: true },
  40: { label: '40% (Aggressive Save)', mp3Bitrate: '48k', mp3Vbr: 7, oggQuality: 0, oggBitrate: '48k', sampleRate: 24000, mono: true },
  30: { label: '30% (Ultra Low Size)', mp3Bitrate: '32k', mp3Vbr: 8, oggQuality: -1, oggBitrate: '32k', sampleRate: 22050, mono: true },
  20: { label: '20% (Micro Playable <2MB)', mp3Bitrate: '24k', mp3Vbr: 9, oggQuality: -1, oggBitrate: '24k', sampleRate: 16000, mono: true },
};

function fail(message) {
  console.error(`[audio-optimizer] ERROR: ${message}`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
    format: 'keep', // 'mp3' | 'ogg' | 'wav' | 'keep'
    quality: 50,
    bitrate: null, // explicit bitrate e.g. '48k'
    mono: null, // true | false | null (null = use preset default)
    sampleRate: null, // number in Hz or null
    write: false,
    backup: false,
    skipIfLarger: false,
    updateMeta: true,
    recursive: true,
    ffmpegPath: '',
    outputDir: '',
    doctor: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--doctor') {
      options.doctor = true;
    } else if (arg === '--write') {
      options.write = true;
    } else if (arg === '--backup') {
      options.backup = true;
    } else if (arg === '--skip-if-larger' || arg === '--only-if-smaller') {
      options.skipIfLarger = true;
    } else if (arg === '--no-meta') {
      options.updateMeta = false;
    } else if (arg === '--mono') {
      options.mono = true;
    } else if (arg === '--stereo') {
      options.mono = false;
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

  return options;
}

function printHelp() {
  console.log(`
Cocos Playable Offline Audio Optimizer (FFmpeg)
================================================
Compresses, downmixes, and converts audio/SFX assets for lightweight Playable Ads.

Usage:
  node playable-shared-kit/tools/audio-optimizer.cjs [options] [files/directories...]

Options:
  -f, --format <mp3|ogg|wav|keep>  Target audio format. Default: 'keep' (in-place optimize).
  -q, --quality <20..80>           Optimization level percentage (20, 30, 40, 50, 60, 70, 80). Default: 50.
  -b, --bitrate <rate>             Explicit audio bitrate (e.g. 32k, 48k, 64k, 96k, 128k).
  --mono                           Force downmixing audio to Mono (1 channel, cuts SFX size in half).
  --stereo                         Preserve or force Stereo (2 channels).
  -r, --sample-rate <Hz>           Override sample rate (e.g. 16000, 22050, 32000, 44100).
  --skip-if-larger                 Skip replacing if the optimized output is larger than source.
  --write                          Apply changes to disk. (Default is safe dry-run mode).
  --backup                         Create a .bak copy before modifying files.
  --no-meta                        Skip Cocos Creator .meta file updates.
  --no-recursive                   Do not scan directories recursively.
  -o, --output <dir>               Save optimized files to a custom directory instead of in-place.
  --ffmpeg-path <path>             Explicit path to ffmpeg executable.
  --doctor                         Diagnose FFmpeg environment and paths.
  --json                           Output result summary in JSON format.
  -h, --help                       Show this help menu.

Quality Levels & Playable Recommendations:
  80%  -> 128 kbps, 44.1 kHz, Stereo  (High quality BGM)
  70%  -> 112 kbps, 44.1 kHz, Stereo  (Balanced BGM)
  60%  ->  96 kbps, 32.0 kHz, Mono    (Standard SFX & Voice)
  50%  ->  64 kbps, 32.0 kHz, Mono    (Recommended default for Playable SFX - ~50-60% size drop)
  40%  ->  48 kbps, 24.0 kHz, Mono    (Aggressive optimization for short clicks/pops)
  30%  ->  32 kbps, 22.05 kHz, Mono   (Ultra-compact budget SFX)
  20%  ->  24 kbps, 16.0 kHz, Mono    (Extreme micro-playable tier < 2MB total)

Examples:
  # 1. Check environment and FFmpeg resolution:
  node playable-shared-kit/tools/audio-optimizer.cjs --doctor

  # 2. Dry-run test converting all SFX in assets/resources/sound to MP3 at 50% quality:
  node playable-shared-kit/tools/audio-optimizer.cjs --format mp3 -q 50 assets/resources/sound

  # 3. Optimize and write changes to MP3:
  node playable-shared-kit/tools/audio-optimizer.cjs --format mp3 -q 50 --write assets/resources/sound

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
function getQualityConfig(qualityPercent, userMono, userSampleRate, explicitBitrate) {
  // Find nearest or interpolated preset
  const presetKeys = Object.keys(QUALITY_PRESETS).map(Number).sort((a, b) => a - b);
  let closest = presetKeys[0];
  for (const k of presetKeys) {
    if (Math.abs(k - qualityPercent) <= Math.abs(closest - qualityPercent)) {
      closest = k;
    }
  }

  const basePreset = QUALITY_PRESETS[closest];
  const mono = userMono !== null ? userMono : basePreset.mono;
  const sampleRate = userSampleRate !== null ? userSampleRate : basePreset.sampleRate;

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
    mono,
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

/**
 * Update Cocos Creator companion .meta file when converting formats
 */
function updateCocosMeta(originalAudioPath, targetAudioPath, write) {
  const origMetaPath = `${originalAudioPath}.meta`;
  const targetMetaPath = `${targetAudioPath}.meta`;

  if (!fs.existsSync(origMetaPath)) {
    return { metaUpdated: false, reason: 'no-meta-file' };
  }

  try {
    const raw = fs.readFileSync(origMetaPath, 'utf8');
    const metaObj = JSON.parse(raw);

    const targetExt = path.extname(targetAudioPath).toLowerCase();
    metaObj.files = ['.json', targetExt];

    if (write) {
      if (origMetaPath !== targetMetaPath) {
        // Different extension: write new meta file and remove old
        fs.writeFileSync(targetMetaPath, JSON.stringify(metaObj, null, 2) + '\n', 'utf8');
        try {
          fs.unlinkSync(origMetaPath);
        } catch (_) {}
      } else {
        // Same file: update in-place
        fs.writeFileSync(origMetaPath, JSON.stringify(metaObj, null, 2) + '\n', 'utf8');
      }
    }

    return { metaUpdated: true, uuid: metaObj.uuid, targetMetaPath };
  } catch (err) {
    return { metaUpdated: false, error: err.message };
  }
}

/**
 * Execute FFmpeg conversion
 */
function optimizeAudioFile(ffmpegPath, inputPath, options, qualityConfig) {
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
  const tempPath = path.join(outDir, `${baseName}.opt_tmp_${Date.now()}${targetExt}`);

  const origSize = fs.statSync(inputPath).size;

  // Build FFmpeg Arguments
  const ffmpegArgs = ['-y', '-i', inputPath];

  // Channel downmix
  if (qualityConfig.mono) {
    ffmpegArgs.push('-ac', '1');
  } else {
    ffmpegArgs.push('-ac', '2');
  }

  // Sample Rate
  if (qualityConfig.sampleRate) {
    ffmpegArgs.push('-ar', String(qualityConfig.sampleRate));
  }

  // Format & Codec options
  if (targetExt === '.mp3') {
    ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', qualityConfig.mp3Bitrate);
  } else if (targetExt === '.ogg') {
    ffmpegArgs.push('-c:a', 'libvorbis');
    if (qualityConfig.oggQuality >= 0 && !options.bitrate) {
      ffmpegArgs.push('-q:a', String(qualityConfig.oggQuality));
    } else {
      ffmpegArgs.push('-b:a', qualityConfig.oggBitrate);
    }
  } else if (targetExt === '.wav') {
    ffmpegArgs.push('-c:a', 'pcm_s16le');
  }

  // Remove metadata / ID3 tags to minimize size
  ffmpegArgs.push('-map_metadata', '-1');
  ffmpegArgs.push(tempPath);

  // Run conversion
  const runResult = spawnSync(ffmpegPath, ffmpegArgs, { encoding: 'utf8', timeout: 30000 });

  if (runResult.status !== 0 || !fs.existsSync(tempPath)) {
    const errMsg = runResult.stderr || runResult.stdout || 'Unknown FFmpeg execution error';
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

  // Check skip if larger
  if (options.skipIfLarger && newSize > origSize) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    return {
      success: true,
      skipped: true,
      reason: 'Output is larger than original file',
      inputPath,
      targetPath,
      origSize,
      newSize,
      savingsBytes: 0,
      savingsPercent: 0,
      channels: qualityConfig.mono ? 'Mono' : 'Stereo',
      sampleRate: qualityConfig.sampleRate,
    };
  }

  if (options.write) {
    // Backup original if requested
    if (options.backup && fs.existsSync(inputPath)) {
      fs.copyFileSync(inputPath, `${inputPath}.bak`);
    }

    // If changing extension, remove original file if in-place
    if (inputPath !== targetPath && fs.existsSync(inputPath) && !options.outputDir) {
      try {
        fs.unlinkSync(inputPath);
      } catch (_) {}
    }

    // Move temp file to target
    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (_) {}
    }
    fs.renameSync(tempPath, targetPath);

    // Update Cocos Creator meta
    let metaReport = null;
    if (options.updateMeta && !options.outputDir) {
      metaReport = updateCocosMeta(inputPath, targetPath, true);
    }

    return {
      success: true,
      inputPath,
      targetPath,
      origSize,
      newSize,
      savingsBytes,
      savingsPercent,
      channels: qualityConfig.mono ? 'Mono' : 'Stereo',
      sampleRate: qualityConfig.sampleRate,
      metaReport,
    };
  } else {
    // Dry-run: clean up temp file
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}

    return {
      success: true,
      inputPath,
      targetPath,
      origSize,
      newSize,
      savingsBytes,
      savingsPercent,
      channels: qualityConfig.mono ? 'Mono' : 'Stereo',
      sampleRate: qualityConfig.sampleRate,
      dryRun: true,
    };
  }
}

/**
 * Main Entry Point
 */
function main() {
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
    const defaultSoundDir = path.resolve(process.cwd(), 'assets', 'resources', 'sound');
    const defaultAssetsDir = path.resolve(process.cwd(), 'assets');
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

  const qualityConfig = getQualityConfig(options.quality, options.mono, options.sampleRate, options.bitrate);

  if (!options.json) {
    console.log('================================================================================');
    console.log(` Cocos Playable Audio Optimizer (${options.write ? 'WRITE MODE' : 'DRY-RUN MODE'})`);
    console.log('================================================================================');
    console.log(` FFmpeg Binary : ${ffmpegRes.path} (${ffmpegRes.source})`);
    console.log(` Target Format : ${options.format.toUpperCase()} ${options.format === 'keep' ? '(preserve original extension)' : ''}`);
    console.log(` Quality Level : ${qualityConfig.label}`);
    console.log(` Configuration : ${qualityConfig.mono ? 'Mono' : 'Stereo'} | Sample Rate: ${qualityConfig.sampleRate} Hz | MP3: ${qualityConfig.mp3Bitrate} / OGG: q${qualityConfig.oggQuality}`);
    console.log(` Target Files  : ${audioFiles.length} file(s)`);
    console.log('--------------------------------------------------------------------------------\n');
  }

  const results = [];
  let totalOrigSize = 0;
  let totalNewSize = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const file of audioFiles) {
    const report = optimizeAudioFile(ffmpegRes.path, file, options, qualityConfig);
    results.push(report);

    if (report.success) {
      if (report.skipped) {
        skippedCount++;
        totalOrigSize += report.origSize;
        totalNewSize += report.origSize; // Kept original
        if (!options.json) {
          const relInput = toPosix(path.relative(process.cwd(), report.inputPath));
          console.log(` [SKIP] ${relInput} (${report.reason})`);
        }
      } else {
        successCount++;
        totalOrigSize += report.origSize;
        totalNewSize += report.newSize;

        if (!options.json) {
          const relInput = toPosix(path.relative(process.cwd(), report.inputPath));
          const relTarget = toPosix(path.relative(process.cwd(), report.targetPath));
          const savingSign = report.savingsBytes >= 0 ? '-' : '+';
          const absPercent = Math.abs(report.savingsPercent).toFixed(1);
          const nameDisplay = relInput === relTarget ? relInput : `${relInput} -> ${relTarget}`;

          console.log(` [OK] ${nameDisplay}`);
          console.log(`      Size: ${formatBytes(report.origSize)} -> ${formatBytes(report.newSize)} (${savingSign}${absPercent}%) | ${report.channels} | ${report.sampleRate}Hz`);
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
  const totalSavedPercent = totalOrigSize > 0 ? ((totalSavedBytes / totalOrigSize) * 100).toFixed(1) : 0;

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
    return;
  }

  console.log('\n================================================================================');
  console.log(' SUMMARY REPORT');
  console.log('================================================================================');
  console.log(` Status         : ${options.write ? 'CHANGES COMMITTED TO DISK' : 'DRY-RUN (Pass --write to apply)'}`);
  console.log(` Total Files    : ${audioFiles.length} (${successCount} optimized, ${skippedCount} skipped, ${failCount} failed)`);
  console.log(` Total Original : ${formatBytes(totalOrigSize)}`);
  console.log(` Total Optimized: ${formatBytes(totalNewSize)}`);
  console.log(` Net Savings    : ${formatBytes(totalSavedBytes)} (${totalSavedPercent}% reduction)`);
  console.log('================================================================================');

  if (!options.write && successCount > 0) {
    console.log('\n>> To apply these optimizations to your project, add the --write flag:');
    const cmdArgs = process.argv.slice(2).filter(a => a !== '--write').join(' ');
    console.log(`   node playable-shared-kit/tools/audio-optimizer.cjs ${cmdArgs} --write\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveFfmpeg,
  getQualityConfig,
  optimizeAudioFile,
  QUALITY_PRESETS,
};
