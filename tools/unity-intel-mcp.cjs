#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const {
  inspectUnityProject,
  createCompactScanEnvelope,
  queryUnitySnapshot,
  scanUnityProject: scanProject,
} = require('./unity-intel/service.cjs');

const snapshotCache = new Map();

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
    description: 'FIRST tool for a Unity port or Unity implementation task. Returns a <=24 KiB compact project summary and deterministic feature sketch. Default auto mode is read-only and falls back to the static scanner. Set bootstrap=true only when package installation/reload is explicitly allowed.',
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
      },
      required: ['project'],
      additionalProperties: false,
    },
  },
  {
    name: 'getUnityProjectFeatures',
    description: 'Return only the compact, evidence-backed gameplay/porting feature sketch from the latest scan. Auto-scans read-only if this MCP session has no snapshot yet.',
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
    description: 'Fetch one bounded <=48 KiB page from the latest full Unity index. Prefer this over reading Unity YAML/C# trees. Cursor is tied to scan, section, and query.',
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
  return path.resolve(project).toLowerCase();
}

function makeJsonResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function makeErrorResult(error) {
  const payload = {
    code: error && error.code || 'UNITY_INTEL_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

async function getOrScan(args, dependencies = {}) {
  const key = cacheKey(args.project);
  if (snapshotCache.has(key)) return snapshotCache.get(key);
  const scan = dependencies.scanProject || scanProject;
  const result = await scan({ project: args.project, provider: 'auto', timeoutMs: 10_000 });
  snapshotCache.set(key, result.snapshot);
  return result.snapshot;
}

async function handleToolCall(name, args = {}, dependencies = {}) {
  if (name === 'doctorUnityProject') {
    const inspect = dependencies.inspectProject || inspectUnityProject;
    return makeJsonResult(inspect(args));
  }
  if (name === 'scanUnityProject') {
    const scan = dependencies.scanProject || scanProject;
    const result = await scan({
      project: args.project,
      provider: args.provider || 'auto',
      bootstrap: args.bootstrap === true,
      unity: args.unity,
      mcpUrl: args.mcpUrl,
      mcpToken: process.env.UNITY_MCP_TOKEN || undefined,
      timeoutMs: args.timeoutMs || (args.bootstrap ? 180_000 : 10_000),
      requestTimeoutMs: args.requestTimeoutMs,
      includeVendor: args.includeVendor === true,
      refreshCache: args.refreshCache === true,
    });
    snapshotCache.set(cacheKey(args.project), result.snapshot);
    return makeJsonResult(createCompactScanEnvelope(result));
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
    { name: 'cc-playable-unity-intelligence', version: '0.2.0' },
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
  cacheKey,
  makeJsonResult,
  makeErrorResult,
  getOrScan,
  handleToolCall,
  main,
};
