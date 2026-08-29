#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHARED_KIT_ROOT = path.resolve(__dirname, '..');
const EXTENSION_ROOT = path.join(SHARED_KIT_ROOT, 'packages', 'extensions', 'cocos-mcp');
const REGISTRY_FILE = path.join(EXTENSION_ROOT, 'dist', 'mcp-server.js');
const SCHEMA_FILE = path.join(__dirname, 'cocos-mcp-schema.json');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function collectSchema() {
  if (!fs.existsSync(REGISTRY_FILE)) throw new Error('Cocos MCP dist registry is missing; build the extension first.');
  const originalLog = console.log;
  const originalWarn = console.warn;
  let tools;
  try {
    // Several legacy tool constructors announce simulated listeners. Schema
    // generation is machine output, so suppress constructor chatter only for
    // this bounded registry instantiation.
    console.log = () => {};
    console.warn = () => {};
    delete require.cache[require.resolve(REGISTRY_FILE)];
    const { CocosToolRegistry } = require(REGISTRY_FILE);
    tools = new CocosToolRegistry().listTools();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  if (!Array.isArray(tools) || tools.length === 0) throw new Error('Cocos MCP registry returned no tools.');
  const seen = new Set();
  const projected = tools.map(tool => {
    if (!tool || typeof tool.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tool.name)) {
      throw new Error(`Invalid Cocos MCP tool name: ${tool && tool.name}`);
    }
    if (seen.has(tool.name)) throw new Error(`Duplicate Cocos MCP tool name: ${tool.name}`);
    seen.add(tool.name);
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
      throw new Error(`Tool ${tool.name} has no JSON input schema.`);
    }
    return stable({
      name: tool.name,
      description: String(tool.description || ''),
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    });
  });
  return projected.sort((left, right) => left.name.localeCompare(right.name));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeSchema(tools) {
  const bytes = serialize(tools);
  const temp = `${SCHEMA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, bytes, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temp, SCHEMA_FILE);
  return bytes;
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const json = argv.includes('--json');
  const unknown = argv.filter(arg => !['--check', '--json'].includes(arg));
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);
  const tools = collectSchema();
  const expected = serialize(tools);
  const current = fs.existsSync(SCHEMA_FILE) ? fs.readFileSync(SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
  const changed = current !== expected;
  if (check && changed) {
    const error = new Error('Cocos MCP offline schema cache is stale; run cocos-mcp-schema-refresh.cjs.');
    error.code = 'COCOS_MCP_SCHEMA_STALE';
    throw error;
  }
  if (!check && changed) writeSchema(tools);
  const result = { ok: true, changed: !check && changed, stale: check && changed, toolCount: tools.length, schema: path.relative(SHARED_KIT_ROOT, SCHEMA_FILE).replace(/\\/g, '/') };
  console.log(json ? JSON.stringify(result) : `[cocos-mcp-schema] ${check ? 'verified' : changed ? 'updated' : 'current'} ${tools.length} tools`);
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[cocos-mcp-schema] ${error.code || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { stable, collectSchema, serialize, writeSchema, main, SCHEMA_FILE, REGISTRY_FILE };
