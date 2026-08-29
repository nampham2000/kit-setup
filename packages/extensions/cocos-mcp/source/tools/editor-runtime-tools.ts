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

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        const ed = getEditor();
        switch (toolName) {
            case 'run_preview': {
                if (!ed) return unavailable();
                try {
                    if (typeof ed.Message?.request !== 'function') return unavailable();
                    // Cocos Creator 3.8.8 contributes `open-terminal`; there is
                    // no `start` message in the built-in preview package.
                    await ed.Message.request('preview', 'open-terminal');
                    const platform = args?.platform || 'browser';
                    pushRuntimeLog('info', `preview open requested (${platform})`);
                    return {
                        success: true,
                        message: 'preview open requested through preview:open-terminal',
                        data: { platform, message: 'preview:open-terminal' }
                    };
                } catch (e: any) {
                    return { success: false, error: e?.message ?? String(e) };
                }
            }
            case 'stop_preview': {
                if (!ed) return unavailable();
                return {
                    success: false,
                    error: 'Cocos Creator 3.8.x does not contribute a preview stop message.',
                    instruction: 'Close connected preview targets, or restart the exact project editor through its external supervisor when a full preview-service restart is required.'
                };
            }
            case 'reload_preview': {
                if (!ed) return unavailable();
                try {
                    if (typeof ed.Message?.request !== 'function') return unavailable();
                    const steps: string[] = [];
                    const assetUrl = typeof args?.assetUrl === 'string' && args.assetUrl
                        ? args.assetUrl : 'db://assets';
                    if (args?.refreshAssets !== false) {
                        await ed.Message.request('asset-db', 'refresh-asset', assetUrl);
                        steps.push(`asset-db:refresh-asset ${assetUrl}`);
                    }
                    // `reload-terminal` is the exact message declared by the
                    // built-in preview package in Creator 3.8.8. The previous
                    // guessed `reload` message always failed at runtime.
                    await ed.Message.request('preview', 'reload-terminal');
                    steps.push('preview:reload-terminal');
                    let previewUrl: unknown = null;
                    try {
                        previewUrl = await ed.Message.request('preview', 'query-preview-url');
                    } catch {
                        // Reload is authoritative; URL discovery is optional.
                    }
                    pushRuntimeLog('info', `preview reload requested (${steps.join(', ')})`);
                    return {
                        success: true,
                        message: 'preview reload requested through preview:reload-terminal',
                        data: { assetUrl, previewUrl, steps }
                    };
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
