"use strict";
/**
 * Phase 5 — Editor runtime tools.
 *
 * Surface a small but useful set of editor-runtime operations as MCP tools:
 *   - run_preview / stop_preview / reload_preview — control the preview server.
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
                description: 'Stop the editor preview/runtime server.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'reload_preview',
                description: 'Reload the running preview without stopping it.',
                inputSchema: { type: 'object', properties: {} }
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const ed = getEditor();
        switch (toolName) {
            case 'run_preview': {
                if (!ed)
                    return unavailable();
                try {
                    await ((_b = (_a = ed.Message) === null || _a === void 0 ? void 0 : _a.request) === null || _b === void 0 ? void 0 : _b.call(_a, 'preview', 'start', { platform: (args === null || args === void 0 ? void 0 : args.platform) || 'browser' }));
                    (0, registries_1.pushRuntimeLog)('info', `preview started (${(args === null || args === void 0 ? void 0 : args.platform) || 'browser'})`);
                    return { success: true, message: 'preview started' };
                }
                catch (e) {
                    return { success: false, error: (_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : String(e) };
                }
            }
            case 'stop_preview': {
                if (!ed)
                    return unavailable();
                try {
                    await ((_e = (_d = ed.Message) === null || _d === void 0 ? void 0 : _d.request) === null || _e === void 0 ? void 0 : _e.call(_d, 'preview', 'stop'));
                    (0, registries_1.pushRuntimeLog)('info', 'preview stopped');
                    return { success: true, message: 'preview stopped' };
                }
                catch (e) {
                    return { success: false, error: (_f = e === null || e === void 0 ? void 0 : e.message) !== null && _f !== void 0 ? _f : String(e) };
                }
            }
            case 'reload_preview': {
                if (!ed)
                    return unavailable();
                try {
                    await ((_h = (_g = ed.Message) === null || _g === void 0 ? void 0 : _g.request) === null || _h === void 0 ? void 0 : _h.call(_g, 'preview', 'reload'));
                    return { success: true, message: 'preview reloaded' };
                }
                catch (e) {
                    return { success: false, error: (_j = e === null || e === void 0 ? void 0 : e.message) !== null && _j !== void 0 ? _j : String(e) };
                }
            }
            case 'tail_runtime_logs': {
                const buf = (0, registries_1.getRuntimeLogs)();
                const limit = Math.min(200, Math.max(1, Number.parseInt(String((_k = args === null || args === void 0 ? void 0 : args.limit) !== null && _k !== void 0 ? _k : 50), 10) || 50));
                const filter = typeof (args === null || args === void 0 ? void 0 : args.filter) === 'string' ? args.filter.toLowerCase() : '';
                const filtered = filter ? buf.filter((l) => l.toLowerCase().includes(filter)) : buf;
                const slice = filtered.slice(-limit);
                return { success: true, data: { lines: slice, total: filtered.length } };
            }
            case 'reload_current_scene': {
                if (!ed)
                    return unavailable();
                try {
                    await ((_m = (_l = ed.Message) === null || _l === void 0 ? void 0 : _l.request) === null || _m === void 0 ? void 0 : _m.call(_l, 'scene', 'soft-reload'));
                    return { success: true, message: 'scene soft-reloaded' };
                }
                catch (e) {
                    return { success: false, error: (_o = e === null || e === void 0 ? void 0 : e.message) !== null && _o !== void 0 ? _o : String(e) };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLXJ1bnRpbWUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZWRpdG9yLXJ1bnRpbWUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7OztHQWNHOzs7QUFHSCx1REFBd0U7QUFHeEUsU0FBUyxTQUFTO0lBQ2QsTUFBTSxDQUFDLEdBQVEsVUFBaUIsQ0FBQztJQUNqQyxPQUFPLENBQUMsQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsTUFBTSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQ3RFLENBQUM7QUFFRCxNQUFhLGtCQUFrQjtJQUMzQixRQUFRO1FBQ0osT0FBTztZQUNIO2dCQUNJLElBQUksRUFBRSxhQUFhO2dCQUNuQixXQUFXLEVBQUUsMENBQTBDO2dCQUN2RCxXQUFXLEVBQUU7b0JBQ1QsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFO3dCQUNSLFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLGlEQUFpRCxFQUFFO3FCQUMvRjtpQkFDSjthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLGNBQWM7Z0JBQ3BCLFdBQVcsRUFBRSx5Q0FBeUM7Z0JBQ3RELFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTthQUNsRDtZQUNEO2dCQUNJLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLFdBQVcsRUFBRSxpREFBaUQ7Z0JBQzlELFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTthQUNsRDtZQUNEO2dCQUNJLElBQUksRUFBRSxtQkFBbUI7Z0JBQ3pCLFdBQVcsRUFBRSx1RUFBdUU7Z0JBQ3BGLFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUs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S0FBSyxFQUFFLEtBQUssRUFBRSwrREFBK0QsRUFBRSxDQUFDO0FBQ3RHLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFBoYXNlIDUg4oCUIEVkaXRvciBydW50aW1lIHRvb2xzLlxuICpcbiAqIFN1cmZhY2UgYSBzbWFsbCBidXQgdXNlZnVsIHNldCBvZiBlZGl0b3ItcnVudGltZSBvcGVyYXRpb25zIGFzIE1DUCB0b29sczpcbiAqICAgLSBydW5fcHJldmlldyAvIHN0b3BfcHJldmlldyAvIHJlbG9hZF9wcmV2aWV3IOKAlCBjb250cm9sIHRoZSBwcmV2aWV3IHNlcnZlci5cbiAqICAgLSB0YWlsX3J1bnRpbWVfbG9ncyDigJQgcmVhZCB0aGUgaW4tcHJvY2VzcyBsb2cgcmluZyBidWZmZXIgbWFpbnRhaW5lZCBieVxuICogICAgIHtAbGluayBwdXNoUnVudGltZUxvZ30gKGFsc28gZXhwb3NlZCBhcyB0aGUgYHJ1bnRpbWU6Ly9sb2dzYCByZXNvdXJjZSkuXG4gKiAgIC0gcmVsb2FkX2N1cnJlbnRfc2NlbmUg4oCUIHNvZnQgcmVsb2FkIHRoZSBhY3RpdmUgc2NlbmUuXG4gKiAgIC0gc3Vic2NyaWJlX3J1bnRpbWVfbG9ncyDigJQgY29udmVuaWVuY2Ugd3JhcHBlciB0aGF0IGFza3MgdGhlIGNsaWVudCB0b1xuICogICAgIHN1YnNjcmliZSB0byBgcnVudGltZTovL2xvZ3NgICh0aGUgTUNQIHN0YW5kYXJkIHdheSB0byBsaXZlLXN0cmVhbSBsb2dzKS5cbiAqXG4gKiBUaGVzZSBjYWxscyBhbGwgZGVsZWdhdGUgdG8gdGhlIGVkaXRvciBgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCguLi4pYCBBUEk7XG4gKiB3aGVuIHJ1bm5pbmcgb3V0c2lkZSB0aGUgZWRpdG9yIGhvc3QgKGUuZy4gc3RkaW8gYmluYXJ5IGluIHN0YW5kYWxvbmUgbW9kZSlcbiAqIHRoZXkgZGVncmFkZSB3aXRoIGBzdWNjZXNzOiBmYWxzZWAgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuXG5pbXBvcnQgeyBUb29sRGVmaW5pdGlvbiwgVG9vbEV4ZWN1dG9yLCBUb29sUmVzcG9uc2UgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBnZXRSdW50aW1lTG9ncywgcHVzaFJ1bnRpbWVMb2cgfSBmcm9tICcuLi9wcm90b2NvbC9yZWdpc3RyaWVzJztcblxuXG5mdW5jdGlvbiBnZXRFZGl0b3IoKTogYW55IHwgbnVsbCB7XG4gICAgY29uc3QgZzogYW55ID0gZ2xvYmFsVGhpcyBhcyBhbnk7XG4gICAgcmV0dXJuIGcuRWRpdG9yICYmIHR5cGVvZiBnLkVkaXRvciA9PT0gJ29iamVjdCcgPyBnLkVkaXRvciA6IG51bGw7XG59XG5cbmV4cG9ydCBjbGFzcyBFZGl0b3JSdW50aW1lVG9vbHMgaW1wbGVtZW50cyBUb29sRXhlY3V0b3Ige1xuICAgIGdldFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdydW5fcHJldmlldycsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTdGFydCB0aGUgZWRpdG9yIHByZXZpZXcvcnVudGltZSBzZXJ2ZXIuJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGxhdGZvcm06IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnT3B0aW9uYWwgcHJldmlldyBwbGF0Zm9ybSAoYnJvd3Nlciwgc2ltdWxhdG9yKS4nIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3N0b3BfcHJldmlldycsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTdG9wIHRoZSBlZGl0b3IgcHJldmlldy9ydW50aW1lIHNlcnZlci4nLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdyZWxvYWRfcHJldmlldycsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZWxvYWQgdGhlIHJ1bm5pbmcgcHJldmlldyB3aXRob3V0IHN0b3BwaW5nIGl0LicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogJ29iamVjdCcsIHByb3BlcnRpZXM6IHt9IH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3RhaWxfcnVudGltZV9sb2dzJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlYWQgdGhlIGluLXByb2Nlc3MgZWRpdG9yIHJ1bnRpbWUgbG9nIHJpbmcgYnVmZmVyIChsYXN0IH4yMDAgbGluZXMpLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxpbWl0OiB7IHR5cGU6ICdpbnRlZ2VyJywgbWluaW11bTogMSwgbWF4aW11bTogMjAwLCBkZWZhdWx0OiA1MCB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsdGVyOiB7IHR5cGU6ICdzdHJpbmcnLCBkZXNjcmlwdGlvbjogJ1N1YnN0cmluZyBmaWx0ZXIgKGNhc2UtaW5zZW5zaXRpdmUpLicgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAncmVsb2FkX2N1cnJlbnRfc2NlbmUnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU29mdC1yZWxvYWQgdGhlIGN1cnJlbnRseSBvcGVuIHNjZW5lLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogJ29iamVjdCcsIHByb3BlcnRpZXM6IHt9IH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3N1YnNjcmliZV9ydW50aW1lX2xvZ3MnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSGludCB0aGF0IHRoZSBjbGllbnQgc2hvdWxkIGNhbGwgcmVzb3VyY2VzL3N1YnNjcmliZSBvbiBydW50aW1lOi8vbG9ncyBmb3IgbGl2ZSBzdHJlYW1pbmcuJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogeyB0eXBlOiAnb2JqZWN0JywgcHJvcGVydGllczoge30gfVxuICAgICAgICAgICAgfVxuICAgICAgICBdO1xuICAgIH1cblxuICAgIGFzeW5jIGV4ZWN1dGUodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgY29uc3QgZWQgPSBnZXRFZGl0b3IoKTtcbiAgICAgICAgc3dpdGNoICh0b29sTmFtZSkge1xuICAgICAgICAgICAgY2FzZSAncnVuX3ByZXZpZXcnOiB7XG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIHVuYXZhaWxhYmxlKCk7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZWQuTWVzc2FnZT8ucmVxdWVzdD8uKCdwcmV2aWV3JywgJ3N0YXJ0JywgeyBwbGF0Zm9ybTogYXJncz8ucGxhdGZvcm0gfHwgJ2Jyb3dzZXInIH0pO1xuICAgICAgICAgICAgICAgICAgICBwdXNoUnVudGltZUxvZygnaW5mbycsIGBwcmV2aWV3IHN0YXJ0ZWQgKCR7YXJncz8ucGxhdGZvcm0gfHwgJ2Jyb3dzZXInfSlgKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogJ3ByZXZpZXcgc3RhcnRlZCcgfTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJ3N0b3BfcHJldmlldyc6IHtcbiAgICAgICAgICAgICAgICBpZiAoIWVkKSByZXR1cm4gdW5hdmFpbGFibGUoKTtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBlZC5NZXNzYWdlPy5yZXF1ZXN0Py4oJ3ByZXZpZXcnLCAnc3RvcCcpO1xuICAgICAgICAgICAgICAgICAgICBwdXNoUnVudGltZUxvZygnaW5mbycsICdwcmV2aWV3IHN0b3BwZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogJ3ByZXZpZXcgc3RvcHBlZCcgfTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJ3JlbG9hZF9wcmV2aWV3Jzoge1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiB1bmF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGVkLk1lc3NhZ2U/LnJlcXVlc3Q/LigncHJldmlldycsICdyZWxvYWQnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogJ3ByZXZpZXcgcmVsb2FkZWQnIH07XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlICd0YWlsX3J1bnRpbWVfbG9ncyc6IHtcbiAgICAgICAgICAgICAgICBjb25zdCBidWYgPSBnZXRSdW50aW1lTG9ncygpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oMjAwLCBNYXRoLm1heCgxLCBOdW1iZXIucGFyc2VJbnQoU3RyaW5nKGFyZ3M/LmxpbWl0ID8/IDUwKSwgMTApIHx8IDUwKSk7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsdGVyID0gdHlwZW9mIGFyZ3M/LmZpbHRlciA9PT0gJ3N0cmluZycgPyBhcmdzLmZpbHRlci50b0xvd2VyQ2FzZSgpIDogJyc7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXIgPyBidWYuZmlsdGVyKChsKSA9PiBsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoZmlsdGVyKSkgOiBidWY7XG4gICAgICAgICAgICAgICAgY29uc3Qgc2xpY2UgPSBmaWx0ZXJlZC5zbGljZSgtbGltaXQpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IHsgbGluZXM6IHNsaWNlLCB0b3RhbDogZmlsdGVyZWQubGVuZ3RoIH0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJ3JlbG9hZF9jdXJyZW50X3NjZW5lJzoge1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiB1bmF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGVkLk1lc3NhZ2U/LnJlcXVlc3Q/Lignc2NlbmUnLCAnc29mdC1yZWxvYWQnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogJ3NjZW5lIHNvZnQtcmVsb2FkZWQnIH07XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlICdzdWJzY3JpYmVfcnVudGltZV9sb2dzJzoge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdDYWxsIHJlc291cmNlcy9zdWJzY3JpYmUgd2l0aCB1cmk9XCJydW50aW1lOi8vbG9nc1wiIHRvIHN0cmVhbSBuZXcgbG9nIGxpbmVzLicsXG4gICAgICAgICAgICAgICAgICAgIGluc3RydWN0aW9uOiAncmVzb3VyY2VzL3N1YnNjcmliZSB7IFwidXJpXCI6IFwicnVudGltZTovL2xvZ3NcIiB9J1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFVua25vd24gZWRpdG9yUnVudGltZSB0b29sOiAke3Rvb2xOYW1lfWAgfTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gdW5hdmFpbGFibGUoKTogVG9vbFJlc3BvbnNlIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdFZGl0b3IgcnVudGltZSBub3QgYXZhaWxhYmxlIChydW5uaW5nIG91dHNpZGUgQ29jb3MgQ3JlYXRvcikuJyB9O1xufVxuIl19