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

import { ToolDefinition, ToolExecutor, ToolResponse } from '../types';
import { getRuntimeLogs, pushRuntimeLog } from '../protocol/registries';


function getEditor(): any | null {
    const g: any = globalThis as any;
    return g.Editor && typeof g.Editor === 'object' ? g.Editor : null;
}

export class EditorRuntimeTools implements ToolExecutor {
    getTools(): ToolDefinition[] {
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

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        const ed = getEditor();
        switch (toolName) {
            case 'run_preview': {
                if (!ed) return unavailable();
                try {
                    await ed.Message?.request?.('preview', 'start', { platform: args?.platform || 'browser' });
                    pushRuntimeLog('info', `preview started (${args?.platform || 'browser'})`);
                    return { success: true, message: 'preview started' };
                } catch (e: any) {
                    return { success: false, error: e?.message ?? String(e) };
                }
            }
            case 'stop_preview': {
                if (!ed) return unavailable();
                try {
                    await ed.Message?.request?.('preview', 'stop');
                    pushRuntimeLog('info', 'preview stopped');
                    return { success: true, message: 'preview stopped' };
                } catch (e: any) {
                    return { success: false, error: e?.message ?? String(e) };
                }
            }
            case 'reload_preview': {
                if (!ed) return unavailable();
                try {
                    await ed.Message?.request?.('preview', 'reload');
                    return { success: true, message: 'preview reloaded' };
                } catch (e: any) {
                    return { success: false, error: e?.message ?? String(e) };
                }
            }
            case 'tail_runtime_logs': {
                const buf = getRuntimeLogs();
                const limit = Math.min(200, Math.max(1, Number.parseInt(String(args?.limit ?? 50), 10) || 50));
                const filter = typeof args?.filter === 'string' ? args.filter.toLowerCase() : '';
                const filtered = filter ? buf.filter((l) => l.toLowerCase().includes(filter)) : buf;
                const slice = filtered.slice(-limit);
                return { success: true, data: { lines: slice, total: filtered.length } };
            }
            case 'reload_current_scene': {
                if (!ed) return unavailable();
                try {
                    await ed.Message?.request?.('scene', 'soft-reload');
                    return { success: true, message: 'scene soft-reloaded' };
                } catch (e: any) {
                    return { success: false, error: e?.message ?? String(e) };
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

function unavailable(): ToolResponse {
    return { success: false, error: 'Editor runtime not available (running outside Cocos Creator).' };
}
