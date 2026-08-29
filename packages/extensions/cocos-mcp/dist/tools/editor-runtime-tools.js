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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLXJ1bnRpbWUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZWRpdG9yLXJ1bnRpbWUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBR0gsdURBQXdFO0FBR3hFLFNBQVMsU0FBUztJQUNkLE1BQU0sQ0FBQyxHQUFRLFVBQWlCLENBQUM7SUFDakMsT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE1BQU0sS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztBQUN0RSxDQUFDO0FBRUQsTUFBYSxrQkFBa0I7SUFDM0IsUUFBUTtRQUNKLE9BQU87WUFDSDtnQkFDSSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsV0FBVyxFQUFFLDBDQUEwQztnQkFDdkQsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRTt3QkFDUixRQUFRLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxpREFBaUQsRUFBRTtxQkFDL0Y7aUJBQ0o7YUFDSjtZQUNEO2dCQUNJLElBQUksRUFBRSxjQUFjO2dCQUNwQixXQUFXLEVBQUUsZ0ZBQWdGO2dCQUM3RixXQUFXLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUU7YUFDbEQ7WUFDRDtnQkFDSSxJQUFJLEVBQUUsZ0JBQWdCO2dCQUN0QixXQUFXLEVBQUUsNEdBQTRHO2dCQUN6SCxXQUFXLEVBQUU7b0JBQ1QsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFO3dCQUNSLGFBQWEsRUFBRSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsaURBQWlELEVBQUU7d0JBQ2pILFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxXQUFXLEVBQUUsMEJBQTBCLEVBQUU7cUJBQ2hHO2lCQUNKO2FBQ0o7WUFDRDtnQkFDSSxJQUFJLEVBQUUsbUJBQW1CO2dCQUN6QixXQUFXLEVBQUUsdUVBQXVFO2dCQUNwRixXQUFXLEVBQUU7b0JBQ1QsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFO3dCQUNSLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLENBQUMsRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUU7d0JBQ2pFLE1BQU0sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLHNDQUFzQyxFQUFFO3FCQUNsRjtpQkFDSjthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHNCQUFzQjtnQkFDNUIsV0FBVyxFQUFFLHVDQUF1QztnQkFDcEQsV0FBVyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFO2FBQ2xEO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHdCQUF3QjtnQkFDOUIsV0FBVyxFQUFFLDRGQUE0RjtnQkFDekcsV0FBVyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFO2FBQ2xEO1NBQ0osQ0FBQztJQUNOLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQWdCLEVBQUUsSUFBUzs7UUFDckMsTUFBTSxFQUFFLEdBQUcsU0FBUyxFQUFFLENBQUM7UUFDdkIsUUFBUSxRQUFRLEVBQUUsQ0FBQztZQUNmLEtBQUssYUFBYSxDQUFDLENBQUMsQ0FBQztnQkFDakIsSUFBSSxDQUFDLEVBQUU7b0JBQUUsT0FBTyxXQUFXLEVBQUUsQ0FBQztnQkFDOUIsSUFBSSxDQUFDO29CQUNELElBQUksT0FBTyxDQUFBLE1BQUEsRUFBRSxDQUFDLE9BQU8sMENBQUUsT0FBTyxDQUFBLEtBQUssVUFBVTt3QkFBRSxPQUFPLFdBQVcsRUFBRSxDQUFDO29CQUNwRSw0REFBNEQ7b0JBQzVELHNEQUFzRDtvQkFDdEQsTUFBTSxFQUFFLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLENBQUM7b0JBQ3JELE1BQU0sUUFBUSxHQUFHLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFFBQVEsS0FBSSxTQUFTLENBQUM7b0JBQzdDLElBQUEsMkJBQWMsRUFBQyxNQUFNLEVBQUUsMkJBQTJCLFFBQVEsR0FBRyxDQUFDLENBQUM7b0JBQy9ELE9BQU87d0JBQ0gsT0FBTyxFQUFFLElBQUk7d0JBQ2IsT0FBTyxFQUFFLHNEQUFzRDt3QkFDL0QsSUFBSSxFQUFFLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSx1QkFBdUIsRUFBRTtxQkFDdkQsQ0FBQztnQkFDTixDQUFDO2dCQUFDLE9BQU8sQ0FBTSxFQUFFLENBQUM7b0JBQ2QsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLE1BQUEsQ0FBQyxhQUFELENBQUMsdUJBQUQsQ0FBQyxDQUFFLE9BQU8sbUNBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQzlELENBQUM7WUFDTCxDQUFDO1lBQ0QsS0FBSyxjQUFjLENBQUMsQ0FBQyxDQUFDO2dCQUNsQixJQUFJLENBQUMsRUFBRTtvQkFBRSxPQUFPLFdBQVcsRUFBRSxDQUFDO2dCQUM5QixPQUFPO29CQUNILE9BQU8sRUFBRSxLQUFLO29CQUNkLEtBQUssRUFBRSxpRUFBaUU7b0JBQ3hFLFdBQVcsRUFBRSx1SkFBdUo7aUJBQ3ZLLENBQUM7WUFDTixDQUFDO1lBQ0QsS0FBSyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7Z0JBQ3BCLElBQUksQ0FBQyxFQUFFO29CQUFFLE9BQU8sV0FBVyxFQUFFLENBQUM7Z0JBQzlCLElBQUksQ0FBQztvQkFDRCxJQUFJLE9BQU8sQ0FBQSxNQUFBLEVBQUUsQ0FBQyxPQUFPLDBDQUFFLE9BQU8sQ0FBQSxLQUFLLFVBQVU7d0JBQUUsT0FBTyxXQUFXLEVBQUUsQ0FBQztvQkFDcEUsTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFDO29CQUMzQixNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFFBQVEsQ0FBQSxLQUFLLFFBQVEsSUFBSSxJQUFJLENBQUMsUUFBUTt3QkFDaEUsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQztvQkFDcEMsSUFBSSxDQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxhQUFhLE1BQUssS0FBSyxFQUFFLENBQUM7d0JBQ2hDLE1BQU0sRUFBRSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsQ0FBQzt3QkFDaEUsS0FBSyxDQUFDLElBQUksQ0FBQywwQkFBMEIsUUFBUSxFQUFFLENBQUMsQ0FBQztvQkFDckQsQ0FBQztvQkFDRCx5REFBeUQ7b0JBQ3pELDBEQUEwRDtvQkFDMUQscURBQXFEO29CQUNyRCxNQUFNLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO29CQUN2RCxLQUFLLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUM7b0JBQ3RDLElBQUksVUFBVSxHQUFZLElBQUksQ0FBQztvQkFDL0IsSUFBSSxDQUFDO3dCQUNELFVBQVUsR0FBRyxNQUFNLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO29CQUMxRSxDQUFDO29CQUFDLFdBQU0sQ0FBQzt3QkFDTCxzREFBc0Q7b0JBQzFELENBQUM7b0JBQ0QsSUFBQSwyQkFBYyxFQUFDLE1BQU0sRUFBRSw2QkFBNkIsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ3pFLE9BQU87d0JBQ0gsT0FBTyxFQUFFLElBQUk7d0JBQ2IsT0FBTyxFQUFFLDBEQUEwRDt3QkFDbkUsSUFBSSxFQUFFLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUU7cUJBQ3hDLENBQUM7Z0JBQ04sQ0FBQztnQkFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO29CQUNkLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxNQUFBLENBQUMsYUFBRCxDQUFDLHVCQUFELENBQUMsQ0FBRSxPQUFPLG1DQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUM5RCxDQUFDO1lBQ0wsQ0FBQztZQUNELEtBQUssbUJBQW1CLENBQUMsQ0FBQyxDQUFDO2dCQUN2QixNQUFNLEdBQUcsR0FBRyxJQUFBLDJCQUFjLEdBQUUsQ0FBQztnQkFDN0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsTUFBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxtQ0FBSSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUMvRixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLE1BQU0sQ0FBQSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNqRixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDO2dCQUNwRixNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ3JDLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzdFLENBQUM7WUFDRCxLQUFLLHNCQUFzQixDQUFDLENBQUMsQ0FBQztnQkFDMUIsSUFBSSxDQUFDLEVBQUU7b0JBQUUsT0FBTyxXQUFXLEVBQUUsQ0FBQztnQkFDOUIsSUFBSSxDQUFDO29CQUNELE1BQU0sQ0FBQSxNQUFBLE1BQUEsRUFBRSxDQUFDLE9BQU8sMENBQUUsT0FBTyxtREFBRyxPQUFPLEVBQUUsYUFBYSxDQUFDLENBQUEsQ0FBQztvQkFDcEQsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLHFCQUFxQixFQUFFLENBQUM7Z0JBQzdELENBQUM7Z0JBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztvQkFDZCxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsTUFBQSxDQUFDLGFBQUQsQ0FBQyx1QkFBRCxDQUFDLENBQUUsT0FBTyxtQ0FBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDOUQsQ0FBQztZQUNMLENBQUM7WUFDRCxLQUFLLHdCQUF3QixDQUFDLENBQUMsQ0FBQztnQkFDNUIsT0FBTztvQkFDSCxPQUFPLEVBQUUsSUFBSTtvQkFDYixPQUFPLEVBQUUsNkVBQTZFO29CQUN0RixXQUFXLEVBQUUsaURBQWlEO2lCQUNqRSxDQUFDO1lBQ04sQ0FBQztZQUNEO2dCQUNJLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSwrQkFBK0IsUUFBUSxFQUFFLEVBQUUsQ0FBQztRQUNwRixDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBOUlELGdEQThJQztBQUVELFNBQVMsV0FBVztJQUNoQixPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsK0RBQStELEVBQUUsQ0FBQztBQUN0RyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFBoYXNlIDUg4oCUIEVkaXRvciBydW50aW1lIHRvb2xzLlxyXG4gKlxyXG4gKiBTdXJmYWNlIGEgc21hbGwgYnV0IHVzZWZ1bCBzZXQgb2YgZWRpdG9yLXJ1bnRpbWUgb3BlcmF0aW9ucyBhcyBNQ1AgdG9vbHM6XHJcbiAqICAgLSBydW5fcHJldmlldyAvIHJlbG9hZF9wcmV2aWV3IOKAlCB1c2UgdGhlIHB1YmxpYyBtZXNzYWdlcyBjb250cmlidXRlZCBieVxuICogICAgIENvY29zIENyZWF0b3IncyBidWlsdC1pbiBgcHJldmlld2AgcGFja2FnZS5cbiAqICAgLSBzdG9wX3ByZXZpZXcg4oCUIHJlcG9ydCB0aGUgZWRpdG9yIGxpbWl0YXRpb24gZXhwbGljaXRseSAoMy44LnggZXhwb3Nlc1xuICogICAgIG5vIHN0b3AgbWVzc2FnZTsgdGhlIHByZXZpZXcgSFRUUCBzZXJ2aWNlIGJlbG9uZ3MgdG8gdGhlIGVkaXRvcikuXG4gKiAgIC0gdGFpbF9ydW50aW1lX2xvZ3Mg4oCUIHJlYWQgdGhlIGluLXByb2Nlc3MgbG9nIHJpbmcgYnVmZmVyIG1haW50YWluZWQgYnlcclxuICogICAgIHtAbGluayBwdXNoUnVudGltZUxvZ30gKGFsc28gZXhwb3NlZCBhcyB0aGUgYHJ1bnRpbWU6Ly9sb2dzYCByZXNvdXJjZSkuXHJcbiAqICAgLSByZWxvYWRfY3VycmVudF9zY2VuZSDigJQgc29mdCByZWxvYWQgdGhlIGFjdGl2ZSBzY2VuZS5cclxuICogICAtIHN1YnNjcmliZV9ydW50aW1lX2xvZ3Mg4oCUIGNvbnZlbmllbmNlIHdyYXBwZXIgdGhhdCBhc2tzIHRoZSBjbGllbnQgdG9cclxuICogICAgIHN1YnNjcmliZSB0byBgcnVudGltZTovL2xvZ3NgICh0aGUgTUNQIHN0YW5kYXJkIHdheSB0byBsaXZlLXN0cmVhbSBsb2dzKS5cclxuICpcclxuICogVGhlc2UgY2FsbHMgYWxsIGRlbGVnYXRlIHRvIHRoZSBlZGl0b3IgYEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoLi4uKWAgQVBJO1xyXG4gKiB3aGVuIHJ1bm5pbmcgb3V0c2lkZSB0aGUgZWRpdG9yIGhvc3QgKGUuZy4gc3RkaW8gYmluYXJ5IGluIHN0YW5kYWxvbmUgbW9kZSlcclxuICogdGhleSBkZWdyYWRlIHdpdGggYHN1Y2Nlc3M6IGZhbHNlYCBpbnN0ZWFkIG9mIHRocm93aW5nLlxyXG4gKi9cclxuXHJcbmltcG9ydCB7IFRvb2xEZWZpbml0aW9uLCBUb29sRXhlY3V0b3IsIFRvb2xSZXNwb25zZSB9IGZyb20gJy4uL3R5cGVzJztcclxuaW1wb3J0IHsgZ2V0UnVudGltZUxvZ3MsIHB1c2hSdW50aW1lTG9nIH0gZnJvbSAnLi4vcHJvdG9jb2wvcmVnaXN0cmllcyc7XHJcblxyXG5cclxuZnVuY3Rpb24gZ2V0RWRpdG9yKCk6IGFueSB8IG51bGwge1xyXG4gICAgY29uc3QgZzogYW55ID0gZ2xvYmFsVGhpcyBhcyBhbnk7XHJcbiAgICByZXR1cm4gZy5FZGl0b3IgJiYgdHlwZW9mIGcuRWRpdG9yID09PSAnb2JqZWN0JyA/IGcuRWRpdG9yIDogbnVsbDtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIEVkaXRvclJ1bnRpbWVUb29scyBpbXBsZW1lbnRzIFRvb2xFeGVjdXRvciB7XHJcbiAgICBnZXRUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcclxuICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAncnVuX3ByZXZpZXcnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTdGFydCB0aGUgZWRpdG9yIHByZXZpZXcvcnVudGltZSBzZXJ2ZXIuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwbGF0Zm9ybTogeyB0eXBlOiAnc3RyaW5nJywgZGVzY3JpcHRpb246ICdPcHRpb25hbCBwcmV2aWV3IHBsYXRmb3JtIChicm93c2VyLCBzaW11bGF0b3IpLicgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdzdG9wX3ByZXZpZXcnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVwb3J0IHdoZXRoZXIgdGhlIGVkaXRvciBleHBvc2VzIHByZXZpZXctc3RvcCBjb250cm9sIChDb2NvcyAzLjgueCBkb2VzIG5vdCkuJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogeyB0eXBlOiAnb2JqZWN0JywgcHJvcGVydGllczoge30gfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAncmVsb2FkX3ByZXZpZXcnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVmcmVzaCBhc3NldHMsIHRoZW4gcmVsb2FkIGNvbm5lY3RlZCBwcmV2aWV3IHRhcmdldHMgdGhyb3VnaCBDb2NvcyBDcmVhdG9yIDMuOC54IHB1YmxpYyBwcmV2aWV3IG1lc3NhZ2VzLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZnJlc2hBc3NldHM6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiB0cnVlLCBkZXNjcmlwdGlvbjogJ1JlZnJlc2gvaW1wb3J0IGFzc2V0cyBiZWZvcmUgcmVsb2FkaW5nIHByZXZpZXcuJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXRVcmw6IHsgdHlwZTogJ3N0cmluZycsIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cycsIGRlc2NyaXB0aW9uOiAnQXNzZXQgREIgVVJMIHRvIHJlZnJlc2guJyB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAndGFpbF9ydW50aW1lX2xvZ3MnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZWFkIHRoZSBpbi1wcm9jZXNzIGVkaXRvciBydW50aW1lIGxvZyByaW5nIGJ1ZmZlciAobGFzdCB+MjAwIGxpbmVzKS4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxpbWl0OiB7IHR5cGU6ICdpbnRlZ2VyJywgbWluaW11bTogMSwgbWF4aW11bTogMjAwLCBkZWZhdWx0OiA1MCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWx0ZXI6IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnU3Vic3RyaW5nIGZpbHRlciAoY2FzZS1pbnNlbnNpdGl2ZSkuJyB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAncmVsb2FkX2N1cnJlbnRfc2NlbmUnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTb2Z0LXJlbG9hZCB0aGUgY3VycmVudGx5IG9wZW4gc2NlbmUuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdzdWJzY3JpYmVfcnVudGltZV9sb2dzJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSGludCB0aGF0IHRoZSBjbGllbnQgc2hvdWxkIGNhbGwgcmVzb3VyY2VzL3N1YnNjcmliZSBvbiBydW50aW1lOi8vbG9ncyBmb3IgbGl2ZSBzdHJlYW1pbmcuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGV4ZWN1dGUodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICBjb25zdCBlZCA9IGdldEVkaXRvcigpO1xyXG4gICAgICAgIHN3aXRjaCAodG9vbE5hbWUpIHtcclxuICAgICAgICAgICAgY2FzZSAncnVuX3ByZXZpZXcnOiB7XG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIHVuYXZhaWxhYmxlKCk7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBlZC5NZXNzYWdlPy5yZXF1ZXN0ICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gdW5hdmFpbGFibGUoKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gQ29jb3MgQ3JlYXRvciAzLjguOCBjb250cmlidXRlcyBgb3Blbi10ZXJtaW5hbGA7IHRoZXJlIGlzXG4gICAgICAgICAgICAgICAgICAgIC8vIG5vIGBzdGFydGAgbWVzc2FnZSBpbiB0aGUgYnVpbHQtaW4gcHJldmlldyBwYWNrYWdlLlxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBlZC5NZXNzYWdlLnJlcXVlc3QoJ3ByZXZpZXcnLCAnb3Blbi10ZXJtaW5hbCcpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwbGF0Zm9ybSA9IGFyZ3M/LnBsYXRmb3JtIHx8ICdicm93c2VyJztcbiAgICAgICAgICAgICAgICAgICAgcHVzaFJ1bnRpbWVMb2coJ2luZm8nLCBgcHJldmlldyBvcGVuIHJlcXVlc3RlZCAoJHtwbGF0Zm9ybX0pYCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ3ByZXZpZXcgb3BlbiByZXF1ZXN0ZWQgdGhyb3VnaCBwcmV2aWV3Om9wZW4tdGVybWluYWwnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBwbGF0Zm9ybSwgbWVzc2FnZTogJ3ByZXZpZXc6b3Blbi10ZXJtaW5hbCcgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGU/Lm1lc3NhZ2UgPz8gU3RyaW5nKGUpIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSAnc3RvcF9wcmV2aWV3Jzoge1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiB1bmF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogJ0NvY29zIENyZWF0b3IgMy44LnggZG9lcyBub3QgY29udHJpYnV0ZSBhIHByZXZpZXcgc3RvcCBtZXNzYWdlLicsXG4gICAgICAgICAgICAgICAgICAgIGluc3RydWN0aW9uOiAnQ2xvc2UgY29ubmVjdGVkIHByZXZpZXcgdGFyZ2V0cywgb3IgcmVzdGFydCB0aGUgZXhhY3QgcHJvamVjdCBlZGl0b3IgdGhyb3VnaCBpdHMgZXh0ZXJuYWwgc3VwZXJ2aXNvciB3aGVuIGEgZnVsbCBwcmV2aWV3LXNlcnZpY2UgcmVzdGFydCBpcyByZXF1aXJlZC4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJ3JlbG9hZF9wcmV2aWV3Jzoge1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiB1bmF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZWQuTWVzc2FnZT8ucmVxdWVzdCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHVuYXZhaWxhYmxlKCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldFVybCA9IHR5cGVvZiBhcmdzPy5hc3NldFVybCA9PT0gJ3N0cmluZycgJiYgYXJncy5hc3NldFVybFxuICAgICAgICAgICAgICAgICAgICAgICAgPyBhcmdzLmFzc2V0VXJsIDogJ2RiOi8vYXNzZXRzJztcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFyZ3M/LnJlZnJlc2hBc3NldHMgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBlZC5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlZnJlc2gtYXNzZXQnLCBhc3NldFVybCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGVwcy5wdXNoKGBhc3NldC1kYjpyZWZyZXNoLWFzc2V0ICR7YXNzZXRVcmx9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gYHJlbG9hZC10ZXJtaW5hbGAgaXMgdGhlIGV4YWN0IG1lc3NhZ2UgZGVjbGFyZWQgYnkgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIGJ1aWx0LWluIHByZXZpZXcgcGFja2FnZSBpbiBDcmVhdG9yIDMuOC44LiBUaGUgcHJldmlvdXNcbiAgICAgICAgICAgICAgICAgICAgLy8gZ3Vlc3NlZCBgcmVsb2FkYCBtZXNzYWdlIGFsd2F5cyBmYWlsZWQgYXQgcnVudGltZS5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZWQuTWVzc2FnZS5yZXF1ZXN0KCdwcmV2aWV3JywgJ3JlbG9hZC10ZXJtaW5hbCcpO1xuICAgICAgICAgICAgICAgICAgICBzdGVwcy5wdXNoKCdwcmV2aWV3OnJlbG9hZC10ZXJtaW5hbCcpO1xuICAgICAgICAgICAgICAgICAgICBsZXQgcHJldmlld1VybDogdW5rbm93biA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwcmV2aWV3VXJsID0gYXdhaXQgZWQuTWVzc2FnZS5yZXF1ZXN0KCdwcmV2aWV3JywgJ3F1ZXJ5LXByZXZpZXctdXJsJyk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVsb2FkIGlzIGF1dGhvcml0YXRpdmU7IFVSTCBkaXNjb3ZlcnkgaXMgb3B0aW9uYWwuXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcHVzaFJ1bnRpbWVMb2coJ2luZm8nLCBgcHJldmlldyByZWxvYWQgcmVxdWVzdGVkICgke3N0ZXBzLmpvaW4oJywgJyl9KWApO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdwcmV2aWV3IHJlbG9hZCByZXF1ZXN0ZWQgdGhyb3VnaCBwcmV2aWV3OnJlbG9hZC10ZXJtaW5hbCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGFzc2V0VXJsLCBwcmV2aWV3VXJsLCBzdGVwcyB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhc2UgJ3RhaWxfcnVudGltZV9sb2dzJzoge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYnVmID0gZ2V0UnVudGltZUxvZ3MoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oMjAwLCBNYXRoLm1heCgxLCBOdW1iZXIucGFyc2VJbnQoU3RyaW5nKGFyZ3M/LmxpbWl0ID8/IDUwKSwgMTApIHx8IDUwKSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmaWx0ZXIgPSB0eXBlb2YgYXJncz8uZmlsdGVyID09PSAnc3RyaW5nJyA/IGFyZ3MuZmlsdGVyLnRvTG93ZXJDYXNlKCkgOiAnJztcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyID8gYnVmLmZpbHRlcigobCkgPT4gbC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGZpbHRlcikpIDogYnVmO1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2xpY2UgPSBmaWx0ZXJlZC5zbGljZSgtbGltaXQpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgZGF0YTogeyBsaW5lczogc2xpY2UsIHRvdGFsOiBmaWx0ZXJlZC5sZW5ndGggfSB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhc2UgJ3JlbG9hZF9jdXJyZW50X3NjZW5lJzoge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIHVuYXZhaWxhYmxlKCk7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGVkLk1lc3NhZ2U/LnJlcXVlc3Q/Lignc2NlbmUnLCAnc29mdC1yZWxvYWQnKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtZXNzYWdlOiAnc2NlbmUgc29mdC1yZWxvYWRlZCcgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjYXNlICdzdWJzY3JpYmVfcnVudGltZV9sb2dzJzoge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdDYWxsIHJlc291cmNlcy9zdWJzY3JpYmUgd2l0aCB1cmk9XCJydW50aW1lOi8vbG9nc1wiIHRvIHN0cmVhbSBuZXcgbG9nIGxpbmVzLicsXHJcbiAgICAgICAgICAgICAgICAgICAgaW5zdHJ1Y3Rpb246ICdyZXNvdXJjZXMvc3Vic2NyaWJlIHsgXCJ1cmlcIjogXCJydW50aW1lOi8vbG9nc1wiIH0nXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBVbmtub3duIGVkaXRvclJ1bnRpbWUgdG9vbDogJHt0b29sTmFtZX1gIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiB1bmF2YWlsYWJsZSgpOiBUb29sUmVzcG9uc2Uge1xyXG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnRWRpdG9yIHJ1bnRpbWUgbm90IGF2YWlsYWJsZSAocnVubmluZyBvdXRzaWRlIENvY29zIENyZWF0b3IpLicgfTtcclxufVxyXG4iXX0=