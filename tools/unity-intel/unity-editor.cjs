'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const UNITY_VERSION_RE = /(\d+\.\d+\.\d+[abfp]\d+)/i;
const EXPLICIT_EDITOR_ENV_KEYS = Object.freeze([
  'CC_PLAYABLE_UNITY_EDITOR',
  'UNITY_EDITOR_PATH',
]);

class UnityEditorInfrastructureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UnityEditorInfrastructureError';
    this.code = code;
    this.details = details;
  }
}

function normalizeVersion(value) {
  const match = UNITY_VERSION_RE.exec(String(value || ''));
  return match ? match[1] : null;
}

function parseUnityProjectVersion(text) {
  const source = String(text || '');
  const versionLine = /^m_EditorVersion:\s*(\S+)\s*$/m.exec(source);
  if (!versionLine || !normalizeVersion(versionLine[1])) {
    throw new UnityEditorInfrastructureError(
      'UNITY_PROJECT_VERSION_INVALID',
      'ProjectSettings/ProjectVersion.txt does not contain a valid m_EditorVersion.',
    );
  }
  const revisionLine = /^m_EditorVersionWithRevision:\s*\S+\s*\(([0-9a-f]+)\)\s*$/im.exec(source);
  return {
    version: normalizeVersion(versionLine[1]),
    revision: revisionLine ? revisionLine[1].toLowerCase() : null,
  };
}

function realpath(fsImpl, value) {
  return fsImpl.realpathSync(value);
}

function isInside(pathImpl, parent, candidate) {
  const relative = pathImpl.relative(pathImpl.resolve(parent), pathImpl.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !pathImpl.isAbsolute(relative));
}

function statOrNull(fsImpl, value) {
  try { return fsImpl.statSync(value); } catch (_) { return null; }
}

function validateUnityProject(projectPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  if (!projectPath || typeof projectPath !== 'string') {
    throw new UnityEditorInfrastructureError('UNITY_PROJECT_PATH_REQUIRED', 'Unity project path is required.');
  }

  const requestedRoot = pathImpl.resolve(projectPath);
  const rootStat = statOrNull(fsImpl, requestedRoot);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new UnityEditorInfrastructureError(
      'UNITY_PROJECT_NOT_FOUND',
      `Unity project directory not found: ${requestedRoot}`,
      { projectRoot: requestedRoot },
    );
  }

  const projectRoot = realpath(fsImpl, requestedRoot);
  const assetsPath = pathImpl.join(projectRoot, 'Assets');
  const packagesPath = pathImpl.join(projectRoot, 'Packages');
  const projectSettingsPath = pathImpl.join(projectRoot, 'ProjectSettings');
  const versionFile = pathImpl.join(projectSettingsPath, 'ProjectVersion.txt');
  const requiredDirectories = [assetsPath, packagesPath, projectSettingsPath];
  const missing = requiredDirectories.filter(value => {
    const entry = statOrNull(fsImpl, value);
    return !entry || !entry.isDirectory();
  });
  if (missing.length || !statOrNull(fsImpl, versionFile)) {
    throw new UnityEditorInfrastructureError(
      'UNITY_PROJECT_INVALID',
      `Directory is not a complete Unity project: ${projectRoot}`,
      { projectRoot, missing: [...missing, ...(!statOrNull(fsImpl, versionFile) ? [versionFile] : [])] },
    );
  }

  const parsed = parseUnityProjectVersion(fsImpl.readFileSync(versionFile, 'utf8'));
  return Object.freeze({
    projectRoot,
    requestedRoot,
    assetsPath,
    packagesPath,
    projectSettingsPath,
    versionFile,
    unityVersion: parsed.version,
    unityRevision: parsed.revision,
  });
}

function editorExecutableNames(platform) {
  if (platform === 'win32') return ['Editor/Unity.exe'];
  if (platform === 'darwin') return ['Unity.app/Contents/MacOS/Unity'];
  return ['Editor/Unity'];
}

