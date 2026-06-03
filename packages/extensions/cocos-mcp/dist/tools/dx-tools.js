"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DXTools = void 0;
class DXTools {
    constructor(directory) {
        this.directory = directory;
    }
    getTools() {
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
    async execute(toolName, args) {
        var _a, _b, _c;
        switch (toolName) {
            case 'search_tools': {
                const q = String((_a = args === null || args === void 0 ? void 0 : args.query) !== null && _a !== void 0 ? _a : '').toLowerCase();
                if (!q)
                    return { success: false, error: 'query is required' };
                const limit = Math.min(200, Math.max(1, Number.parseInt(String((_b = args === null || args === void 0 ? void 0 : args.limit) !== null && _b !== void 0 ? _b : 50), 10) || 50));
                const all = this.directory.listTools();
                const matches = all.filter((t) => t.name.toLowerCase().includes(q) ||
                    (typeof t.description === 'string' && t.description.toLowerCase().includes(q)));
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
                const name = String((_c = args === null || args === void 0 ? void 0 : args.name) !== null && _c !== void 0 ? _c : '');
                const tool = this.directory.listTools().find((t) => t.name === name);
                if (!tool)
                    return { success: false, error: `Tool not found: ${name}` };
                return { success: true, data: tool };
            }
            default:
                return { success: false, error: `Unknown dx tool: ${toolName}` };
        }
    }
}
exports.DXTools = DXTools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHgtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZHgtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBVUgsTUFBYSxPQUFPO0lBR2hCLFlBQVksU0FBZ0M7UUFDeEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7SUFDL0IsQ0FBQztJQUVELFFBQVE7UUFDSixPQUFPO1lBQ0g7Z0JBQ0ksSUFBSSxFQUFFLGNBQWM7Z0JBQ3BCLFdBQVcsRUFBRSx3RUFBd0U7Z0JBQ3JGLFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxRQUFRLEVBQUUsQ0FBQyxPQUFPLENBQUM7b0JBQ25CLFVBQVUsRUFBRTt3QkFDUixLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSw2QkFBNkIsRUFBRTt3QkFDckUsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRTtxQkFDcEU7aUJBQ0o7YUFDSjtZQUNEO2dCQUNJLElBQUksRUFBRSxrQkFBa0I7Z0JBQ3hCLFdBQVcsRUFBRSx1RUFBdUU7Z0JBQ3BGLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTthQUNsRDtZQUNEO2dCQUNJLElBQUksRUFBRSxhQUFhO2dCQUNuQixXQUFXLEVBQUUsK0RBQStEO2dCQUM1RSxXQUFXLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUU7YUFDbEQ7WUFDRDtnQkFDSSxJQUFJLEVBQUUsZUFBZTtnQkFDckIsV0FBVyxFQUFFLGlGQUFpRjtnQkFDOUYsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFFB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LENBQUM7Z0JBQ3ZFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQztZQUN6QyxDQUFDO1lBQ0Q7Z0JBQ0ksT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLG9CQUFvQixRQUFRLEVBQUUsRUFBRSxDQUFDO1FBQ3pFLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUE5RUQsMEJBOEVDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQaGFzZSA2IOKAlCBEZXZlbG9wZXItZXhwZXJpZW5jZSB0b29scy5cbiAqXG4gKiBUaGVzZSB0b29scyBsaXZlIGFsb25nc2lkZSB0aGUgZWRpdG9yLWRyaXZlbiBjYXRlZ29yaWVzIGJ1dCBvcGVyYXRlIG9uIHRoZVxuICogTUNQIHNlcnZlciBpdHNlbGYsIGdpdmluZyBhbiBMTE0gKG9yIGEgY3VyaW91cyBkZXZlbG9wZXIpIGludHJvc3BlY3Rpb25cbiAqIGFib3V0IHdoYXQgdGhlIHNlcnZlciBjYW4gZG8gd2l0aG91dCBoYXZpbmcgdG8gZW51bWVyYXRlIGV2ZXJ5IGNhdGVnb3J5LlxuICpcbiAqICAgLSBkeF9zZWFyY2hfdG9vbHMgICAgICAgICDigJQgc3Vic3RyaW5nIHNlYXJjaCBhY3Jvc3MgcmVnaXN0ZXJlZCB0b29scy5cbiAqICAgLSBkeF9nZXRfY2FwYWJpbGl0aWVzICAgICDigJQgcmV0dXJucyB0aGUgY2FwYWJpbGl0aWVzIGFkdmVydGlzZWQgYXRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBpbml0aWFsaXplYCB0aW1lIHNvIGEgY2xpZW50IGNhbiBicmFuY2ggb25cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdoaWNoIG9wdGlvbmFsIG1ldGhvZHMgZXhpc3QuXG4gKiAgIC0gZHhfc2VydmVyX2luZm8gICAgICAgICAg4oCUIHNlcnZlciBuYW1lLCB2ZXJzaW9uLCB1cHRpbWUsIHNlc3Npb24gY291bnQuXG4gKiAgIC0gZHhfZGVzY3JpYmVfdG9vbCAgICAgICAg4oCUIGZ1bGwgc2NoZW1hICsgYW5ub3RhdGlvbnMgZm9yIGEgc2luZ2xlIHRvb2wuXG4gKlxuICogVGhlIGFjdHVhbCB0b29sL3JlZ2lzdHJ5IGxvb2t1cHMgaGFwcGVuIHZpYSB0aGUge0BsaW5rIFRvb2xEaXJlY3RvcnlQcm92aWRlcn1cbiAqIHRoZSBzZXJ2ZXIgcGFzc2VzIGluIGF0IGNvbnN0cnVjdGlvbiB0aW1lLCBzbyB3ZSBkb24ndCBkZXBlbmQgb24gdGhlXG4gKiBlZGl0b3IgaG9zdC5cbiAqL1xuXG5pbXBvcnQgeyBUb29sRGVmaW5pdGlvbiwgVG9vbEV4ZWN1dG9yLCBUb29sUmVzcG9uc2UgfSBmcm9tICcuLi90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVG9vbERpcmVjdG9yeVByb3ZpZGVyIHtcbiAgICBsaXN0VG9vbHMoKTogVG9vbERlZmluaXRpb25bXTtcbiAgICBnZXRTZXJ2ZXJDYXBhYmlsaXRpZXMoKTogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICBnZXRTZXJ2ZXJJbmZvKCk6IHsgbmFtZTogc3RyaW5nOyB2ZXJzaW9uOiBzdHJpbmc7IHVwdGltZU1zOiBudW1iZXI7IHNlc3Npb25zOiBudW1iZXI7IHBvcnQ6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY2xhc3MgRFhUb29scyBpbXBsZW1lbnRzIFRvb2xFeGVjdXRvciB7XG4gICAgcHJpdmF0ZSBkaXJlY3Rvcnk6IFRvb2xEaXJlY3RvcnlQcm92aWRlcjtcblxuICAgIGNvbnN0cnVjdG9yKGRpcmVjdG9yeTogVG9vbERpcmVjdG9yeVByb3ZpZGVyKSB7XG4gICAgICAgIHRoaXMuZGlyZWN0b3J5ID0gZGlyZWN0b3J5O1xuICAgIH1cblxuICAgIGdldFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdzZWFyY2hfdG9vbHMnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU3Vic3RyaW5nIHNlYXJjaCBhY3Jvc3MgdGhlIHJlZ2lzdGVyZWQgdG9vbCBsaXN0IChuYW1lICsgZGVzY3JpcHRpb24pLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3F1ZXJ5J10sXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5OiB7IHR5cGU6ICdzdHJpbmcnLCBkZXNjcmlwdGlvbjogJ0Nhc2UtaW5zZW5zaXRpdmUgc3Vic3RyaW5nLicgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxpbWl0OiB7IHR5cGU6ICdpbnRlZ2VyJywgbWluaW11bTogMSwgbWF4aW11bTogMjAwLCBkZWZhdWx0OiA1MCB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdnZXRfY2FwYWJpbGl0aWVzJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JldHVybiB0aGUgTUNQIGNhcGFiaWxpdGllcyB0aGUgc2VydmVyIGFkdmVydGlzZXMgYXQgaW5pdGlhbGl6ZSB0aW1lLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogJ29iamVjdCcsIHByb3BlcnRpZXM6IHt9IH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3NlcnZlcl9pbmZvJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JldHVybiBzZXJ2ZXIgbmFtZSwgdmVyc2lvbiwgdXB0aW1lIGFuZCBhY3RpdmUgc2Vzc2lvbiBjb3VudC4nLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdkZXNjcmliZV90b29sJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JldHVybiB0aGUgZnVsbCBzY2hlbWEgKyBhbm5vdGF0aW9ucyBmb3IgYSBzaW5nbGUgdG9vbCBieSBmdWxseS1xdWFsaWZpZWQgbmFtZS4nLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyduYW1lJ10sXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHsgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9IH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIF07XG4gICAgfVxuXG4gICAgYXN5bmMgZXhlY3V0ZSh0b29sTmFtZTogc3RyaW5nLCBhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICBzd2l0Y2ggKHRvb2xOYW1lKSB7XG4gICAgICAgICAgICBjYXNlICdzZWFyY2hfdG9vbHMnOiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcSA9IFN0cmluZyhhcmdzPy5xdWVyeSA/PyAnJykudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgICAgICBpZiAoIXEpIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ3F1ZXJ5IGlzIHJlcXVpcmVkJyB9O1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oMjAwLCBNYXRoLm1heCgxLCBOdW1iZXIucGFyc2VJbnQoU3RyaW5nKGFyZ3M/LmxpbWl0ID8/IDUwKSwgMTApIHx8IDUwKSk7XG4gICAgICAgICAgICAgICAgY29uc3QgYWxsID0gdGhpcy5kaXJlY3RvcnkubGlzdFRvb2xzKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGFsbC5maWx0ZXIoKHQpID0+XG4gICAgICAgICAgICAgICAgICAgIHQubmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpIHx8XG4gICAgICAgICAgICAgICAgICAgICh0eXBlb2YgdC5kZXNjcmlwdGlvbiA9PT0gJ3N0cmluZycgJiYgdC5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgdG90YWw6IG1hdGNoZXMubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHM6IG1hdGNoZXMuc2xpY2UoMCwgbGltaXQpLm1hcCgodCkgPT4gKHsgbmFtZTogdC5uYW1lLCBkZXNjcmlwdGlvbjogdC5kZXNjcmlwdGlvbiB9KSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlICdnZXRfY2FwYWJpbGl0aWVzJzoge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IHRoaXMuZGlyZWN0b3J5LmdldFNlcnZlckNhcGFiaWxpdGllcygpIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlICdzZXJ2ZXJfaW5mbyc6IHtcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBkYXRhOiB0aGlzLmRpcmVjdG9yeS5nZXRTZXJ2ZXJJbmZvKCkgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJ2Rlc2NyaWJlX3Rvb2wnOiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IFN0cmluZyhhcmdzPy5uYW1lID8/ICcnKTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29sID0gdGhpcy5kaXJlY3RvcnkubGlzdFRvb2xzKCkuZmluZCgodCkgPT4gdC5uYW1lID09PSBuYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAoIXRvb2wpIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFRvb2wgbm90IGZvdW5kOiAke25hbWV9YCB9O1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IHRvb2wgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5rbm93biBkeCB0b29sOiAke3Rvb2xOYW1lfWAgfTtcbiAgICAgICAgfVxuICAgIH1cbn1cbiJdfQ==