'use strict';

const fs = require('node:fs');
const path = require('node:path');

const UNITY_MCP_TOOL_ID = 'playable-port-scan';
const UNITY_MCP_CONFIG_RELATIVE_PATH = 'UserSettings/AI-Game-Developer-Config.json';
const ALLOWED_ACTIONS = new Set(['probe', 'scan', 'evidence']);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class UnityMcpProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'UnityMcpProviderError';
    this.code = code;
    if (Number.isInteger(options.status)) this.status = options.status;
    this.retryable = options.retryable === true;
  }
}

function redactSensitive(value, secrets = []) {
  let message = String(value || 'Unity MCP request failed.');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    message = message.split(secret).join('<redacted>');
  }
  message = message
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
    .replace(/([?&](?:access_?token|token|api_?key|authorization)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return message.slice(0, 400);
}

function providerError(code, message, options = {}) {
  return new UnityMcpProviderError(
    code,
    redactSensitive(message, options.secrets || []),
    options,
  );
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (!match) return false;
  return match.slice(1).every(value => Number(value) >= 0 && Number(value) <= 255);
}

function normalizeBaseUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (_) {
    throw providerError('UNITY_MCP_URL_INVALID', 'Unity MCP URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw providerError('UNITY_MCP_URL_INVALID', 'Unity MCP URL must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw providerError('UNITY_MCP_URL_INVALID', 'Unity MCP URL must not contain credentials, a query, or a fragment.');
  }
  if (options.allowRemote !== true && !isLoopbackHostname(parsed.hostname)) {
    throw providerError('UNITY_MCP_REMOTE_REJECTED', 'Unity MCP URL must resolve to loopback unless allowRemote is explicit.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function readUnityMcpConfig(projectRoot, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw providerError(
      'UNITY_MCP_CONNECTION_REQUIRED',
      'Provide a Unity MCP URL or a Unity project root containing UserSettings config.',
    );
  }
  const configPath = pathImpl.join(projectRoot, ...UNITY_MCP_CONFIG_RELATIVE_PATH.split('/'));
  let text;
  try {
    text = fsImpl.readFileSync(configPath, 'utf8');
  } catch (_) {
    throw providerError(
      'UNITY_MCP_CONFIG_MISSING',
      'Unity MCP UserSettings config is unavailable for this project.',
    );
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value;
  } catch (_) {
    throw providerError('UNITY_MCP_CONFIG_INVALID', 'Unity MCP UserSettings config contains invalid JSON.');
  }
}

function resolveUnityMcpConnection(options = {}) {
  const explicitUrl = options.url || options.host;
  let config = null;
  if (!explicitUrl || options.token === undefined) {
    const projectRoot = options.projectRoot || options.unityProjectPath;
    if (projectRoot) config = readUnityMcpConfig(projectRoot, options);
  }
  const url = explicitUrl || (config && config.host);
  if (!url) {
    throw providerError('UNITY_MCP_CONNECTION_REQUIRED', 'Unity MCP host is not configured.');
  }
  const token = options.token !== undefined ? options.token : (config && config.token);
  if (token !== undefined && token !== null && typeof token !== 'string') {
    throw providerError('UNITY_MCP_TOKEN_INVALID', 'Unity MCP token must be a string when provided.');
  }
  return Object.freeze({
    url: normalizeBaseUrl(url, options),
    token: typeof token === 'string' && token.length > 0 ? token : undefined,
    source: explicitUrl ? 'explicit' : 'user-settings',
  });
}

function looksLikeLivePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.kind === 'unity-live-patch') return true;
  return value.protocolVersion === 1 && value.provider === 'unity-mcp' &&
    typeof value.projectFingerprint === 'string';
}

function parseNestedJson(value, maxBytes) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > maxBytes) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) return null;
  try { return JSON.parse(trimmed); } catch (_) { return null; }
}

function unwrapUnityMcpResponse(response, options = {}) {
  const maxBytes = options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;
  const queue = [{ value: response, depth: 0 }];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    const value = current.value;
    if (looksLikeLivePatch(value)) return value;
    if (current.depth >= 8 || value === null || value === undefined) continue;

    if (typeof value === 'string') {
      const parsed = parseNestedJson(value, maxBytes);
      if (parsed !== null) queue.push({ value: parsed, depth: current.depth + 1 });
      continue;
    }
    if (typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) queue.push({ value: item, depth: current.depth + 1 });
      continue;
    }

    for (const key of ['structured', 'structuredContent', 'result', 'data', 'payload', 'value', 'output', 'content']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        queue.push({ value: value[key], depth: current.depth + 1 });
      }
    }
    if (value.type === 'text' && typeof value.text === 'string') {
      queue.push({ value: value.text, depth: current.depth + 1 });
    }
  }

  throw providerError(
    'UNITY_MCP_MALFORMED_RESPONSE',
    'Unity MCP returned no recognizable playable-port-scan payload.',
  );
}

function positiveNumber(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw providerError('UNITY_MCP_OPTIONS_INVALID', `${name} must be a positive number.`);
  }
  return value;
}

function integerInRange(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw providerError('UNITY_MCP_OPTIONS_INVALID', `${name} is outside the supported range.`);
  }
  return value;
}

function networkCode(error) {
  if (!error || typeof error !== 'object') return null;
  return error.code || (error.cause && error.cause.code) || null;
}

async function postJsonOnce(connection, route, body, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw providerError('UNITY_MCP_FETCH_UNAVAILABLE', 'No fetch implementation is available.');
  }

  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.requestTimeoutMs);
  const abortFromCaller = () => {
    externallyAborted = true;
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) abortFromCaller();
    else options.signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (connection.token) headers.Authorization = `Bearer ${connection.token}`;
    const response = await fetchImpl(`${connection.url}${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
      throw providerError('UNITY_MCP_MALFORMED_RESPONSE', 'Unity MCP returned an invalid HTTP response.');
    }
    if (!response.ok) {
      const retryable = response.status === 404 || response.status === 503;
      throw providerError(
        retryable ? 'UNITY_MCP_NOT_READY' : 'UNITY_MCP_HTTP_ERROR',
        `Unity MCP returned HTTP ${response.status}.`,
        { status: response.status, retryable },
      );
    }

    const contentLength = Number(response.headers && response.headers.get
      ? response.headers.get('content-length')
      : 0);
    if (Number.isFinite(contentLength) && contentLength > options.maxResponseBytes) {
      throw providerError('UNITY_MCP_RESPONSE_TOO_LARGE', 'Unity MCP response exceeds the compact payload limit.');
    }
    const text = typeof response.text === 'function' ? await response.text() : '';
    if (Buffer.byteLength(text, 'utf8') > options.maxResponseBytes) {
      throw providerError('UNITY_MCP_RESPONSE_TOO_LARGE', 'Unity MCP response exceeds the compact payload limit.');
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch (_) {
      throw providerError('UNITY_MCP_MALFORMED_RESPONSE', 'Unity MCP returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof UnityMcpProviderError) throw error;
    if (externallyAborted) {
      throw providerError('UNITY_MCP_ABORTED', 'Unity MCP request was aborted by the caller.');
    }
    if (timedOut || (error && error.name === 'AbortError')) {
      throw providerError('UNITY_MCP_TIMEOUT', 'Unity MCP request timed out.');
    }
    const code = networkCode(error);
    const retryable = code === 'ECONNRESET' || code === 'ECONNREFUSED';
    throw providerError(
      'UNITY_MCP_NETWORK_ERROR',
      retryable
        ? 'Unity MCP connection is not ready.'
        : `Unity MCP network request failed: ${error && error.message ? error.message : 'unknown error'}`,
      { retryable, secrets: [connection.token] },
    );
  } finally {
    clearTimeout(timeout);
    if (options.signal) options.signal.removeEventListener('abort', abortFromCaller);
  }
}

async function postJsonWithRetry(connection, route, body, options) {
  const sleepImpl = options.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let attempt = 0;
  let delay = options.retryDelayMs;

  for (;;) {
    const remaining = options.deadline - Date.now();
    if (remaining <= 0) {
      throw providerError('UNITY_MCP_TIMEOUT', 'Unity MCP readiness window expired.');
    }
    attempt++;
    try {
      return await postJsonOnce(connection, route, body, {
        ...options,
        requestTimeoutMs: Math.max(1, Math.min(options.requestTimeoutMs, remaining)),
      });
    } catch (error) {
      const hasAttempts = attempt < options.maxAttempts;
      if (!(error instanceof UnityMcpProviderError) || !error.retryable || !hasAttempts) throw error;
      const remainingAfterFailure = options.deadline - Date.now();
      if (remainingAfterFailure <= 0) {
        throw providerError('UNITY_MCP_TIMEOUT', 'Unity MCP readiness window expired.');
      }
      const wait = Math.min(delay, remainingAfterFailure);
      await sleepImpl(wait);
      delay = Math.min(Math.max(1, delay * 2), 2000);
    }
  }
}

function validateToolOptions(options) {
  if (options.toolName !== undefined && options.toolName !== UNITY_MCP_TOOL_ID) {
    throw providerError('UNITY_MCP_TOOL_REJECTED', 'Only playable-port-scan is allowed through this provider.');
  }
  const action = String(options.action || 'scan').trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    throw providerError('UNITY_MCP_ACTION_INVALID', 'Unity MCP action must be probe, scan, or evidence.');
  }
  const expectedFingerprint = options.expectedFingerprint || options.projectFingerprint;
  if (expectedFingerprint !== undefined &&
      (typeof expectedFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedFingerprint))) {
    throw providerError('UNITY_MCP_FINGERPRINT_INVALID', 'Expected Unity project fingerprint is invalid.');
  }
  const includeUnresolvedGuids = Object.prototype.hasOwnProperty.call(options, 'unresolvedGuids');
  const includeSerializedAssetPaths = Object.prototype.hasOwnProperty.call(options, 'serializedAssetPaths');
  const unresolvedGuids = Array.isArray(options.unresolvedGuids) ? options.unresolvedGuids : [];
  const serializedAssetPaths = Array.isArray(options.serializedAssetPaths) ? options.serializedAssetPaths : [];
  if (unresolvedGuids.length > 512 || unresolvedGuids.some(value => typeof value !== 'string' || !/^[0-9a-f]{32}$/i.test(value))) {
    throw providerError('UNITY_MCP_OPTIONS_INVALID', 'unresolvedGuids must contain at most 512 Unity GUIDs.');
  }
  if (serializedAssetPaths.length > 96 || serializedAssetPaths.some(value =>
    typeof value !== 'string' || !/^(?:Assets|Packages)\//.test(value.replace(/\\/g, '/')) || value.length > 320)) {
    throw providerError('UNITY_MCP_OPTIONS_INVALID', 'serializedAssetPaths must contain at most 96 logical Unity asset paths.');
  }
  return {
    action,
    expectedFingerprint: expectedFingerprint ? expectedFingerprint.toLowerCase() : undefined,
    cursor: integerInRange(options.cursor, 0, 0, Number.MAX_SAFE_INTEGER, 'cursor'),
    pageSize: integerInRange(options.pageSize, 128, 1, 512, 'pageSize'),
    maxPrefabs: integerInRange(options.maxPrefabs, 96, 0, 256, 'maxPrefabs'),
    includeUnresolvedGuids,
    includeSerializedAssetPaths,
    unresolvedGuids: [...new Set(unresolvedGuids.map(value => value.toLowerCase()))].sort(),
    serializedAssetPaths: [...new Set(serializedAssetPaths.map(value => value.replace(/\\/g, '/'))) ].sort(),
  };
}

function validateLivePatch(patch, options) {
  if (options.expectedFingerprint &&
      String(patch.projectFingerprint || '').toLowerCase() !== options.expectedFingerprint) {
    throw providerError(
      'UNITY_MCP_FINGERPRINT_MISMATCH',
      'The connected Unity Editor does not match the requested project fingerprint.',
    );
  }
  if (typeof options.validator !== 'function') return patch;
  let validation;
  try {
    validation = options.validator(patch, {
      expectedProjectFingerprint: options.expectedFingerprint,
    });
  } catch (_) {
    throw providerError('UNITY_MCP_VALIDATION_FAILED', 'Unity MCP payload validation failed.');
  }
  if (validation === false || (Array.isArray(validation) && validation.length > 0)) {
    throw providerError('UNITY_MCP_VALIDATION_FAILED', 'Unity MCP payload validation failed.');
  }
  return patch;
}

async function invokeUnityMcpTool(options = {}) {
  const input = validateToolOptions(options);
  const connection = resolveUnityMcpConnection(options);
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const requestTimeoutMs = positiveNumber(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    'requestTimeoutMs',
  );
  const retryDelayMs = options.retryDelayMs === undefined
    ? DEFAULT_RETRY_DELAY_MS
    : integerInRange(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0, 10_000, 'retryDelayMs');
  const maxAttempts = options.maxAttempts === undefined
    ? Number.MAX_SAFE_INTEGER
    : integerInRange(options.maxAttempts, Number.MAX_SAFE_INTEGER, 1, 10_000, 'maxAttempts');
  const maxResponseBytes = integerInRange(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1024,
    16 * 1024 * 1024,
    'maxResponseBytes',
  );
  const requestOptions = {
    deadline: Date.now() + timeoutMs,
    requestTimeoutMs,
    retryDelayMs,
    maxAttempts,
    maxResponseBytes,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    signal: options.signal,
  };

  await postJsonWithRetry(connection, '/api/system-tools/ping', {}, requestOptions);
  const body = {
    action: input.action,
    cursor: input.cursor,
    pageSize: input.pageSize,
    maxPrefabs: input.maxPrefabs,
  };
  if (input.includeUnresolvedGuids) body.unresolvedGuids = input.unresolvedGuids;
  if (input.includeSerializedAssetPaths) body.serializedAssetPaths = input.serializedAssetPaths;
  if (input.expectedFingerprint) body.expectedFingerprint = input.expectedFingerprint;
  const response = await postJsonWithRetry(
    connection,
    `/api/tools/${UNITY_MCP_TOOL_ID}`,
    body,
    requestOptions,
  );
  const patch = unwrapUnityMcpResponse(response, { maxResponseBytes });
  return validateLivePatch(patch, {
    expectedFingerprint: input.expectedFingerprint,
    validator: options.validator,
  });
}

function createUnityMcpProvider(defaultOptions = {}) {
  const call = (action, options = {}) => invokeUnityMcpTool({
    ...defaultOptions,
    ...options,
    action,
  });
  return Object.freeze({
    id: 'unity-mcp',
    toolId: UNITY_MCP_TOOL_ID,
    probe: options => call('probe', options),
    scan: options => call('scan', options),
    evidence: options => call('evidence', options),
  });
}

const scanUnityWithMcp = invokeUnityMcpTool;

module.exports = {
  UNITY_MCP_TOOL_ID,
  UNITY_MCP_CONFIG_RELATIVE_PATH,
  UnityMcpProviderError,
  redactSensitive,
  isLoopbackHostname,
  readUnityMcpConfig,
  resolveUnityMcpConnection,
  unwrapUnityMcpResponse,
  invokeUnityMcpTool,
  scanUnityWithMcp,
  createUnityMcpProvider,
};
