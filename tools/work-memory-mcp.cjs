#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const cliRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(cliRoot, 'playable-shared-kit', 'tools', 'work-memory.cjs');
const repoRoot = path.resolve(process.env.WORK_MEMORY_REPO_ROOT || process.cwd());
const pathOverrides = {
  'repo-root': repoRoot,
  'repo-db': process.env.WORK_MEMORY_REPO_DB || '',
  'global-db': process.env.WORK_MEMORY_GLOBAL_DB || '',
  'cache-file': process.env.WORK_MEMORY_CACHE_FILE || '',
  'shared-capture-file': process.env.WORK_MEMORY_SHARED_CAPTURE_FILE || '',
};

function appendOption(args, key, value) {
  if (value === undefined || value === null || value === '') return;
  const normalized = Array.isArray(value)
    ? value.join(',')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  args.push(`--${key}`, normalized);
}

function runCli(command, options = {}) {
  const args = [cliPath, command, '--json'];
  for (const [key, value] of Object.entries(pathOverrides)) appendOption(args, key, value);
  for (const [key, value] of Object.entries(options)) appendOption(args, key, value);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `work-memory ${command} failed`).trim());
  }
  const output = String(result.stdout || '').trim();
  return output ? JSON.parse(output) : { ok: true };
}

function makeJsonResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function makeErrorResult(error) {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

const TOOLS = [
  {
    name: 'queryWorkMemory',
    description: 'Query the local work-memory store for this workspace. Defaults to fresh DB reads instead of cache so recent saves show up immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Search text to match against lexical and semantic memory indexes.' },
        scope: { type: 'string', enum: ['repo', 'global', 'hybrid'], description: 'Which memory scope to search.' },
        semantic: { type: 'string', enum: ['off', 'hybrid', 'only'], description: 'Semantic search mode.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of returned items.' },
        semanticLimit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of semantic candidates before merge.' },
        category: { type: 'string', description: 'Optional category filter.' },
        tags: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } }
          ],
          description: 'Optional tag filter as CSV or string array.'
        },
        pinned: { type: 'boolean', description: 'Optional pinned filter.' },
        includeContent: { type: 'boolean', description: 'Include full memory content in results.' },
        preferCache: { type: 'boolean', description: 'Use the warm cache first. Defaults to false for fresh MCP reads.' }
      },
      required: ['text']
    },
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  {
    name: 'rememberWorkMemory',
    description: 'Save one or more work-memory items using the same normalization as remember-auto, including minimal payload inference for scope, category, and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        memory: {
          anyOf: [
            { type: 'object', additionalProperties: true },
            { type: 'array', items: { type: 'object', additionalProperties: true } }
          ],
          description: 'One memory payload or an array of memory payloads.'
        },
        scope: { type: 'string', enum: ['repo', 'global'], description: 'Fallback scope when a payload omits scope.' },
        sessionId: { type: 'string', description: 'Optional session identifier stored in memory metadata.' }
      },
      required: ['memory']
    }
  },
  {
    name: 'workMemoryStats',
    description: 'Return repo/shared DB counts and semantic index status for this workspace.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }
];

async function handleToolCall(name, args = {}) {
  if (name === 'queryWorkMemory') {
    return makeJsonResult(runCli('query', {
      text: args.text,
      scope: args.scope || 'hybrid',
      semantic: args.semantic || 'hybrid',
      limit: args.limit,
      'semantic-limit': args.semanticLimit,
      category: args.category,
      tags: args.tags,
      pinned: args.pinned,
      'include-content': args.includeContent,
      'prefer-cache': args.preferCache === undefined ? false : args.preferCache,
    }));
  }
  if (name === 'rememberWorkMemory') {
    return makeJsonResult(runCli('remember-auto', {
      memory: args.memory,
      scope: args.scope,
      'session-id': args.sessionId,
    }));
  }
  if (name === 'workMemoryStats') {
    return makeJsonResult(runCli('stats'));
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function main() {
  const server = new Server(
    { name: 'work-memory-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.onerror = (error) => {
    console.error('[work-memory-mcp]', error instanceof Error ? error.stack || error.message : String(error));
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await handleToolCall(request.params.name, request.params.arguments || {});
    } catch (error) {
      return makeErrorResult(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[work-memory-mcp]', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});