#!/usr/bin/env node
'use strict';

/**
 * Dependency Scanner & Auto-Provisioner for Portable MCPs & Porting Tools
 *
 * Scans and provisions local portable runtimes in `playable-shared-kit/tools/dependency/`:
 * - Python 3.11 Portable (`dependency/python/python.exe`)
 * - uv Standalone tool (`dependency/uv/uv.exe` or `dependency/uv.exe`)
 * - FFmpeg Standalone (`dependency/ffmpeg/ffmpeg.exe` or `dependency/ffmpeg/bin/ffmpeg.exe`)
 * - Node.js, Git, Blender, Cocos Creator
 *
 * Automatically injects valid runnable directories into process.env.PATH.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const HOME_DIR = os.homedir();
const SHARED_KIT_DIR = path.resolve(__dirname, '..');
const DEPENDENCY_DIR = path.join(__dirname, 'dependency');

if (!fs.existsSync(DEPENDENCY_DIR)) {
  fs.mkdirSync(DEPENDENCY_DIR, { recursive: true });
}

function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 5000, ...options }).trim();
  } catch (e) {
    return null;
  }
}

function addPathToProcess(newDir) {
  if (!fs.existsSync(newDir)) return false;
  const absDir = path.resolve(newDir);

  // Prepend to current process PATH
  const currentPath = process.env.PATH || '';
  if (!currentPath.toLowerCase().includes(absDir.toLowerCase())) {
    process.env.PATH = `${absDir}${path.delimiter}${currentPath}`;
  }
  return true;
}

// -------------------------------------------------------------
// 1. Scan & Setup Python 3.x
// -------------------------------------------------------------
function resolvePython3() {
  const pyCheckCode = '"import sys; print(str(sys.version_info[0]) + \'.\' + str(sys.version_info[1]))"';
  
  // 1. Check local portable directory FIRST (playable-shared-kit/tools/dependency/python)
  const localPortablePaths = [
    path.join(DEPENDENCY_DIR, 'python', IS_WIN ? 'python.exe' : 'python'),
    path.join(DEPENDENCY_DIR, 'python-portable', IS_WIN ? 'python.exe' : 'python'),
    path.join(DEPENDENCY_DIR, 'python-embed', IS_WIN ? 'python.exe' : 'python'),
  ];

  for (const p of localPortablePaths) {
    if (fs.existsSync(p)) {
      const ver = runCmd(`"${p}" -c ${pyCheckCode}`);
      if (ver && (ver.startsWith('3.') || ver.startsWith('3'))) {
        addPathToProcess(path.dirname(p));
        return { ok: true, version: `Python ${ver} (local portable)`, path: p, source: 'local-dependency', addedToPath: true };
      }
    }
  }

  // 2. Check if 'python' or 'python3' in PATH is Python >= 3.8
  const cmds = ['python3', 'py -3', 'python', 'py'];
  for (const cmd of cmds) {
    const ver = runCmd(`${cmd} -c ${pyCheckCode}`);
    if (ver && (ver.startsWith('3.') || ver.startsWith('3'))) {
      const parts = ver.split('.').map(Number);
      if (parts[0] === 3 && parts[1] >= 8) {
        return { ok: true, version: `Python ${ver}`, path: runCmd(`${cmd} -c "import sys; print(sys.executable)"`) || cmd, source: 'system-path' };
      }
    }
  }

  // 3. Scan standard Windows / Mac paths
  const standardPaths = [
    'C:\\Program Files\\Blender Foundation\\Blender 5.2\\5.2\\python\\bin\\python.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.2\\4.2\\python\\bin\\python.exe',
    path.join(HOME_DIR, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(HOME_DIR, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(HOME_DIR, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    'C:\\Program Files\\Python313\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3'
  ];

  for (const p of standardPaths) {
    if (fs.existsSync(p)) {
      const ver = runCmd(`"${p}" -c ${pyCheckCode}`);
      if (ver && ver.startsWith('3.')) {
        addPathToProcess(path.dirname(p));
        return { ok: true, version: `Python ${ver} (detected from filesystem)`, path: p, source: 'standard-path', addedToPath: true };
      }
    }
  }

  return { ok: false, version: null, path: null, source: null };
}

function downloadPortablePython() {
  if (!IS_WIN) {
    console.log('  [skip] Auto-downloading portable Python is currently configured for Windows (64-bit).');
    return false;
  }
  const pythonDir = path.join(DEPENDENCY_DIR, 'python');
  const pythonZip = path.join(DEPENDENCY_DIR, 'python-embed.zip');
  console.log('  [download] Downloading portable Python 3.11 for Windows...');
  const psScript = `
    $ErrorActionPreference = 'Stop'
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" -OutFile "${pythonZip.replace(/\\/g, '\\\\')}"
    Expand-Archive -Path "${pythonZip.replace(/\\/g, '\\\\')}" -DestinationPath "${pythonDir.replace(/\\/g, '\\\\')}" -Force
    Remove-Item -Force "${pythonZip.replace(/\\/g, '\\\\')}"
    $pthFile = Join-Path "${pythonDir.replace(/\\/g, '\\\\')}" "python311._pth"
    if (Test-Path $pthFile) {
      (Get-Content $pthFile) -replace '^#import site', 'import site' | Set-Content $pthFile
    }
  `;
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, { stdio: 'inherit', timeout: 60000 });
  } catch (_) {}
  return resolvePython3().ok;
}

// -------------------------------------------------------------
// 2. Scan & Setup uv (Fast Python tool runner)
// -------------------------------------------------------------
function resolveUv() {
  // 1. Check local portable directory FIRST
  const localUvPaths = [
    path.join(DEPENDENCY_DIR, 'uv', IS_WIN ? 'uv.exe' : 'uv'),
    path.join(DEPENDENCY_DIR, IS_WIN ? 'uv.exe' : 'uv')
  ];
  for (const p of localUvPaths) {
    if (fs.existsSync(p)) {
      const ver = runCmd(`"${p}" --version`);
      if (ver) {
        addPathToProcess(path.dirname(p));
        return { ok: true, version: `${ver} (local portable)`, path: p, source: 'local-dependency', addedToPath: true };
      }
    }
  }

  // 2. PATH
  const uvInPath = runCmd('uv --version');
  if (uvInPath) {
    return { ok: true, version: uvInPath, path: runCmd('where uv') || 'uv', source: 'system-path' };
  }

  // 3. Standard paths
  const standardUvPaths = [
    path.join(HOME_DIR, '.cargo', 'bin', 'uv.exe'),
    path.join(HOME_DIR, '.cargo', 'bin', 'uv'),
    path.join(HOME_DIR, '.local', 'bin', 'uv'),
    path.join(HOME_DIR, 'AppData', 'Local', 'bin', 'uv.exe'),
  ];

  for (const p of standardUvPaths) {
    if (fs.existsSync(p)) {
      const ver = runCmd(`"${p}" --version`);
      if (ver) {
        addPathToProcess(path.dirname(p));
        return { ok: true, version: ver, path: p, source: 'standard-path', addedToPath: true };
      }
    }
  }

  return { ok: false, version: null, path: null, source: null };
}

function downloadPortableUv() {
  if (!IS_WIN) {
    console.log('  [install] Installing uv standalone tool via curl...');
    runCmd('curl -LsSf https://astral.sh/uv/install.sh | sh');
    return resolveUv().ok;
  }
  const uvDir = path.join(DEPENDENCY_DIR, 'uv');
  const uvZip = path.join(DEPENDENCY_DIR, 'uv.zip');
  console.log('  [download] Downloading standalone uv for Windows...');
  const psScript = `
    $ErrorActionPreference = 'Stop'
    Invoke-WebRequest -Uri "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" -OutFile "${uvZip.replace(/\\/g, '\\\\')}"
    Expand-Archive -Path "${uvZip.replace(/\\/g, '\\\\')}" -DestinationPath "${uvDir.replace(/\\/g, '\\\\')}" -Force
    Remove-Item -Force "${uvZip.replace(/\\/g, '\\\\')}"
    if (Test-Path "${path.join(uvDir, 'uv.exe').replace(/\\/g, '\\\\')}") {
      Copy-Item "${path.join(uvDir, 'uv.exe').replace(/\\/g, '\\\\')}" "${path.join(DEPENDENCY_DIR, 'uv.exe').replace(/\\/g, '\\\\')}" -Force
    }
  `;
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, { stdio: 'inherit', timeout: 60000 });
  } catch (_) {}
  return resolveUv().ok;
}

// -------------------------------------------------------------
// 3. Scan & Setup FFmpeg
// -------------------------------------------------------------
function resolveFfmpeg() {
  try {
    const audioOptimizer = require('./audio-optimizer.cjs');
    return audioOptimizer.resolveFfmpeg();
  } catch (_) {
    const depFfmpeg = path.join(DEPENDENCY_DIR, 'ffmpeg', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(depFfmpeg)) {
      return { ok: true, path: depFfmpeg, version: 'FFmpeg (local)', source: 'local-dependency' };
    }
    const pathFfmpeg = runCmd('ffmpeg -version');
    if (pathFfmpeg) {
      return { ok: true, path: 'ffmpeg', version: pathFfmpeg.split('\n')[0], source: 'system-path' };
    }
    return { ok: false, path: null, version: null, source: null };
  }
}

function downloadPortableFfmpeg() {
  const ffmpegDir = path.join(DEPENDENCY_DIR, 'ffmpeg');
  // 1. Check if npm package ffmpeg-static has it
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      fs.mkdirSync(ffmpegDir, { recursive: true });
      fs.copyFileSync(ffmpegStatic, path.join(ffmpegDir, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg'));
      return resolveFfmpeg().ok;
    }
  } catch (_) {}

  // 2. Download from Gyan.dev essentials for Windows
  if (IS_WIN) {
    console.log('  [download] Downloading portable FFmpeg for Windows...');
    const ffmpegZip = path.join(DEPENDENCY_DIR, 'ffmpeg.zip');
    const psScript = `
      $ErrorActionPreference = 'Stop'
      Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "${ffmpegZip.replace(/\\/g, '\\\\')}"
      $tmpDir = Join-Path "${DEPENDENCY_DIR.replace(/\\/g, '\\\\')}" "ffmpeg-tmp"
      Expand-Archive -Path "${ffmpegZip.replace(/\\/g, '\\\\')}" -DestinationPath $tmpDir -Force
      $binExe = Get-ChildItem -Path $tmpDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
      if ($binExe) {
        New-Item -ItemType Directory -Force -Path "${ffmpegDir.replace(/\\/g, '\\\\')}" | Out-Null
        Copy-Item $binExe.FullName "${path.join(ffmpegDir, 'ffmpeg.exe').replace(/\\/g, '\\\\')}" -Force
      }
      Remove-Item -Recurse -Force $tmpDir
      Remove-Item -Force "${ffmpegZip.replace(/\\/g, '\\\\')}"
    `;
    try {
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, { stdio: 'inherit', timeout: 120000 });
    } catch (_) {}
    return resolveFfmpeg().ok;
  }
  return false;
}

// -------------------------------------------------------------
// 4. Scan All Dependencies
// -------------------------------------------------------------
function scanAllDependencies(autoDownload = false) {
  console.log('==> Scanning System & Portable Runtimes for Playable Tools & MCPs...');

  // Node.js
  const nodeVer = runCmd('node -v');
  if (nodeVer) {
    console.log(`  [ok] Node.js: ${nodeVer}`);
  } else {
    console.log('  [ERROR] Node.js is NOT installed! (Node 20+ or 22+ LTS required)');
  }

  // Git
  const gitVer = runCmd('git --version');
  if (gitVer) {
    console.log(`  [ok] Git: ${gitVer}`);
  } else {
    console.log('  [warn] Git is not installed or not in PATH.');
  }

  // Python 3
  let py = resolvePython3();
  if (!py.ok && autoDownload) {
    downloadPortablePython();
    py = resolvePython3();
  }
  if (py.ok) {
    console.log(`  [ok] Python: ${py.version} -> ${py.path} (${py.source})`);
  } else {
    console.log('  [info] Python 3.x not found. Run with --download-all to provision portable Python automatically.');
  }

  // uv
  let uv = resolveUv();
  if (!uv.ok && autoDownload) {
    downloadPortableUv();
    uv = resolveUv();
  }
  if (uv.ok) {
    console.log(`  [ok] uv: ${uv.version} -> ${uv.path} (${uv.source})`);
  } else {
    console.log('  [info] uv tool optional. Run with --download-all to provision standalone uv.');
  }

  // FFmpeg
  let ffmpeg = resolveFfmpeg();
  if (!ffmpeg.ok && autoDownload) {
    downloadPortableFfmpeg();
    ffmpeg = resolveFfmpeg();
  }
  if (ffmpeg.ok) {
    console.log(`  [ok] FFmpeg: ${ffmpeg.version} -> ${ffmpeg.path} (${ffmpeg.source})`);
  } else {
    console.log('  [info] FFmpeg not found. Run with --download-all to provision portable FFmpeg.');
  }

  // Cocos Creator 3.8.8
  const cocosPaths = [
    'C:\\Program Files\\Cocos\\Creator\\3.8.8\\CocosCreator.exe',
    'C:\\CocosDashboard\\resources\\.editors\\Creator\\3.8.8\\CocosCreator.exe',
    'D:\\CocosDashboard\\resources\\.editors\\Creator\\3.8.8\\CocosCreator.exe',
    path.join(HOME_DIR, 'AppData', 'Local', 'CocosDashboard', 'resources', '.editors', 'Creator', '3.8.8', 'CocosCreator.exe'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app'
  ];
  let foundCocos = cocosPaths.find(p => fs.existsSync(p));
  if (foundCocos) {
    console.log(`  [ok] Cocos Creator 3.8.8 -> ${foundCocos}`);
  } else {
    console.log('  [info] Cocos Creator 3.8.8 detected during project launch.');
  }

  // Blender 5.x / 4.x
  const blenderPaths = [
    'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
    'D:\\Tools\\Blender 5.2\\blender.exe',
    '/Applications/Blender.app'
  ];
  let foundBlender = blenderPaths.find(p => fs.existsSync(p));
  if (foundBlender) {
    console.log(`  [ok] Blender -> ${foundBlender}`);
  } else {
    console.log('  [skip] Blender optional for 3D porting.');
  }

  console.log('  [ok] Dependency scan and portable environment check completed.\n');
}

const args = process.argv.slice(2);
const autoDownload = args.includes('--download-all') || args.includes('--setup-portable');

scanAllDependencies(autoDownload);

module.exports = {
  resolvePython3,
  resolveUv,
  resolveFfmpeg,
  downloadPortablePython,
  downloadPortableUv,
  downloadPortableFfmpeg,
  DEPENDENCY_DIR,
};
