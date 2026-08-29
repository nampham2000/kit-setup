"use strict";
/**
 * Cocos Creator MCP server orchestrator.
 *
 * Owns the tool registry and the Streamable HTTP transport. The actual
 * JSON‑RPC / MCP protocol is implemented by {@link ProtocolHandler} so it
 * can be reused by stdio (and future WebSocket) transports.
 *
 * Phase 1 capabilities:
 *  - A1 Streamable HTTP transport (GET/POST/DELETE /mcp, Mcp-Session-Id, SSE)
 *  - A4 Origin allow‑list + DNS rebinding guard
 *  - A5 ****** auth
 *  - A6 logging/setLevel + notifications/message
 *  - A7 notifications/progress
 *  - A8 AbortSignal cancellation
 *  - G1 Tool annotations on tools/list
 *  - G3 outputSchema on tools/list + structuredContent on tools/call
 *  - G4 Pagination cursor on tools/list
 *  - G8 Ajv input validation → -32602
 *  - G9 protocolVersion handshake with feature flags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPServer = exports.CocosToolRegistry = void 0;
const protocol_handler_1 = require("./protocol/protocol-handler");
const streamable_http_1 = require("./transport/streamable-http");
const registries_1 = require("./protocol/registries");
const scene_tools_1 = require("./tools/scene-tools");
const node_tools_1 = require("./tools/node-tools");
const component_tools_1 = require("./tools/component-tools");
const prefab_tools_1 = require("./tools/prefab-tools");
const project_tools_1 = require("./tools/project-tools");
const debug_tools_1 = require("./tools/debug-tools");
const preferences_tools_1 = require("./tools/preferences-tools");
const server_tools_1 = require("./tools/server-tools");
const broadcast_tools_1 = require("./tools/broadcast-tools");
const scene_advanced_tools_1 = require("./tools/scene-advanced-tools");
const scene_view_tools_1 = require("./tools/scene-view-tools");
const reference_image_tools_1 = require("./tools/reference-image-tools");
const asset_advanced_tools_1 = require("./tools/asset-advanced-tools");
const validation_tools_1 = require("./tools/validation-tools");
const editor_runtime_tools_1 = require("./tools/editor-runtime-tools");
const engine_feature_tools_1 = require("./tools/engine-feature-tools");
const dx_tools_1 = require("./tools/dx-tools");
/**
 * The tool registry used by all transports. Wraps the legacy per‑category
 * tool classes and exposes the unified {@link ToolRegistry} interface used by
 * {@link ProtocolHandler}.
 */
