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
    referenceImage_:{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    // Phase 5
    editorRuntime_:{ readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: false },
    // Phase 6
    dx_:           { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false }
};

/**
 * Explicit per‑tool overrides. Only list tools where the defaults are wrong.
 *
 * Phases 3 & 4 expand this map to cover every shipped tool so that LLM clients
 * receive accurate `readOnlyHint` / `destructiveHint` / `idempotentHint`
 * signals. Tools omitted here inherit `CATEGORY_DEFAULTS` above.
 */
const TOOL_HINTS: Record<string, ToolHints> = {
    // -- scene_ ---------------------------------------------------------
    'scene_get_current_scene':      { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'scene_get_scene_list':         { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'scene_get_scene_hierarchy':    { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'scene_open_scene':             { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'scene_save_scene':             { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'scene_save_scene_as':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'scene_create_scene':           { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'scene_close_scene':            { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },

    // -- node_ ----------------------------------------------------------
    'node_get_all_nodes':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_find_node_by_name':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_find_nodes':              { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_get_node_info':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_detect_node_type':        { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'node_create_node':             { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'node_delete_node':             { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'node_duplicate_node':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'node_move_node':               { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'node_set_node_property':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'node_set_node_transform':      { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },

    // -- component_ ----------------------------------------------------
    'component_get_components':         { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'component_get_component_info':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'component_get_available_components':{ annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'component_add_component':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'component_remove_component':       { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'component_set_component_property': { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'component_attach_script':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },

    // -- prefab_ -------------------------------------------------------
    'prefab_get_prefab_list':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'prefab_load_prefab':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'prefab_get_prefab_info':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'prefab_validate_prefab':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'prefab_instantiate_prefab':    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'prefab_create_prefab':         { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'prefab_update_prefab':         { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'prefab_revert_prefab':         { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'prefab_duplicate_prefab':      { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'prefab_restore_prefab_node':   { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },

    // -- project_ (mostly asset-DB ops — Phase 4) -----------------------
    'project_get_project_info':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_project_settings': { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_asset_list':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_asset_info':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_asset_details':    { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_query_asset_path':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_query_asset_uuid':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_query_asset_url':      { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_assets':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_find_asset_by_name':   { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_get_build_settings':   { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_check_builder_status': { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'project_run_project':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'project_build_project':        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'project_open_build_panel':     { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'project_start_preview_server': { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'project_stop_preview_server':  { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'project_refresh_assets':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'project_save_asset':           { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'project_reimport_asset':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'project_create_asset':         { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'project_import_asset':         { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'project_copy_asset':           { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'project_move_asset':           { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'project_delete_asset':         { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },

    // -- assetAdvanced_ (Phase 4) --------------------------------------
    'assetAdvanced_save_asset_meta':            { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'assetAdvanced_generate_available_url':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false } },
    'assetAdvanced_query_asset_db_ready':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false } },
    'assetAdvanced_open_asset_external':        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: true } },
    'assetAdvanced_batch_import_assets':        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    'assetAdvanced_batch_delete_assets':        { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true,  openWorldHint: false } },
    'assetAdvanced_validate_asset_references':  { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false } },
    'assetAdvanced_get_asset_dependencies':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false } },
    'assetAdvanced_get_unused_assets':          { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false } },
    'assetAdvanced_compress_textures':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    'assetAdvanced_export_asset_manifest':      { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: true } },

    // -- referenceImage_ (Phase 4) -------------------------------------
    'referenceImage_query_reference_image_config':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'referenceImage_query_current_reference_image':    { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'referenceImage_list_reference_images':            { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'referenceImage_remove_reference_image':           { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'referenceImage_clear_all_reference_images':       { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },

    // -- preferences_ --------------------------------------------------
    'preferences_open_preferences_settings':{ annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'preferences_query_preferences_config': { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'preferences_get_all_preferences':      { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'preferences_set_preferences_config':   { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'preferences_reset_preferences':        { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'preferences_export_preferences':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: true } },
    'preferences_import_preferences':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: true } },

    // -- sceneAdvanced_ ------------------------------------------------
    'sceneAdvanced_query_scene_ready':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_query_scene_dirty':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_query_scene_classes':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_query_scene_components':  { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_query_component_has_script':{ annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_query_nodes_by_asset_uuid':{ annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_reset_node_property':     { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'sceneAdvanced_reset_node_transform':    { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'sceneAdvanced_reset_component':         { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'sceneAdvanced_remove_array_element':    { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: false } },
    'sceneAdvanced_move_array_element':      { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_copy_node':               { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_paste_node':              { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_cut_node':                { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: false } },
    'sceneAdvanced_restore_prefab':          { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },
    'sceneAdvanced_execute_component_method':{ annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_execute_scene_script':    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_scene_snapshot':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_scene_snapshot_abort':    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_begin_undo_recording':    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_end_undo_recording':      { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
    'sceneAdvanced_cancel_undo_recording':   { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'sceneAdvanced_soft_reload_scene':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },

    // -- sceneView_ (queries are read-only, change_/set_ mutate UI only) -
    'sceneView_query_gizmo_tool_name':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_gizmo_pivot':           { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_gizmo_view_mode':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_gizmo_coordinate':      { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_view_mode_2d_3d':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_grid_visible':          { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_icon_gizmo_3d':         { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_query_icon_gizmo_size':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_get_scene_view_status':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'sceneView_focus_camera_on_nodes':       { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'sceneView_align_camera_with_view':      { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'sceneView_align_view_with_node':        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'sceneView_reset_scene_view':            { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },

    // -- broadcast_ ----------------------------------------------------
    'broadcast_get_broadcast_log':   { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'broadcast_get_active_listeners':{ annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'broadcast_clear_broadcast_log': { annotations: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true } },

    // -- editorRuntime_ (Phase 5) --------------------------------------
    'editorRuntime_run_preview':           { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'editorRuntime_stop_preview':          { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'editorRuntime_reload_preview':        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'editorRuntime_tail_runtime_logs':     { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'editorRuntime_reload_current_scene':  { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    'editorRuntime_subscribe_runtime_logs':{ annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },

    // -- dx_ (Phase 6) -------------------------------------------------
    'dx_search_tools':       { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'dx_get_capabilities':   { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'dx_server_info':        { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } },
    'dx_describe_tool':      { annotations: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true } }
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
