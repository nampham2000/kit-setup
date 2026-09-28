#!/usr/bin/env node
'use strict';

/**
 * Preview project identity guard.
 *
 * Several Cocos Creator editors can run on one machine; preview ports are handed out
 * first-come (7456, 7457, ...), so after an editor restart a port may belong to ANOTHER
 * project. Preview-based verifiers must prove the URL is served by the project they verify
 * before interpreting any gameplay result.
 *
 * Signal (strong): the Cocos 3.8 editor preview serves the project script import map at
 * `/scripting/x/import-map.json`. Its keys are absolute `file:///<projectRoot>/assets/...`
 * URLs of the project's own compiled scripts, so they name the exact project folder the
 * editor opened. This differs between git worktrees of one repo (package.json names do not).
 *
 * Signal (weak fallback): the preview page title `Cocos Creator - <project folder name>`.
 * Used only when the import map is unavailable or has no project scripts; a different folder
 * name proves a mismatch, an equal name is reported as a weak match.
 *
 * Result: { status: 'match' | 'mismatch' | 'unknown', signal, strength, evidence, ... }.
 * Only HTTP GET is used; the editor is never mutated.
 */

const fs = require('node:fs');
const path = require('node:path');

const IMPORT_MAP_PATH = '/scripting/x/import-map.json';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SCAN_PORTS = Object.freeze(Array.from({ length: 16 }, (_, index) => 7456 + index));
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MISMATCH_CODE = 'PREVIEW_PROJECT_MISMATCH';
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

