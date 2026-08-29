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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tY3Atc2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRzs7O0FBR0gsa0VBQWtHO0FBQ2xHLGlFQUFtRTtBQUNuRSxzREFLK0I7QUFDL0IscURBQWlEO0FBQ2pELG1EQUErQztBQUMvQyw2REFBeUQ7QUFDekQsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCxxREFBaUQ7QUFDakQsaUVBQTZEO0FBQzdELHVEQUFtRDtBQUNuRCw2REFBeUQ7QUFDekQsdUVBQWtFO0FBQ2xFLCtEQUEwRDtBQUMxRCx5RUFBb0U7QUFDcEUsdUVBQWtFO0FBQ2xFLCtEQUEyRDtBQUMzRCx1RUFBa0U7QUFDbEUsdUVBQWtFO0FBQ2xFLCtDQUEyQztBQUUzQzs7OztHQUlHO0FBQ0gsTUFBYSxpQkFBaUI7SUFLMUI7UUFKUSxVQUFLLEdBQXdCLEVBQUUsQ0FBQztRQUNoQyxjQUFTLEdBQXFCLEVBQUUsQ0FBQztRQUNqQyxpQkFBWSxHQUF5QyxFQUFFLENBQUM7UUFHNUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7UUFDbEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxFQUFFLENBQUM7UUFDNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7UUFDdEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEdBQUcsSUFBSSw0QkFBWSxFQUFFLENBQUM7UUFDeEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEdBQUcs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RSxXQUFXLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUU7WUFDakQsT0FBTyxFQUFFLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRTtZQUM5QixRQUFRLEVBQUUsRUFBRTtZQUNaLFdBQVcsRUFBRSxFQUFFO1NBQ2xCLENBQUM7SUFDTixDQUFDO0NBQ0o7QUE1SUQsOEJBNElDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENvY29zIENyZWF0b3IgTUNQIHNlcnZlciBvcmNoZXN0cmF0b3IuXHJcbiAqXHJcbiAqIE93bnMgdGhlIHRvb2wgcmVnaXN0cnkgYW5kIHRoZSBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0LiBUaGUgYWN0dWFsXHJcbiAqIEpTT07igJFSUEMgLyBNQ1AgcHJvdG9jb2wgaXMgaW1wbGVtZW50ZWQgYnkge0BsaW5rIFByb3RvY29sSGFuZGxlcn0gc28gaXRcclxuICogY2FuIGJlIHJldXNlZCBieSBzdGRpbyAoYW5kIGZ1dHVyZSBXZWJTb2NrZXQpIHRyYW5zcG9ydHMuXHJcbiAqXHJcbiAqIFBoYXNlIDEgY2FwYWJpbGl0aWVzOlxyXG4gKiAgLSBBMSBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0IChHRVQvUE9TVC9ERUxFVEUgL21jcCwgTWNwLVNlc3Npb24tSWQsIFNTRSlcclxuICogIC0gQTQgT3JpZ2luIGFsbG934oCRbGlzdCArIEROUyByZWJpbmRpbmcgZ3VhcmRcclxuICogIC0gQTUgKioqKioqIGF1dGhcclxuICogIC0gQTYgbG9nZ2luZy9zZXRMZXZlbCArIG5vdGlmaWNhdGlvbnMvbWVzc2FnZVxyXG4gKiAgLSBBNyBub3RpZmljYXRpb25zL3Byb2dyZXNzXHJcbiAqICAtIEE4IEFib3J0U2lnbmFsIGNhbmNlbGxhdGlvblxyXG4gKiAgLSBHMSBUb29sIGFubm90YXRpb25zIG9uIHRvb2xzL2xpc3RcclxuICogIC0gRzMgb3V0cHV0U2NoZW1hIG9uIHRvb2xzL2xpc3QgKyBzdHJ1Y3R1cmVkQ29udGVudCBvbiB0b29scy9jYWxsXHJcbiAqICAtIEc0IFBhZ2luYXRpb24gY3Vyc29yIG9uIHRvb2xzL2xpc3RcclxuICogIC0gRzggQWp2IGlucHV0IHZhbGlkYXRpb24g4oaSIC0zMjYwMlxyXG4gKiAgLSBHOSBwcm90b2NvbFZlcnNpb24gaGFuZHNoYWtlIHdpdGggZmVhdHVyZSBmbGFnc1xyXG4gKi9cclxuXHJcbmltcG9ydCB7IE1DUFNlcnZlclNldHRpbmdzLCBNQ1BDbGllbnQsIFNlcnZlclN0YXR1cywgVG9vbERlZmluaXRpb24gfSBmcm9tICcuL3R5cGVzJztcclxuaW1wb3J0IHsgUHJvdG9jb2xIYW5kbGVyLCBUb29sRXhlY3V0aW9uQ29udGV4dCwgVG9vbFJlZ2lzdHJ5IH0gZnJvbSAnLi9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyJztcclxuaW1wb3J0IHsgU3RyZWFtYWJsZUh0dHBTZXJ2ZXIgfSBmcm9tICcuL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAnO1xyXG5pbXBvcnQge1xyXG4gICAgUHJvbXB0UmVnaXN0cnksXHJcbiAgICBSZXNvdXJjZVJlZ2lzdHJ5LFxyXG4gICAgYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIsXHJcbiAgICBidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyXHJcbn0gZnJvbSAnLi9wcm90b2NvbC9yZWdpc3RyaWVzJztcclxuaW1wb3J0IHsgU2NlbmVUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtdG9vbHMnO1xyXG5pbXBvcnQgeyBOb2RlVG9vbHMgfSBmcm9tICcuL3Rvb2xzL25vZGUtdG9vbHMnO1xyXG5pbXBvcnQgeyBDb21wb25lbnRUb29scyB9IGZyb20gJy4vdG9vbHMvY29tcG9uZW50LXRvb2xzJztcclxuaW1wb3J0IHsgUHJlZmFiVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ByZWZhYi10b29scyc7XHJcbmltcG9ydCB7IFByb2plY3RUb29scyB9IGZyb20gJy4vdG9vbHMvcHJvamVjdC10b29scyc7XHJcbmltcG9ydCB7IERlYnVnVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2RlYnVnLXRvb2xzJztcclxuaW1wb3J0IHsgUHJlZmVyZW5jZXNUb29scyB9IGZyb20gJy4vdG9vbHMvcHJlZmVyZW5jZXMtdG9vbHMnO1xyXG5pbXBvcnQgeyBTZXJ2ZXJUb29scyB9IGZyb20gJy4vdG9vbHMvc2VydmVyLXRvb2xzJztcclxuaW1wb3J0IHsgQnJvYWRjYXN0VG9vbHMgfSBmcm9tICcuL3Rvb2xzL2Jyb2FkY2FzdC10b29scyc7XHJcbmltcG9ydCB7IFNjZW5lQWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtYWR2YW5jZWQtdG9vbHMnO1xyXG5pbXBvcnQgeyBTY2VuZVZpZXdUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtdmlldy10b29scyc7XHJcbmltcG9ydCB7IFJlZmVyZW5jZUltYWdlVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3JlZmVyZW5jZS1pbWFnZS10b29scyc7XHJcbmltcG9ydCB7IEFzc2V0QWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvYXNzZXQtYWR2YW5jZWQtdG9vbHMnO1xyXG5pbXBvcnQgeyBWYWxpZGF0aW9uVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ZhbGlkYXRpb24tdG9vbHMnO1xyXG5pbXBvcnQgeyBFZGl0b3JSdW50aW1lVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2VkaXRvci1ydW50aW1lLXRvb2xzJztcbmltcG9ydCB7IEVuZ2luZUZlYXR1cmVUb29scyB9IGZyb20gJy4vdG9vbHMvZW5naW5lLWZlYXR1cmUtdG9vbHMnO1xuaW1wb3J0IHsgRFhUb29scyB9IGZyb20gJy4vdG9vbHMvZHgtdG9vbHMnO1xyXG5cclxuLyoqXHJcbiAqIFRoZSB0b29sIHJlZ2lzdHJ5IHVzZWQgYnkgYWxsIHRyYW5zcG9ydHMuIFdyYXBzIHRoZSBsZWdhY3kgcGVy4oCRY2F0ZWdvcnlcclxuICogdG9vbCBjbGFzc2VzIGFuZCBleHBvc2VzIHRoZSB1bmlmaWVkIHtAbGluayBUb29sUmVnaXN0cnl9IGludGVyZmFjZSB1c2VkIGJ5XHJcbiAqIHtAbGluayBQcm90b2NvbEhhbmRsZXJ9LlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIENvY29zVG9vbFJlZ2lzdHJ5IGltcGxlbWVudHMgVG9vbFJlZ2lzdHJ5IHtcclxuICAgIHByaXZhdGUgdG9vbHM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcclxuICAgIHByaXZhdGUgdG9vbHNMaXN0OiBUb29sRGVmaW5pdGlvbltdID0gW107XHJcbiAgICBwcml2YXRlIGVuYWJsZWRUb29sczogeyBjYXRlZ29yeTogc3RyaW5nOyBuYW1lOiBzdHJpbmcgfVtdID0gW107XHJcblxyXG4gICAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAgICAgdGhpcy50b29scy5zY2VuZSA9IG5ldyBTY2VuZVRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5ub2RlID0gbmV3IE5vZGVUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMuY29tcG9uZW50ID0gbmV3IENvbXBvbmVudFRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5wcmVmYWIgPSBuZXcgUHJlZmFiVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLnByb2plY3QgPSBuZXcgUHJvamVjdFRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5kZWJ1ZyA9IG5ldyBEZWJ1Z1Rvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5wcmVmZXJlbmNlcyA9IG5ldyBQcmVmZXJlbmNlc1Rvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5zZXJ2ZXIgPSBuZXcgU2VydmVyVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLmJyb2FkY2FzdCA9IG5ldyBCcm9hZGNhc3RUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMuc2NlbmVBZHZhbmNlZCA9IG5ldyBTY2VuZUFkdmFuY2VkVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLnNjZW5lVmlldyA9IG5ldyBTY2VuZVZpZXdUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMucmVmZXJlbmNlSW1hZ2UgPSBuZXcgUmVmZXJlbmNlSW1hZ2VUb29scygpO1xyXG4gICAgICAgIHRoaXMudG9vbHMuYXNzZXRBZHZhbmNlZCA9IG5ldyBBc3NldEFkdmFuY2VkVG9vbHMoKTtcclxuICAgICAgICB0aGlzLnRvb2xzLnZhbGlkYXRpb24gPSBuZXcgVmFsaWRhdGlvblRvb2xzKCk7XHJcbiAgICAgICAgdGhpcy50b29scy5lZGl0b3JSdW50aW1lID0gbmV3IEVkaXRvclJ1bnRpbWVUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLmVuZ2luZUZlYXR1cmUgPSBuZXcgRW5naW5lRmVhdHVyZVRvb2xzKCk7XG4gICAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH1cclxuXHJcbiAgICAvKiogTGF0ZSBiaW5kaW5nIGZvciB0aGUgRFggY2F0ZWdvcnksIHdoaWNoIG5lZWRzIGEgZGlyZWN0b3J5IHBvaW50ZXIgdG8gdGhlIHNlcnZlci4gKi9cclxuICAgIHB1YmxpYyByZWdpc3RlckR4VG9vbHMoZHg6IERYVG9vbHMpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLnRvb2xzLmR4ID0gZHg7XHJcbiAgICAgICAgdGhpcy5yZWJ1aWxkKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHVwZGF0ZUVuYWJsZWRUb29scyhlbmFibGVkOiB7IGNhdGVnb3J5OiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9W10pOiB2b2lkIHtcclxuICAgICAgICB0aGlzLmVuYWJsZWRUb29scyA9IGVuYWJsZWQgfHwgW107XHJcbiAgICAgICAgdGhpcy5yZWJ1aWxkKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGxpc3RUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcclxuICAgICAgICByZXR1cm4gdGhpcy50b29sc0xpc3Q7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldEZpbHRlcmVkVG9vbHMoZW5hYmxlZDogeyBjYXRlZ29yeTogc3RyaW5nOyBuYW1lOiBzdHJpbmcgfVtdKTogVG9vbERlZmluaXRpb25bXSB7XHJcbiAgICAgICAgaWYgKCFlbmFibGVkIHx8IGVuYWJsZWQubGVuZ3RoID09PSAwKSByZXR1cm4gdGhpcy50b29sc0xpc3Q7XHJcbiAgICAgICAgY29uc3QgYWxsb3dlZCA9IG5ldyBTZXQoZW5hYmxlZC5tYXAoKHQpID0+IGAke3QuY2F0ZWdvcnl9XyR7dC5uYW1lfWApKTtcclxuICAgICAgICByZXR1cm4gdGhpcy50b29sc0xpc3QuZmlsdGVyKCh0KSA9PiBhbGxvd2VkLmhhcyh0Lm5hbWUpKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgYXN5bmMgZXhlY3V0ZVRvb2xDYWxsKG5hbWU6IHN0cmluZywgYXJnczogYW55LCBjdHg6IFRvb2xFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBjb25zdCBpZHggPSBuYW1lLmluZGV4T2YoJ18nKTtcclxuICAgICAgICBpZiAoaWR4IDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHRvb2wgbmFtZTogJHtuYW1lfWApO1xyXG4gICAgICAgIGNvbnN0IGNhdGVnb3J5ID0gbmFtZS5zbGljZSgwLCBpZHgpO1xyXG4gICAgICAgIGNvbnN0IHRvb2wgPSBuYW1lLnNsaWNlKGlkeCArIDEpO1xyXG4gICAgICAgIGlmICghdGhpcy50b29sc1tjYXRlZ29yeV0pIHRocm93IG5ldyBFcnJvcihgVG9vbCBjYXRlZ29yeSBub3QgZm91bmQ6ICR7Y2F0ZWdvcnl9YCk7XHJcblxyXG4gICAgICAgIC8vIEE4OiBzdXJmYWNlIEFib3J0U2lnbmFsIHRvIHRvb2xzIHRoYXQgc3VwcG9ydCBpdC4gTGVnYWN5IHRvb2xzIGlnbm9yZSB0aGVcclxuICAgICAgICAvLyAzcmQgYXJndW1lbnQgaGFybWxlc3NseTsgbmV3IHRvb2xzIGNhbiB0YWtlIGFkdmFudGFnZS4gV2Ugc3RpbGwgcG9sbCB0aGVcclxuICAgICAgICAvLyBzaWduYWwgaGVyZSBzbyB0aGF0IGV2ZW4gc3luY2hyb25vdXMgdG9vbHMgdGVybWluYXRlIHByb21wdGx5LlxyXG4gICAgICAgIGlmIChjdHguc2lnbmFsLmFib3J0ZWQpIHRocm93IG5ldyBFcnJvcignY2FuY2VsbGVkJyk7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudG9vbHNbY2F0ZWdvcnldLmV4ZWN1dGUodG9vbCwgYXJncywgY3R4KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlYnVpbGQoKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy50b29sc0xpc3QgPSBbXTtcclxuICAgICAgICBjb25zdCBlbmFibGVkTmFtZXMgPSB0aGlzLmVuYWJsZWRUb29scy5sZW5ndGhcclxuICAgICAgICAgICAgPyBuZXcgU2V0KHRoaXMuZW5hYmxlZFRvb2xzLm1hcCgodCkgPT4gYCR7dC5jYXRlZ29yeX1fJHt0Lm5hbWV9YCkpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICBmb3IgKGNvbnN0IFtjYXRlZ29yeSwgdG9vbFNldF0gb2YgT2JqZWN0LmVudHJpZXModGhpcy50b29scykpIHtcclxuICAgICAgICAgICAgY29uc3QgZGVmczogVG9vbERlZmluaXRpb25bXSA9IHRvb2xTZXQuZ2V0VG9vbHMoKTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBkZWYgb2YgZGVmcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZnEgPSBgJHtjYXRlZ29yeX1fJHtkZWYubmFtZX1gO1xyXG4gICAgICAgICAgICAgICAgaWYgKGVuYWJsZWROYW1lcyAmJiAhZW5hYmxlZE5hbWVzLmhhcyhmcSkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy50b29sc0xpc3QucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogZnEsXHJcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGRlZi5kZXNjcmlwdGlvbixcclxuICAgICAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogZGVmLmlucHV0U2NoZW1hLFxyXG4gICAgICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYTogZGVmLm91dHB1dFNjaGVtYSxcclxuICAgICAgICAgICAgICAgICAgICBhbm5vdGF0aW9uczogZGVmLmFubm90YXRpb25zXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIE1DUFNlcnZlciB7XHJcbiAgICBwcml2YXRlIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcclxuICAgIHByaXZhdGUgcmVnaXN0cnk6IENvY29zVG9vbFJlZ2lzdHJ5O1xyXG4gICAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFN0cmVhbWFibGVIdHRwU2VydmVyO1xyXG4gICAgcHJpdmF0ZSBoYW5kbGVyc0J5U2Vzc2lvbiA9IG5ldyBNYXA8c3RyaW5nLCBQcm90b2NvbEhhbmRsZXI+KCk7XHJcbiAgICBwcml2YXRlIHJlc291cmNlczogUmVzb3VyY2VSZWdpc3RyeTtcclxuICAgIHByaXZhdGUgcHJvbXB0czogUHJvbXB0UmVnaXN0cnk7XHJcbiAgICBwcml2YXRlIHN0YXJ0ZWRBdCA9IDA7XHJcblxyXG4gICAgY29uc3RydWN0b3Ioc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzKSB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHNldHRpbmdzO1xyXG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSBuZXcgQ29jb3NUb29sUmVnaXN0cnkoKTtcclxuXHJcbiAgICAgICAgLy8gUGhhc2UgMiDigJQgcmVnaXN0cmllcyBicm9hZGNhc3QgbGlzdF9jaGFuZ2VkIHZpYSBldmVyeSBhY3RpdmUgc2Vzc2lvblxyXG4gICAgICAgIC8vIGJ5IHBpcGluZyB0aGVpciBub3RpZmljYXRpb25zIHRocm91Z2ggYGJyb2FkY2FzdE5vdGlmaWNhdGlvbmAuXHJcbiAgICAgICAgdGhpcy5yZXNvdXJjZXMgPSBuZXcgUmVzb3VyY2VSZWdpc3RyeSgobWV0aG9kLCBwYXJhbXMpID0+IHRoaXMuYnJvYWRjYXN0Tm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKSk7XHJcbiAgICAgICAgdGhpcy5wcm9tcHRzID0gbmV3IFByb21wdFJlZ2lzdHJ5KChtZXRob2QsIHBhcmFtcykgPT4gdGhpcy5icm9hZGNhc3ROb3RpZmljYXRpb24obWV0aG9kLCBwYXJhbXMpKTtcclxuICAgICAgICB0aGlzLnJlc291cmNlcy5hZGRQcm92aWRlcihidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyKCkpO1xyXG4gICAgICAgIHRoaXMucHJvbXB0cy5hZGRQcm92aWRlcihidWlsZEJ1aWx0SW5Qcm9tcHRQcm92aWRlcigpKTtcclxuXHJcbiAgICAgICAgLy8gUGhhc2UgNiDigJQgRFggdG9vbHMgbmVlZCBhIHBvaW50ZXIgdG8gdGhlIHNlcnZlciBpdHNlbGYuXHJcbiAgICAgICAgdGhpcy5yZWdpc3RyeS5yZWdpc3RlckR4VG9vbHMobmV3IERYVG9vbHMoe1xyXG4gICAgICAgICAgICBsaXN0VG9vbHM6ICgpID0+IHRoaXMucmVnaXN0cnkubGlzdFRvb2xzKCksXHJcbiAgICAgICAgICAgIGdldFNlcnZlckNhcGFiaWxpdGllczogKCkgPT4gdGhpcy5nZXRBZHZlcnRpc2VkQ2FwYWJpbGl0aWVzKCksXHJcbiAgICAgICAgICAgIGdldFNlcnZlckluZm86ICgpID0+ICh7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnY29jb3MtbWNwLXNlcnZlcicsXHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiAnMS40LjAnLFxyXG4gICAgICAgICAgICAgICAgdXB0aW1lTXM6IHRoaXMuc3RhcnRlZEF0ID8gRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRlZEF0IDogMCxcclxuICAgICAgICAgICAgICAgIHNlc3Npb25zOiB0aGlzLnRyYW5zcG9ydCA/IHRoaXMudHJhbnNwb3J0LmdldFNlc3Npb25Db3VudCgpIDogMCxcclxuICAgICAgICAgICAgICAgIHBvcnQ6IHRoaXMuc2V0dGluZ3MucG9ydFxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgdGhpcy50cmFuc3BvcnQgPSBuZXcgU3RyZWFtYWJsZUh0dHBTZXJ2ZXIoe1xyXG4gICAgICAgICAgICBzZXR0aW5ncyxcclxuICAgICAgICAgICAgY3JlYXRlSGFuZGxlcjogKHNlc3Npb25JZCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaCA9IG5ldyBQcm90b2NvbEhhbmRsZXIoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdHJ5OiB0aGlzLnJlZ2lzdHJ5LFxyXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VTaXplOiB0aGlzLnNldHRpbmdzLnRvb2xzUGFnZVNpemUgPz8gMTAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxMb2dMZXZlbDogdGhpcy5zZXR0aW5ncy5sb2dMZXZlbCA/PyAnaW5mbycsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiB0aGlzLnJlc291cmNlcyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9tcHRzOiB0aGlzLnByb21wdHNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVyc0J5U2Vzc2lvbi5zZXQoc2Vzc2lvbklkLCBoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBoO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBvblNlc3Npb25UZXJtaW5hdGVkOiAoc2Vzc2lvbklkKSA9PiB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLmRlbGV0ZShzZXNzaW9uSWQpXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGF3YWl0IHRoaXMudHJhbnNwb3J0LnN0YXJ0KCk7XHJcbiAgICAgICAgdGhpcy5zdGFydGVkQXQgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBTdHJlYW1hYmxlIEhUVFAgbGlzdGVuaW5nIG9uIGh0dHA6Ly8xMjcuMC4wLjE6JHt0aGlzLnNldHRpbmdzLnBvcnR9L21jcGApO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzdG9wKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMudHJhbnNwb3J0LnN0b3AoKTtcclxuICAgICAgICB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLmNsZWFyKCk7XHJcbiAgICAgICAgdGhpcy5zdGFydGVkQXQgPSAwO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyB1cGRhdGVTZXR0aW5ncyhzZXR0aW5nczogTUNQU2VydmVyU2V0dGluZ3MpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XHJcbiAgICAgICAgdGhpcy50cmFuc3BvcnQudXBkYXRlU2V0dGluZ3Moc2V0dGluZ3MpO1xyXG4gICAgICAgIGZvciAoY29uc3QgaCBvZiB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnZhbHVlcygpKSB7XHJcbiAgICAgICAgICAgIGlmIChzZXR0aW5ncy5sb2dMZXZlbCkgaC5zZXRMb2dMZXZlbChzZXR0aW5ncy5sb2dMZXZlbCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyB1cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZFRvb2xzOiBhbnlbXSk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMucmVnaXN0cnkudXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29scyk7XHJcbiAgICAgICAgLy8gUGhhc2UgMSBmb2xsb3ctdXA6IGludmFsaWRhdGUgdmFsaWRhdG9ycyAqYW5kKiBicm9hZGNhc3RcclxuICAgICAgICAvLyBub3RpZmljYXRpb25zL3Rvb2xzL2xpc3RfY2hhbmdlZCBzbyBjb25uZWN0ZWQgY2xpZW50cyByZWZyZXNoLlxyXG4gICAgICAgIGZvciAoY29uc3QgaCBvZiB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnZhbHVlcygpKSB7XHJcbiAgICAgICAgICAgIGguY2xlYXJWYWxpZGF0b3JDYWNoZSgpO1xyXG4gICAgICAgICAgICBoLmVtaXRUb29sc0xpc3RDaGFuZ2VkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRSZWdpc3RyeSgpOiBDb2Nvc1Rvb2xSZWdpc3RyeSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMucmVnaXN0cnk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldFJlc291cmNlcygpOiBSZXNvdXJjZVJlZ2lzdHJ5IHtcclxuICAgICAgICByZXR1cm4gdGhpcy5yZXNvdXJjZXM7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldFByb21wdHMoKTogUHJvbXB0UmVnaXN0cnkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnByb21wdHM7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldFN0YXR1cygpOiBTZXJ2ZXJTdGF0dXMge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmc6IHRoaXMudHJhbnNwb3J0LmdldFJ1bm5pbmcoKSxcclxuICAgICAgICAgICAgcG9ydDogdGhpcy50cmFuc3BvcnQuZ2V0UG9ydCgpLFxyXG4gICAgICAgICAgICBjbGllbnRzOiB0aGlzLnRyYW5zcG9ydC5nZXRTZXNzaW9uQ291bnQoKVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldENsaWVudHMoKTogTUNQQ2xpZW50W10ge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnRyYW5zcG9ydC5nZXRDbGllbnRzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldFNldHRpbmdzKCk6IE1DUFNlcnZlclNldHRpbmdzIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5zZXR0aW5ncztcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0QXZhaWxhYmxlVG9vbHMoKTogVG9vbERlZmluaXRpb25bXSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMucmVnaXN0cnkubGlzdFRvb2xzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldEZpbHRlcmVkVG9vbHMoZW5hYmxlZFRvb2xzOiBhbnlbXSk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5LmdldEZpbHRlcmVkVG9vbHMoZW5hYmxlZFRvb2xzKTtcclxuICAgIH1cclxuXHJcbiAgICAvKiogQnJvYWRjYXN0IGEgc2VydmVyIG5vdGlmaWNhdGlvbiB0byBldmVyeSBhY3RpdmUgc2Vzc2lvbi4gKi9cclxuICAgIHByaXZhdGUgYnJvYWRjYXN0Tm90aWZpY2F0aW9uKG1ldGhvZDogc3RyaW5nLCBwYXJhbXM/OiBhbnkpOiB2b2lkIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGggb2YgdGhpcy5oYW5kbGVyc0J5U2Vzc2lvbi52YWx1ZXMoKSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgLy8gV2UgY2hlYXQgaGVyZSBhIGxpdHRsZSBieSByZWFjaGluZyBmb3IgdGhlIHB1YmxpYyBzZW5kQ2xpZW50UmVxdWVzdFxyXG4gICAgICAgICAgICAgICAgLy8gcGF0aCdzIG5vdGlmaWNhdGlvbiBjb3VzaW4gdmlhIHRoZSBwdWJsaWMgZW1pdCBoZWxwZXJzOyBmb3JcclxuICAgICAgICAgICAgICAgIC8vIGdlbmVyaWMgbm90aWZpY2F0aW9ucyB3ZSB1c2UgdGhlIHNhbWUgcHJpdmF0ZSBub3RpZnkgY2hhbm5lbFxyXG4gICAgICAgICAgICAgICAgLy8gYnkgY2FsbGluZyBjbGVhclZhbGlkYXRvckNhY2hlIHdyYXBwZXJzIHdvbid0IGZpdCwgc28gdXNlXHJcbiAgICAgICAgICAgICAgICAvLyB0aGUgcHJvdG9jb2wgaGFuZGxlcidzIG5vdGlmaWNhdGlvbiBoZWxwZXJzIGFkZGVkIGJlbG93LlxyXG4gICAgICAgICAgICAgICAgaC5lbWl0Tm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKTtcclxuICAgICAgICAgICAgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZ2V0QWR2ZXJ0aXNlZENhcGFiaWxpdGllcygpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICB0b29sczogeyBsaXN0Q2hhbmdlZDogdHJ1ZSB9LFxyXG4gICAgICAgICAgICBsb2dnaW5nOiB7fSxcclxuICAgICAgICAgICAgcmVzb3VyY2VzOiB7IGxpc3RDaGFuZ2VkOiB0cnVlLCBzdWJzY3JpYmU6IHRydWUgfSxcclxuICAgICAgICAgICAgcHJvbXB0czogeyBsaXN0Q2hhbmdlZDogdHJ1ZSB9LFxyXG4gICAgICAgICAgICBzYW1wbGluZzoge30sXHJcbiAgICAgICAgICAgIGNvbXBsZXRpb25zOiB7fVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuIl19