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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RkaW8uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvY2xpL3N0ZGlvLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRzs7QUFFSCxtRUFBK0Q7QUFDL0QsOENBQW9EO0FBQ3BELDhDQUFrRDtBQUNsRCx1REFLZ0M7QUFFaEMsU0FBUyxJQUFJO0lBQ1QsNkVBQTZFO0lBQzdFLDRFQUE0RTtJQUM1RSw4REFBOEQ7SUFDOUQsTUFBTSxDQUFDLEdBQUcsVUFBaUIsQ0FBQztJQUM1QixJQUFJLE9BQU8sQ0FBQyxDQUFDLE1BQU0sS0FBSyxXQUFXLEVBQUUsQ0FBQztRQUNsQyxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksS0FBSyxDQUFDLEVBQUUsRUFBRTtZQUNyQixHQUFHLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUN4RixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSw4QkFBaUIsRUFBRSxDQUFDO0lBQ3pDLDBFQUEwRTtJQUMxRSxzRUFBc0U7SUFDdEUsc0VBQXNFO0lBQ3RFLElBQUksYUFBYSxHQUF1QyxFQUFFLENBQUM7SUFDM0QsSUFBSSxVQUFVLEdBQTZDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ2hFLGFBQWEsQ0FBQyxJQUFJLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2pELENBQUMsQ0FBQztJQUNGLE1BQU0sU0FBUyxHQUFHLElBQUksNkJBQWdCLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbkUsTUFBTSxPQUFPLEdBQUcsSUFBSSwyQkFBYyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQy9ELFNBQVMsQ0FBQyxXQUFXLENBQUMsSUFBQSx5Q0FBNEIsR0FBRSxDQUFDLENBQUM7SUFDdEQsT0FBTyxDQUFDLFdBQVcsQ0FBQyxJQUFBLHVDQUEwQixHQUFFLENBQUMsQ0FBQztJQUVsRCxNQUFNLE9BQU8sR0FBRyxJQUFJLGtDQUFlLENBQUM7UUFDaEMsUUFBUTtRQUNSLFFBQVEsRUFBRSxHQUFHO1FBQ2IsZUFBZSxFQUFFLE1BQU07UUFDdkIsU0FBUztRQUNULE9BQU87S0FDVixDQUFDLENBQUM7SUFDSCxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFjLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO0lBQ2xELHFFQUFxRTtJQUNyRSxzRUFBc0U7SUFDdEUsVUFBVSxHQUFHLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMxRSxLQUFLLE1BQU0sRUFBRSxJQUFJLGFBQWE7UUFBRSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDL0UsYUFBYSxHQUFHLEVBQUUsQ0FBQztJQUVuQixNQUFNLFFBQVEsR0FBRyxHQUFHLEVBQUU7UUFDbEIsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0lBQ0YsT0FBTyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDL0IsT0FBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFFaEMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ2xCLHFEQUFxRDtJQUNyRCxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0FBQ2hFLENBQUM7QUFFRCxJQUFJLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcclxuLyoqXHJcbiAqIFN0YW5k4oCRYWxvbmUgc3RkaW8gZW50cnkgcG9pbnQgKEEyKS5cclxuICpcclxuICogVGhpcyBiaW5hcnkgY2FuIGJlIHdpcmVkIHN0cmFpZ2h0IGludG8gYSBDbGF1ZGUgRGVza3RvcCAvIEN1cnNvciBNQ1BcclxuICogc2VydmVyIGNvbmZpZzpcclxuICpcclxuICogICAgIHtcclxuICogICAgICAgXCJtY3BTZXJ2ZXJzXCI6IHtcclxuICogICAgICAgICBcImNvY29zXCI6IHtcclxuICogICAgICAgICAgIFwiY29tbWFuZFwiOiBcIm5vZGVcIixcclxuICogICAgICAgICAgIFwiYXJnc1wiOiBbXCIvcGF0aC90by9jb2Nvcy1tY3AvZGlzdC9jbGkvc3RkaW8uanNcIl1cclxuICogICAgICAgICB9XHJcbiAqICAgICAgIH1cclxuICogICAgIH1cclxuICpcclxuICogQ2F2ZWF0OiB0b29scyB0aGF0IHRhbGsgdG8gYEVkaXRvci4qYCBvbmx5IHdvcmsgd2hlbiB0aGUgQ29jb3MgQ3JlYXRvclxyXG4gKiBlZGl0b3IgaXMgY3VycmVudGx5IGhvc3RpbmcgdGhpcyBwcm9jZXNzIChpLmUuIHdoZW4gdGhlIGV4dGVuc2lvbiBpc1xyXG4gKiBsb2FkZWQpLiBXaGVuIHJ1biBmcm9tIGEgcGxhaW4gTm9kZS5qcyBwcm9jZXNzIHRoZSB0b29scyB0aGF0IHRvdWNoIHRoZVxyXG4gKiBlZGl0b3Igd2lsbCBmYWlsIGdyYWNlZnVsbHkgd2l0aCBhIGRlc2NyaXB0aXZlIGVycm9yLCBidXQgYHRvb2xzL2xpc3RgLFxyXG4gKiBgaW5pdGlhbGl6ZWAsIGBwaW5nYCwgYGxvZ2dpbmcvc2V0TGV2ZWxgIGFuZCBjYXBhYmlsaXR5IG5lZ290aWF0aW9uIGFsbFxyXG4gKiBmdW5jdGlvbiBzbyB0aGUgdHJhbnNwb3J0IGlzIHN0aWxsIHVzZWZ1bCBmb3IgdGVzdGluZy5cclxuICovXHJcblxyXG5pbXBvcnQgeyBQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuLi9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyJztcclxuaW1wb3J0IHsgU3RkaW9UcmFuc3BvcnQgfSBmcm9tICcuLi90cmFuc3BvcnQvc3RkaW8nO1xyXG5pbXBvcnQgeyBDb2Nvc1Rvb2xSZWdpc3RyeSB9IGZyb20gJy4uL21jcC1zZXJ2ZXInO1xyXG5pbXBvcnQge1xyXG4gICAgUHJvbXB0UmVnaXN0cnksXHJcbiAgICBSZXNvdXJjZVJlZ2lzdHJ5LFxyXG4gICAgYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIsXHJcbiAgICBidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyXHJcbn0gZnJvbSAnLi4vcHJvdG9jb2wvcmVnaXN0cmllcyc7XHJcblxyXG5mdW5jdGlvbiBtYWluKCk6IHZvaWQge1xyXG4gICAgLy8gVG9vbHMgdGhhdCB0b3VjaCB0aGUgQ29jb3MgZWRpdG9yIGV4cGVjdCBhIGdsb2JhbCBgRWRpdG9yYCBvYmplY3QuIFByb3ZpZGVcclxuICAgIC8vIGEgc3R1YiB3aGVuIHJ1bm5pbmcgb3V0c2lkZSB0aGUgZWRpdG9yIHNvIGByZXF1aXJlKClg4oCRdGltZSBhY2Nlc3MgZG9lc24ndFxyXG4gICAgLy8gY3Jhc2g7IHRvb2wgZXhlY3V0aW9uIHdpbGwgc3RpbGwgdGhyb3cgYSBkZXNjcmlwdGl2ZSBlcnJvci5cclxuICAgIGNvbnN0IGcgPSBnbG9iYWxUaGlzIGFzIGFueTtcclxuICAgIGlmICh0eXBlb2YgZy5FZGl0b3IgPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgICAgZy5FZGl0b3IgPSBuZXcgUHJveHkoe30sIHtcclxuICAgICAgICAgICAgZ2V0KCkgeyB0aHJvdyBuZXcgRXJyb3IoJ0NvY29zIEVkaXRvciBBUEkgbm90IGF2YWlsYWJsZSBpbiBzdGRpbyBzdGFuZGFsb25lIG1vZGUnKTsgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IENvY29zVG9vbFJlZ2lzdHJ5KCk7XHJcbiAgICAvLyBQaGFzZSAyIOKAlCBleHBvc2UgcmVzb3VyY2VzIGFuZCBwcm9tcHRzIGluIHN0ZGlvIG1vZGUgdG9vLiBOb3RpZmljYXRpb25zXHJcbiAgICAvLyBlbWl0dGVkIGJ5IHRoZSByZWdpc3RyaWVzIGZsb3cgdGhyb3VnaCB0aGUgdHJhbnNwb3J0J3Mgbm90aWZpY2F0aW9uXHJcbiAgICAvLyBzaW5rIChzZXQgdXAgYnkgYFN0ZGlvVHJhbnNwb3J0YCBhZnRlciBoYW5kbGVyIGNvbnN0cnVjdGlvbiBiZWxvdykuXHJcbiAgICBsZXQgcGVuZGluZ05vdGlmeTogeyBtZXRob2Q6IHN0cmluZzsgcGFyYW1zPzogYW55IH1bXSA9IFtdO1xyXG4gICAgbGV0IG5vdGlmeVNpbms6ICgobWV0aG9kOiBzdHJpbmcsIHBhcmFtcz86IGFueSkgPT4gdm9pZCkgPSAobSwgcCkgPT4ge1xyXG4gICAgICAgIHBlbmRpbmdOb3RpZnkucHVzaCh7IG1ldGhvZDogbSwgcGFyYW1zOiBwIH0pO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IHJlc291cmNlcyA9IG5ldyBSZXNvdXJjZVJlZ2lzdHJ5KChtLCBwKSA9PiBub3RpZnlTaW5rKG0sIHApKTtcclxuICAgIGNvbnN0IHByb21wdHMgPSBuZXcgUHJvbXB0UmVnaXN0cnkoKG0sIHApID0+IG5vdGlmeVNpbmsobSwgcCkpO1xyXG4gICAgcmVzb3VyY2VzLmFkZFByb3ZpZGVyKGJ1aWxkQnVpbHRJblJlc291cmNlUHJvdmlkZXIoKSk7XHJcbiAgICBwcm9tcHRzLmFkZFByb3ZpZGVyKGJ1aWxkQnVpbHRJblByb21wdFByb3ZpZGVyKCkpO1xyXG5cclxuICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgUHJvdG9jb2xIYW5kbGVyKHtcclxuICAgICAgICByZWdpc3RyeSxcclxuICAgICAgICBwYWdlU2l6ZTogMTAwLFxyXG4gICAgICAgIGluaXRpYWxMb2dMZXZlbDogJ2luZm8nLFxyXG4gICAgICAgIHJlc291cmNlcyxcclxuICAgICAgICBwcm9tcHRzXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IG5ldyBTdGRpb1RyYW5zcG9ydCh7IGhhbmRsZXIgfSk7XHJcbiAgICAvLyBSZXBsYWNlIHRoZSBidWZmZXJpbmcgc2luayB3aXRoIG9uZSB0aGF0IGhhbmRzIG9mZiB0byB0aGUgcHJvdG9jb2xcclxuICAgIC8vIGhhbmRsZXIgKHdoaWNoIGZvcndhcmRzIHRocm91Z2ggdGhlIHRyYW5zcG9ydCdzIG5vdGlmaWNhdGlvbiBwYXRoKS5cclxuICAgIG5vdGlmeVNpbmsgPSAobWV0aG9kLCBwYXJhbXMpID0+IGhhbmRsZXIuZW1pdE5vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcyk7XHJcbiAgICBmb3IgKGNvbnN0IGV2IG9mIHBlbmRpbmdOb3RpZnkpIGhhbmRsZXIuZW1pdE5vdGlmaWNhdGlvbihldi5tZXRob2QsIGV2LnBhcmFtcyk7XHJcbiAgICBwZW5kaW5nTm90aWZ5ID0gW107XHJcblxyXG4gICAgY29uc3Qgc2h1dGRvd24gPSAoKSA9PiB7XHJcbiAgICAgICAgdHJhbnNwb3J0LnN0b3AoKTtcclxuICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XHJcbiAgICB9O1xyXG4gICAgcHJvY2Vzcy5vbignU0lHSU5UJywgc2h1dGRvd24pO1xyXG4gICAgcHJvY2Vzcy5vbignU0lHVEVSTScsIHNodXRkb3duKTtcclxuXHJcbiAgICB0cmFuc3BvcnQuc3RhcnQoKTtcclxuICAgIC8vIE5vdGU6IG5ldmVyIHByaW50IHRvIHN0ZG91dDsgdGhlIHByb3RvY29sIG93bnMgaXQuXHJcbiAgICBwcm9jZXNzLnN0ZGVyci53cml0ZSgnW2NvY29zLW1jcF0gc3RkaW8gdHJhbnNwb3J0IHJlYWR5XFxuJyk7XHJcbn1cclxuXHJcbm1haW4oKTtcclxuIl19