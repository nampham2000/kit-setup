#!/usr/bin/env node
'use strict';

const net = require('net');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const BLENDER_HOST = process.env.BLENDER_HOST || '127.0.0.1';
const BLENDER_PORT = parseInt(process.env.BLENDER_PORT || '9876', 10);

function sendToBlender(action, code = '') {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let dataBuffer = '';
    const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify({ id: reqId, action, code });

    client.setTimeout(35000);

    client.connect(BLENDER_PORT, BLENDER_HOST, () => {
      client.write(payload);
    });

    client.on('data', (chunk) => {
      dataBuffer += chunk.toString();
    });

    client.on('end', () => {
      try {
        const parsed = JSON.parse(dataBuffer);
        resolve(parsed);
      } catch (err) {
        resolve({ ok: false, error: `Invalid response from Blender: ${dataBuffer}` });
      }
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error(`Timeout communicating with Blender backend at ${BLENDER_HOST}:${BLENDER_PORT}`));
    });

    client.on('error', (err) => {
      reject(new Error(`Cannot connect to Blender at ${BLENDER_HOST}:${BLENDER_PORT}. Make sure Blender is running with MCP addon: ${err.message}`));
    });
  });
}

const TOOLS = [
  {
    name: 'blender_execute_script',
    description: 'Execute Python script inside Blender (bpy context). Returns stdout, stderr and return values.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Python script code to execute inside Blender.'
        }
      },
      required: ['code']
    }
  },
  {
    name: 'blender_eval',
    description: 'Evaluate a Python expression in Blender and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Python expression to evaluate, e.g. "len(bpy.data.objects)".'
        }
      },
      required: ['expression']
    }
  },
  {
    name: 'blender_get_scene_info',
    description: 'Get list of objects, types, transforms, vertices count and materials in the current Blender scene.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'blender_ping',
    description: 'Health-check ping to verify Blender backend is responding on port 9876.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

function makeJsonResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

function makeErrorResult(error) {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true
  };
}

async function main() {
  const server = new Server(
    { name: 'blender-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      if (name === 'blender_ping') {
        const res = await sendToBlender('ping');
        return makeJsonResult(res);
      }
      if (name === 'blender_get_scene_info') {
        const res = await sendToBlender('scene_info');
        return makeJsonResult(res);
      }
      if (name === 'blender_eval') {
        const res = await sendToBlender('eval', args.expression || '');
        return makeJsonResult(res);
      }
      if (name === 'blender_execute_script') {
        const res = await sendToBlender('execute', args.code || '');
        return makeJsonResult(res);
      }
      return makeErrorResult(new Error(`Unknown tool: ${name}`));
    } catch (err) {
      return makeErrorResult(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[blender-mcp] Fatal error:', err);
  process.exit(1);
});