function inferEditorVersion(editorPath) {
  const segments = String(editorPath || '').replace(/\\/g, '/').split('/');
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const version = normalizeVersion(segments[index]);
    if (version) return version;
  }
  return null;
}

function deduplicatePaths(values, pathImpl, platform) {
  const seen = new Set();
  const result = [];
  for (const value of values.filter(Boolean)) {
    const resolved = pathImpl.resolve(value);
    const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function executableCandidates(inputPath, requiredVersion, platform, pathImpl) {
  const value = pathImpl.resolve(inputPath);
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  if (normalized.endsWith('/unity.exe') || normalized.endsWith('/macos/unity') ||
      (platform !== 'win32' && normalized.endsWith('/editor/unity'))) {
    return [value];
  }
  const candidates = [];
  for (const relative of editorExecutableNames(platform)) {
    candidates.push(pathImpl.join(value, relative));
    candidates.push(pathImpl.join(value, requiredVersion, relative));
  }
  return deduplicatePaths(candidates, pathImpl, platform);
}

function readJsonIfPresent(filePath, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function collectHubEditorRecords(value, inheritedVersion = null, records = []) {
  if (!value) return records;
  if (Array.isArray(value)) {
    for (const item of value) collectHubEditorRecords(item, inheritedVersion, records);
    return records;
  }
  if (typeof value !== 'object') return records;

  const version = normalizeVersion(value.version || value.displayVersion || inheritedVersion);
  for (const key of ['location', 'path', 'installPath', 'executablePath']) {
    const locations = Array.isArray(value[key]) ? value[key] : [value[key]];
    for (const location of locations) {
      if (typeof location === 'string' && /(?:unity(?:\.exe|\.app)?|[/\\]editor)(?:[/\\]|$)/i.test(location)) {
        records.push({ path: location, version });
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (['location', 'path', 'installPath', 'executablePath'].includes(key)) continue;
    collectHubEditorRecords(child, normalizeVersion(key) || version, records);
  }
  return records;
}

function hubConfigDirectory(platform, env, homeDir, pathImpl) {
  if (platform === 'win32') return env.APPDATA ? pathImpl.join(env.APPDATA, 'UnityHub') : null;
  if (platform === 'darwin') return pathImpl.join(homeDir, 'Library', 'Application Support', 'UnityHub');
  return pathImpl.join(env.XDG_CONFIG_HOME || pathImpl.join(homeDir, '.config'), 'UnityHub');
}

function defaultEditorRoots(platform, env, homeDir, pathImpl) {
  if (platform === 'win32') {
    return [
      env.PROGRAMFILES && pathImpl.join(env.PROGRAMFILES, 'Unity', 'Hub', 'Editor'),
      env['PROGRAMFILES(X86)'] && pathImpl.join(env['PROGRAMFILES(X86)'], 'Unity', 'Hub', 'Editor'),
      'C:\\Program Files\\Unity\\Hub\\Editor',
    ].filter(Boolean);
  }
  if (platform === 'darwin') return ['/Applications/Unity/Hub/Editor'];
  return [pathImpl.join(homeDir, 'Unity', 'Hub', 'Editor'), '/opt/unity/editors'];
}

function discoverHubCandidates(options) {
  const fsImpl = options.fs;
  const pathImpl = options.path;
  const platform = options.platform;
  const env = options.env;
  const requiredVersion = options.requiredVersion;
  const homeDir = options.homeDir;
  const records = [];
  const roots = [...(options.editorRoots || [])];
  const configDir = hubConfigDirectory(platform, env, homeDir, pathImpl);

  if (configDir) {
    for (const name of ['editors-v2.json', 'editors.json']) {
      const parsed = readJsonIfPresent(pathImpl.join(configDir, name), fsImpl);
      collectHubEditorRecords(parsed, null, records);
    }
    const secondary = readJsonIfPresent(pathImpl.join(configDir, 'secondaryInstallPath.json'), fsImpl);
    if (typeof secondary === 'string') roots.push(secondary);
  }
  roots.push(...defaultEditorRoots(platform, env, homeDir, pathImpl));

  const available = [];
  const exact = [];
  for (const record of records) {
    const recordVersion = record.version || inferEditorVersion(record.path);
    for (const candidate of executableCandidates(record.path, requiredVersion, platform, pathImpl)) {
      const stat = statOrNull(fsImpl, candidate);
      if (!stat || !stat.isFile()) continue;
      available.push({ path: candidate, version: recordVersion, source: 'hub-config' });
      if (recordVersion === requiredVersion) exact.push({ path: candidate, version: recordVersion, source: 'hub-config' });
    }
  }

  for (const root of deduplicatePaths(roots, pathImpl, platform)) {
    let entries = [];
    try { entries = fsImpl.readdirSync(root, { withFileTypes: true }); } catch (_) { /* optional root */ }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const version = normalizeVersion(entry.name);
      if (!version) continue;
      for (const candidate of executableCandidates(pathImpl.join(root, entry.name), version, platform, pathImpl)) {
        const stat = statOrNull(fsImpl, candidate);
        if (!stat || !stat.isFile()) continue;
        available.push({ path: candidate, version, source: 'editor-root' });
        if (version === requiredVersion) exact.push({ path: candidate, version, source: 'editor-root' });
      }
    }
    for (const candidate of executableCandidates(root, requiredVersion, platform, pathImpl)) {
      const stat = statOrNull(fsImpl, candidate);
      if (!stat || !stat.isFile()) continue;
      exact.push({ path: candidate, version: requiredVersion, source: 'exact-root' });
    }
  }

  const unique = list => {
    const seen = new Set();
    return list.filter(item => {
      const key = platform === 'win32' ? item.path.toLowerCase() : item.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return { exact: unique(exact), available: unique(available) };
}

function discoverUnityEditor(projectOrPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const platform = options.platform || processImpl.platform;
  const env = options.env || processImpl.env || {};
  const homeDir = options.homeDir || os.homedir();
  const project = typeof projectOrPath === 'string'
    ? validateUnityProject(projectOrPath, { fs: fsImpl, path: pathImpl })
    : projectOrPath;
  const requiredVersion = project.unityVersion;
  const requiredRevision = project.unityRevision;

  let explicitPath = options.editorPath || null;
  let explicitSource = options.editorPath ? 'option' : null;
  if (!explicitPath) {
    for (const key of EXPLICIT_EDITOR_ENV_KEYS) {
      if (!env[key]) continue;
      explicitPath = env[key];
      explicitSource = `env:${key}`;
      break;
    }
  }

  if (explicitPath) {
    const candidates = executableCandidates(explicitPath, requiredVersion, platform, pathImpl);
    const editorPath = candidates.find(candidate => {
      const entry = statOrNull(fsImpl, candidate);
      return entry && entry.isFile();
    });
    if (!editorPath) {
      return {
        status: 'error',
        code: 'UNITY_EDITOR_EXPLICIT_NOT_FOUND',
        requiredVersion,
        requiredRevision,
        source: explicitSource,
        editor: null,
        checked: candidates,
      };
    }
    const explicitVersion = normalizeVersion(options.editorVersion || env.CC_PLAYABLE_UNITY_EDITOR_VERSION ||
      env.UNITY_EDITOR_VERSION) || inferEditorVersion(editorPath) ||
      (typeof options.probeEditorVersion === 'function' ? normalizeVersion(options.probeEditorVersion(editorPath)) : null);
    if (!explicitVersion) {
      return {
        status: 'error',
        code: 'UNITY_EDITOR_VERSION_UNKNOWN',
        requiredVersion,
        requiredRevision,
        source: explicitSource,
        editor: { path: editorPath, version: null },
        checked: candidates,
      };
    }
    if (explicitVersion !== requiredVersion) {
      return {
        status: 'mismatch',
        code: 'UNITY_EDITOR_VERSION_MISMATCH',
        requiredVersion,
        requiredRevision,
        source: explicitSource,
        editor: { path: editorPath, version: explicitVersion },
        checked: candidates,
      };
    }
    return {
      status: 'ready',
      code: null,
      requiredVersion,
      requiredRevision,
      source: explicitSource,
      editor: { path: editorPath, version: explicitVersion },
      checked: candidates,
      available: [{ path: editorPath, version: explicitVersion, source: explicitSource }],
    };
  }

  const discovered = discoverHubCandidates({
    fs: fsImpl,
    path: pathImpl,
    platform,
    env,
    homeDir,
    requiredVersion,
    editorRoots: options.editorRoots,
  });
  if (discovered.exact.length) {
    const selected = discovered.exact[0];
    return {
      status: 'ready',
      code: null,
      requiredVersion,
      requiredRevision,
      source: selected.source,
      editor: { path: selected.path, version: selected.version },
      checked: discovered.available.map(item => item.path),
      available: discovered.available,
    };
  }
  return {
    status: 'missing',
    code: 'UNITY_EDITOR_EXACT_VERSION_MISSING',
    requiredVersion,
    requiredRevision,
    source: null,
    editor: null,
    checked: discovered.available.map(item => item.path),
    available: discovered.available,
  };
}

function defaultLockProbe(lockFile, fsImpl) {
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(lockFile, 'r');
    fsImpl.closeSync(descriptor);
    return { state: 'stale', error: null };
  } catch (error) {
    if (descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
    if (error && error.code === 'ENOENT') return { state: 'unlocked', error: null };
    if (error && ['EACCES', 'EBUSY', 'EPERM'].includes(error.code)) {
      return { state: 'held', error: error.message };
    }
    return { state: 'unknown', error: error ? error.message : 'Unknown lock probe failure' };
  }
}

function getUnityProjectLockStatus(projectOrPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const project = typeof projectOrPath === 'string'
    ? validateUnityProject(projectOrPath, { fs: fsImpl, path: pathImpl })
    : projectOrPath;
  const lockFile = pathImpl.join(project.projectRoot, 'Temp', 'UnityLockfile');
  const exists = !!statOrNull(fsImpl, lockFile);
  if (!exists) return { state: 'unlocked', locked: false, path: lockFile, error: null };
  const result = typeof options.lockProbe === 'function'
    ? options.lockProbe(lockFile, { fs: fsImpl, project })
    : defaultLockProbe(lockFile, fsImpl);
  const state = typeof result === 'string' ? result : result.state;
  return {
    state,
    locked: state === 'held',
    path: lockFile,
    error: typeof result === 'string' ? null : (result.error || null),
  };
}

function readOpenUnityEditorInstance(projectOrPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const project = typeof projectOrPath === 'string'
    ? validateUnityProject(projectOrPath, { fs: fsImpl, path: pathImpl })
    : projectOrPath;
  const instanceFile = pathImpl.join(project.projectRoot, 'Library', 'EditorInstance.json');
  const instance = readJsonIfPresent(instanceFile, fsImpl);
  if (!instance) return { status: 'missing', processId: null, instanceFile };
  const processId = Number(instance.process_id);
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    return { status: 'invalid', processId: null, instanceFile };
  }
  const version = normalizeVersion(instance.version);
  if (version !== project.unityVersion) {
    return { status: 'version-mismatch', processId, version, instanceFile };
  }
  return { status: 'ready', processId, version, instanceFile };
}

const WINDOWS_EDITOR_REFRESH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$targetPid = [int]$env:CC_PLAYABLE_REFRESH_PID
$expectedProject = [IO.Path]::GetFullPath($env:CC_PLAYABLE_REFRESH_PROJECT).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $targetPid)
if (-not $processInfo -or $processInfo.Name -ne 'Unity.exe') { exit 11 }
$commandLine = [string]$processInfo.CommandLine
if ($commandLine -notmatch '(?i)(?:^|\s)-projectpath\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))') { exit 12 }
$actualProjectValue = if ($Matches['quoted']) { $Matches['quoted'] } else { $Matches['plain'] }
$actualProject = [IO.Path]::GetFullPath($actualProjectValue).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($expectedProject, $actualProject)) { exit 13 }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CcPlayableUnityRefreshKeys {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
$editor = Get-Process -Id $targetPid
if ($editor.MainWindowHandle -eq [IntPtr]::Zero) { exit 14 }
[CcPlayableUnityRefreshKeys]::ShowWindowAsync($editor.MainWindowHandle, 9) | Out-Null
if (-not [CcPlayableUnityRefreshKeys]::SetForegroundWindow($editor.MainWindowHandle)) { exit 15 }
Start-Sleep -Milliseconds 200
$foregroundPid = [uint32]0
[CcPlayableUnityRefreshKeys]::GetWindowThreadProcessId([CcPlayableUnityRefreshKeys]::GetForegroundWindow(), [ref]$foregroundPid) | Out-Null
if ($foregroundPid -ne $targetPid) { exit 16 }
[CcPlayableUnityRefreshKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[CcPlayableUnityRefreshKeys]::keybd_event(0x52, 0, 0, [UIntPtr]::Zero)
[CcPlayableUnityRefreshKeys]::keybd_event(0x52, 0, 2, [UIntPtr]::Zero)
[CcPlayableUnityRefreshKeys]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
`;

function refreshOpenUnityEditor(projectOrPath, options = {}) {
  const processImpl = options.process || process;
  const platform = options.platform || processImpl.platform;
  const project = typeof projectOrPath === 'string'
    ? validateUnityProject(projectOrPath, options)
    : projectOrPath;
  const instance = readOpenUnityEditorInstance(project, options);
  if (instance.status !== 'ready') {
    return { attempted: false, dispatched: false, reason: `editor-instance-${instance.status}` };
  }
  if (platform !== 'win32') {
    return { attempted: false, dispatched: false, reason: 'platform-refresh-unsupported' };
  }
  const env = options.env || processImpl.env || {};
  const pathImpl = options.path || path;
  const powershell = pathImpl.join(
    env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', WINDOWS_EDITOR_REFRESH_SCRIPT,
  ], {
    cwd: project.projectRoot,
    env: {
      ...env,
      CC_PLAYABLE_REFRESH_PID: String(instance.processId),
      CC_PLAYABLE_REFRESH_PROJECT: project.projectRoot,
    },
    encoding: 'utf8',
    timeout: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return {
      attempted: true,
      dispatched: false,
      reason: result.error && result.error.code || `refresh-exit-${result.status}`,
    };
  }
  return {
    attempted: true,
    dispatched: true,
    method: 'windows-targeted-ctrl-r',
    processId: instance.processId,
  };
}

function defaultEditorLogPath(platform, env, homeDir, pathImpl) {
  if (platform === 'win32') {
    return env.LOCALAPPDATA ? pathImpl.join(env.LOCALAPPDATA, 'Unity', 'Editor', 'Editor.log') : null;
  }
  if (platform === 'darwin') return pathImpl.join(homeDir, 'Library', 'Logs', 'Unity', 'Editor.log');
  return pathImpl.join(env.XDG_CONFIG_HOME || pathImpl.join(homeDir, '.config'), 'unity3d', 'Editor.log');
}

function readBoundedFileTail(filePath, maxBytes, fsImpl) {
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(filePath, 'r');
    const stat = fsImpl.fstatSync(descriptor);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    fsImpl.readSync(descriptor, buffer, 0, length, stat.size - length);
    return buffer.toString('utf8');
  } catch (_) {
    return null;
  } finally {
    if (descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
  }
}

function readUnityCompileDiagnostics(projectOrPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const platform = options.platform || processImpl.platform;
  const env = options.env || processImpl.env || {};
  const homeDir = options.homeDir || os.homedir();
  const project = typeof projectOrPath === 'string'
    ? validateUnityProject(projectOrPath, { fs: fsImpl, path: pathImpl })
    : projectOrPath;
  const logPath = options.editorLog || defaultEditorLogPath(platform, env, homeDir, pathImpl);
  if (!logPath) return null;
  const maxBytes = Number.isFinite(options.maxBytes)
    ? Math.max(64 * 1024, Math.min(Math.floor(options.maxBytes), 32 * 1024 * 1024))
    : 16 * 1024 * 1024;
  const tail = readBoundedFileTail(logPath, maxBytes, fsImpl);
  if (!tail) return null;
  const lines = tail.split(/\r?\n/);
  const projectKey = project.projectRoot.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  let targetStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^WorkingDir:\s*(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const workingDir = match[1].replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    if (workingDir === projectKey) targetStart = index + 1;
  }
  if (targetStart < 0) return null;
  let targetEnd = lines.length;
  for (let index = targetStart; index < lines.length; index += 1) {
    if (/^WorkingDir:\s*/.test(lines[index])) { targetEnd = index; break; }
  }
  const evidence = [];
  const seen = new Set();
  for (const line of lines.slice(targetStart, targetEnd)) {
    const trimmed = line.trim();
    if (!/^(?:(?:Assets|Packages)[\\/]|[A-Za-z]:[\\/]).+\(\d+,\d+\):\s*error\s+CS\d+:/i.test(trimmed)) continue;
    let logical = trimmed;
    const normalized = logical.replace(/\\/g, '/');
    const absolutePrefix = `${projectKey}/`;
    if (normalized.toLowerCase().startsWith(absolutePrefix)) logical = normalized.slice(absolutePrefix.length);
    logical = logical.slice(0, 500);
    if (seen.has(logical)) continue;
    seen.add(logical);
    evidence.push(logical);
    if (evidence.length >= 64) break;
  }
  if (!evidence.length) return null;
  return {
    code: 'UNITY_PROJECT_COMPILE_ERRORS',
    count: evidence.length,
    evidence: evidence.slice(0, 8),
    source: 'bounded-editor-log-tail',
    truncated: evidence.length > 8,
  };
}

function readUnityPackageDiagnostics(projectOrPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const platform = options.platform || processImpl.platform;
  const env = options.env || processImpl.env || {};
  const homeDir = options.homeDir || os.homedir();
  const project = typeof projectOrPath === 'string'
    ? validateUnityProject(projectOrPath, { fs: fsImpl, path: pathImpl }) : projectOrPath;
  const logPath = options.editorLog || defaultEditorLogPath(platform, env, homeDir, pathImpl);
  if (!logPath) return null;
  const tail = readBoundedFileTail(logPath, Number(options.maxBytes) || 4 * 1024 * 1024, fsImpl);
  if (!tail) return null;
  const lines = tail.split(/\r?\n/);
  const projectKey = project.projectRoot.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  let targetStart = -1;
  for (let index = 0; index < lines.length; index++) {
    const match = /^WorkingDir:\s*(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    if (match[1].replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === projectKey) targetStart = index + 1;
  }
  if (targetStart < 0) return null;
  let targetEnd = lines.length;
  for (let index = targetStart; index < lines.length; index++) {
    if (/^WorkingDir:\s*/.test(lines[index])) { targetEnd = index; break; }
  }
  const evidence = [];
  const seen = new Set();
  let code = null;
  for (const line of lines.slice(targetStart, targetEnd)) {
    const trimmed = line.trim();
    if (/Curl error 35:.*Cert(?:ificate)? verify failed/i.test(trimmed)
      || /UnityTls error code:\s*7/i.test(trimmed)) {
      code = 'UNITY_PACKAGE_TLS_CERTIFICATE_ERROR';
    } else if (/(?:Package Manager|UPM).*(?:error|failed)|Error adding package/i.test(trimmed)) {
      code = code || 'UNITY_PACKAGE_RESOLUTION_ERROR';
    } else continue;
    const bounded = trimmed.slice(0, 500);
    if (!seen.has(bounded)) {
      seen.add(bounded);
      evidence.push(bounded);
      if (evidence.length >= 8) break;
    }
  }
  if (!code) return null;
  return {
    code,
    count: evidence.length,
    evidence,
    source: 'bounded-editor-log-tail',
  };
}

function defaultHubPath(platform, env, pathImpl) {
  if (platform === 'win32') return pathImpl.join(env.PROGRAMFILES || 'C:\\Program Files', 'Unity Hub', 'Unity Hub.exe');
  if (platform === 'darwin') return '/Applications/Unity Hub.app/Contents/MacOS/Unity Hub';
  return null;
}

function buildHubInstallRemediation(project, options = {}) {
  if (!project || !project.unityVersion) return null;
  const processImpl = options.process || process;
  const platform = options.platform || processImpl.platform;
  const env = options.env || processImpl.env || {};
  const pathImpl = options.path || path;
  const executable = options.hubPath || defaultHubPath(platform, env, pathImpl);
  if (!executable) return null;
  const args = platform === 'linux' ? ['--headless'] : ['--', '--headless'];
  args.push('install', '--version', project.unityVersion);
  if (project.unityRevision) args.push('--changeset', project.unityRevision);
  args.push('--errors');
  return { executable, args };
}

function doctorUnityEditor(projectPath, options = {}) {
  const issues = [];
  let project;
  try {
    project = validateUnityProject(projectPath, options);
  } catch (error) {
    return {
      ok: false,
      ready: false,
      canLaunch: false,
      canAttach: false,
      project: null,
      editor: null,
      lock: null,
      remediation: null,
      issues: [{ code: error.code || 'UNITY_PROJECT_INVALID', severity: 'high', message: error.message }],
    };
  }

  const lock = getUnityProjectLockStatus(project, options);
  const editor = discoverUnityEditor(project, options);
  if (editor.status !== 'ready') {
    issues.push({
      code: editor.code,
      severity: 'high',
      message: editor.status === 'mismatch'
        ? `Explicit Unity Editor ${editor.editor.version} does not match project ${project.unityVersion}.`
        : `Exact Unity Editor ${project.unityVersion} is not available.`,
    });
  }
  if (lock.state === 'held') {
    issues.push({
      code: 'UNITY_PROJECT_ALREADY_OPEN',
      severity: 'medium',
      message: 'UnityLockfile is actively held; attach to the existing Editor or close it before batch launch.',
    });
  } else if (lock.state === 'unknown') {
    issues.push({
      code: 'UNITY_PROJECT_LOCK_UNKNOWN',
      severity: 'medium',
      message: `Unity project lock could not be classified: ${lock.error || 'unknown error'}`,
    });
  }

  const ready = editor.status === 'ready';
  const canLaunch = ready && lock.state !== 'held' && lock.state !== 'unknown';
  return {
    ok: canLaunch,
    ready,
    canLaunch,
    canAttach: ready && lock.state === 'held',
    project,
    editor,
    lock,
    remediation: editor.status === 'missing' ? buildHubInstallRemediation(project, options) : null,
    issues,
  };
}

module.exports = {
  UNITY_VERSION_RE,
  EXPLICIT_EDITOR_ENV_KEYS,
  UnityEditorInfrastructureError,
  normalizeVersion,
  parseUnityProjectVersion,
  validateUnityProject,
  inferEditorVersion,
  discoverUnityEditor,
  getUnityProjectLockStatus,
  readOpenUnityEditorInstance,
  refreshOpenUnityEditor,
  readUnityCompileDiagnostics,
  readUnityPackageDiagnostics,
  buildHubInstallRemediation,
  doctorUnityEditor,
  isInside,
};
