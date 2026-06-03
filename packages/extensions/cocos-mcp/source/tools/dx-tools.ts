/**
 * Phase 6 — Developer-experience tools.
 *
 * These tools live alongside the editor-driven categories but operate on the
 * MCP server itself, giving an LLM (or a curious developer) introspection
 * about what the server can do without having to enumerate every category.
 *
 *   - dx_search_tools         — substring search across registered tools.
 *   - dx_get_capabilities     — returns the capabilities advertised at
 *                               `initialize` time so a client can branch on
 *                               which optional methods exist.
 *   - dx_server_info          — server name, version, uptime, session count.
 *   - dx_describe_tool        — full schema + annotations for a single tool.
 *
 * The actual tool/registry lookups happen via the {@link ToolDirectoryProvider}
 * the server passes in at construction time, so we don't depend on the
 * editor host.
 */

import { ToolDefinition, ToolExecutor, ToolResponse } from '../types';

export interface ToolDirectoryProvider {
    listTools(): ToolDefinition[];
    getServerCapabilities(): Record<string, any>;
    getServerInfo(): { name: string; version: string; uptimeMs: number; sessions: number; port: number };
}

export class DXTools implements ToolExecutor {
    private directory: ToolDirectoryProvider;

    constructor(directory: ToolDirectoryProvider) {
        this.directory = directory;
    }

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'search_tools',
                description: 'Substring search across the registered tool list (name + description).',
                inputSchema: {
                    type: 'object',
                    required: ['query'],
                    properties: {
                        query: { type: 'string', description: 'Case-insensitive substring.' },
                        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
                    }
                }
            },
            {
                name: 'get_capabilities',
                description: 'Return the MCP capabilities the server advertises at initialize time.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'server_info',
                description: 'Return server name, version, uptime and active session count.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'describe_tool',
                description: 'Return the full schema + annotations for a single tool by fully-qualified name.',
                inputSchema: {
                    type: 'object',
                    required: ['name'],
                    properties: { name: { type: 'string' } }
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'search_tools': {
                const q = String(args?.query ?? '').toLowerCase();
                if (!q) return { success: false, error: 'query is required' };
                const limit = Math.min(200, Math.max(1, Number.parseInt(String(args?.limit ?? 50), 10) || 50));
                const all = this.directory.listTools();
                const matches = all.filter((t) =>
                    t.name.toLowerCase().includes(q) ||
                    (typeof t.description === 'string' && t.description.toLowerCase().includes(q))
                );
                return {
                    success: true,
                    data: {
                        total: matches.length,
                        tools: matches.slice(0, limit).map((t) => ({ name: t.name, description: t.description }))
                    }
                };
            }
            case 'get_capabilities': {
                return { success: true, data: this.directory.getServerCapabilities() };
            }
            case 'server_info': {
                return { success: true, data: this.directory.getServerInfo() };
            }
            case 'describe_tool': {
                const name = String(args?.name ?? '');
                const tool = this.directory.listTools().find((t) => t.name === name);
                if (!tool) return { success: false, error: `Tool not found: ${name}` };
                return { success: true, data: tool };
            }
            default:
                return { success: false, error: `Unknown dx tool: ${toolName}` };
        }
    }
}
