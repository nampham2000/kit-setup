#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const {
  inspectUnityProject,
  queryUnitySnapshot,
  resolveProjectRoot,
  scanUnityProject: scanProject,
} = require('./unity-intel/service.cjs');
const { computeUnityProjectState, normalizedRealPath } = require('./unity-intel/project-state.cjs');
const { runUnityPortPreflight } = require('./unity-intel/preflight.cjs');
const { sanitizeForProjection } = require('./unity-intel/compact-projection.cjs');

const snapshotCache = new Map();
const scanGenerations = new Map();

const commonProjectProperty = {
  type: 'string',
  description: 'Unity project root containing Assets/, Packages/, and ProjectSettings/.',
};

const TOOLS = [
  {
    name: 'doctorUnityProject',
    description: 'Read-only check of Unity version, exact Editor availability, project lock, and local Unity-MCP endpoint. Use before bootstrap when setup readiness is unclear.',
    inputSchema: {
      type: 'object',
      properties: {
        project: commonProjectProperty,
        unity: { type: 'string', description: 'Optional exact Unity Editor executable.' },
        mcpUrl: { type: 'string', description: 'Optional HTTP loopback Unity-MCP endpoint.' },
      },
      required: ['project'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'scanUnityProject',
    description: 'MANDATORY FIRST tool for every Unity port/implementation task. Returns a <=12 KiB implementation brief with feature sketch, all high dispositions, verification routes, and a fresh mutation receipt. Read decision/features/obligations before implementation. Default auto mode is project-read-only and falls back to static; bootstrap only when install/reload is allowed.',
    inputSchema: {
      type: 'object',
      properties: {
        project: commonProjectProperty,
        provider: { type: 'string', enum: ['auto', 'static', 'unity-mcp'], default: 'auto' },
        bootstrap: { type: 'boolean', default: false, description: 'Install scanner/Unity-MCP and automate reload. This writes Packages/manifest.json and UserSettings config.' },
        unity: { type: 'string', description: 'Optional exact Unity Editor executable.' },
        mcpUrl: { type: 'string', description: 'Optional HTTP loopback Unity-MCP endpoint.' },
        timeoutMs: { type: 'integer', minimum: 250, maximum: 600000 },
        requestTimeoutMs: { type: 'integer', minimum: 250, maximum: 180000 },
        includeVendor: { type: 'boolean', default: false },
        refreshCache: { type: 'boolean', default: false },
        intent: { type: 'string', enum: ['project', 'scene', 'prefab', 'script', 'shader', 'feature', 'diagnostic'], default: 'project', description: 'Project intent issues the mutation receipt. Focused intents are analysis-only evidence briefs.' },
        targets: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 320 }, description: 'Exact logical paths/symbols for a focused analysis-only intent.' },
      },
      required: ['project'],
      additionalProperties: false,
    },
  },
  {
    name: 'getUnityProjectFeatures',
    description: 'Return only the compact feature sketch from the mandatory latest scan. This does not replace reviewing high obligations; fails with UNITY_SCAN_REQUIRED if scanUnityProject was skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        project: commonProjectProperty,
        search: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['project'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'getUnityProjectSlice',
    description: 'Fetch one bounded <=48 KiB page from the mandatory latest scan. Use diagnostics+severity=high when the brief asks for evidence; prefer this over raw Unity YAML/C#. Cursor is tied to content-sensitive scan, section, and query.',
    inputSchema: {
      type: 'object',
      properties: {
        project: commonProjectProperty,
        section: {
          type: 'string',
          enum: ['assets', 'dependencies', 'unresolved', 'diagnostics', 'scenes', 'scripts'],
        },
        search: { type: 'string' },
        severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        type: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['project', 'section'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

function cacheKey(project) {
  return normalizedRealPath(project);
}

function makeJsonResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function makeErrorResult(error) {
  const payload = sanitizeForProjection({
    code: String(error && error.code || 'UNITY_INTEL_FAILED'),
    message: error instanceof Error ? error.message : String(error),
  }, { maxString: 320, maxArray: 4, maxDepth: 3 });
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

async function getOrScan(args, dependencies = {}) {
  const resolveRoot = dependencies.resolveProjectRoot || resolveProjectRoot;
  let projectRoot;
  try {
    projectRoot = resolveRoot(args.project);
  } catch (_) {
    const error = new Error('Phải gọi scanUnityProject và đọc implementation brief trước khi query evidence.');
    error.code = 'UNITY_SCAN_REQUIRED';
    throw error;
  }
  const key = cacheKey(projectRoot);
  if (!snapshotCache.has(key)) {
    const error = new Error('Phải gọi scanUnityProject và đọc implementation brief trước khi query evidence.');
    error.code = 'UNITY_SCAN_REQUIRED';
    throw error;
  }
  const entry = snapshotCache.get(key);
  const snapshot = entry && entry.snapshot || entry;
  if (snapshot.stateFingerprint && !dependencies.skipStateCheck) {
    const computeProjectState = dependencies.computeProjectState || computeUnityProjectState;
    const current = computeProjectState(entry.projectRoot || projectRoot);
    if (current.fingerprint !== snapshot.stateFingerprint) {
      snapshotCache.delete(key);
      const error = new Error('Unity source đã đổi sau scan; gọi lại scanUnityProject.');
      error.code = 'UNITY_SCAN_STALE';
      throw error;
    }
  }
  return snapshot;
}

async function handleToolCall(name, args = {}, dependencies = {}) {
  if (name === 'doctorUnityProject') {
    const inspect = dependencies.inspectProject || inspectUnityProject;
    return makeJsonResult(inspect(args));
  }
  if (name === 'scanUnityProject') {
    const scan = dependencies.scanProject || scanProject;
    const preflight = dependencies.runPreflight || runUnityPortPreflight;
    const resolveRoot = dependencies.resolveProjectRoot || resolveProjectRoot;
    const projectRoot = resolveRoot(args.project);
    const key = cacheKey(projectRoot);
    const generation = (scanGenerations.get(key) || 0) + 1;
    scanGenerations.set(key, generation);
    // A query must never observe an older snapshot while a newer scan for the
    // same project is in flight, even when the older async invocation finishes last.
    snapshotCache.delete(key);
    const input = {
      project: projectRoot,
      provider: args.provider || 'auto',
      bootstrap: args.bootstrap === true,
      unity: args.unity,
      mcpUrl: args.mcpUrl,
      mcpToken: process.env.UNITY_MCP_TOKEN || undefined,
      timeoutMs: args.timeoutMs || (args.bootstrap ? 180_000 : 10_000),
      requestTimeoutMs: args.requestTimeoutMs,
      includeVendor: args.includeVendor === true,
      refreshCache: args.refreshCache === true,
      intent: args.intent || 'project',
      targets: args.targets,
    };
    const result = await preflight(input, { scanProject: scan });
    if (scanGenerations.get(key) !== generation) {
      const error = new Error('Scan này đã bị một scan mới hơn thay thế; dùng implementation brief mới nhất.');
      error.code = 'UNITY_SCAN_SUPERSEDED';
      throw error;
    }
    snapshotCache.set(key, { projectRoot, snapshot: result.snapshot });
    return makeJsonResult(result.brief);
  }
  if (name === 'getUnityProjectFeatures') {
    const snapshot = await getOrScan(args, dependencies);
    return makeJsonResult(queryUnitySnapshot(snapshot, {
      section: 'features', search: args.search, cursor: args.cursor, limit: args.limit,
    }));
  }
  if (name === 'getUnityProjectSlice') {
    const snapshot = await getOrScan(args, dependencies);
    return makeJsonResult(queryUnitySnapshot(snapshot, {
      section: args.section,
      search: args.search,
      severity: args.severity,
      type: args.type,
      cursor: args.cursor,
      limit: args.limit,
    }));
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function main() {
  const server = new Server(
    { name: 'cc-playable-unity-intelligence', version: '0.3.0' },
    { capabilities: { tools: {} } },
  );
  server.onerror = error => {
    console.error('[unity-intel-mcp]', error instanceof Error ? error.stack || error.message : String(error));
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      return await handleToolCall(request.params.name, request.params.arguments || {});
    } catch (error) {
      return makeErrorResult(error);
    }
  });
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch(error => {
    console.error('[unity-intel-mcp]', error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  TOOLS,
  snapshotCache,
  scanGenerations,
  cacheKey,
  makeJsonResult,
  makeErrorResult,
  getOrScan,
  handleToolCall,
  main,
};
