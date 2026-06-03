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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tY3Atc2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRzs7O0FBR0gsa0VBQWtHO0FBQ2xHLGlFQUFtRTtBQUNuRSxzREFLK0I7QUFDL0IscURBQWlEO0FBQ2pELG1EQUErQztBQUMvQyw2REFBeUQ7QUFDekQsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCxxREFBaUQ7QUFDakQsaUVBQTZEO0FBQzdELHVEQUFtRDtBQUNuRCw2REFBeUQ7QUFDekQsdUVBQWtFO0FBQ2xFLCtEQUEwRDtBQUMxRCx5RUFBb0U7QUFDcEUsdUVBQWtFO0FBQ2xFLCtEQUEyRDtBQUMzRCx1RUFBa0U7QUFDbEUsK0NBQTJDO0FBRTNDOzs7O0dBSUc7QUFDSCxNQUFhLGlCQUFpQjtJQUsxQjtRQUpRLFVBQUssR0FBd0IsRUFBRSxDQUFDO1FBQ2hDLGNBQVMsR0FBcUIsRUFBRSxDQUFDO1FBQ2pDLGlCQUFZLEdBQXlDLEVBQUUsQ0FBQztRQUc1RCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxJQUFJLHdCQUFVLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztRQUNsQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJLGdDQUFjLEVBQUUsQ0FBQztRQUM1QyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxJQUFJLDBCQUFXLEVBQUUsQ0FBQztRQUN0QyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sR0FBRyxJQUFJLDRCQUFZLEVBQUUsQ0FBQztRQUN4QyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxJQUFJLHdCQUFVLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJLG9DQUFnQixF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RSxJQUFJLEVBQUU7WUFDOUIsUUFBUSxFQUFFLEVBQUU7WUFDWixXQUFXLEVBQUUsRUFBRTtTQUNsQixDQUFDO0lBQ04sQ0FBQztDQUNKO0FBNUlELDhCQTRJQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ29jb3MgQ3JlYXRvciBNQ1Agc2VydmVyIG9yY2hlc3RyYXRvci5cbiAqXG4gKiBPd25zIHRoZSB0b29sIHJlZ2lzdHJ5IGFuZCB0aGUgU3RyZWFtYWJsZSBIVFRQIHRyYW5zcG9ydC4gVGhlIGFjdHVhbFxuICogSlNPTuKAkVJQQyAvIE1DUCBwcm90b2NvbCBpcyBpbXBsZW1lbnRlZCBieSB7QGxpbmsgUHJvdG9jb2xIYW5kbGVyfSBzbyBpdFxuICogY2FuIGJlIHJldXNlZCBieSBzdGRpbyAoYW5kIGZ1dHVyZSBXZWJTb2NrZXQpIHRyYW5zcG9ydHMuXG4gKlxuICogUGhhc2UgMSBjYXBhYmlsaXRpZXM6XG4gKiAgLSBBMSBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0IChHRVQvUE9TVC9ERUxFVEUgL21jcCwgTWNwLVNlc3Npb24tSWQsIFNTRSlcbiAqICAtIEE0IE9yaWdpbiBhbGxvd+KAkWxpc3QgKyBETlMgcmViaW5kaW5nIGd1YXJkXG4gKiAgLSBBNSAqKioqKiogYXV0aFxuICogIC0gQTYgbG9nZ2luZy9zZXRMZXZlbCArIG5vdGlmaWNhdGlvbnMvbWVzc2FnZVxuICogIC0gQTcgbm90aWZpY2F0aW9ucy9wcm9ncmVzc1xuICogIC0gQTggQWJvcnRTaWduYWwgY2FuY2VsbGF0aW9uXG4gKiAgLSBHMSBUb29sIGFubm90YXRpb25zIG9uIHRvb2xzL2xpc3RcbiAqICAtIEczIG91dHB1dFNjaGVtYSBvbiB0b29scy9saXN0ICsgc3RydWN0dXJlZENvbnRlbnQgb24gdG9vbHMvY2FsbFxuICogIC0gRzQgUGFnaW5hdGlvbiBjdXJzb3Igb24gdG9vbHMvbGlzdFxuICogIC0gRzggQWp2IGlucHV0IHZhbGlkYXRpb24g4oaSIC0zMjYwMlxuICogIC0gRzkgcHJvdG9jb2xWZXJzaW9uIGhhbmRzaGFrZSB3aXRoIGZlYXR1cmUgZmxhZ3NcbiAqL1xuXG5pbXBvcnQgeyBNQ1BTZXJ2ZXJTZXR0aW5ncywgTUNQQ2xpZW50LCBTZXJ2ZXJTdGF0dXMsIFRvb2xEZWZpbml0aW9uIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBQcm90b2NvbEhhbmRsZXIsIFRvb2xFeGVjdXRpb25Db250ZXh0LCBUb29sUmVnaXN0cnkgfSBmcm9tICcuL3Byb3RvY29sL3Byb3RvY29sLWhhbmRsZXInO1xuaW1wb3J0IHsgU3RyZWFtYWJsZUh0dHBTZXJ2ZXIgfSBmcm9tICcuL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAnO1xuaW1wb3J0IHtcbiAgICBQcm9tcHRSZWdpc3RyeSxcbiAgICBSZXNvdXJjZVJlZ2lzdHJ5LFxuICAgIGJ1aWxkQnVpbHRJblByb21wdFByb3ZpZGVyLFxuICAgIGJ1aWxkQnVpbHRJblJlc291cmNlUHJvdmlkZXJcbn0gZnJvbSAnLi9wcm90b2NvbC9yZWdpc3RyaWVzJztcbmltcG9ydCB7IFNjZW5lVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLXRvb2xzJztcbmltcG9ydCB7IE5vZGVUb29scyB9IGZyb20gJy4vdG9vbHMvbm9kZS10b29scyc7XG5pbXBvcnQgeyBDb21wb25lbnRUb29scyB9IGZyb20gJy4vdG9vbHMvY29tcG9uZW50LXRvb2xzJztcbmltcG9ydCB7IFByZWZhYlRvb2xzIH0gZnJvbSAnLi90b29scy9wcmVmYWItdG9vbHMnO1xuaW1wb3J0IHsgUHJvamVjdFRvb2xzIH0gZnJvbSAnLi90b29scy9wcm9qZWN0LXRvb2xzJztcbmltcG9ydCB7IERlYnVnVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2RlYnVnLXRvb2xzJztcbmltcG9ydCB7IFByZWZlcmVuY2VzVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ByZWZlcmVuY2VzLXRvb2xzJztcbmltcG9ydCB7IFNlcnZlclRvb2xzIH0gZnJvbSAnLi90b29scy9zZXJ2ZXItdG9vbHMnO1xuaW1wb3J0IHsgQnJvYWRjYXN0VG9vbHMgfSBmcm9tICcuL3Rvb2xzL2Jyb2FkY2FzdC10b29scyc7XG5pbXBvcnQgeyBTY2VuZUFkdmFuY2VkVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLWFkdmFuY2VkLXRvb2xzJztcbmltcG9ydCB7IFNjZW5lVmlld1Rvb2xzIH0gZnJvbSAnLi90b29scy9zY2VuZS12aWV3LXRvb2xzJztcbmltcG9ydCB7IFJlZmVyZW5jZUltYWdlVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3JlZmVyZW5jZS1pbWFnZS10b29scyc7XG5pbXBvcnQgeyBBc3NldEFkdmFuY2VkVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2Fzc2V0LWFkdmFuY2VkLXRvb2xzJztcbmltcG9ydCB7IFZhbGlkYXRpb25Ub29scyB9IGZyb20gJy4vdG9vbHMvdmFsaWRhdGlvbi10b29scyc7XG5pbXBvcnQgeyBFZGl0b3JSdW50aW1lVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2VkaXRvci1ydW50aW1lLXRvb2xzJztcbmltcG9ydCB7IERYVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2R4LXRvb2xzJztcblxuLyoqXG4gKiBUaGUgdG9vbCByZWdpc3RyeSB1c2VkIGJ5IGFsbCB0cmFuc3BvcnRzLiBXcmFwcyB0aGUgbGVnYWN5IHBlcuKAkWNhdGVnb3J5XG4gKiB0b29sIGNsYXNzZXMgYW5kIGV4cG9zZXMgdGhlIHVuaWZpZWQge0BsaW5rIFRvb2xSZWdpc3RyeX0gaW50ZXJmYWNlIHVzZWQgYnlcbiAqIHtAbGluayBQcm90b2NvbEhhbmRsZXJ9LlxuICovXG5leHBvcnQgY2xhc3MgQ29jb3NUb29sUmVnaXN0cnkgaW1wbGVtZW50cyBUb29sUmVnaXN0cnkge1xuICAgIHByaXZhdGUgdG9vbHM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBwcml2YXRlIHRvb2xzTGlzdDogVG9vbERlZmluaXRpb25bXSA9IFtdO1xuICAgIHByaXZhdGUgZW5hYmxlZFRvb2xzOiB7IGNhdGVnb3J5OiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9W10gPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICB0aGlzLnRvb2xzLnNjZW5lID0gbmV3IFNjZW5lVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5ub2RlID0gbmV3IE5vZGVUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLmNvbXBvbmVudCA9IG5ldyBDb21wb25lbnRUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnByZWZhYiA9IG5ldyBQcmVmYWJUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnByb2plY3QgPSBuZXcgUHJvamVjdFRvb2xzKCk7XG4gICAgICAgIHRoaXMudG9vbHMuZGVidWcgPSBuZXcgRGVidWdUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnByZWZlcmVuY2VzID0gbmV3IFByZWZlcmVuY2VzVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5zZXJ2ZXIgPSBuZXcgU2VydmVyVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5icm9hZGNhc3QgPSBuZXcgQnJvYWRjYXN0VG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5zY2VuZUFkdmFuY2VkID0gbmV3IFNjZW5lQWR2YW5jZWRUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnNjZW5lVmlldyA9IG5ldyBTY2VuZVZpZXdUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnJlZmVyZW5jZUltYWdlID0gbmV3IFJlZmVyZW5jZUltYWdlVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5hc3NldEFkdmFuY2VkID0gbmV3IEFzc2V0QWR2YW5jZWRUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnZhbGlkYXRpb24gPSBuZXcgVmFsaWRhdGlvblRvb2xzKCk7XG4gICAgICAgIHRoaXMudG9vbHMuZWRpdG9yUnVudGltZSA9IG5ldyBFZGl0b3JSdW50aW1lVG9vbHMoKTtcbiAgICAgICAgdGhpcy5yZWJ1aWxkKCk7XG4gICAgfVxuXG4gICAgLyoqIExhdGUgYmluZGluZyBmb3IgdGhlIERYIGNhdGVnb3J5LCB3aGljaCBuZWVkcyBhIGRpcmVjdG9yeSBwb2ludGVyIHRvIHRoZSBzZXJ2ZXIuICovXG4gICAgcHVibGljIHJlZ2lzdGVyRHhUb29scyhkeDogRFhUb29scyk6IHZvaWQge1xuICAgICAgICB0aGlzLnRvb2xzLmR4ID0gZHg7XG4gICAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH1cblxuICAgIHB1YmxpYyB1cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZDogeyBjYXRlZ29yeTogc3RyaW5nOyBuYW1lOiBzdHJpbmcgfVtdKTogdm9pZCB7XG4gICAgICAgIHRoaXMuZW5hYmxlZFRvb2xzID0gZW5hYmxlZCB8fCBbXTtcbiAgICAgICAgdGhpcy5yZWJ1aWxkKCk7XG4gICAgfVxuXG4gICAgcHVibGljIGxpc3RUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0O1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWQ6IHsgY2F0ZWdvcnk6IHN0cmluZzsgbmFtZTogc3RyaW5nIH1bXSk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICBpZiAoIWVuYWJsZWQgfHwgZW5hYmxlZC5sZW5ndGggPT09IDApIHJldHVybiB0aGlzLnRvb2xzTGlzdDtcbiAgICAgICAgY29uc3QgYWxsb3dlZCA9IG5ldyBTZXQoZW5hYmxlZC5tYXAoKHQpID0+IGAke3QuY2F0ZWdvcnl9XyR7dC5uYW1lfWApKTtcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0LmZpbHRlcigodCkgPT4gYWxsb3dlZC5oYXModC5uYW1lKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGV4ZWN1dGVUb29sQ2FsbChuYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSwgY3R4OiBUb29sRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGNvbnN0IGlkeCA9IG5hbWUuaW5kZXhPZignXycpO1xuICAgICAgICBpZiAoaWR4IDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHRvb2wgbmFtZTogJHtuYW1lfWApO1xuICAgICAgICBjb25zdCBjYXRlZ29yeSA9IG5hbWUuc2xpY2UoMCwgaWR4KTtcbiAgICAgICAgY29uc3QgdG9vbCA9IG5hbWUuc2xpY2UoaWR4ICsgMSk7XG4gICAgICAgIGlmICghdGhpcy50b29sc1tjYXRlZ29yeV0pIHRocm93IG5ldyBFcnJvcihgVG9vbCBjYXRlZ29yeSBub3QgZm91bmQ6ICR7Y2F0ZWdvcnl9YCk7XG5cbiAgICAgICAgLy8gQTg6IHN1cmZhY2UgQWJvcnRTaWduYWwgdG8gdG9vbHMgdGhhdCBzdXBwb3J0IGl0LiBMZWdhY3kgdG9vbHMgaWdub3JlIHRoZVxuICAgICAgICAvLyAzcmQgYXJndW1lbnQgaGFybWxlc3NseTsgbmV3IHRvb2xzIGNhbiB0YWtlIGFkdmFudGFnZS4gV2Ugc3RpbGwgcG9sbCB0aGVcbiAgICAgICAgLy8gc2lnbmFsIGhlcmUgc28gdGhhdCBldmVuIHN5bmNocm9ub3VzIHRvb2xzIHRlcm1pbmF0ZSBwcm9tcHRseS5cbiAgICAgICAgaWYgKGN0eC5zaWduYWwuYWJvcnRlZCkgdGhyb3cgbmV3IEVycm9yKCdjYW5jZWxsZWQnKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudG9vbHNbY2F0ZWdvcnldLmV4ZWN1dGUodG9vbCwgYXJncywgY3R4KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYnVpbGQoKTogdm9pZCB7XG4gICAgICAgIHRoaXMudG9vbHNMaXN0ID0gW107XG4gICAgICAgIGNvbnN0IGVuYWJsZWROYW1lcyA9IHRoaXMuZW5hYmxlZFRvb2xzLmxlbmd0aFxuICAgICAgICAgICAgPyBuZXcgU2V0KHRoaXMuZW5hYmxlZFRvb2xzLm1hcCgodCkgPT4gYCR7dC5jYXRlZ29yeX1fJHt0Lm5hbWV9YCkpXG4gICAgICAgICAgICA6IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgW2NhdGVnb3J5LCB0b29sU2V0XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnRvb2xzKSkge1xuICAgICAgICAgICAgY29uc3QgZGVmczogVG9vbERlZmluaXRpb25bXSA9IHRvb2xTZXQuZ2V0VG9vbHMoKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgZGVmIG9mIGRlZnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmcSA9IGAke2NhdGVnb3J5fV8ke2RlZi5uYW1lfWA7XG4gICAgICAgICAgICAgICAgaWYgKGVuYWJsZWROYW1lcyAmJiAhZW5hYmxlZE5hbWVzLmhhcyhmcSkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIHRoaXMudG9vbHNMaXN0LnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBmcSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGRlZi5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IGRlZi5pbnB1dFNjaGVtYSxcbiAgICAgICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hOiBkZWYub3V0cHV0U2NoZW1hLFxuICAgICAgICAgICAgICAgICAgICBhbm5vdGF0aW9uczogZGVmLmFubm90YXRpb25zXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBNQ1BTZXJ2ZXIge1xuICAgIHByaXZhdGUgc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzO1xuICAgIHByaXZhdGUgcmVnaXN0cnk6IENvY29zVG9vbFJlZ2lzdHJ5O1xuICAgIHByaXZhdGUgdHJhbnNwb3J0OiBTdHJlYW1hYmxlSHR0cFNlcnZlcjtcbiAgICBwcml2YXRlIGhhbmRsZXJzQnlTZXNzaW9uID0gbmV3IE1hcDxzdHJpbmcsIFByb3RvY29sSGFuZGxlcj4oKTtcbiAgICBwcml2YXRlIHJlc291cmNlczogUmVzb3VyY2VSZWdpc3RyeTtcbiAgICBwcml2YXRlIHByb21wdHM6IFByb21wdFJlZ2lzdHJ5O1xuICAgIHByaXZhdGUgc3RhcnRlZEF0ID0gMDtcblxuICAgIGNvbnN0cnVjdG9yKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSBuZXcgQ29jb3NUb29sUmVnaXN0cnkoKTtcblxuICAgICAgICAvLyBQaGFzZSAyIOKAlCByZWdpc3RyaWVzIGJyb2FkY2FzdCBsaXN0X2NoYW5nZWQgdmlhIGV2ZXJ5IGFjdGl2ZSBzZXNzaW9uXG4gICAgICAgIC8vIGJ5IHBpcGluZyB0aGVpciBub3RpZmljYXRpb25zIHRocm91Z2ggYGJyb2FkY2FzdE5vdGlmaWNhdGlvbmAuXG4gICAgICAgIHRoaXMucmVzb3VyY2VzID0gbmV3IFJlc291cmNlUmVnaXN0cnkoKG1ldGhvZCwgcGFyYW1zKSA9PiB0aGlzLmJyb2FkY2FzdE5vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcykpO1xuICAgICAgICB0aGlzLnByb21wdHMgPSBuZXcgUHJvbXB0UmVnaXN0cnkoKG1ldGhvZCwgcGFyYW1zKSA9PiB0aGlzLmJyb2FkY2FzdE5vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcykpO1xuICAgICAgICB0aGlzLnJlc291cmNlcy5hZGRQcm92aWRlcihidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyKCkpO1xuICAgICAgICB0aGlzLnByb21wdHMuYWRkUHJvdmlkZXIoYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIoKSk7XG5cbiAgICAgICAgLy8gUGhhc2UgNiDigJQgRFggdG9vbHMgbmVlZCBhIHBvaW50ZXIgdG8gdGhlIHNlcnZlciBpdHNlbGYuXG4gICAgICAgIHRoaXMucmVnaXN0cnkucmVnaXN0ZXJEeFRvb2xzKG5ldyBEWFRvb2xzKHtcbiAgICAgICAgICAgIGxpc3RUb29sczogKCkgPT4gdGhpcy5yZWdpc3RyeS5saXN0VG9vbHMoKSxcbiAgICAgICAgICAgIGdldFNlcnZlckNhcGFiaWxpdGllczogKCkgPT4gdGhpcy5nZXRBZHZlcnRpc2VkQ2FwYWJpbGl0aWVzKCksXG4gICAgICAgICAgICBnZXRTZXJ2ZXJJbmZvOiAoKSA9PiAoe1xuICAgICAgICAgICAgICAgIG5hbWU6ICdjb2Nvcy1tY3Atc2VydmVyJyxcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiAnMS40LjAnLFxuICAgICAgICAgICAgICAgIHVwdGltZU1zOiB0aGlzLnN0YXJ0ZWRBdCA/IERhdGUubm93KCkgLSB0aGlzLnN0YXJ0ZWRBdCA6IDAsXG4gICAgICAgICAgICAgICAgc2Vzc2lvbnM6IHRoaXMudHJhbnNwb3J0ID8gdGhpcy50cmFuc3BvcnQuZ2V0U2Vzc2lvbkNvdW50KCkgOiAwLFxuICAgICAgICAgICAgICAgIHBvcnQ6IHRoaXMuc2V0dGluZ3MucG9ydFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHRoaXMudHJhbnNwb3J0ID0gbmV3IFN0cmVhbWFibGVIdHRwU2VydmVyKHtcbiAgICAgICAgICAgIHNldHRpbmdzLFxuICAgICAgICAgICAgY3JlYXRlSGFuZGxlcjogKHNlc3Npb25JZCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGggPSBuZXcgUHJvdG9jb2xIYW5kbGVyKHtcbiAgICAgICAgICAgICAgICAgICAgcmVnaXN0cnk6IHRoaXMucmVnaXN0cnksXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VTaXplOiB0aGlzLnNldHRpbmdzLnRvb2xzUGFnZVNpemUgPz8gMTAwLFxuICAgICAgICAgICAgICAgICAgICBpbml0aWFsTG9nTGV2ZWw6IHRoaXMuc2V0dGluZ3MubG9nTGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IHRoaXMucmVzb3VyY2VzLFxuICAgICAgICAgICAgICAgICAgICBwcm9tcHRzOiB0aGlzLnByb21wdHNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnNldChzZXNzaW9uSWQsIGgpO1xuICAgICAgICAgICAgICAgIHJldHVybiBoO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uU2Vzc2lvblRlcm1pbmF0ZWQ6IChzZXNzaW9uSWQpID0+IHRoaXMuaGFuZGxlcnNCeVNlc3Npb24uZGVsZXRlKHNlc3Npb25JZClcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLnRyYW5zcG9ydC5zdGFydCgpO1xuICAgICAgICB0aGlzLnN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBTdHJlYW1hYmxlIEhUVFAgbGlzdGVuaW5nIG9uIGh0dHA6Ly8xMjcuMC4wLjE6JHt0aGlzLnNldHRpbmdzLnBvcnR9L21jcGApO1xuICAgIH1cblxuICAgIHB1YmxpYyBzdG9wKCk6IHZvaWQge1xuICAgICAgICB0aGlzLnRyYW5zcG9ydC5zdG9wKCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnNCeVNlc3Npb24uY2xlYXIoKTtcbiAgICAgICAgdGhpcy5zdGFydGVkQXQgPSAwO1xuICAgIH1cblxuICAgIHB1YmxpYyB1cGRhdGVTZXR0aW5ncyhzZXR0aW5nczogTUNQU2VydmVyU2V0dGluZ3MpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHNldHRpbmdzO1xuICAgICAgICB0aGlzLnRyYW5zcG9ydC51cGRhdGVTZXR0aW5ncyhzZXR0aW5ncyk7XG4gICAgICAgIGZvciAoY29uc3QgaCBvZiB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnZhbHVlcygpKSB7XG4gICAgICAgICAgICBpZiAoc2V0dGluZ3MubG9nTGV2ZWwpIGguc2V0TG9nTGV2ZWwoc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIHVwZGF0ZUVuYWJsZWRUb29scyhlbmFibGVkVG9vbHM6IGFueVtdKTogdm9pZCB7XG4gICAgICAgIHRoaXMucmVnaXN0cnkudXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29scyk7XG4gICAgICAgIC8vIFBoYXNlIDEgZm9sbG93LXVwOiBpbnZhbGlkYXRlIHZhbGlkYXRvcnMgKmFuZCogYnJvYWRjYXN0XG4gICAgICAgIC8vIG5vdGlmaWNhdGlvbnMvdG9vbHMvbGlzdF9jaGFuZ2VkIHNvIGNvbm5lY3RlZCBjbGllbnRzIHJlZnJlc2guXG4gICAgICAgIGZvciAoY29uc3QgaCBvZiB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnZhbHVlcygpKSB7XG4gICAgICAgICAgICBoLmNsZWFyVmFsaWRhdG9yQ2FjaGUoKTtcbiAgICAgICAgICAgIGguZW1pdFRvb2xzTGlzdENoYW5nZWQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBnZXRSZWdpc3RyeSgpOiBDb2Nvc1Rvb2xSZWdpc3RyeSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5O1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRSZXNvdXJjZXMoKTogUmVzb3VyY2VSZWdpc3RyeSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlc291cmNlcztcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0UHJvbXB0cygpOiBQcm9tcHRSZWdpc3RyeSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb21wdHM7XG4gICAgfVxuXG4gICAgcHVibGljIGdldFN0YXR1cygpOiBTZXJ2ZXJTdGF0dXMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcnVubmluZzogdGhpcy50cmFuc3BvcnQuZ2V0UnVubmluZygpLFxuICAgICAgICAgICAgcG9ydDogdGhpcy50cmFuc3BvcnQuZ2V0UG9ydCgpLFxuICAgICAgICAgICAgY2xpZW50czogdGhpcy50cmFuc3BvcnQuZ2V0U2Vzc2lvbkNvdW50KClcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q2xpZW50cygpOiBNQ1BDbGllbnRbXSB7XG4gICAgICAgIHJldHVybiB0aGlzLnRyYW5zcG9ydC5nZXRDbGllbnRzKCk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldFNldHRpbmdzKCk6IE1DUFNlcnZlclNldHRpbmdzIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0dGluZ3M7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEF2YWlsYWJsZVRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5saXN0VG9vbHMoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0RmlsdGVyZWRUb29scyhlbmFibGVkVG9vbHM6IGFueVtdKTogVG9vbERlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5LmdldEZpbHRlcmVkVG9vbHMoZW5hYmxlZFRvb2xzKTtcbiAgICB9XG5cbiAgICAvKiogQnJvYWRjYXN0IGEgc2VydmVyIG5vdGlmaWNhdGlvbiB0byBldmVyeSBhY3RpdmUgc2Vzc2lvbi4gKi9cbiAgICBwcml2YXRlIGJyb2FkY2FzdE5vdGlmaWNhdGlvbihtZXRob2Q6IHN0cmluZywgcGFyYW1zPzogYW55KTogdm9pZCB7XG4gICAgICAgIGZvciAoY29uc3QgaCBvZiB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnZhbHVlcygpKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIFdlIGNoZWF0IGhlcmUgYSBsaXR0bGUgYnkgcmVhY2hpbmcgZm9yIHRoZSBwdWJsaWMgc2VuZENsaWVudFJlcXVlc3RcbiAgICAgICAgICAgICAgICAvLyBwYXRoJ3Mgbm90aWZpY2F0aW9uIGNvdXNpbiB2aWEgdGhlIHB1YmxpYyBlbWl0IGhlbHBlcnM7IGZvclxuICAgICAgICAgICAgICAgIC8vIGdlbmVyaWMgbm90aWZpY2F0aW9ucyB3ZSB1c2UgdGhlIHNhbWUgcHJpdmF0ZSBub3RpZnkgY2hhbm5lbFxuICAgICAgICAgICAgICAgIC8vIGJ5IGNhbGxpbmcgY2xlYXJWYWxpZGF0b3JDYWNoZSB3cmFwcGVycyB3b24ndCBmaXQsIHNvIHVzZVxuICAgICAgICAgICAgICAgIC8vIHRoZSBwcm90b2NvbCBoYW5kbGVyJ3Mgbm90aWZpY2F0aW9uIGhlbHBlcnMgYWRkZWQgYmVsb3cuXG4gICAgICAgICAgICAgICAgaC5lbWl0Tm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRBZHZlcnRpc2VkQ2FwYWJpbGl0aWVzKCk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG9vbHM6IHsgbGlzdENoYW5nZWQ6IHRydWUgfSxcbiAgICAgICAgICAgIGxvZ2dpbmc6IHt9LFxuICAgICAgICAgICAgcmVzb3VyY2VzOiB7IGxpc3RDaGFuZ2VkOiB0cnVlLCBzdWJzY3JpYmU6IHRydWUgfSxcbiAgICAgICAgICAgIHByb21wdHM6IHsgbGlzdENoYW5nZWQ6IHRydWUgfSxcbiAgICAgICAgICAgIHNhbXBsaW5nOiB7fSxcbiAgICAgICAgICAgIGNvbXBsZXRpb25zOiB7fVxuICAgICAgICB9O1xuICAgIH1cbn1cbiJdfQ==