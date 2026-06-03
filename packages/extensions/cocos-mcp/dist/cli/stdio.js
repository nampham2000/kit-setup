#!/usr/bin/env node
"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const protocol_handler_1 = require("../protocol/protocol-handler");
const stdio_1 = require("../transport/stdio");
const mcp_server_1 = require("../mcp-server");
function main() {
    // Tools that touch the Cocos editor expect a global `Editor` object. Provide
    // a stub when running outside the editor so `require()`‑time access doesn't
    // crash; tool execution will still throw a descriptive error.
    const g = globalThis;
    if (typeof g.Editor === 'undefined') {
        g.Editor = new Proxy({}, {
            get() { throw new Error('Cocos Editor API not available in stdio standalone mode'); }
        });
    }
    const registry = new mcp_server_1.CocosToolRegistry();
    const handler = new protocol_handler_1.ProtocolHandler({ registry, pageSize: 100, initialLogLevel: 'info' });
    const transport = new stdio_1.StdioTransport({ handler });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RkaW8uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvY2xpL3N0ZGlvLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRzs7QUFFSCxtRUFBK0Q7QUFDL0QsOENBQW9EO0FBQ3BELDhDQUFrRDtBQUVsRCxTQUFTLElBQUk7SUFDVCw2RUFBNkU7SUFDN0UsNEVBQTRFO0lBQzVFLDhEQUE4RDtJQUM5RCxNQUFNLENBQUMsR0FBRyxVQUFpQixDQUFDO0lBQzVCLElBQUksT0FBTyxDQUFDLENBQUMsTUFBTSxLQUFLLFdBQVcsRUFBRSxDQUFDO1FBQ2xDLENBQUMsQ0FBQyxNQUFNLEdBQUcsSUFBSSxLQUFLLENBQUMsRUFBRSxFQUFFO1lBQ3JCLEdBQUcsS0FBSyxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQ3hGLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyxJQUFJLDhCQUFpQixFQUFFLENBQUM7SUFDekMsTUFBTSxPQUFPLEdBQUcsSUFBSSxrQ0FBZSxDQUFDLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZUFBZSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDMUYsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBYyxDQUFDLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztJQUVsRCxNQUFNLFFBQVEsR0FBRyxHQUFHLEVBQUU7UUFDbEIsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0lBQ0YsT0FBTyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDL0IsT0FBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFFaEMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ2xCLHFEQUFxRDtJQUNyRCxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0FBQ2hFLENBQUM7QUFFRCxJQUFJLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbi8qKlxuICogU3RhbmTigJFhbG9uZSBzdGRpbyBlbnRyeSBwb2ludCAoQTIpLlxuICpcbiAqIFRoaXMgYmluYXJ5IGNhbiBiZSB3aXJlZCBzdHJhaWdodCBpbnRvIGEgQ2xhdWRlIERlc2t0b3AgLyBDdXJzb3IgTUNQXG4gKiBzZXJ2ZXIgY29uZmlnOlxuICpcbiAqICAgICB7XG4gKiAgICAgICBcIm1jcFNlcnZlcnNcIjoge1xuICogICAgICAgICBcImNvY29zXCI6IHtcbiAqICAgICAgICAgICBcImNvbW1hbmRcIjogXCJub2RlXCIsXG4gKiAgICAgICAgICAgXCJhcmdzXCI6IFtcIi9wYXRoL3RvL2NvY29zLW1jcC9kaXN0L2NsaS9zdGRpby5qc1wiXVxuICogICAgICAgICB9XG4gKiAgICAgICB9XG4gKiAgICAgfVxuICpcbiAqIENhdmVhdDogdG9vbHMgdGhhdCB0YWxrIHRvIGBFZGl0b3IuKmAgb25seSB3b3JrIHdoZW4gdGhlIENvY29zIENyZWF0b3JcbiAqIGVkaXRvciBpcyBjdXJyZW50bHkgaG9zdGluZyB0aGlzIHByb2Nlc3MgKGkuZS4gd2hlbiB0aGUgZXh0ZW5zaW9uIGlzXG4gKiBsb2FkZWQpLiBXaGVuIHJ1biBmcm9tIGEgcGxhaW4gTm9kZS5qcyBwcm9jZXNzIHRoZSB0b29scyB0aGF0IHRvdWNoIHRoZVxuICogZWRpdG9yIHdpbGwgZmFpbCBncmFjZWZ1bGx5IHdpdGggYSBkZXNjcmlwdGl2ZSBlcnJvciwgYnV0IGB0b29scy9saXN0YCxcbiAqIGBpbml0aWFsaXplYCwgYHBpbmdgLCBgbG9nZ2luZy9zZXRMZXZlbGAgYW5kIGNhcGFiaWxpdHkgbmVnb3RpYXRpb24gYWxsXG4gKiBmdW5jdGlvbiBzbyB0aGUgdHJhbnNwb3J0IGlzIHN0aWxsIHVzZWZ1bCBmb3IgdGVzdGluZy5cbiAqL1xuXG5pbXBvcnQgeyBQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuLi9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyJztcbmltcG9ydCB7IFN0ZGlvVHJhbnNwb3J0IH0gZnJvbSAnLi4vdHJhbnNwb3J0L3N0ZGlvJztcbmltcG9ydCB7IENvY29zVG9vbFJlZ2lzdHJ5IH0gZnJvbSAnLi4vbWNwLXNlcnZlcic7XG5cbmZ1bmN0aW9uIG1haW4oKTogdm9pZCB7XG4gICAgLy8gVG9vbHMgdGhhdCB0b3VjaCB0aGUgQ29jb3MgZWRpdG9yIGV4cGVjdCBhIGdsb2JhbCBgRWRpdG9yYCBvYmplY3QuIFByb3ZpZGVcbiAgICAvLyBhIHN0dWIgd2hlbiBydW5uaW5nIG91dHNpZGUgdGhlIGVkaXRvciBzbyBgcmVxdWlyZSgpYOKAkXRpbWUgYWNjZXNzIGRvZXNuJ3RcbiAgICAvLyBjcmFzaDsgdG9vbCBleGVjdXRpb24gd2lsbCBzdGlsbCB0aHJvdyBhIGRlc2NyaXB0aXZlIGVycm9yLlxuICAgIGNvbnN0IGcgPSBnbG9iYWxUaGlzIGFzIGFueTtcbiAgICBpZiAodHlwZW9mIGcuRWRpdG9yID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICBnLkVkaXRvciA9IG5ldyBQcm94eSh7fSwge1xuICAgICAgICAgICAgZ2V0KCkgeyB0aHJvdyBuZXcgRXJyb3IoJ0NvY29zIEVkaXRvciBBUEkgbm90IGF2YWlsYWJsZSBpbiBzdGRpbyBzdGFuZGFsb25lIG1vZGUnKTsgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCByZWdpc3RyeSA9IG5ldyBDb2Nvc1Rvb2xSZWdpc3RyeSgpO1xuICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgUHJvdG9jb2xIYW5kbGVyKHsgcmVnaXN0cnksIHBhZ2VTaXplOiAxMDAsIGluaXRpYWxMb2dMZXZlbDogJ2luZm8nIH0pO1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IG5ldyBTdGRpb1RyYW5zcG9ydCh7IGhhbmRsZXIgfSk7XG5cbiAgICBjb25zdCBzaHV0ZG93biA9ICgpID0+IHtcbiAgICAgICAgdHJhbnNwb3J0LnN0b3AoKTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KDApO1xuICAgIH07XG4gICAgcHJvY2Vzcy5vbignU0lHSU5UJywgc2h1dGRvd24pO1xuICAgIHByb2Nlc3Mub24oJ1NJR1RFUk0nLCBzaHV0ZG93bik7XG5cbiAgICB0cmFuc3BvcnQuc3RhcnQoKTtcbiAgICAvLyBOb3RlOiBuZXZlciBwcmludCB0byBzdGRvdXQ7IHRoZSBwcm90b2NvbCBvd25zIGl0LlxuICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKCdbY29jb3MtbWNwXSBzdGRpbyB0cmFuc3BvcnQgcmVhZHlcXG4nKTtcbn1cblxubWFpbigpO1xuIl19