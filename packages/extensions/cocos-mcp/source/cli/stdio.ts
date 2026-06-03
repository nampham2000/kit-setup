#!/usr/bin/env node
/**
 * Stand‑alone stdio entry point (A2).
 *
 * This binary can be wired straight into a Claude Desktop / Cursor MCP
 * server config:
 *
 *     {
 *       "mcpServers": {
 *         "cocos": {
 *           "command": "node",
 *           "args": ["/path/to/cocos-mcp/dist/cli/stdio.js"]
 *         }
 *       }
 *     }
 *
 * Caveat: tools that talk to `Editor.*` only work when the Cocos Creator
 * editor is currently hosting this process (i.e. when the extension is
 * loaded). When run from a plain Node.js process the tools that touch the
 * editor will fail gracefully with a descriptive error, but `tools/list`,
 * `initialize`, `ping`, `logging/setLevel` and capability negotiation all
 * function so the transport is still useful for testing.
 */

import { ProtocolHandler } from '../protocol/protocol-handler';
import { StdioTransport } from '../transport/stdio';
import { CocosToolRegistry } from '../mcp-server';

function main(): void {
    // Tools that touch the Cocos editor expect a global `Editor` object. Provide
    // a stub when running outside the editor so `require()`‑time access doesn't
    // crash; tool execution will still throw a descriptive error.
    const g = globalThis as any;
    if (typeof g.Editor === 'undefined') {
        g.Editor = new Proxy({}, {
            get() { throw new Error('Cocos Editor API not available in stdio standalone mode'); }
        });
    }

    const registry = new CocosToolRegistry();
    const handler = new ProtocolHandler({ registry, pageSize: 100, initialLogLevel: 'info' });
    const transport = new StdioTransport({ handler });

    const shutdown = () => {
        transport.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    transport.start();
    // Note: never print to stdout; the protocol owns it.
    process.stderr.write('[cocos-mcp] stdio transport ready\n');
}

main();
