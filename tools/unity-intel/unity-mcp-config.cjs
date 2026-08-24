'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { isInside, validateUnityProject } = require('./unity-editor.cjs');

const CONFIG_RELATIVE_PATH = 'UserSettings/AI-Game-Developer-Config.json';
const SCAN_TOOL_NAME = 'playable-port-scan';

function normalizeProjectIdentity(projectRoot) {
  const input = String(projectRoot);
  const absolute = path.win32.isAbsolute(input) || path.posix.isAbsolute(input) ? input : path.resolve(input);
  const normalized = absolute.replace(/\\/g, '/').replace(/\/+$/, '');
  // C# ToLowerInvariant leaves U+0130 unchanged; JS expands it to i + combining dot.
  // Preserve the upstream golden-vector behavior before applying Unicode lower-case.
  return [...normalized].map(character => character === '\u0130' ? character : character.toLowerCase()).join('');
}

/** Mirrors Unity-MCP 0.89 ProjectIdentity.DerivePortV2 golden-vector contract. */
function deriveUnityMcpPort(projectRoot) {
  const digest = crypto.createHash('sha256').update(normalizeProjectIdentity(projectRoot), 'utf8').digest();
  return 20000 + (digest.readUInt32LE(0) % 10000);
}

function normalizeLoopbackUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const loopback = hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash ||
        (url.pathname && url.pathname !== '/')) return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

function isLoopbackUrl(value) {
  return normalizeLoopbackUrl(value) !== null;
}

function configPath(projectRoot) {
  return path.join(path.resolve(projectRoot), ...CONFIG_RELATIVE_PATH.split('/'));
}

function validateConfigPath(projectRoot, fsImpl = fs, pathImpl = path) {
  const project = validateUnityProject(projectRoot, { fs: fsImpl, path: pathImpl });
  const projectReal = fsImpl.realpathSync(project.projectRoot);
  const directory = pathImpl.join(project.projectRoot, 'UserSettings');
  if (fsImpl.existsSync(directory)) {
    const directoryStat = fsImpl.lstatSync(directory);
    if (directoryStat.isSymbolicLink()) {
      const error = new Error('UserSettings không được là symlink/junction khi ghi Unity-MCP config.');
      error.code = 'UNITY_MCP_CONFIG_SYMLINK_UNSUPPORTED';
      throw error;
    }
  } else {
    fsImpl.mkdirSync(directory, { recursive: false });
  }
  const directoryReal = fsImpl.realpathSync(directory);
  if (!isInside(pathImpl, projectReal, directoryReal)) {
    const error = new Error('UserSettings resolve ra ngoài Unity project.');
    error.code = 'UNITY_MCP_CONFIG_PATH_ESCAPE';
    throw error;
  }
  const filePath = pathImpl.join(directory, pathImpl.basename(CONFIG_RELATIVE_PATH));
  if (fsImpl.existsSync(filePath) && fsImpl.lstatSync(filePath).isSymbolicLink()) {
    const error = new Error('Unity-MCP config không được là symbolic link.');
    error.code = 'UNITY_MCP_CONFIG_SYMLINK_UNSUPPORTED';
    throw error;
  }
  return filePath;
}

function validateReadableConfigPath(projectRoot, fsImpl = fs, pathImpl = path) {
  const project = validateUnityProject(projectRoot, { fs: fsImpl, path: pathImpl });
  const directory = pathImpl.join(project.projectRoot, 'UserSettings');
  const filePath = pathImpl.join(directory, pathImpl.basename(CONFIG_RELATIVE_PATH));
  if (!fsImpl.existsSync(directory)) return filePath;
  if (fsImpl.lstatSync(directory).isSymbolicLink() ||
      !isInside(pathImpl, project.projectRoot, fsImpl.realpathSync(directory))) {
    const error = new Error('UserSettings symlink/junction không an toàn cho Unity-MCP config.');
    error.code = 'UNITY_MCP_CONFIG_SYMLINK_UNSUPPORTED';
    throw error;
  }
  if (fsImpl.existsSync(filePath) && fsImpl.lstatSync(filePath).isSymbolicLink()) {
    const error = new Error('Unity-MCP config không được là symbolic link.');
    error.code = 'UNITY_MCP_CONFIG_SYMLINK_UNSUPPORTED';
    throw error;
  }
  return filePath;
}

function readJsonIfPresent(filePath, fsImpl = fs) {
  if (!fsImpl.existsSync(filePath)) return { exists: false, bytes: null, value: {} };
  const bytes = fsImpl.readFileSync(filePath);
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return { exists: true, bytes, value: {} };
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`Unity-MCP config JSON không hợp lệ: ${CONFIG_RELATIVE_PATH}: ${error.message}`);
    wrapped.code = 'UNITY_MCP_CONFIG_INVALID';
    throw wrapped;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`Unity-MCP config phải là JSON object: ${CONFIG_RELATIVE_PATH}`);
    error.code = 'UNITY_MCP_CONFIG_INVALID';
    throw error;
  }
  return { exists: true, bytes, value };
}

function randomToken(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString('base64url');
}

function mergeTools(tools) {
  const output = [];
  const seen = new Set();
  for (const item of Array.isArray(tools) ? tools : []) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name) continue;
    const normalized = { ...item };
    if (item.name === SCAN_TOOL_NAME) normalized.enabled = true;
    output.push(normalized);
    seen.add(item.name);
  }
  if (!seen.has(SCAN_TOOL_NAME)) output.push({ name: SCAN_TOOL_NAME, enabled: true });
  return output;
}

