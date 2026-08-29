"use strict";
/**
 * Phase 5 — Editor runtime tools.
 *
 * Surface a small but useful set of editor-runtime operations as MCP tools:
 *   - run_preview / reload_preview — use the public messages contributed by
 *     Cocos Creator's built-in `preview` package.
 *   - stop_preview — report the editor limitation explicitly (3.8.x exposes
 *     no stop message; the preview HTTP service belongs to the editor).
 *   - tail_runtime_logs — read the in-process log ring buffer maintained by
 *     {@link pushRuntimeLog} (also exposed as the `runtime://logs` resource).
 *   - reload_current_scene — soft reload the active scene.
 *   - subscribe_runtime_logs — convenience wrapper that asks the client to
 *     subscribe to `runtime://logs` (the MCP standard way to live-stream logs).
 *
 * These calls all delegate to the editor `Editor.Message.request(...)` API;
 * when running outside the editor host (e.g. stdio binary in standalone mode)
 * they degrade with `success: false` instead of throwing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditorRuntimeTools = void 0;
const registries_1 = require("../protocol/registries");
function getEditor() {
    const g = globalThis;
    return g.Editor && typeof g.Editor === 'object' ? g.Editor : null;
}
class EditorRuntimeTools {
    getTools() {
        return [
            {
                name: 'run_preview',
                description: 'Start the editor preview/runtime server.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        platform: { type: 'string', description: 'Optional preview platform (browser, simulator).' }
                    }
                }
            },
            {
                name: 'stop_preview',
                description: 'Report whether the editor exposes preview-stop control (Cocos 3.8.x does not).',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'reload_preview',
                description: 'Refresh assets, then reload connected preview targets through Cocos Creator 3.8.x public preview messages.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        refreshAssets: { type: 'boolean', default: true, description: 'Refresh/import assets before reloading preview.' },
                        assetUrl: { type: 'string', default: 'db://assets', description: 'Asset DB URL to refresh.' }
                    }
                }
            },
            {
                name: 'tail_runtime_logs',
                description: 'Read the in-process editor runtime log ring buffer (last ~200 lines).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
                        filter: { type: 'string', description: 'Substring filter (case-insensitive).' }
                    }
                }
            },
            {
                name: 'reload_current_scene',
                description: 'Soft-reload the currently open scene.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'subscribe_runtime_logs',
                description: 'Hint that the client should call resources/subscribe on runtime://logs for live streaming.',
                inputSchema: { type: 'object', properties: {} }
            }
        ];
    }
    async execute(toolName, args) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const ed = getEditor();
        switch (toolName) {
            case 'run_preview': {
                if (!ed)
                    return unavailable();
                try {
                    if (typeof ((_a = ed.Message) === null || _a === void 0 ? void 0 : _a.request) !== 'function')
                        return unavailable();
                    // Cocos Creator 3.8.8 contributes `open-terminal`; there is
                    // no `start` message in the built-in preview package.
                    await ed.Message.request('preview', 'open-terminal');
                    const platform = (args === null || args === void 0 ? void 0 : args.platform) || 'browser';
                    (0, registries_1.pushRuntimeLog)('info', `preview open requested (${platform})`);
                    return {
                        success: true,
                        message: 'preview open requested through preview:open-terminal',
                        data: { platform, message: 'preview:open-terminal' }
                    };
                }
                catch (e) {
                    return { success: false, error: (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e) };
                }
            }
            case 'stop_preview': {
                if (!ed)
                    return unavailable();
                return {
                    success: false,
                    error: 'Cocos Creator 3.8.x does not contribute a preview stop message.',
                    instruction: 'Close connected preview targets, or restart the exact project editor through its external supervisor when a full preview-service restart is required.'
                };
            }
            case 'reload_preview': {
                if (!ed)
                    return unavailable();
                try {
                    if (typeof ((_c = ed.Message) === null || _c === void 0 ? void 0 : _c.request) !== 'function')
                        return unavailable();
                    const steps = [];
                    const assetUrl = typeof (args === null || args === void 0 ? void 0 : args.assetUrl) === 'string' && args.assetUrl
                        ? args.assetUrl : 'db://assets';
                    if ((args === null || args === void 0 ? void 0 : args.refreshAssets) !== false) {
                        await ed.Message.request('asset-db', 'refresh-asset', assetUrl);
                        steps.push(`asset-db:refresh-asset ${assetUrl}`);
                    }
                    // `reload-terminal` is the exact message declared by the
                    // built-in preview package in Creator 3.8.8. The previous
                    // guessed `reload` message always failed at runtime.
                    await ed.Message.request('preview', 'reload-terminal');
                    steps.push('preview:reload-terminal');
                    let previewUrl = null;
                    try {
                        previewUrl = await ed.Message.request('preview', 'query-preview-url');
                    }
                    catch (_j) {
                        // Reload is authoritative; URL discovery is optional.
                    }
                    (0, registries_1.pushRuntimeLog)('info', `preview reload requested (${steps.join(', ')})`);
                    return {
                        success: true,
                        message: 'preview reload requested through preview:reload-terminal',
                        data: { assetUrl, previewUrl, steps }
                    };
                }
                catch (e) {
                    return { success: false, error: (_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : String(e) };
                }
            }
            case 'tail_runtime_logs': {
                const buf = (0, registries_1.getRuntimeLogs)();
                const limit = Math.min(200, Math.max(1, Number.parseInt(String((_e = args === null || args === void 0 ? void 0 : args.limit) !== null && _e !== void 0 ? _e : 50), 10) || 50));
                const filter = typeof (args === null || args === void 0 ? void 0 : args.filter) === 'string' ? args.filter.toLowerCase() : '';
                const filtered = filter ? buf.filter((l) => l.toLowerCase().includes(filter)) : buf;
                const slice = filtered.slice(-limit);
                return { success: true, data: { lines: slice, total: filtered.length } };
            }
            case 'reload_current_scene': {
                if (!ed)
                    return unavailable();
                try {
                    await ((_g = (_f = ed.Message) === null || _f === void 0 ? void 0 : _f.request) === null || _g === void 0 ? void 0 : _g.call(_f, 'scene', 'soft-reload'));
                    return { success: true, message: 'scene soft-reloaded' };
                }
                catch (e) {
                    return { success: false, error: (_h = e === null || e === void 0 ? void 0 : e.message) !== null && _h !== void 0 ? _h : String(e) };
                }
            }
            case 'subscribe_runtime_logs': {
                return {
                    success: true,
                    message: 'Call resources/subscribe with uri="runtime://logs" to stream new log lines.',
                    instruction: 'resources/subscribe { "uri": "runtime://logs" }'
                };
            }
            default:
                return { success: false, error: `Unknown editorRuntime tool: ${toolName}` };
        }
    }
}
exports.EditorRuntimeTools = EditorRuntimeTools;
function unavailable() {
    return { success: false, error: 'Editor runtime not available (running outside Cocos Creator).' };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLXJ1bnRpbWUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZWRpdG9yLXJ1bnRpbWUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBR0gsdURBQXdFO0FBR3hFLFNBQVMsU0FBUztJQUNkLE1BQU0sQ0FBQyxHQUFRLFVBQWlCLENBQUM7SUFDakMsT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE1BQU0sS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztBQUN0RSxDQUFDO0FBRUQsTUFBYSxrQkFBa0I7SUFDM0IsUUFBUTtRQUNKLE9BQU87WUFDSDtnQkFDSSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsV0FBVyxFQUFFLDBDQUEwQztnQkFDdkQsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRTt3QkFDUixRQUFRLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxpREFBaUQsRUFBRTtxQkFDL0Y7aUJBQ0o7YUFDSjtZQUNEO2dCQUNJLElBQUksRUFBRSxjQUFjO2dCQUNwQixXQUFXLEVBQUUsZ0ZBQWdGO2dCQUM3RixXQUFXLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUU7YUFDbEQ7WUFDRDtnQkFDSSxJQUFJLEVBQUUsZ0JBQWdCO2dCQUN0QixXQUFXLEVBQUUsNEdBQTRHO2dCQUN6SCxXQUFXLEVBQUU7b0JBQ1QsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFO3dCQUNSLGFBQWEsRUFBRSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsaURBQWlELEVBQUU7d0JBQ2pILFFBQVEs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LEVBQUUsQ0FBQztBQUN0RyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFBoYXNlIDUg4oCUIEVkaXRvciBydW50aW1lIHRvb2xzLlxyXG4gKlxyXG4gKiBTdXJmYWNlIGEgc21hbGwgYnV0IHVzZWZ1bCBzZXQgb2YgZWRpdG9yLXJ1bnRpbWUgb3BlcmF0aW9ucyBhcyBNQ1AgdG9vbHM6XHJcbiAqICAgLSBydW5fcHJldmlldyAvIHJlbG9hZF9wcmV2aWV3IOKAlCB1c2UgdGhlIHB1YmxpYyBtZXNzYWdlcyBjb250cmlidXRlZCBieVxyXG4gKiAgICAgQ29jb3MgQ3JlYXRvcidzIGJ1aWx0LWluIGBwcmV2aWV3YCBwYWNrYWdlLlxyXG4gKiAgIC0gc3RvcF9wcmV2aWV3IOKAlCByZXBvcnQgdGhlIGVkaXRvciBsaW1pdGF0aW9uIGV4cGxpY2l0bHkgKDMuOC54IGV4cG9zZXNcclxuICogICAgIG5vIHN0b3AgbWVzc2FnZTsgdGhlIHByZXZpZXcgSFRUUCBzZXJ2aWNlIGJlbG9uZ3MgdG8gdGhlIGVkaXRvcikuXHJcbiAqICAgLSB0YWlsX3J1bnRpbWVfbG9ncyDigJQgcmVhZCB0aGUgaW4tcHJvY2VzcyBsb2cgcmluZyBidWZmZXIgbWFpbnRhaW5lZCBieVxyXG4gKiAgICAge0BsaW5rIHB1c2hSdW50aW1lTG9nfSAoYWxzbyBleHBvc2VkIGFzIHRoZSBgcnVudGltZTovL2xvZ3NgIHJlc291cmNlKS5cclxuICogICAtIHJlbG9hZF9jdXJyZW50X3NjZW5lIOKAlCBzb2Z0IHJlbG9hZCB0aGUgYWN0aXZlIHNjZW5lLlxyXG4gKiAgIC0gc3Vic2NyaWJlX3J1bnRpbWVfbG9ncyDigJQgY29udmVuaWVuY2Ugd3JhcHBlciB0aGF0IGFza3MgdGhlIGNsaWVudCB0b1xyXG4gKiAgICAgc3Vic2NyaWJlIHRvIGBydW50aW1lOi8vbG9nc2AgKHRoZSBNQ1Agc3RhbmRhcmQgd2F5IHRvIGxpdmUtc3RyZWFtIGxvZ3MpLlxyXG4gKlxyXG4gKiBUaGVzZSBjYWxscyBhbGwgZGVsZWdhdGUgdG8gdGhlIGVkaXRvciBgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCguLi4pYCBBUEk7XHJcbiAqIHdoZW4gcnVubmluZyBvdXRzaWRlIHRoZSBlZGl0b3IgaG9zdCAoZS5nLiBzdGRpbyBiaW5hcnkgaW4gc3RhbmRhbG9uZSBtb2RlKVxyXG4gKiB0aGV5IGRlZ3JhZGUgd2l0aCBgc3VjY2VzczogZmFsc2VgIGluc3RlYWQgb2YgdGhyb3dpbmcuXHJcbiAqL1xyXG5cclxuaW1wb3J0IHsgVG9vbERlZmluaXRpb24sIFRvb2xFeGVjdXRvciwgVG9vbFJlc3BvbnNlIH0gZnJvbSAnLi4vdHlwZXMnO1xyXG5pbXBvcnQgeyBnZXRSdW50aW1lTG9ncywgcHVzaFJ1bnRpbWVMb2cgfSBmcm9tICcuLi9wcm90b2NvbC9yZWdpc3RyaWVzJztcclxuXHJcblxyXG5mdW5jdGlvbiBnZXRFZGl0b3IoKTogYW55IHwgbnVsbCB7XHJcbiAgICBjb25zdCBnOiBhbnkgPSBnbG9iYWxUaGlzIGFzIGFueTtcclxuICAgIHJldHVybiBnLkVkaXRvciAmJiB0eXBlb2YgZy5FZGl0b3IgPT09ICdvYmplY3QnID8gZy5FZGl0b3IgOiBudWxsO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgRWRpdG9yUnVudGltZVRvb2xzIGltcGxlbWVudHMgVG9vbEV4ZWN1dG9yIHtcclxuICAgIGdldFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdydW5fcHJldmlldycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1N0YXJ0IHRoZSBlZGl0b3IgcHJldmlldy9ydW50aW1lIHNlcnZlci4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBsYXRmb3JtOiB7IHR5cGU6ICdzdHJpbmcnLCBkZXNjcmlwdGlvbjogJ09wdGlvbmFsIHByZXZpZXcgcGxhdGZvcm0gKGJyb3dzZXIsIHNpbXVsYXRvcikuJyB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnc3RvcF9wcmV2aWV3JyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVwb3J0IHdoZXRoZXIgdGhlIGVkaXRvciBleHBvc2VzIHByZXZpZXctc3RvcCBjb250cm9sIChDb2NvcyAzLjgueCBkb2VzIG5vdCkuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdyZWxvYWRfcHJldmlldycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlZnJlc2ggYXNzZXRzLCB0aGVuIHJlbG9hZCBjb25uZWN0ZWQgcHJldmlldyB0YXJnZXRzIHRocm91Z2ggQ29jb3MgQ3JlYXRvciAzLjgueCBwdWJsaWMgcHJldmlldyBtZXNzYWdlcy4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZnJlc2hBc3NldHM6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiB0cnVlLCBkZXNjcmlwdGlvbjogJ1JlZnJlc2gvaW1wb3J0IGFzc2V0cyBiZWZvcmUgcmVsb2FkaW5nIHByZXZpZXcuJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhc3NldFVybDogeyB0eXBlOiAnc3RyaW5nJywgZGVmYXVsdDogJ2RiOi8vYXNzZXRzJywgZGVzY3JpcHRpb246ICdBc3NldCBEQiBVUkwgdG8gcmVmcmVzaC4nIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICd0YWlsX3J1bnRpbWVfbG9ncycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlYWQgdGhlIGluLXByb2Nlc3MgZWRpdG9yIHJ1bnRpbWUgbG9nIHJpbmcgYnVmZmVyIChsYXN0IH4yMDAgbGluZXMpLicsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGltaXQ6IHsgdHlwZTogJ2ludGVnZXInLCBtaW5pbXVtOiAxLCBtYXhpbXVtOiAyMDAsIGRlZmF1bHQ6IDUwIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbHRlcjogeyB0eXBlOiAnc3RyaW5nJywgZGVzY3JpcHRpb246ICdTdWJzdHJpbmcgZmlsdGVyIChjYXNlLWluc2Vuc2l0aXZlKS4nIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdyZWxvYWRfY3VycmVudF9zY2VuZScsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NvZnQtcmVsb2FkIHRoZSBjdXJyZW50bHkgb3BlbiBzY2VuZS4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogJ29iamVjdCcsIHByb3BlcnRpZXM6IHt9IH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ3N1YnNjcmliZV9ydW50aW1lX2xvZ3MnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdIaW50IHRoYXQgdGhlIGNsaWVudCBzaG91bGQgY2FsbCByZXNvdXJjZXMvc3Vic2NyaWJlIG9uIHJ1bnRpbWU6Ly9sb2dzIGZvciBsaXZlIHN0cmVhbWluZy4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogJ29iamVjdCcsIHByb3BlcnRpZXM6IHt9IH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIF07XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZXhlY3V0ZSh0b29sTmFtZTogc3RyaW5nLCBhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIGNvbnN0IGVkID0gZ2V0RWRpdG9yKCk7XHJcbiAgICAgICAgc3dpdGNoICh0b29sTmFtZSkge1xyXG4gICAgICAgICAgICBjYXNlICdydW5fcHJldmlldyc6IHtcclxuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiB1bmF2YWlsYWJsZSgpO1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGVkLk1lc3NhZ2U/LnJlcXVlc3QgIT09ICdmdW5jdGlvbicpIHJldHVybiB1bmF2YWlsYWJsZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENvY29zIENyZWF0b3IgMy44LjggY29udHJpYnV0ZXMgYG9wZW4tdGVybWluYWxgOyB0aGVyZSBpc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIG5vIGBzdGFydGAgbWVzc2FnZSBpbiB0aGUgYnVpbHQtaW4gcHJldmlldyBwYWNrYWdlLlxyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGVkLk1lc3NhZ2UucmVxdWVzdCgncHJldmlldycsICdvcGVuLXRlcm1pbmFsJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGxhdGZvcm0gPSBhcmdzPy5wbGF0Zm9ybSB8fCAnYnJvd3Nlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgcHVzaFJ1bnRpbWVMb2coJ2luZm8nLCBgcHJldmlldyBvcGVuIHJlcXVlc3RlZCAoJHtwbGF0Zm9ybX0pYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ3ByZXZpZXcgb3BlbiByZXF1ZXN0ZWQgdGhyb3VnaCBwcmV2aWV3Om9wZW4tdGVybWluYWwnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IHBsYXRmb3JtLCBtZXNzYWdlOiAncHJldmlldzpvcGVuLXRlcm1pbmFsJyB9XHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjYXNlICdzdG9wX3ByZXZpZXcnOiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWVkKSByZXR1cm4gdW5hdmFpbGFibGUoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6ICdDb2NvcyBDcmVhdG9yIDMuOC54IGRvZXMgbm90IGNvbnRyaWJ1dGUgYSBwcmV2aWV3IHN0b3AgbWVzc2FnZS4nLFxyXG4gICAgICAgICAgICAgICAgICAgIGluc3RydWN0aW9uOiAnQ2xvc2UgY29ubmVjdGVkIHByZXZpZXcgdGFyZ2V0cywgb3IgcmVzdGFydCB0aGUgZXhhY3QgcHJvamVjdCBlZGl0b3IgdGhyb3VnaCBpdHMgZXh0ZXJuYWwgc3VwZXJ2aXNvciB3aGVuIGEgZnVsbCBwcmV2aWV3LXNlcnZpY2UgcmVzdGFydCBpcyByZXF1aXJlZC4nXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhc2UgJ3JlbG9hZF9wcmV2aWV3Jzoge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIHVuYXZhaWxhYmxlKCk7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZWQuTWVzc2FnZT8ucmVxdWVzdCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHVuYXZhaWxhYmxlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcHM6IHN0cmluZ1tdID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXNzZXRVcmwgPSB0eXBlb2YgYXJncz8uYXNzZXRVcmwgPT09ICdzdHJpbmcnICYmIGFyZ3MuYXNzZXRVcmxcclxuICAgICAgICAgICAgICAgICAgICAgICAgPyBhcmdzLmFzc2V0VXJsIDogJ2RiOi8vYXNzZXRzJztcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYXJncz8ucmVmcmVzaEFzc2V0cyAhPT0gZmFsc2UpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZWQuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0JywgYXNzZXRVcmwpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGVwcy5wdXNoKGBhc3NldC1kYjpyZWZyZXNoLWFzc2V0ICR7YXNzZXRVcmx9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGByZWxvYWQtdGVybWluYWxgIGlzIHRoZSBleGFjdCBtZXNzYWdlIGRlY2xhcmVkIGJ5IHRoZVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGJ1aWx0LWluIHByZXZpZXcgcGFja2FnZSBpbiBDcmVhdG9yIDMuOC44LiBUaGUgcHJldmlvdXNcclxuICAgICAgICAgICAgICAgICAgICAvLyBndWVzc2VkIGByZWxvYWRgIG1lc3NhZ2UgYWx3YXlzIGZhaWxlZCBhdCBydW50aW1lLlxyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGVkLk1lc3NhZ2UucmVxdWVzdCgncHJldmlldycsICdyZWxvYWQtdGVybWluYWwnKTtcclxuICAgICAgICAgICAgICAgICAgICBzdGVwcy5wdXNoKCdwcmV2aWV3OnJlbG9hZC10ZXJtaW5hbCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIGxldCBwcmV2aWV3VXJsOiB1bmtub3duID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcmV2aWV3VXJsID0gYXdhaXQgZWQuTWVzc2FnZS5yZXF1ZXN0KCdwcmV2aWV3JywgJ3F1ZXJ5LXByZXZpZXctdXJsJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlbG9hZCBpcyBhdXRob3JpdGF0aXZlOyBVUkwgZGlzY292ZXJ5IGlzIG9wdGlvbmFsLlxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBwdXNoUnVudGltZUxvZygnaW5mbycsIGBwcmV2aWV3IHJlbG9hZCByZXF1ZXN0ZWQgKCR7c3RlcHMuam9pbignLCAnKX0pYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ3ByZXZpZXcgcmVsb2FkIHJlcXVlc3RlZCB0aHJvdWdoIHByZXZpZXc6cmVsb2FkLXRlcm1pbmFsJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBhc3NldFVybCwgcHJldmlld1VybCwgc3RlcHMgfVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGU/Lm1lc3NhZ2UgPz8gU3RyaW5nKGUpIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2FzZSAndGFpbF9ydW50aW1lX2xvZ3MnOiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBidWYgPSBnZXRSdW50aW1lTG9ncygpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGltaXQgPSBNYXRoLm1pbigyMDAsIE1hdGgubWF4KDEsIE51bWJlci5wYXJzZUludChTdHJpbmcoYXJncz8ubGltaXQgPz8gNTApLCAxMCkgfHwgNTApKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZpbHRlciA9IHR5cGVvZiBhcmdzPy5maWx0ZXIgPT09ICdzdHJpbmcnID8gYXJncy5maWx0ZXIudG9Mb3dlckNhc2UoKSA6ICcnO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXIgPyBidWYuZmlsdGVyKChsKSA9PiBsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoZmlsdGVyKSkgOiBidWY7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzbGljZSA9IGZpbHRlcmVkLnNsaWNlKC1saW1pdCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBkYXRhOiB7IGxpbmVzOiBzbGljZSwgdG90YWw6IGZpbHRlcmVkLmxlbmd0aCB9IH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2FzZSAncmVsb2FkX2N1cnJlbnRfc2NlbmUnOiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWVkKSByZXR1cm4gdW5hdmFpbGFibGUoKTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZWQuTWVzc2FnZT8ucmVxdWVzdD8uKCdzY2VuZScsICdzb2Z0LXJlbG9hZCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1lc3NhZ2U6ICdzY2VuZSBzb2Z0LXJlbG9hZGVkJyB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhc2UgJ3N1YnNjcmliZV9ydW50aW1lX2xvZ3MnOiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0NhbGwgcmVzb3VyY2VzL3N1YnNjcmliZSB3aXRoIHVyaT1cInJ1bnRpbWU6Ly9sb2dzXCIgdG8gc3RyZWFtIG5ldyBsb2cgbGluZXMuJyxcclxuICAgICAgICAgICAgICAgICAgICBpbnN0cnVjdGlvbjogJ3Jlc291cmNlcy9zdWJzY3JpYmUgeyBcInVyaVwiOiBcInJ1bnRpbWU6Ly9sb2dzXCIgfSdcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFVua25vd24gZWRpdG9yUnVudGltZSB0b29sOiAke3Rvb2xOYW1lfWAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHVuYXZhaWxhYmxlKCk6IFRvb2xSZXNwb25zZSB7XHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdFZGl0b3IgcnVudGltZSBub3QgYXZhaWxhYmxlIChydW5uaW5nIG91dHNpZGUgQ29jb3MgQ3JlYXRvcikuJyB9O1xyXG59XHJcbiJdfQ==