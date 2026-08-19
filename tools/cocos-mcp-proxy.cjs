#!/usr/bin/env node
'use strict';

/**
 * Smart Stdio Proxy for Cocos Creator MCP server.
 *
 * Solves the startup order issue:
 * - If Antigravity (or another AI client) is opened BEFORE Cocos Creator,
 *   the proxy handles initialize + tools/list using cached schemas so the client
 *   registers all Cocos tools and stays healthy.
 * - When Cocos Creator is opened later, subsequent tool calls automatically
 *   connect over HTTP to http://127.0.0.1:3000/mcp without needing to restart the AI client.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const { URL } = require('url');

const COCOS_MCP_URL = process.env.COCOS_MCP_URL || 'http://127.0.0.1:3000/mcp';
const SCHEMA_CACHE_FILE = path.join(__dirname, 'cocos-mcp-schema.json');

/**
 * PHÂN TẦNG TOOL THEO PROFILE — cắt token cố định của mỗi request.
 * ================================================================
 * Đo được: cocos-mcp công bố 100 tool = 65.954 ký tự ≈ 18.3k token, và khoản
 * này bị nạp lại ở MỌI request của AI agent, kể cả khi task chỉ cần đọc scene.
 *
 * Đặt COCOS_MCP_PROFILE để chỉ công bố nhóm cần dùng. Lọc ở proxy nên không
 * phải sửa extension, và `tools/call` vẫn chuyển tiếp đầy đủ — profile chỉ ảnh
 * hưởng danh sách công bố, KHÔNG chặn việc gọi tool ngoài profile.
 *
 *   full  (mặc định) : tất cả, giữ nguyên hành vi cũ
 *   port             : đọc/ghi scene + node + component + prefab + asset
 *   scene            : chỉ đọc/sửa scene và node
 *   build            : build, preview, asset
 *   debug            : log, performance, validate
 */
const TOOL_PROFILES = {
  port: ['scene_', 'node_', 'component_', 'prefab_', 'project_get', 'project_query', 'project_find', 'project_import', 'project_refresh', 'project_create_asset', 'project_save', 'debug_get_console', 'debug_validate'],
  scene: ['scene_', 'node_', 'component_', 'debug_get_node_tree'],
  build: ['project_build', 'project_check_builder', 'project_get_build', 'project_open_build', 'project_run', 'project_start_preview', 'project_stop_preview', 'project_get_project', 'debug_get_console'],
  debug: ['debug_', 'broadcast_', 'server_', 'scene_get_current_scene'],
};

function applyToolProfile(tools) {
  const profile = String(process.env.COCOS_MCP_PROFILE || 'full').trim().toLowerCase();
  if (!profile || profile === 'full' || !Array.isArray(tools)) return tools;
  const prefixes = TOOL_PROFILES[profile];
  if (!prefixes) {
    process.stderr.write(`[cocos-mcp-proxy] COCOS_MCP_PROFILE='${profile}' không tồn tại; công bố toàn bộ tool. Hợp lệ: ${Object.keys(TOOL_PROFILES).join(', ')}, full
`);
    return tools;
  }
  const filtered = tools.filter((t) => prefixes.some((prefix) => String(t && t.name).startsWith(prefix)));
  process.stderr.write(`[cocos-mcp-proxy] profile='${profile}': công bố ${filtered.length}/${tools.length} tool
`);
  return filtered;
}

let cachedTools = [];
try {
  if (fs.existsSync(SCHEMA_CACHE_FILE)) {
    cachedTools = JSON.parse(fs.readFileSync(SCHEMA_CACHE_FILE, 'utf8'));
  }
} catch (e) {
  cachedTools = [];
}

function forwardHttp(messageObj) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(messageObj), 'utf8');
    let parsedUrl;
    try {
      parsedUrl = new URL(COCOS_MCP_URL);
    } catch (err) {
      return reject(err);
    }

    const req = http.request(parsedUrl, {
      method: 'POST',
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Accept': 'application/json, text/event-stream'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('text/event-stream') || data.includes('data:')) {
          const sseLines = data.split('\n');
          for (const sseLine of sseLines) {
            if (sseLine.startsWith('data:')) {
              const dataStr = sseLine.slice(5).trim();
              if (dataStr) {
                try {
                  const parsed = JSON.parse(dataStr);
                  return resolve(parsed);
                } catch (_) {}
              }
            }
          }
        }
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Invalid JSON response from Cocos: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout connecting to Cocos Creator MCP on port 3000'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end(body);
  });
}

function sendJsonRpc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  const { id, method, params } = message;

  // Notifications (no id)
  if (id === undefined || id === null) {
    try {
      await forwardHttp(message);
    } catch (_) {
      // Ignore notification failures when offline
    }
    return;
  }

  // Try live forwarding first
  try {
    const liveResponse = await forwardHttp(message);
    // If tools/list succeeded, update local cache
    if (method === 'tools/list' && liveResponse && liveResponse.result && Array.isArray(liveResponse.result.tools)) {
      // Cache LUÔN lưu danh sách đầy đủ; profile chỉ lọc lúc công bố.
      cachedTools = liveResponse.result.tools;
      try {
        fs.writeFileSync(SCHEMA_CACHE_FILE, JSON.stringify(cachedTools, null, 2), 'utf8');
      } catch (_) {}
      liveResponse.result.tools = applyToolProfile(cachedTools);
    }
    sendJsonRpc(liveResponse);
    return;
  } catch (httpError) {
    // Cocos is offline / not reachable at this moment. Provide graceful fallback.
    process.stderr.write(`[cocos-mcp-proxy] Cocos HTTP offline for method ${method}: ${httpError.message}\n`);

    if (method === 'initialize') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
            resources: { listChanged: true },
            prompts: { listChanged: true }
          },
          serverInfo: {
            name: 'cocos-mcp',
            version: '1.0.0'
          }
        }
      });
      return;
    }

    if (method === 'tools/list') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          tools: applyToolProfile(cachedTools)
        }
      });
      return;
    }

    if (method === 'resources/list') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: { resources: [] }
      });
      return;
    }

    if (method === 'prompts/list') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: { prompts: [] }
      });
      return;
    }

    if (method === 'tools/call') {
      // Tool call failed because Cocos Creator is not running
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `[ERROR] Cocos Creator is not reachable on port 3000 (${httpError.message}). Please ensure Cocos Creator 3.8.8 is open with this project (run 1_open-project.bat) to execute Cocos tools.`
            }
          ],
          isError: true
        }
      });
      return;
    }

    // Generic fallback error
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: `Cocos Creator MCP is currently offline: ${httpError.message}`
      }
    });
  }
}

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  let buffer = '';

  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep remainder

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        handleMessage(msg).catch((err) => {
          process.stderr.write(`[cocos-mcp-proxy] Unhandled error in message handler: ${err.stack || err}\n`);
        });
      } catch (err) {
        process.stderr.write(`[cocos-mcp-proxy] Bad JSON-RPC line: ${trimmed.slice(0, 100)}\n`);
      }
    }
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main();