function buildManagedConfig(current, projectRoot, options = {}) {
  const requestedUrl = options.url || `http://127.0.0.1:${deriveUnityMcpPort(projectRoot)}`;
  const normalizedUrl = normalizeLoopbackUrl(requestedUrl);
  if (!normalizedUrl) {
    const error = new Error('Unity intelligence chỉ cho phép Unity-MCP endpoint HTTP loopback.');
    error.code = 'UNITY_MCP_NON_LOOPBACK_REJECTED';
    throw error;
  }
  const token = options.token || (typeof current.token === 'string' && current.token) || randomToken(options.randomBytes);
  return {
    config: {
      ...current,
      host: requestedUrl.replace(/\/$/, ''),
      token,
      keepConnected: true,
      keepServerRunning: true,
      transportMethod: 'streamableHttp',
      authOption: 'token',
      connectionMode: 'Custom',
      tools: mergeTools(current.tools),
    },
    url: normalizedUrl,
    token,
  };
}

function sameBytes(left, right) {
  if (left === null || right === null) return left === right;
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function writeAtomic(filePath, bytes, fsImpl = fs, expectedBytes = undefined) {
  const directory = path.dirname(filePath);
  fsImpl.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fsImpl.writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    if (expectedBytes !== undefined) {
      const currentBytes = fsImpl.existsSync(filePath) ? fsImpl.readFileSync(filePath) : null;
      if (!sameBytes(currentBytes, expectedBytes)) {
        const error = new Error('Unity-MCP config đổi trong lúc transaction; từ chối ghi đè.');
        error.code = 'UNITY_MCP_CONFIG_WRITE_CONFLICT';
        throw error;
      }
    }
    fsImpl.renameSync(tempPath, filePath);
  } catch (error) {
    try { if (fsImpl.existsSync(tempPath)) fsImpl.unlinkSync(tempPath); } catch (_) { /* best effort */ }
    throw error;
  }
}

function ensureUnityMcpConfig(projectRoot, options = {}) {
  const fsImpl = options.fs || fs;
  const filePath = validateConfigPath(projectRoot, fsImpl, options.path || path);
  const previous = readJsonIfPresent(filePath, fsImpl);
  const managed = buildManagedConfig(previous.value, projectRoot, options);
  const nextBytes = Buffer.from(`${JSON.stringify(managed.config, null, 2)}\n`, 'utf8');
  const changed = !previous.bytes || !previous.bytes.equals(nextBytes);
  if (changed) writeAtomic(filePath, nextBytes, fsImpl, previous.bytes);
  const installedBytes = changed ? nextBytes : previous.bytes;
  let rolledBack = false;

  return {
    path: CONFIG_RELATIVE_PATH,
    url: managed.url,
    token: managed.token,
    changed,
    rollback() {
      if (rolledBack || !changed) return { restored: false, reason: rolledBack ? 'already-rolled-back' : 'unchanged' };
      const current = readJsonIfPresent(filePath, fsImpl);
      if (!current.bytes || !current.bytes.equals(installedBytes)) {
        const error = new Error('Không rollback Unity-MCP config vì file đã được Unity/người dùng thay đổi sau bootstrap.');
        error.code = 'UNITY_MCP_CONFIG_ROLLBACK_CONFLICT';
        throw error;
      }
      if (previous.exists) writeAtomic(filePath, previous.bytes, fsImpl, installedBytes);
      else fsImpl.unlinkSync(filePath);
      rolledBack = true;
      return { restored: true };
    },
  };
}

function readUnityMcpConnection(projectRoot, options = {}) {
  const env = options.env || process.env;
  const explicitUrl = options.url || env.UNITY_MCP_HOST;
  const explicitToken = options.token || env.UNITY_MCP_TOKEN;
  if (explicitUrl) {
    const normalizedUrl = normalizeLoopbackUrl(explicitUrl);
    if (!normalizedUrl) {
      const error = new Error('Unity intelligence chỉ kết nối Unity-MCP qua HTTP loopback.');
      error.code = 'UNITY_MCP_NON_LOOPBACK_REJECTED';
      throw error;
    }
    return { url: normalizedUrl, token: explicitToken || null, source: options.url ? 'option' : 'environment' };
  }
  const fsImpl = options.fs || fs;
  const current = readJsonIfPresent(validateReadableConfigPath(projectRoot, fsImpl, options.path || path), fsImpl);
  const configuredUrl = current.exists && typeof current.value.host === 'string'
    ? normalizeLoopbackUrl(current.value.host) : null;
  if (configuredUrl) {
    return {
      url: configuredUrl,
      token: explicitToken || (typeof current.value.token === 'string' ? current.value.token : null),
      source: 'project-config',
    };
  }
  return {
    url: `http://127.0.0.1:${deriveUnityMcpPort(projectRoot)}`,
    token: explicitToken || null,
    source: 'derived',
  };
}

function publicConnection(connection) {
  const url = normalizeLoopbackUrl(connection.url);
  return {
    url: url || null,
    authenticated: !!connection.token,
    source: connection.source || null,
  };
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  SCAN_TOOL_NAME,
  normalizeProjectIdentity,
  deriveUnityMcpPort,
  normalizeLoopbackUrl,
  isLoopbackUrl,
  configPath,
  validateConfigPath,
  validateReadableConfigPath,
  readJsonIfPresent,
  mergeTools,
  buildManagedConfig,
  sameBytes,
  writeAtomic,
  ensureUnityMcpConfig,
  readUnityMcpConnection,
  publicConnection,
};
