#!/usr/bin/env node
'use strict';

/**
 * Stdio-to-HTTP bridge for Cocos Creator MCP server.
 * Enables stdio-only MCP clients (such as Claude Desktop) to connect to Cocos Creator's HTTP MCP endpoint.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const TARGET_URL = process.env.COCOS_MCP_URL || process.argv[2] || 'http://127.0.0.1:3000/mcp';
let sessionId = null;

let stdinBuffer = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
    stdinBuffer += chunk;
    const lines = stdinBuffer.split('\n');
    stdinBuffer = lines.pop();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { continue; }
        try {
            const message = JSON.parse(trimmed);
            handleMessage(message, trimmed);
        } catch (err) {
            // Ignore malformed lines or write parse error
        }
    }
});

process.stdin.on('end', () => {
    process.exit(0);
});

function sendToStdout(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleMessage(message, rawJson) {
    let parsedUrl;
    try {
        parsedUrl = new URL(TARGET_URL);
    } catch (e) {
        if (message.id !== undefined) {
            sendToStdout({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32603, message: `Invalid target URL: ${TARGET_URL}` }
            });
        }
        return;
    }

    const payload = Buffer.from(rawJson, 'utf8');
    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'Accept': 'application/json, text/event-stream'
    };
    if (sessionId) {
        headers['mcp-session-id'] = sessionId;
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.request(parsedUrl, {
        method: 'POST',
        headers: headers,
        timeout: 60000
    }, (res) => {
        if (res.headers['mcp-session-id']) {
            sessionId = res.headers['mcp-session-id'];
        }

        let body = '';
        res.on('data', (c) => { body += c.toString(); });
        res.on('end', () => {
            if (!body.trim()) { return; }

            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('text/event-stream')) {
                // Parse SSE messages
                const sseLines = body.split('\n');
                for (const sseLine of sseLines) {
                    if (sseLine.startsWith('data:')) {
                        const dataStr = sseLine.slice(5).trim();
                        if (dataStr) {
                            try {
                                const parsed = JSON.parse(dataStr);
                                sendToStdout(parsed);
                            } catch (_) { }
                        }
                    }
                }
            } else {
                try {
                    const parsed = JSON.parse(body);
                    sendToStdout(parsed);
                } catch (_) {
                    if (message.id !== undefined) {
                        sendToStdout({
                            jsonrpc: '2.0',
                            id: message.id,
                            error: { code: -32603, message: `Invalid JSON from Cocos MCP: ${body.slice(0, 200)}` }
                        });
                    }
                }
            }
        });
    });

    req.on('timeout', () => {
        req.destroy(new Error('Request timeout to Cocos MCP server (60s)'));
    });

    req.on('error', (err) => {
        if (message.id !== undefined) {
            sendToStdout({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32000,
                    message: `Cocos Creator MCP server unreachable (${err.message}). Make sure Cocos Creator is running.`
                }
            });
        }
    });

    req.write(payload);
    req.end();
}