function normalizeFsPath(value) {
  let text = String(value || '').replace(/\\/g, '/');
  if (/^\/[A-Za-z]:\//.test(text)) text = text.slice(1);
  text = text.replace(/\/+$/, '');
  if (/^[A-Za-z]:/.test(text) || process.platform === 'win32') text = text.toLowerCase();
  return text;
}

function fileUrlToProjectPath(key) {
  if (!/^file:\/\//i.test(key)) return null;
  let pathname;
  try { pathname = decodeURIComponent(new URL(key).pathname); } catch (_) { return null; }
  if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
  return pathname;
}

function isEngineInternalRoot(root) {
  return /\/resources\/3d\/engine(\/|$)/i.test(root) || /\/engine\/editor$/i.test(root);
}

/** Extract project roots (folder containing /assets/) from import-map keys, with counts. */
function projectRootsFromImportMap(importMap) {
  const imports = importMap && typeof importMap === 'object' && importMap.imports
    && typeof importMap.imports === 'object' ? importMap.imports : {};
  const counts = new Map();
  for (const key of Object.keys(imports)) {
    const filePath = fileUrlToProjectPath(key);
    if (!filePath) continue;
    const index = filePath.indexOf('/assets/');
    if (index <= 0) continue;
    const root = filePath.slice(0, index);
    if (isEngineInternalRoot(root)) continue;
    counts.set(root, (counts.get(root) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([root, scripts]) => ({ root, scripts }));
}

function parsePreviewTitle(html) {
  const match = /<title>\s*([^<]*?)\s*<\/title>/i.exec(String(html || ''));
  if (!match) return { title: null, projectName: null };
  const title = match[1];
  const named = /^Cocos Creator\s*-\s*(.+)$/i.exec(title);
  return { title, projectName: named ? named[1].trim() : null };
}

function expectedRoots(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const set = new Set([normalizeFsPath(resolved)]);
  try { set.add(normalizeFsPath(fs.realpathSync.native(resolved))); } catch (_) { /* keep resolved */ }
  return set;
}

function belongsToProject(root, expected) {
  const normalized = normalizeFsPath(root);
  for (const candidate of expected) {
    if (normalized === candidate || normalized.startsWith(`${candidate}/extensions/`)) return true;
  }
  return false;
}

async function fetchText(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: '*/*' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const text = await response.text();
    return { ok: !!response.ok, status: response.status, text: text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text };
  } catch (error) {
    return { ok: false, status: null, error: error && error.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(error && error.message || error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function previewOrigin(url) {
  const parsed = new URL(String(url));
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Preview URL phải là http(s): ${url}`);
  return parsed.origin;
}

/**
 * Probe which project a preview origin serves.
 * @returns {Promise<object>} identity result (never throws for network errors; status=unknown).
 */
async function probePreviewProjectIdentity(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  let origin;
  try { origin = previewOrigin(options.url); } catch (error) {
    return { status: 'unknown', origin: null, url: String(options.url || ''), expectedProjectRoot: projectRoot,
      signal: null, strength: null, evidence: { error: error.message }, message: error.message };
  }
  const base = {
    origin,
    url: String(options.url),
    expectedProjectRoot: projectRoot.replace(/\\/g, '/'),
    expectedProjectName: path.basename(projectRoot),
  };
  if (typeof fetchImpl !== 'function') {
    return { ...base, status: 'unknown', signal: null, strength: null, evidence: { error: 'fetch unavailable' },
      message: 'Không có fetch() trong Node runtime; không xác minh được project của preview.' };
  }
  const expected = expectedRoots(projectRoot);
  const [importMapResponse, pageResponse] = await Promise.all([
    fetchText(fetchImpl, `${origin}${IMPORT_MAP_PATH}`, timeoutMs),
    fetchText(fetchImpl, `${origin}/`, timeoutMs),
  ]);
  const evidence = {
    importMap: { path: IMPORT_MAP_PATH, httpStatus: importMapResponse.status, error: importMapResponse.error },
    page: { httpStatus: pageResponse.status, error: pageResponse.error },
  };
  let roots = [];
  if (importMapResponse.ok) {
    try {
      roots = projectRootsFromImportMap(JSON.parse(importMapResponse.text));
    } catch (error) {
      evidence.importMap.error = `invalid JSON: ${error.message}`;
    }
  }
  evidence.importMap.projectRoots = roots.slice(0, 4);
  const titleInfo = pageResponse.ok ? parsePreviewTitle(pageResponse.text) : { title: null, projectName: null };
  evidence.page.title = titleInfo.title;
  evidence.page.projectName = titleInfo.projectName;

  const own = roots.filter(entry => belongsToProject(entry.root, expected));
  const foreign = roots.filter(entry => !belongsToProject(entry.root, expected));
  if (own.length) {
    return { ...base, status: 'match', signal: 'import-map-project-root', strength: 'strong',
      servedProjectRoot: own[0].root, servedProjectName: titleInfo.projectName, evidence,
      message: `Preview ${origin} phục vụ đúng project ${own[0].root}.` };
  }
  if (foreign.length) {
    return { ...base, status: 'mismatch', signal: 'import-map-project-root', strength: 'strong',
      servedProjectRoot: foreign[0].root, servedProjectName: titleInfo.projectName, evidence,
      message: `Preview ${origin} phục vụ project ${foreign[0].root}, không phải ${base.expectedProjectRoot}.` };
  }
  if (titleInfo.projectName) {
    const same = titleInfo.projectName.toLowerCase() === base.expectedProjectName.toLowerCase();
    return { ...base, status: same ? 'match' : 'mismatch', signal: 'preview-title',
      strength: same ? 'weak' : 'strong', servedProjectRoot: null, servedProjectName: titleInfo.projectName, evidence,
      message: same
        ? `Preview ${origin} có title project "${titleInfo.projectName}" trùng tên folder (match yếu: import map không có script project).`
        : `Preview ${origin} phục vụ project "${titleInfo.projectName}", không phải "${base.expectedProjectName}" (${base.expectedProjectRoot}).` };
  }
  return { ...base, status: 'unknown', signal: null, strength: null, servedProjectRoot: null, servedProjectName: null,
    evidence, message: `Không xác định được project của preview ${origin} (không có ${IMPORT_MAP_PATH} hoặc title Cocos Creator).` };
}

/** Scan loopback preview ports for the one(s) serving projectRoot. Only on demand (mismatch hint). */
async function findPreviewPortsForProject(options = {}) {
  const ports = Array.isArray(options.ports) ? options.ports : DEFAULT_SCAN_PORTS;
  const host = options.host || 'localhost';
  const protocol = options.protocol || 'http:';
  const results = await Promise.all(ports.map(port => probePreviewProjectIdentity({
    url: `${protocol}//${host}:${port}/`,
    projectRoot: options.projectRoot,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || 1500,
  }).then(result => ({ port, result }))));
  return results
    .filter(entry => entry.result.status !== 'unknown')
    .map(entry => ({
      port: entry.port,
      origin: entry.result.origin,
      status: entry.result.status,
      strength: entry.result.strength,
      servedProjectRoot: entry.result.servedProjectRoot,
      servedProjectName: entry.result.servedProjectName,
    }));
}

function mismatchHint(result, candidates) {
  const own = (candidates || []).filter(entry => entry.status === 'match');
  const found = own.length
    ? ` Port đang phục vụ project này: ${own.map(entry => entry.origin).join(', ')}.`
    : '';
  return `${found} Tìm đúng port bằng Cocos MCP \`server_query_server_port\` của editor project này, `
    + '`node playable-shared-kit/tools/preview-project-identity.cjs --scan`, hoặc liệt kê port đang listen '
    + '(`netstat -ano | findstr :745`). Chỉ khi chủ ý test preview của project khác mới dùng --allow-foreign-preview.';
}

/**
 * Guard used by verifiers. mismatch => throws PREVIEW_PROJECT_MISMATCH unless allowForeign;
 * unknown => returns result with warning (caller continues).
 */
async function assertPreviewProjectIdentity(options = {}) {
  const probe = options.probe || probePreviewProjectIdentity;
  // A busy editor (recompiling scripts, reloading preview) can transiently drop requests;
  // retry unknown a few times so a foreign preview is not waved through as "unknown".
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : DEFAULT_RETRIES;
  const retryDelayMs = Number(options.retryDelayMs) >= 0 ? Number(options.retryDelayMs) : DEFAULT_RETRY_DELAY_MS;
  let result = await probe(options);
  let attempts = 1;
  while (result.status === 'unknown' && attempts <= retries) {
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    result = await probe(options);
    attempts += 1;
  }
  const record = {
    ...result,
    attempts,
    allowForeignPreview: options.allowForeign === true,
    checkedAt: new Date().toISOString(),
  };
  if (result.status === 'mismatch') {
    if (options.allowForeign === true) {
      record.overridden = true;
      record.warning = `${MISMATCH_CODE} bị bỏ qua bởi --allow-foreign-preview: ${result.message}`;
      return record;
    }
    let candidates = [];
    if (options.scanOnMismatch !== false) {
      try {
        candidates = await findPreviewPortsForProject({
          projectRoot: options.projectRoot, fetchImpl: options.fetchImpl, ports: options.scanPorts,
        });
      } catch (_) { candidates = []; }
    }
    const error = new Error(`${MISMATCH_CODE}: ${result.message} Expected project root: ${result.expectedProjectRoot}; `
      + `URL ${result.url} serves ${result.servedProjectRoot || result.servedProjectName || 'another project'}.`
      + mismatchHint(result, candidates));
    error.code = MISMATCH_CODE;
    error.details = { ...record, candidates };
    throw error;
  }
  if (result.status === 'unknown') {
    record.warning = `PREVIEW_PROJECT_UNKNOWN: ${result.message} Tiếp tục nhưng chưa chứng minh URL thuộc project này.`;
  }
  return record;
}

/** Compact identity record for receipts/manifests (bounded, no raw bodies). */
function compactEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return undefined;
  const part = value => (value ? {
    httpStatus: value.httpStatus === undefined ? null : value.httpStatus,
    ...(value.error ? { error: String(value.error).slice(0, 200) } : {}),
  } : undefined);
  return { importMap: part(evidence.importMap), page: part(evidence.page) };
}

function identityReceipt(record) {
  if (!record) return null;
  return {
    status: record.status,
    origin: record.origin,
    signal: record.signal,
    strength: record.strength,
    expectedProjectRoot: record.expectedProjectRoot,
    servedProjectRoot: record.servedProjectRoot || null,
    servedProjectName: record.servedProjectName || null,
    allowForeignPreview: record.allowForeignPreview === true,
    ...(Number.isInteger(record.attempts) ? { attempts: record.attempts } : {}),
    ...(record.status === 'unknown' && record.evidence ? { evidence: compactEvidence(record.evidence) } : {}),
    ...(record.overridden ? { overridden: true } : {}),
    ...(record.warning ? { warning: record.warning } : {}),
    ...(record.skipped ? { skipped: true, reason: record.reason } : {}),
  };
}

const USAGE = `Preview Project Identity

Usage:
  node playable-shared-kit/tools/preview-project-identity.cjs --url <previewUrl> [--project <dir>] [--json]
  node playable-shared-kit/tools/preview-project-identity.cjs --scan [--project <dir>] [--ports 7456-7471] [--json]

Đọc ${IMPORT_MAP_PATH} (key file:///<projectRoot>/assets/...) và title preview để
chứng minh URL preview thuộc project nào. Chỉ HTTP GET; không mutate editor.
Exit 0 = match, 2 = mismatch, 3 = unknown (--url); --scan in mọi port có preview Cocos.`;

function parseCliArgs(argv) {
  const options = { json: false, scan: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--scan') options.scan = true;
    else if (arg === '--url') options.url = argv[++index];
    else if (arg.startsWith('--url=')) options.url = arg.slice(6);
    else if (arg === '--project') options.project = argv[++index];
    else if (arg.startsWith('--project=')) options.project = arg.slice(10);
    else if (arg === '--ports' || arg.startsWith('--ports=')) {
      const value = arg === '--ports' ? argv[++index] : arg.slice(8);
      const range = /^(\d+)-(\d+)$/.exec(String(value || ''));
      if (!range || Number(range[2]) < Number(range[1]) || Number(range[2]) - Number(range[1]) > 64) {
        throw new Error('--ports cần dạng <from>-<to> (tối đa 65 port).');
      }
      options.ports = Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
    } else throw new Error(`Option không hỗ trợ: ${arg}`);
  }
  if (!options.help && !options.scan && !options.url) throw new Error('Cần --url <previewUrl> hoặc --scan.');
  return options;
}

function defaultProjectRoot() {
  return path.resolve(__dirname, '..', '..');
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  const projectRoot = path.resolve(options.project || defaultProjectRoot());
  if (options.scan) {
    const found = await findPreviewPortsForProject({ projectRoot, ports: options.ports });
    if (options.json) console.log(JSON.stringify({ ok: found.some(entry => entry.status === 'match'), projectRoot, previews: found }, null, 2));
    else {
      console.log(`[preview-project-identity] project: ${projectRoot}`);
      if (!found.length) console.log('  Không có preview Cocos nào trả lời trên các port đã quét.');
      for (const entry of found) {
        console.log(`  ${entry.status === 'match' ? '[this project]' : '[other]       '} ${entry.origin} -> ${entry.servedProjectRoot || entry.servedProjectName}`);
      }
    }
    if (!found.some(entry => entry.status === 'match')) process.exitCode = 3;
    return;
  }
  const result = await probePreviewProjectIdentity({ url: options.url, projectRoot });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`[preview-project-identity] ${result.status}: ${result.message}`);
  process.exitCode = result.status === 'match' ? 0 : result.status === 'mismatch' ? 2 : 3;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[preview-project-identity] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  IMPORT_MAP_PATH,
  MISMATCH_CODE,
  DEFAULT_SCAN_PORTS,
  normalizeFsPath,
  projectRootsFromImportMap,
  parsePreviewTitle,
  probePreviewProjectIdentity,
  findPreviewPortsForProject,
  assertPreviewProjectIdentity,
  identityReceipt,
  parseCliArgs,
};
