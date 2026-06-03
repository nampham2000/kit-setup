/**
 * Default tool annotations and registered output schemas.
 *
 * Annotations follow MCP 2025‑03‑26 (`readOnlyHint`, `destructiveHint`,
 * `idempotentHint`, `openWorldHint`) and are merged into the `tools/list`
 * response so that compliant clients can warn users before invoking a
 * destructive tool.
 *
 * Output schemas are JSON Schema documents (MCP 2025‑06‑18). They are
 * advisory — the server still validates inputs strictly but does not
 * enforce output shape because tool execution results may legitimately
 * vary based on editor state. The schemas are sufficient to give the LLM
 * a strong hint about the response shape.
 */

import { ToolAnnotations } from '../types';

type ToolHints = {
    annotations: ToolAnnotations;
    outputSchema?: any;
};

/**
 * Generic envelope used by virtually every tool. Concrete tools may
 * additionally declare a `data` shape via {@link OUTPUT_SCHEMAS}.
 */
export const TOOL_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {},
        error: { type: 'string' },
        warning: { type: 'string' },
        instruction: { type: 'string' }
    },
    required: ['success']
};

/**
 * Category‑wide defaults. A category prefix like `scene_` matches every
 * tool whose fully‑qualified name (`<category>_<tool>`) starts with it.
 *
 * Specific tool entries in {@link TOOL_HINTS} override these.
 */
const CATEGORY_DEFAULTS: Record<string, ToolAnnotations> = {
    // Pure read tools
    debug_:        { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
    validation_:   { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
    server_:       { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
    sceneView_:    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    broadcast_:    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    // Mutating tools
    scene_:        { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    node_:         { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    component_:    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    prefab_:       { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    project_:      { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    preferences_:  { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: false },
    sceneAdvanced_:{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    assetAdvanced_:{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true  },
    referenceImage_:{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
};

/**
 * Explicit per‑tool overrides. Only list tools where the defaults are wrong.
 */
const TOOL_HINTS: Record<string, ToolHints> = {
    'scene_get_current_scene':      { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'scene_get_scene_list':         { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'scene_get_scene_hierarchy':    { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_get_all_nodes':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_find_node_by_name':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_get_node_info':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_delete_node':             { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'component_get_component_info': { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'component_remove_component':   { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'project_delete_asset':         { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'project_get_project_info':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_asset_list':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'preferences_reset_preferences':{ annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } }
};

function lookupCategoryDefaults(fullName: string): ToolAnnotations {
    for (const prefix of Object.keys(CATEGORY_DEFAULTS)) {
        if (fullName.startsWith(prefix)) return CATEGORY_DEFAULTS[prefix];
    }
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
}

/** Resolve the effective annotations + outputSchema for a `<category>_<tool>` name. */
export function resolveToolHints(fullName: string): ToolHints {
    const explicit = TOOL_HINTS[fullName];
    const defaults = lookupCategoryDefaults(fullName);
    return {
        annotations: { ...defaults, ...(explicit?.annotations || {}) },
        outputSchema: explicit?.outputSchema || TOOL_RESPONSE_SCHEMA
    };
}
