#!/usr/bin/env node
'use strict';

/**
 * Health-checks MCP servers by doing a real `initialize` + `tools/list` exchange.
 *
 *   node mcp-probe.cjs <spec.json>
 *
 * The spec is what mcp-clients-sync.ps1 writes out:
 *
 *   { "servers": [
 *       { "name": "cocos-mcp",   "kind": "http",  "url": "http://127.0.0.1:3000/mcp" },
 *       { "name": "blender-mcp", "kind": "stdio", "command": "...", "args": [], "env": {} }
 *   ] }
 *
 * Prints one `name<TAB>ok|fail<TAB>detail` line per server and exits non-zero if any
 * server failed, so a caller can gate on the exit code.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { URL } = require('url');

const HANDSHAKE_TIMEOUT_MS = 40000;

function initializeRequest(id) {
    return {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mcp-probe', version: '1.0.0' },
        },
    };
}

function probeStdio(server) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(server.command, server.args || [], {
                env: { ...process.env, ...(server.env || {}) },
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (error) {
            resolve({ ok: false, detail: `spawn failed: ${error.message}` });
            return;
        }

        let settled = false;
        let stdout = '';
        let stderr = '';

        const finish = (ok, detail) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            try { child.kill(); } catch (_) { /* already gone */ }
            resolve({ ok, detail });
        };

        const timer = setTimeout(() => {
            finish(false, `no response within ${HANDSHAKE_TIMEOUT_MS / 1000}s`);
        }, HANDSHAKE_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            const lines = stdout.split('\n');
            stdout = lines.pop();
            for (const line of lines) {
                if (!line.trim()) { continue; }
                let message;
                try { message = JSON.parse(line); } catch (_) { continue; }
                if (message.id === 1 && message.result) {
                    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
                    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
                } else if (message.id === 1 && message.error) {
                    finish(false, `initialize error: ${JSON.stringify(message.error)}`);
                } else if (message.id === 2) {
                    const tools = (message.result && message.result.tools) || [];
                    finish(true, `${tools.length} tools`);
                }
            }
        });

        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => finish(false, `spawn failed: ${error.message}`));
        child.on('exit', (code) => {
            const tail = stderr.trim().split('\n').pop() || '';
            finish(false, `exited early (code ${code}) ${tail}`.trim());
        });

        child.stdin.on('error', () => { /* the exit handler reports the real cause */ });
        child.stdin.write(`${JSON.stringify(initializeRequest(1))}\n`);
    });
}

function probeHttp(server) {
    return new Promise((resolve) => {
        const body = Buffer.from(JSON.stringify(initializeRequest(1)), 'utf8');
        let url;
        try {
            url = new URL(server.url);
        } catch (error) {
            resolve({ ok: false, detail: `bad url: ${error.message}` });
            return;
        }

        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, {
            method: 'POST',
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                Accept: 'application/json, text/event-stream',
            },
        }, (response) => {
            let payload = '';
            response.on('data', (chunk) => { payload += chunk.toString(); });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300 && /"result"/.test(payload)) {
                    resolve({ ok: true, detail: `HTTP ${response.statusCode}` });
                } else {
                    resolve({ ok: false, detail: `HTTP ${response.statusCode} ${payload.slice(0, 120)}`.trim() });
                }
            });
        });

        request.on('timeout', () => { request.destroy(new Error('timeout')); });
        request.on('error', (error) => resolve({ ok: false, detail: error.message }));
        request.end(body);
    });
}

async function main() {
    const specPath = process.argv[2];
    if (!specPath) {
        console.error('usage: node mcp-probe.cjs <spec.json>');
        process.exit(2);
    }

    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const servers = spec.servers || [];
    let failed = 0;

    for (const server of servers) {
        const result = server.kind === 'http' ? await probeHttp(server) : await probeStdio(server);
        if (!result.ok) { failed += 1; }
        console.log([server.name, result.ok ? 'ok' : 'fail', result.detail].join('\t'));
    }

    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(2);
});