class CocosToolRegistry {
    constructor() {
        this.tools = {};
        this.toolsList = [];
        this.enabledTools = [];
        this.tools.scene = new scene_tools_1.SceneTools();
        this.tools.node = new node_tools_1.NodeTools();
        this.tools.component = new component_tools_1.ComponentTools();
        this.tools.prefab = new prefab_tools_1.PrefabTools();
        this.tools.project = new project_tools_1.ProjectTools();
        this.tools.debug = new debug_tools_1.DebugTools();
        this.tools.preferences = new preferences_tools_1.PreferencesTools();
        this.tools.server = new server_tools_1.ServerTools();
        this.tools.broadcast = new broadcast_tools_1.BroadcastTools();
        this.tools.sceneAdvanced = new scene_advanced_tools_1.SceneAdvancedTools();
        this.tools.sceneView = new scene_view_tools_1.SceneViewTools();
        this.tools.referenceImage = new reference_image_tools_1.ReferenceImageTools();
        this.tools.assetAdvanced = new asset_advanced_tools_1.AssetAdvancedTools();
        this.tools.validation = new validation_tools_1.ValidationTools();
        this.tools.editorRuntime = new editor_runtime_tools_1.EditorRuntimeTools();
        this.tools.engineFeature = new engine_feature_tools_1.EngineFeatureTools();
        this.rebuild();
    }
    /** Late binding for the DX category, which needs a directory pointer to the server. */
    registerDxTools(dx) {
        this.tools.dx = dx;
        this.rebuild();
    }
    updateEnabledTools(enabled) {
        this.enabledTools = enabled || [];
        this.rebuild();
    }
    listTools() {
        return this.toolsList;
    }
    getFilteredTools(enabled) {
        if (!enabled || enabled.length === 0)
            return this.toolsList;
        const allowed = new Set(enabled.map((t) => `${t.category}_${t.name}`));
        return this.toolsList.filter((t) => allowed.has(t.name));
    }
    async executeToolCall(name, args, ctx) {
        const idx = name.indexOf('_');
        if (idx < 0)
            throw new Error(`Invalid tool name: ${name}`);
        const category = name.slice(0, idx);
        const tool = name.slice(idx + 1);
        if (!this.tools[category])
            throw new Error(`Tool category not found: ${category}`);
        // A8: surface AbortSignal to tools that support it. Legacy tools ignore the
        // 3rd argument harmlessly; new tools can take advantage. We still poll the
        // signal here so that even synchronous tools terminate promptly.
        if (ctx.signal.aborted)
            throw new Error('cancelled');
        return await this.tools[category].execute(tool, args, ctx);
    }
    rebuild() {
        this.toolsList = [];
        const enabledNames = this.enabledTools.length
            ? new Set(this.enabledTools.map((t) => `${t.category}_${t.name}`))
            : null;
        for (const [category, toolSet] of Object.entries(this.tools)) {
            const defs = toolSet.getTools();
            for (const def of defs) {
                const fq = `${category}_${def.name}`;
                if (enabledNames && !enabledNames.has(fq))
                    continue;
                this.toolsList.push({
                    name: fq,
                    description: def.description,
                    inputSchema: def.inputSchema,
                    outputSchema: def.outputSchema,
                    annotations: def.annotations
                });
            }
        }
    }
}
exports.CocosToolRegistry = CocosToolRegistry;
class MCPServer {
    constructor(settings) {
        this.handlersBySession = new Map();
        this.startedAt = 0;
        this.settings = settings;
        this.registry = new CocosToolRegistry();
        // Phase 2 — registries broadcast list_changed via every active session
        // by piping their notifications through `broadcastNotification`.
        this.resources = new registries_1.ResourceRegistry((method, params) => this.broadcastNotification(method, params));
        this.prompts = new registries_1.PromptRegistry((method, params) => this.broadcastNotification(method, params));
        this.resources.addProvider((0, registries_1.buildBuiltInResourceProvider)());
        this.prompts.addProvider((0, registries_1.buildBuiltInPromptProvider)());
        // Phase 6 — DX tools need a pointer to the server itself.
        this.registry.registerDxTools(new dx_tools_1.DXTools({
            listTools: () => this.registry.listTools(),
            getServerCapabilities: () => this.getAdvertisedCapabilities(),
            getServerInfo: () => ({
                name: 'cocos-mcp-server',
                version: '1.4.0',
                uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
                sessions: this.transport ? this.transport.getSessionCount() : 0,
                port: this.settings.port
            })
        }));
        this.transport = new streamable_http_1.StreamableHttpServer({
            settings,
            createHandler: (sessionId) => {
                var _a, _b;
                const h = new protocol_handler_1.ProtocolHandler({
                    registry: this.registry,
                    pageSize: (_a = this.settings.toolsPageSize) !== null && _a !== void 0 ? _a : 100,
                    initialLogLevel: (_b = this.settings.logLevel) !== null && _b !== void 0 ? _b : 'info',
                    resources: this.resources,
                    prompts: this.prompts
                });
                this.handlersBySession.set(sessionId, h);
                return h;
            },
            onSessionTerminated: (sessionId) => this.handlersBySession.delete(sessionId)
        });
    }
    async start() {
        await this.transport.start();
        this.startedAt = Date.now();
        console.log(`[MCPServer] Streamable HTTP listening on http://127.0.0.1:${this.settings.port}/mcp`);
    }
    stop() {
        this.transport.stop();
        this.handlersBySession.clear();
        this.startedAt = 0;
    }
    updateSettings(settings) {
        this.settings = settings;
        this.transport.updateSettings(settings);
        for (const h of this.handlersBySession.values()) {
            if (settings.logLevel)
                h.setLogLevel(settings.logLevel);
        }
    }
    updateEnabledTools(enabledTools) {
        this.registry.updateEnabledTools(enabledTools);
        // Phase 1 follow-up: invalidate validators *and* broadcast
        // notifications/tools/list_changed so connected clients refresh.
        for (const h of this.handlersBySession.values()) {
            h.clearValidatorCache();
            h.emitToolsListChanged();
        }
    }
    getRegistry() {
        return this.registry;
    }
    getResources() {
        return this.resources;
    }
    getPrompts() {
        return this.prompts;
    }
    getStatus() {
        return {
            running: this.transport.getRunning(),
            port: this.transport.getPort(),
            clients: this.transport.getSessionCount()
        };
    }
    getClients() {
        return this.transport.getClients();
    }
    getSettings() {
        return this.settings;
    }
    getAvailableTools() {
        return this.registry.listTools();
    }
    getFilteredTools(enabledTools) {
        return this.registry.getFilteredTools(enabledTools);
    }
    /** Broadcast a server notification to every active session. */
    broadcastNotification(method, params) {
        for (const h of this.handlersBySession.values()) {
            try {
                // We cheat here a little by reaching for the public sendClientRequest
                // path's notification cousin via the public emit helpers; for
                // generic notifications we use the same private notify channel
                // by calling clearValidatorCache wrappers won't fit, so use
                // the protocol handler's notification helpers added below.
                h.emitNotification(method, params);
            }
            catch ( /* ignore */_a) { /* ignore */ }
        }
    }
    getAdvertisedCapabilities() {
        return {
            tools: { listChanged: true },
            logging: {},
            resources: { listChanged: true, subscribe: true },
            prompts: { listChanged: true },
            sampling: {},
            completions: {}
        };
    }
}
exports.MCPServer = MCPServer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tY3Atc2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRzs7O0FBR0gsa0VBQWtHO0FBQ2xHLGlFQUFtRTtBQUNuRSxzREFLK0I7QUFDL0IscURBQWlEO0FBQ2pELG1EQUErQztBQUMvQyw2REFBeUQ7QUFDekQsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCxxREFBaUQ7QUFDakQsaUVBQTZEO0FBQzdELHVEQUFtRDtBQUNuRCw2REFBeUQ7QUFDekQsdUVBQWtFO0FBQ2xFLCtEQUEwRDtBQUMxRCx5RUFBb0U7QUFDcEUsdUVBQWtFO0FBQ2xFLCtEQUEyRDtBQUMzRCx1RUFBa0U7QUFDbEUsdUVBQWtFO0FBQ2xFLCtDQUEyQztBQUUzQzs7OztHQUlHO0FBQ0gsTUFBYSxpQkFBaUI7SUFLMUI7UUFKUSxVQUFLLEdBQXdCLEVBQUUsQ0FBQztRQUNoQyxjQUFTLEdBQXFCLEVBQUUsQ0FBQztRQUNqQyxpQkFBWSxHQUF5QyxFQUFFLENBQUM7UUFHNUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7UUFDbEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxFQUFFLENBQUM7UUFDNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7UUFDdEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEdBQUcsSUFBSSw0QkFBWSxFQUFFLENBQUM7UUFDeEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEdBQUcs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RSxXQUFXLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUU7WUFDakQsT0FBTyxFQUFFLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRTtZQUM5QixRQUFRLEVBQUUsRUFBRTtZQUNaLFdBQVcsRUFBRSxFQUFFO1NBQ2xCLENBQUM7SUFDTixDQUFDO0NBQ0o7QUE1SUQsOEJBNElDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENvY29zIENyZWF0b3IgTUNQIHNlcnZlciBvcmNoZXN0cmF0b3IuXHJcbiAqXHJcbiAqIE93bnMgdGhlIHRvb2wgcmVnaXN0cnkgYW5kIHRoZSBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0LiBUaGUgYWN0dWFsXHJcbiAqIEpTT07igJFSUEMgLyBNQ1AgcHJvdG9jb2wgaXMgaW1wbGVtZW50ZWQgYnkge0BsaW5rIFByb3RvY29sSGFuZGxlcn0gc28gaXRcclxuICogY2FuIGJlIHJldXNlZCBieSBzdGRpbyAoYW5kIGZ1dHVyZSBXZWJTb2NrZXQpIHRyYW5zcG9ydHMuXHJcbiAqXHJcbiAqIFBoYXNlIDEgY2FwYWJpbGl0aWVzOlxyXG4gKiAgLSBBMSBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0IChHRVQvUE9TVC9ERUxFVEUgL21jcCwgTWNwLVNlc3Npb24tSWQsIFNTRSlcclxuICogIC0gQTQgT3JpZ2luIGFsbG934oCRbGlzdCArIEROUyByZWJpbmRpbmcgZ3VhcmRcclxuICogIC0gQTUgKioqKioqIGF1dGhcclxuICogIC0gQTYgbG9nZ2luZy9zZXRMZXZlbCArIG5vdGlmaWNhdGlvbnMvbWVzc2FnZVxyXG4gKiAgLSBBNyBub3RpZmljYXRpb25zL3Byb2dyZXNzXHJcbiAqICAtIEE4IEFib3J0U2lnbmFsIGNhbmNlbGxhdGlvblxyXG4gKiAgLSBHMSBUb29sIGFubm90YXRpb25zIG9uIHRvb2xzL2xpc3RcclxuICogIC0gRzMgb3V0cHV0U2NoZW1hIG9uIHRvb2xzL2xpc3QgKyBzdHJ1Y3R1cmVkQ29udGVudCBvbiB0b29scy9jYWxsXHJcbiAqICAtIEc0IFBhZ2luYXRpb24gY3Vyc29yIG9uIHRvb2xzL2xpc3RcclxuICogIC0gRzggQWp2IGlucHV0IHZhbGlkYXRpb24g4oaSIC0zMjYwMlxyXG4gKiAgLSBHOSBwcm90b2NvbFZlcnNpb24gaGFuZHNoYWtlIHdpdGggZmVhdHVyZSBmbGFnc1xyXG4gKi9cclxuXHJcbmltcG9ydCB7IE1DUFNlcnZlclNldHRpbmdzLCBNQ1BDbGllbnQsIFNlcnZlclN0YXR1cywgVG9vbERlZmluaXRpb24gfSBmcm9tICcuL3R5cGVzJztcclxuaW1wb3J0IHsgUHJvdG9jb2xIYW5kbGVyLCBUb29sRXhlY3V0aW9uQ29udGV4dCwgVG9vbFJlZ2lzdHJ5IH0gZnJvbSAnLi9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyJztcclxuaW1wb3J0IHsgU3RyZWFtYWJsZUh0dHBTZXJ2ZXIgfSBmcm9tICcuL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAnO1xyXG5pbXBvcnQge1xyXG4gICAgUHJvbXB0UmVnaXN0cnksXHJcbiAgICBSZXNvdXJjZVJlZ2lzdHJ5LFxyXG4gICAgYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIsXHJcbiAgICBidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyXHJcbn0gZnJvbSAnLi9wcm90b2NvbC9yZWdpc3RyaWVzJztcclxuaW1wb3J0IHsgU2NlbmVUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtdG9vbHMnO1xyXG5pbXBvcnQgeyBOb2RlVG9vbHMgfSBmcm9tICcuL3Rvb2xzL25vZGUtdG9vbHMnO1xyXG5pbXBvcnQgeyBDb21wb25lbnRUb29scyB9IGZyb20gJy4vdG9vbHMvY29tcG9uZW50LXRvb2xzJztcclxuaW1wb3J0IHsgUHJlZmFiVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ByZWZhYi10b29scyc7XHJcbmltcG9ydCB7IFByb2plY3RUb29scyB9IGZyb20gJy4vdG9vbHMvcHJvamVjdC10b29scyc7XHJcbmltcG9ydCB7IERlYnVnVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2RlYnVnLXRvb2xzJztcclxuaW1wb3J0IHsgUHJlZmVyZW5jZXNUb29scyB9IGZyb20gJy4vdG9vbHMvcHJlZmVyZW5jZXMtdG9vbHMnO1xyXG5pbXBvcnQgeyBTZXJ2ZXJUb29scyB9IGZyb20gJy4vdG9vbHMvc2VydmVyLXRvb2xzJztcclxuaW1wb3J0IHsgQnJvYWRjYXN0VG9vbHMgfSBmcm9tICcuL3Rvb2xzL2Jyb2FkY2FzdC10b29scyc7XHJcbmltcG9ydCB7IFNjZW5lQWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtYWR2YW5jZWQtdG9vbHMnO1xyXG5pbXBvcnQgeyBTY2VuZVZpZXdUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtdmlldy10b29scyc7XHJcbmltcG9ydCB7IFJlZmVyZW5jZUltYWdlVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3JlZmVyZW5jZS1pbWFnZS10b29scyc7XHJcbmltcG9ydCB7IEFzc2V0QWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvYXNzZXQtYWR2YW5jZWQtdG9vbHMnO1xyXG5pbXBvcnQgeyBWYWxpZGF0aW9uVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ZhbGlkYXRpb24tdG9vbHMnO1xyXG5pbXBvcnQgeyBFZGl0b3JSdW50aW1lVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2VkaXRvci1ydW50aW1lLXRvb2xzJztcclxuaW1wb3J0IHsgRW5naW5lRmVhdHVyZVRvb2xzIH0gZnJvbSAnLi90b29scy9lbmdpbmUtZmVhdHVyZS10b29scyc7XHJcbmltcG9ydCB7IERYVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2R4LXRvb2xzJztcclxuXHJcbi8qKlxyXG4gKiBUaGUgdG9vbCByZWdpc3RyeSB1c2VkIGJ5IGFsbCB0cmFuc3BvcnRzLiBXcmFwcyB0aGUgbGVnYWN5IHBlcuKAkWNhdGVnb3J5XHJcbiAqIHRvb2wgY2xhc3NlcyBhbmQgZXhwb3NlcyB0aGUgdW5pZmllZCB7QGxpbmsgVG9vbFJlZ2lzdHJ5fSBpbnRlcmZhY2UgdXNlZCBieVxyXG4gKiB7QGxpbmsgUHJvdG9jb2xIYW5kbGVyfS5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBDb2Nvc1Rvb2xSZWdpc3RyeSBpbXBsZW1lbnRzIFRvb2xSZWdpc3RyeSB7XHJcbiAgICBwcml2YXRlIHRvb2xzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XHJcbiAgICBwcml2YXRlIHRvb2xzTGlzdDogVG9vbERlZmluaXRpb25bXSA9IFtdO1xyXG4gICAgcHJpdmF0ZSBlbmFibGVkVG9vbHM6IHsgY2F0ZWdvcnk6IHN0cmluZzsgbmFtZTogc3RyaW5nIH1bXSA9IFtdO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgICAgIHRoaXMudG9vbHMuc2NlbmUgPSBuZXcgU2NlbmVUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMubm9kZSA9IG5ldyBOb2RlVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLmNvbXBvbmVudCA9IG5ldyBDb21wb25lbnRUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMucHJlZmFiID0gbmV3IFByZWZhYlRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5wcm9qZWN0ID0gbmV3IFByb2plY3RUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMuZGVidWcgPSBuZXcgRGVidWdUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMucHJlZmVyZW5jZXMgPSBuZXcgUHJlZmVyZW5jZXNUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMuc2VydmVyID0gbmV3IFNlcnZlclRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5icm9hZGNhc3QgPSBuZXcgQnJvYWRjYXN0VG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLnNjZW5lQWR2YW5jZWQgPSBuZXcgU2NlbmVBZHZhbmNlZFRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5zY2VuZVZpZXcgPSBuZXcgU2NlbmVWaWV3VG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLnJlZmVyZW5jZUltYWdlID0gbmV3IFJlZmVyZW5jZUltYWdlVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLmFzc2V0QWR2YW5jZWQgPSBuZXcgQXNzZXRBZHZhbmNlZFRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy52YWxpZGF0aW9uID0gbmV3IFZhbGlkYXRpb25Ub29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMuZWRpdG9yUnVudGltZSA9IG5ldyBFZGl0b3JSdW50aW1lVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLmVuZ2luZUZlYXR1cmUgPSBuZXcgRW5naW5lRmVhdHVyZVRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy5yZWJ1aWxkKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqIExhdGUgYmluZGluZyBmb3IgdGhlIERYIGNhdGVnb3J5LCB3aGljaCBuZWVkcyBhIGRpcmVjdG9yeSBwb2ludGVyIHRvIHRoZSBzZXJ2ZXIuICovXHJcbiAgICBwdWJsaWMgcmVnaXN0ZXJEeFRvb2xzKGR4OiBEWFRvb2xzKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy50b29scy5keCA9IGR4O1xyXG4gICAgICAgIHRoaXMucmVidWlsZCgpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyB1cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZDogeyBjYXRlZ29yeTogc3RyaW5nOyBuYW1lOiBzdHJpbmcgfVtdKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5lbmFibGVkVG9vbHMgPSBlbmFibGVkIHx8IFtdO1xyXG4gICAgICAgIHRoaXMucmVidWlsZCgpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBsaXN0VG9vbHMoKTogVG9vbERlZmluaXRpb25bXSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0O1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWQ6IHsgY2F0ZWdvcnk6IHN0cmluZzsgbmFtZTogc3RyaW5nIH1bXSk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIGlmICghZW5hYmxlZCB8fCBlbmFibGVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRoaXMudG9vbHNMaXN0O1xyXG4gICAgICAgIGNvbnN0IGFsbG93ZWQgPSBuZXcgU2V0KGVuYWJsZWQubWFwKCh0KSA9PiBgJHt0LmNhdGVnb3J5fV8ke3QubmFtZX1gKSk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0LmZpbHRlcigodCkgPT4gYWxsb3dlZC5oYXModC5uYW1lKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIGV4ZWN1dGVUb29sQ2FsbChuYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSwgY3R4OiBUb29sRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgY29uc3QgaWR4ID0gbmFtZS5pbmRleE9mKCdfJyk7XHJcbiAgICAgICAgaWYgKGlkeCA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0b29sIG5hbWU6ICR7bmFtZX1gKTtcclxuICAgICAgICBjb25zdCBjYXRlZ29yeSA9IG5hbWUuc2xpY2UoMCwgaWR4KTtcclxuICAgICAgICBjb25zdCB0b29sID0gbmFtZS5zbGljZShpZHggKyAxKTtcclxuICAgICAgICBpZiAoIXRoaXMudG9vbHNbY2F0ZWdvcnldKSB0aHJvdyBuZXcgRXJyb3IoYFRvb2wgY2F0ZWdvcnkgbm90IGZvdW5kOiAke2NhdGVnb3J5fWApO1xyXG5cclxuICAgICAgICAvLyBBODogc3VyZmFjZSBBYm9ydFNpZ25hbCB0byB0b29scyB0aGF0IHN1cHBvcnQgaXQuIExlZ2FjeSB0b29scyBpZ25vcmUgdGhlXHJcbiAgICAgICAgLy8gM3JkIGFyZ3VtZW50IGhhcm1sZXNzbHk7IG5ldyB0b29scyBjYW4gdGFrZSBhZHZhbnRhZ2UuIFdlIHN0aWxsIHBvbGwgdGhlXHJcbiAgICAgICAgLy8gc2lnbmFsIGhlcmUgc28gdGhhdCBldmVuIHN5bmNocm9ub3VzIHRvb2xzIHRlcm1pbmF0ZSBwcm9tcHRseS5cclxuICAgICAgICBpZiAoY3R4LnNpZ25hbC5hYm9ydGVkKSB0aHJvdyBuZXcgRXJyb3IoJ2NhbmNlbGxlZCcpO1xyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnRvb2xzW2NhdGVnb3J5XS5leGVjdXRlKHRvb2wsIGFyZ3MsIGN0eCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZWJ1aWxkKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMudG9vbHNMaXN0ID0gW107XHJcbiAgICAgICAgY29uc3QgZW5hYmxlZE5hbWVzID0gdGhpcy5lbmFibGVkVG9vbHMubGVuZ3RoXHJcbiAgICAgICAgICAgID8gbmV3IFNldCh0aGlzLmVuYWJsZWRUb29scy5tYXAoKHQpID0+IGAke3QuY2F0ZWdvcnl9XyR7dC5uYW1lfWApKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgZm9yIChjb25zdCBbY2F0ZWdvcnksIHRvb2xTZXRdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMudG9vbHMpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRlZnM6IFRvb2xEZWZpbml0aW9uW10gPSB0b29sU2V0LmdldFRvb2xzKCk7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgZGVmIG9mIGRlZnMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZxID0gYCR7Y2F0ZWdvcnl9XyR7ZGVmLm5hbWV9YDtcclxuICAgICAgICAgICAgICAgIGlmIChlbmFibGVkTmFtZXMgJiYgIWVuYWJsZWROYW1lcy5oYXMoZnEpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIHRoaXMudG9vbHNMaXN0LnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGZxLFxyXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBkZWYuZGVzY3JpcHRpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IGRlZi5pbnB1dFNjaGVtYSxcclxuICAgICAgICAgICAgICAgICAgICBvdXRwdXRTY2hlbWE6IGRlZi5vdXRwdXRTY2hlbWEsXHJcbiAgICAgICAgICAgICAgICAgICAgYW5ub3RhdGlvbnM6IGRlZi5hbm5vdGF0aW9uc1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBNQ1BTZXJ2ZXIge1xyXG4gICAgcHJpdmF0ZSBzZXR0aW5nczogTUNQU2VydmVyU2V0dGluZ3M7XHJcbiAgICBwcml2YXRlIHJlZ2lzdHJ5OiBDb2Nvc1Rvb2xSZWdpc3RyeTtcclxuICAgIHByaXZhdGUgdHJhbnNwb3J0OiBTdHJlYW1hYmxlSHR0cFNlcnZlcjtcclxuICAgIHByaXZhdGUgaGFuZGxlcnNCeVNlc3Npb24gPSBuZXcgTWFwPHN0cmluZywgUHJvdG9jb2xIYW5kbGVyPigpO1xyXG4gICAgcHJpdmF0ZSByZXNvdXJjZXM6IFJlc291cmNlUmVnaXN0cnk7XHJcbiAgICBwcml2YXRlIHByb21wdHM6IFByb21wdFJlZ2lzdHJ5O1xyXG4gICAgcHJpdmF0ZSBzdGFydGVkQXQgPSAwO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncykge1xyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBzZXR0aW5ncztcclxuICAgICAgICB0aGlzLnJlZ2lzdHJ5ID0gbmV3IENvY29zVG9vbFJlZ2lzdHJ5KCk7XHJcblxyXG4gICAgICAgIC8vIFBoYXNlIDIg4oCUIHJlZ2lzdHJpZXMgYnJvYWRjYXN0IGxpc3RfY2hhbmdlZCB2aWEgZXZlcnkgYWN0aXZlIHNlc3Npb25cclxuICAgICAgICAvLyBieSBwaXBpbmcgdGhlaXIgbm90aWZpY2F0aW9ucyB0aHJvdWdoIGBicm9hZGNhc3ROb3RpZmljYXRpb25gLlxyXG4gICAgICAgIHRoaXMucmVzb3VyY2VzID0gbmV3IFJlc291cmNlUmVnaXN0cnkoKG1ldGhvZCwgcGFyYW1zKSA9PiB0aGlzLmJyb2FkY2FzdE5vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcykpO1xyXG4gICAgICAgIHRoaXMucHJvbXB0cyA9IG5ldyBQcm9tcHRSZWdpc3RyeSgobWV0aG9kLCBwYXJhbXMpID0+IHRoaXMuYnJvYWRjYXN0Tm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKSk7XHJcbiAgICAgICAgdGhpcy5yZXNvdXJjZXMuYWRkUHJvdmlkZXIoYnVpbGRCdWlsdEluUmVzb3VyY2VQcm92aWRlcigpKTtcclxuICAgICAgICB0aGlzLnByb21wdHMuYWRkUHJvdmlkZXIoYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIoKSk7XHJcblxyXG4gICAgICAgIC8vIFBoYXNlIDYg4oCUIERYIHRvb2xzIG5lZWQgYSBwb2ludGVyIHRvIHRoZSBzZXJ2ZXIgaXRzZWxmLlxyXG4gICAgICAgIHRoaXMucmVnaXN0cnkucmVnaXN0ZXJEeFRvb2xzKG5ldyBEWFRvb2xzKHtcclxuICAgICAgICAgICAgbGlzdFRvb2xzOiAoKSA9PiB0aGlzLnJlZ2lzdHJ5Lmxpc3RUb29scygpLFxyXG4gICAgICAgICAgICBnZXRTZXJ2ZXJDYXBhYmlsaXRpZXM6ICgpID0+IHRoaXMuZ2V0QWR2ZXJ0aXNlZENhcGFiaWxpdGllcygpLFxyXG4gICAgICAgICAgICBnZXRTZXJ2ZXJJbmZvOiAoKSA9PiAoe1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2NvY29zLW1jcC1zZXJ2ZXInLFxyXG4gICAgICAgICAgICAgICAgdmVyc2lvbjogJzEuNC4wJyxcclxuICAgICAgICAgICAgICAgIHVwdGltZU1zOiB0aGlzLnN0YXJ0ZWRBdCA/IERhdGUubm93KCkgLSB0aGlzLnN0YXJ0ZWRBdCA6IDAsXHJcbiAgICAgICAgICAgICAgICBzZXNzaW9uczogdGhpcy50cmFuc3BvcnQgPyB0aGlzLnRyYW5zcG9ydC5nZXRTZXNzaW9uQ291bnQoKSA6IDAsXHJcbiAgICAgICAgICAgICAgICBwb3J0OiB0aGlzLnNldHRpbmdzLnBvcnRcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIHRoaXMudHJhbnNwb3J0ID0gbmV3IFN0cmVhbWFibGVIdHRwU2VydmVyKHtcclxuICAgICAgICAgICAgc2V0dGluZ3MsXHJcbiAgICAgICAgICAgIGNyZWF0ZUhhbmRsZXI6IChzZXNzaW9uSWQpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGggPSBuZXcgUHJvdG9jb2xIYW5kbGVyKHtcclxuICAgICAgICAgICAgICAgICAgICByZWdpc3RyeTogdGhpcy5yZWdpc3RyeSxcclxuICAgICAgICAgICAgICAgICAgICBwYWdlU2l6ZTogdGhpcy5zZXR0aW5ncy50b29sc1BhZ2VTaXplID8/IDEwMCxcclxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsTG9nTGV2ZWw6IHRoaXMuc2V0dGluZ3MubG9nTGV2ZWwgPz8gJ2luZm8nLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlc291cmNlczogdGhpcy5yZXNvdXJjZXMsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvbXB0czogdGhpcy5wcm9tcHRzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHRoaXMuaGFuZGxlcnNCeVNlc3Npb24uc2V0KHNlc3Npb25JZCwgaCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gaDtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25TZXNzaW9uVGVybWluYXRlZDogKHNlc3Npb25JZCkgPT4gdGhpcy5oYW5kbGVyc0J5U2Vzc2lvbi5kZWxldGUoc2Vzc2lvbklkKVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBhd2FpdCB0aGlzLnRyYW5zcG9ydC5zdGFydCgpO1xyXG4gICAgICAgIHRoaXMuc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01DUFNlcnZlcl0gU3RyZWFtYWJsZSBIVFRQIGxpc3RlbmluZyBvbiBodHRwOi8vMTI3LjAuMC4xOiR7dGhpcy5zZXR0aW5ncy5wb3J0fS9tY3BgKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgc3RvcCgpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLnRyYW5zcG9ydC5zdG9wKCk7XHJcbiAgICAgICAgdGhpcy5oYW5kbGVyc0J5U2Vzc2lvbi5jbGVhcigpO1xyXG4gICAgICAgIHRoaXMuc3RhcnRlZEF0ID0gMDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdXBkYXRlU2V0dGluZ3Moc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHNldHRpbmdzO1xyXG4gICAgICAgIHRoaXMudHJhbnNwb3J0LnVwZGF0ZVNldHRpbmdzKHNldHRpbmdzKTtcclxuICAgICAgICBmb3IgKGNvbnN0IGggb2YgdGhpcy5oYW5kbGVyc0J5U2Vzc2lvbi52YWx1ZXMoKSkge1xyXG4gICAgICAgICAgICBpZiAoc2V0dGluZ3MubG9nTGV2ZWwpIGguc2V0TG9nTGV2ZWwoc2V0dGluZ3MubG9nTGV2ZWwpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29sczogYW55W10pOiB2b2lkIHtcclxuICAgICAgICB0aGlzLnJlZ2lzdHJ5LnVwZGF0ZUVuYWJsZWRUb29scyhlbmFibGVkVG9vbHMpO1xyXG4gICAgICAgIC8vIFBoYXNlIDEgZm9sbG93LXVwOiBpbnZhbGlkYXRlIHZhbGlkYXRvcnMgKmFuZCogYnJvYWRjYXN0XHJcbiAgICAgICAgLy8gbm90aWZpY2F0aW9ucy90b29scy9saXN0X2NoYW5nZWQgc28gY29ubmVjdGVkIGNsaWVudHMgcmVmcmVzaC5cclxuICAgICAgICBmb3IgKGNvbnN0IGggb2YgdGhpcy5oYW5kbGVyc0J5U2Vzc2lvbi52YWx1ZXMoKSkge1xyXG4gICAgICAgICAgICBoLmNsZWFyVmFsaWRhdG9yQ2FjaGUoKTtcclxuICAgICAgICAgICAgaC5lbWl0VG9vbHNMaXN0Q2hhbmdlZCgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0UmVnaXN0cnkoKTogQ29jb3NUb29sUmVnaXN0cnkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5O1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRSZXNvdXJjZXMoKTogUmVzb3VyY2VSZWdpc3RyeSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMucmVzb3VyY2VzO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRQcm9tcHRzKCk6IFByb21wdFJlZ2lzdHJ5IHtcclxuICAgICAgICByZXR1cm4gdGhpcy5wcm9tcHRzO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRTdGF0dXMoKTogU2VydmVyU3RhdHVzIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBydW5uaW5nOiB0aGlzLnRyYW5zcG9ydC5nZXRSdW5uaW5nKCksXHJcbiAgICAgICAgICAgIHBvcnQ6IHRoaXMudHJhbnNwb3J0LmdldFBvcnQoKSxcclxuICAgICAgICAgICAgY2xpZW50czogdGhpcy50cmFuc3BvcnQuZ2V0U2Vzc2lvbkNvdW50KClcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRDbGllbnRzKCk6IE1DUENsaWVudFtdIHtcclxuICAgICAgICByZXR1cm4gdGhpcy50cmFuc3BvcnQuZ2V0Q2xpZW50cygpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRTZXR0aW5ncygpOiBNQ1BTZXJ2ZXJTZXR0aW5ncyB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0dGluZ3M7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldEF2YWlsYWJsZVRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5Lmxpc3RUb29scygpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWRUb29sczogYW55W10pOiBUb29sRGVmaW5pdGlvbltdIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5nZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWRUb29scyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqIEJyb2FkY2FzdCBhIHNlcnZlciBub3RpZmljYXRpb24gdG8gZXZlcnkgYWN0aXZlIHNlc3Npb24uICovXHJcbiAgICBwcml2YXRlIGJyb2FkY2FzdE5vdGlmaWNhdGlvbihtZXRob2Q6IHN0cmluZywgcGFyYW1zPzogYW55KTogdm9pZCB7XHJcbiAgICAgICAgZm9yIChjb25zdCBoIG9mIHRoaXMuaGFuZGxlcnNCeVNlc3Npb24udmFsdWVzKCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIC8vIFdlIGNoZWF0IGhlcmUgYSBsaXR0bGUgYnkgcmVhY2hpbmcgZm9yIHRoZSBwdWJsaWMgc2VuZENsaWVudFJlcXVlc3RcclxuICAgICAgICAgICAgICAgIC8vIHBhdGgncyBub3RpZmljYXRpb24gY291c2luIHZpYSB0aGUgcHVibGljIGVtaXQgaGVscGVyczsgZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBnZW5lcmljIG5vdGlmaWNhdGlvbnMgd2UgdXNlIHRoZSBzYW1lIHByaXZhdGUgbm90aWZ5IGNoYW5uZWxcclxuICAgICAgICAgICAgICAgIC8vIGJ5IGNhbGxpbmcgY2xlYXJWYWxpZGF0b3JDYWNoZSB3cmFwcGVycyB3b24ndCBmaXQsIHNvIHVzZVxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIHByb3RvY29sIGhhbmRsZXIncyBub3RpZmljYXRpb24gaGVscGVycyBhZGRlZCBiZWxvdy5cclxuICAgICAgICAgICAgICAgIGguZW1pdE5vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcyk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldEFkdmVydGlzZWRDYXBhYmlsaXRpZXMoKTogUmVjb3JkPHN0cmluZywgYW55PiB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgdG9vbHM6IHsgbGlzdENoYW5nZWQ6IHRydWUgfSxcclxuICAgICAgICAgICAgbG9nZ2luZzoge30sXHJcbiAgICAgICAgICAgIHJlc291cmNlczogeyBsaXN0Q2hhbmdlZDogdHJ1ZSwgc3Vic2NyaWJlOiB0cnVlIH0sXHJcbiAgICAgICAgICAgIHByb21wdHM6IHsgbGlzdENoYW5nZWQ6IHRydWUgfSxcclxuICAgICAgICAgICAgc2FtcGxpbmc6IHt9LFxyXG4gICAgICAgICAgICBjb21wbGV0aW9uczoge31cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcbiJdfQ==