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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHgtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZHgtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBVUgsTUFBYSxPQUFPO0lBR2hCLFlBQVksU0FBZ0M7UUFDeEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7SUFDL0IsQ0FBQztJQUVELFFBQVE7UUFDSixPQUFPO1lBQ0g7Z0JBQ0ksSUFBSSxFQUFFLGNBQWM7Z0JBQ3BCLFdBQVcsRUFBRSx3RUFBd0U7Z0JBQ3JGLFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxRQUFRLEVBQUUsQ0FBQyxPQUFPLENBQUM7b0JBQ25CLFVBQVUsRUFBRTt3QkFDUixLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSw2QkFBNkIsRUFBRTt3QkFDckUsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRTtxQkFDcEU7aUJBQ0o7YUFDSjtZQUNEO2dCQUNJLElBQUksRUFBRSxrQkFBa0I7Z0JBQ3hCLFdBQVcsRUFBRSx1RUFBdUU7Z0JBQ3BGLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTthQUNsRDtZQUNEO2dCQUNJLElBQUksRUFBRSxhQUFhO2dCQUNuQixXQUFXLEVBQUUsK0RBQStEO2dCQUM1RSxXQUFXLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUU7YUFDbEQ7WUFDRDtnQkFDSSxJQUFJLEVBQUUsZUFBZTtnQkFDckIsV0FBVyxFQUFFLGlGQUFpRjtnQkFDOUYsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFFB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LENBQUM7Z0JBQ3ZFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQztZQUN6QyxDQUFDO1lBQ0Q7Z0JBQ0ksT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLG9CQUFvQixRQUFRLEVBQUUsRUFBRSxDQUFDO1FBQ3pFLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUE5RUQsMEJBOEVDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFBoYXNlIDYg4oCUIERldmVsb3Blci1leHBlcmllbmNlIHRvb2xzLlxyXG4gKlxyXG4gKiBUaGVzZSB0b29scyBsaXZlIGFsb25nc2lkZSB0aGUgZWRpdG9yLWRyaXZlbiBjYXRlZ29yaWVzIGJ1dCBvcGVyYXRlIG9uIHRoZVxyXG4gKiBNQ1Agc2VydmVyIGl0c2VsZiwgZ2l2aW5nIGFuIExMTSAob3IgYSBjdXJpb3VzIGRldmVsb3BlcikgaW50cm9zcGVjdGlvblxyXG4gKiBhYm91dCB3aGF0IHRoZSBzZXJ2ZXIgY2FuIGRvIHdpdGhvdXQgaGF2aW5nIHRvIGVudW1lcmF0ZSBldmVyeSBjYXRlZ29yeS5cclxuICpcclxuICogICAtIGR4X3NlYXJjaF90b29scyAgICAgICAgIOKAlCBzdWJzdHJpbmcgc2VhcmNoIGFjcm9zcyByZWdpc3RlcmVkIHRvb2xzLlxyXG4gKiAgIC0gZHhfZ2V0X2NhcGFiaWxpdGllcyAgICAg4oCUIHJldHVybnMgdGhlIGNhcGFiaWxpdGllcyBhZHZlcnRpc2VkIGF0XHJcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBpbml0aWFsaXplYCB0aW1lIHNvIGEgY2xpZW50IGNhbiBicmFuY2ggb25cclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2hpY2ggb3B0aW9uYWwgbWV0aG9kcyBleGlzdC5cclxuICogICAtIGR4X3NlcnZlcl9pbmZvICAgICAgICAgIOKAlCBzZXJ2ZXIgbmFtZSwgdmVyc2lvbiwgdXB0aW1lLCBzZXNzaW9uIGNvdW50LlxyXG4gKiAgIC0gZHhfZGVzY3JpYmVfdG9vbCAgICAgICAg4oCUIGZ1bGwgc2NoZW1hICsgYW5ub3RhdGlvbnMgZm9yIGEgc2luZ2xlIHRvb2wuXHJcbiAqXHJcbiAqIFRoZSBhY3R1YWwgdG9vbC9yZWdpc3RyeSBsb29rdXBzIGhhcHBlbiB2aWEgdGhlIHtAbGluayBUb29sRGlyZWN0b3J5UHJvdmlkZXJ9XHJcbiAqIHRoZSBzZXJ2ZXIgcGFzc2VzIGluIGF0IGNvbnN0cnVjdGlvbiB0aW1lLCBzbyB3ZSBkb24ndCBkZXBlbmQgb24gdGhlXHJcbiAqIGVkaXRvciBob3N0LlxyXG4gKi9cclxuXHJcbmltcG9ydCB7IFRvb2xEZWZpbml0aW9uLCBUb29sRXhlY3V0b3IsIFRvb2xSZXNwb25zZSB9IGZyb20gJy4uL3R5cGVzJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgVG9vbERpcmVjdG9yeVByb3ZpZGVyIHtcclxuICAgIGxpc3RUb29scygpOiBUb29sRGVmaW5pdGlvbltdO1xyXG4gICAgZ2V0U2VydmVyQ2FwYWJpbGl0aWVzKCk6IFJlY29yZDxzdHJpbmcsIGFueT47XHJcbiAgICBnZXRTZXJ2ZXJJbmZvKCk6IHsgbmFtZTogc3RyaW5nOyB2ZXJzaW9uOiBzdHJpbmc7IHVwdGltZU1zOiBudW1iZXI7IHNlc3Npb25zOiBudW1iZXI7IHBvcnQ6IG51bWJlciB9O1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgRFhUb29scyBpbXBsZW1lbnRzIFRvb2xFeGVjdXRvciB7XHJcbiAgICBwcml2YXRlIGRpcmVjdG9yeTogVG9vbERpcmVjdG9yeVByb3ZpZGVyO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKGRpcmVjdG9yeTogVG9vbERpcmVjdG9yeVByb3ZpZGVyKSB7XHJcbiAgICAgICAgdGhpcy5kaXJlY3RvcnkgPSBkaXJlY3Rvcnk7XHJcbiAgICB9XHJcblxyXG4gICAgZ2V0VG9vbHMoKTogVG9vbERlZmluaXRpb25bXSB7XHJcbiAgICAgICAgcmV0dXJuIFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ3NlYXJjaF90b29scycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1N1YnN0cmluZyBzZWFyY2ggYWNyb3NzIHRoZSByZWdpc3RlcmVkIHRvb2wgbGlzdCAobmFtZSArIGRlc2NyaXB0aW9uKS4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWydxdWVyeSddLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcXVlcnk6IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnQ2FzZS1pbnNlbnNpdGl2ZSBzdWJzdHJpbmcuJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsaW1pdDogeyB0eXBlOiAnaW50ZWdlcicsIG1pbmltdW06IDEsIG1heGltdW06IDIwMCwgZGVmYXVsdDogNTAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2dldF9jYXBhYmlsaXRpZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZXR1cm4gdGhlIE1DUCBjYXBhYmlsaXRpZXMgdGhlIHNlcnZlciBhZHZlcnRpc2VzIGF0IGluaXRpYWxpemUgdGltZS4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogJ29iamVjdCcsIHByb3BlcnRpZXM6IHt9IH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ3NlcnZlcl9pbmZvJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmV0dXJuIHNlcnZlciBuYW1lLCB2ZXJzaW9uLCB1cHRpbWUgYW5kIGFjdGl2ZSBzZXNzaW9uIGNvdW50LicsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogeyB0eXBlOiAnb2JqZWN0JywgcHJvcGVydGllczoge30gfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZGVzY3JpYmVfdG9vbCcsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JldHVybiB0aGUgZnVsbCBzY2hlbWEgKyBhbm5vdGF0aW9ucyBmb3IgYSBzaW5nbGUgdG9vbCBieSBmdWxseS1xdWFsaWZpZWQgbmFtZS4nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyduYW1lJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogeyBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH0gfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBleGVjdXRlKHRvb2xOYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgc3dpdGNoICh0b29sTmFtZSkge1xyXG4gICAgICAgICAgICBjYXNlICdzZWFyY2hfdG9vbHMnOiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBxID0gU3RyaW5nKGFyZ3M/LnF1ZXJ5ID8/ICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFxKSByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdxdWVyeSBpcyByZXF1aXJlZCcgfTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oMjAwLCBNYXRoLm1heCgxLCBOdW1iZXIucGFyc2VJbnQoU3RyaW5nKGFyZ3M/LmxpbWl0ID8/IDUwKSwgMTApIHx8IDUwKSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhbGwgPSB0aGlzLmRpcmVjdG9yeS5saXN0VG9vbHMoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBhbGwuZmlsdGVyKCh0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHQubmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgKHR5cGVvZiB0LmRlc2NyaXB0aW9uID09PSAnc3RyaW5nJyAmJiB0LmRlc2NyaXB0aW9uLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSkpXHJcbiAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdG90YWw6IG1hdGNoZXMubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b29sczogbWF0Y2hlcy5zbGljZSgwLCBsaW1pdCkubWFwKCh0KSA9PiAoeyBuYW1lOiB0Lm5hbWUsIGRlc2NyaXB0aW9uOiB0LmRlc2NyaXB0aW9uIH0pKVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2FzZSAnZ2V0X2NhcGFiaWxpdGllcyc6IHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IHRoaXMuZGlyZWN0b3J5LmdldFNlcnZlckNhcGFiaWxpdGllcygpIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2FzZSAnc2VydmVyX2luZm8nOiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBkYXRhOiB0aGlzLmRpcmVjdG9yeS5nZXRTZXJ2ZXJJbmZvKCkgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjYXNlICdkZXNjcmliZV90b29sJzoge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IFN0cmluZyhhcmdzPy5uYW1lID8/ICcnKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHRvb2wgPSB0aGlzLmRpcmVjdG9yeS5saXN0VG9vbHMoKS5maW5kKCh0KSA9PiB0Lm5hbWUgPT09IG5hbWUpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCF0b29sKSByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBUb29sIG5vdCBmb3VuZDogJHtuYW1lfWAgfTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IHRvb2wgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5rbm93biBkeCB0b29sOiAke3Rvb2xOYW1lfWAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuIl19