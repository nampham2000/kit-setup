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
const registries_1 = require("../protocol/registries");
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
    // Phase 2 — expose resources and prompts in stdio mode too. Notifications
    // emitted by the registries flow through the transport's notification
    // sink (set up by `StdioTransport` after handler construction below).
    let pendingNotify = [];
    let notifySink = (m, p) => {
        pendingNotify.push({ method: m, params: p });
    };
    const resources = new registries_1.ResourceRegistry((m, p) => notifySink(m, p));
    const prompts = new registries_1.PromptRegistry((m, p) => notifySink(m, p));
    resources.addProvider((0, registries_1.buildBuiltInResourceProvider)());
    prompts.addProvider((0, registries_1.buildBuiltInPromptProvider)());
    const handler = new protocol_handler_1.ProtocolHandler({
        registry,
        pageSize: 100,
        initialLogLevel: 'info',
        resources,
        prompts
    });
    const transport = new stdio_1.StdioTransport({ handler });
    // Replace the buffering sink with one that hands off to the protocol
    // handler (which forwards through the transport's notification path).
    notifySink = (method, params) => handler.emitNotification(method, params);
    for (const ev of pendingNotify)
        handler.emitNotification(ev.method, ev.params);
    pendingNotify = [];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RkaW8uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvY2xpL3N0ZGlvLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRzs7QUFFSCxtRUFBK0Q7QUFDL0QsOENBQW9EO0FBQ3BELDhDQUFrRDtBQUNsRCx1REFLZ0M7QUFFaEMsU0FBUyxJQUFJO0lBQ1QsNkVBQTZFO0lBQzdFLDRFQUE0RTtJQUM1RSw4REFBOEQ7SUFDOUQsTUFBTSxDQUFDLEdBQUcsVUFBaUIsQ0FBQztJQUM1QixJQUFJLE9BQU8sQ0FBQyxDQUFDLE1BQU0sS0FBSyxXQUFXLEVBQUUsQ0FBQztRQUNsQyxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksS0FBSyxDQUFDLEVBQUUsRUFBRTtZQUNyQixHQUFHLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUN4RixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSw4QkFBaUIsRUFBRSxDQUFDO0lBQ3pDLDBFQUEwRTtJQUMxRSxzRUFBc0U7SUFDdEUsc0VBQXNFO0lBQ3RFLElBQUksYUFBYSxHQUF1QyxFQUFFLENBQUM7SUFDM0QsSUFBSSxVQUFVLEdBQTZDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ2hFLGFBQWEsQ0FBQyxJQUFJLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2pELENBQUMsQ0FBQztJQUNGLE1BQU0sU0FBUyxHQUFHLElBQUksNkJBQWdCLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbkUsTUFBTSxPQUFPLEdBQUcsSUFBSSwyQkFBYyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQy9ELFNBQVMsQ0FBQyxXQUFXLENBQUMsSUFBQSx5Q0FBNEIsR0FBRSxDQUFDLENBQUM7SUFDdEQsT0FBTyxDQUFDLFdBQVcsQ0FBQyxJQUFBLHVDQUEwQixHQUFFLENBQUMsQ0FBQztJQUVsRCxNQUFNLE9BQU8sR0FBRyxJQUFJLGtDQUFlLENBQUM7UUFDaEMsUUFBUTtRQUNSLFFBQVEsRUFBRSxHQUFHO1FBQ2IsZUFBZSxFQUFFLE1BQU07UUFDdkIsU0FBUztRQUNULE9BQU87S0FDVixDQUFDLENBQUM7SUFDSCxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFjLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO0lBQ2xELHFFQUFxRTtJQUNyRSxzRUFBc0U7SUFDdEUsVUFBVSxHQUFHLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMxRSxLQUFLLE1BQU0sRUFBRSxJQUFJLGFBQWE7UUFBRSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDL0UsYUFBYSxHQUFHLEVBQUUsQ0FBQztJQUVuQixNQUFNLFFBQVEsR0FBRyxHQUFHLEVBQUU7UUFDbEIsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0lBQ0YsT0FBTyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDL0IsT0FBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFFaEMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ2xCLHFEQUFxRDtJQUNyRCxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0FBQ2hFLENBQUM7QUFFRCxJQUFJLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbi8qKlxuICogU3RhbmTigJFhbG9uZSBzdGRpbyBlbnRyeSBwb2ludCAoQTIpLlxuICpcbiAqIFRoaXMgYmluYXJ5IGNhbiBiZSB3aXJlZCBzdHJhaWdodCBpbnRvIGEgQ2xhdWRlIERlc2t0b3AgLyBDdXJzb3IgTUNQXG4gKiBzZXJ2ZXIgY29uZmlnOlxuICpcbiAqICAgICB7XG4gKiAgICAgICBcIm1jcFNlcnZlcnNcIjoge1xuICogICAgICAgICBcImNvY29zXCI6IHtcbiAqICAgICAgICAgICBcImNvbW1hbmRcIjogXCJub2RlXCIsXG4gKiAgICAgICAgICAgXCJhcmdzXCI6IFtcIi9wYXRoL3RvL2NvY29zLW1jcC9kaXN0L2NsaS9zdGRpby5qc1wiXVxuICogICAgICAgICB9XG4gKiAgICAgICB9XG4gKiAgICAgfVxuICpcbiAqIENhdmVhdDogdG9vbHMgdGhhdCB0YWxrIHRvIGBFZGl0b3IuKmAgb25seSB3b3JrIHdoZW4gdGhlIENvY29zIENyZWF0b3JcbiAqIGVkaXRvciBpcyBjdXJyZW50bHkgaG9zdGluZyB0aGlzIHByb2Nlc3MgKGkuZS4gd2hlbiB0aGUgZXh0ZW5zaW9uIGlzXG4gKiBsb2FkZWQpLiBXaGVuIHJ1biBmcm9tIGEgcGxhaW4gTm9kZS5qcyBwcm9jZXNzIHRoZSB0b29scyB0aGF0IHRvdWNoIHRoZVxuICogZWRpdG9yIHdpbGwgZmFpbCBncmFjZWZ1bGx5IHdpdGggYSBkZXNjcmlwdGl2ZSBlcnJvciwgYnV0IGB0b29scy9saXN0YCxcbiAqIGBpbml0aWFsaXplYCwgYHBpbmdgLCBgbG9nZ2luZy9zZXRMZXZlbGAgYW5kIGNhcGFiaWxpdHkgbmVnb3RpYXRpb24gYWxsXG4gKiBmdW5jdGlvbiBzbyB0aGUgdHJhbnNwb3J0IGlzIHN0aWxsIHVzZWZ1bCBmb3IgdGVzdGluZy5cbiAqL1xuXG5pbXBvcnQgeyBQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuLi9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyJztcbmltcG9ydCB7IFN0ZGlvVHJhbnNwb3J0IH0gZnJvbSAnLi4vdHJhbnNwb3J0L3N0ZGlvJztcbmltcG9ydCB7IENvY29zVG9vbFJlZ2lzdHJ5IH0gZnJvbSAnLi4vbWNwLXNlcnZlcic7XG5pbXBvcnQge1xuICAgIFByb21wdFJlZ2lzdHJ5LFxuICAgIFJlc291cmNlUmVnaXN0cnksXG4gICAgYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIsXG4gICAgYnVpbGRCdWlsdEluUmVzb3VyY2VQcm92aWRlclxufSBmcm9tICcuLi9wcm90b2NvbC9yZWdpc3RyaWVzJztcblxuZnVuY3Rpb24gbWFpbigpOiB2b2lkIHtcbiAgICAvLyBUb29scyB0aGF0IHRvdWNoIHRoZSBDb2NvcyBlZGl0b3IgZXhwZWN0IGEgZ2xvYmFsIGBFZGl0b3JgIG9iamVjdC4gUHJvdmlkZVxuICAgIC8vIGEgc3R1YiB3aGVuIHJ1bm5pbmcgb3V0c2lkZSB0aGUgZWRpdG9yIHNvIGByZXF1aXJlKClg4oCRdGltZSBhY2Nlc3MgZG9lc24ndFxuICAgIC8vIGNyYXNoOyB0b29sIGV4ZWN1dGlvbiB3aWxsIHN0aWxsIHRocm93IGEgZGVzY3JpcHRpdmUgZXJyb3IuXG4gICAgY29uc3QgZyA9IGdsb2JhbFRoaXMgYXMgYW55O1xuICAgIGlmICh0eXBlb2YgZy5FZGl0b3IgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGcuRWRpdG9yID0gbmV3IFByb3h5KHt9LCB7XG4gICAgICAgICAgICBnZXQoKSB7IHRocm93IG5ldyBFcnJvcignQ29jb3MgRWRpdG9yIEFQSSBub3QgYXZhaWxhYmxlIGluIHN0ZGlvIHN0YW5kYWxvbmUgbW9kZScpOyB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IENvY29zVG9vbFJlZ2lzdHJ5KCk7XG4gICAgLy8gUGhhc2UgMiDigJQgZXhwb3NlIHJlc291cmNlcyBhbmQgcHJvbXB0cyBpbiBzdGRpbyBtb2RlIHRvby4gTm90aWZpY2F0aW9uc1xuICAgIC8vIGVtaXR0ZWQgYnkgdGhlIHJlZ2lzdHJpZXMgZmxvdyB0aHJvdWdoIHRoZSB0cmFuc3BvcnQncyBub3RpZmljYXRpb25cbiAgICAvLyBzaW5rIChzZXQgdXAgYnkgYFN0ZGlvVHJhbnNwb3J0YCBhZnRlciBoYW5kbGVyIGNvbnN0cnVjdGlvbiBiZWxvdykuXG4gICAgbGV0IHBlbmRpbmdOb3RpZnk6IHsgbWV0aG9kOiBzdHJpbmc7IHBhcmFtcz86IGFueSB9W10gPSBbXTtcbiAgICBsZXQgbm90aWZ5U2luazogKChtZXRob2Q6IHN0cmluZywgcGFyYW1zPzogYW55KSA9PiB2b2lkKSA9IChtLCBwKSA9PiB7XG4gICAgICAgIHBlbmRpbmdOb3RpZnkucHVzaCh7IG1ldGhvZDogbSwgcGFyYW1zOiBwIH0pO1xuICAgIH07XG4gICAgY29uc3QgcmVzb3VyY2VzID0gbmV3IFJlc291cmNlUmVnaXN0cnkoKG0sIHApID0+IG5vdGlmeVNpbmsobSwgcCkpO1xuICAgIGNvbnN0IHByb21wdHMgPSBuZXcgUHJvbXB0UmVnaXN0cnkoKG0sIHApID0+IG5vdGlmeVNpbmsobSwgcCkpO1xuICAgIHJlc291cmNlcy5hZGRQcm92aWRlcihidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyKCkpO1xuICAgIHByb21wdHMuYWRkUHJvdmlkZXIoYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIoKSk7XG5cbiAgICBjb25zdCBoYW5kbGVyID0gbmV3IFByb3RvY29sSGFuZGxlcih7XG4gICAgICAgIHJlZ2lzdHJ5LFxuICAgICAgICBwYWdlU2l6ZTogMTAwLFxuICAgICAgICBpbml0aWFsTG9nTGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgcmVzb3VyY2VzLFxuICAgICAgICBwcm9tcHRzXG4gICAgfSk7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gbmV3IFN0ZGlvVHJhbnNwb3J0KHsgaGFuZGxlciB9KTtcbiAgICAvLyBSZXBsYWNlIHRoZSBidWZmZXJpbmcgc2luayB3aXRoIG9uZSB0aGF0IGhhbmRzIG9mZiB0byB0aGUgcHJvdG9jb2xcbiAgICAvLyBoYW5kbGVyICh3aGljaCBmb3J3YXJkcyB0aHJvdWdoIHRoZSB0cmFuc3BvcnQncyBub3RpZmljYXRpb24gcGF0aCkuXG4gICAgbm90aWZ5U2luayA9IChtZXRob2QsIHBhcmFtcykgPT4gaGFuZGxlci5lbWl0Tm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKTtcbiAgICBmb3IgKGNvbnN0IGV2IG9mIHBlbmRpbmdOb3RpZnkpIGhhbmRsZXIuZW1pdE5vdGlmaWNhdGlvbihldi5tZXRob2QsIGV2LnBhcmFtcyk7XG4gICAgcGVuZGluZ05vdGlmeSA9IFtdO1xuXG4gICAgY29uc3Qgc2h1dGRvd24gPSAoKSA9PiB7XG4gICAgICAgIHRyYW5zcG9ydC5zdG9wKCk7XG4gICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICB9O1xuICAgIHByb2Nlc3Mub24oJ1NJR0lOVCcsIHNodXRkb3duKTtcbiAgICBwcm9jZXNzLm9uKCdTSUdURVJNJywgc2h1dGRvd24pO1xuXG4gICAgdHJhbnNwb3J0LnN0YXJ0KCk7XG4gICAgLy8gTm90ZTogbmV2ZXIgcHJpbnQgdG8gc3Rkb3V0OyB0aGUgcHJvdG9jb2wgb3ducyBpdC5cbiAgICBwcm9jZXNzLnN0ZGVyci53cml0ZSgnW2NvY29zLW1jcF0gc3RkaW8gdHJhbnNwb3J0IHJlYWR5XFxuJyk7XG59XG5cbm1haW4oKTtcbiJdfQ==