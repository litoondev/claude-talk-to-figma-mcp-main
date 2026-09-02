/**
 * Tool profiles.
 *
 * The full tool set is 114 tools ≈ 25k tokens of JSON schema, and that schema is
 * re-sent on *every* model request for the whole session. Most sessions use a
 * fraction of it. A profile trims the advertised set to what the work actually
 * needs, which cuts per-request cost and leaves more of the context window for
 * the design itself.
 *
 * Select with the FIGMA_MCP_PROFILE environment variable:
 *   core     — ~40 tools (~9k tokens). Layout, text, colour, variables, responsive.
 *   standard — ~85 tools (~19k tokens). Everything except FigJam, REST comments
 *              and activity tracking. **Default.**
 *   full     — all 114 tools (~25k tokens). The previous behaviour.
 *
 * A profile only changes what is advertised, never what the plugin can do:
 * anything omitted is still reachable through `figma_batch`.
 */

export type ProfileName = "core" | "standard" | "full";

/**
 * The minimum set that covers the common loop: inspect the design system,
 * scope to a section, build/adjust a layout, make it responsive, verify.
 */
export const CORE_TOOLS: readonly string[] = [
  // batching — the single biggest cost lever, always present
  "figma_batch",
  // connection + scope
  "join_channel",
  "check_figma_connection",
  "set_section_scope",
  "clear_section_scope",
  "get_section_scope",
  "verify_node_in_scope",
  // inspection
  "get_design_system",
  "get_document_info",
  "get_selection",
  "get_node_info",
  "get_nodes_info",
  "get_pages",
  "set_current_page",
  "get_styles",
  "get_local_components",
  "scan_text_nodes",
  "export_node_as_image",
  // creation
  "create_frame",
  "create_text",
  "create_rectangle",
  "group_nodes",
  "clone_node",
  "insert_child",
  "create_component_instance",
  // modification
  "set_fill_color",
  "set_stroke_color",
  "move_node",
  "resize_node",
  "delete_node",
  "rename_node",
  "reorder_node",
  "set_corner_radius",
  "set_auto_layout",
  "set_effects",
  "set_node_properties",
  "convert_to_frame",
  // text
  "set_text_content",
  "set_multiple_text_contents",
  "set_font_name",
  "set_font_size",
  "set_text_align",
  // variables
  "get_variables",
  "apply_variable_to_node",
  // responsive
  "analyze_responsive",
  "make_responsive",
  "clean_layers",
  "validate_responsive",
];

/**
 * Tools dropped from `standard`: whole subsystems most sessions never touch
 * (FigJam boards, the REST comment client, activity tracking) plus a handful of
 * rarely-used inspectors. All remain callable via `figma_batch`.
 */
export const STANDARD_EXCLUDED: readonly string[] = [
  // FigJam
  "get_figjam_elements",
  "create_sticky",
  "set_sticky_text",
  "create_shape_with_text",
  "create_connector",
  "create_section",
  // REST comments / account
  "get_figma_account",
  "get_current_file",
  "list_figma_files",
  "get_file_comments",
  "get_my_comments",
  "reply_to_comment",
  "reply_to_comments",
  "delete_comment",
  // activity tracking
  "get_activity_log",
  "set_activity_overlay",
  "get_activity_state",
  // niche inspectors / editors
  "get_remote_components",
  "set_reactions",
  "get_reactions",
  "set_grid",
  "get_grid",
  "set_guide",
  "get_guide",
  "set_annotation",
  "get_annotation",
  "get_node_via_rest",
  "duplicate_page",
];

/** Resolve the active profile from the environment, defaulting to `standard`. */
export function getProfile(): ProfileName {
  const raw = (process.env.FIGMA_MCP_PROFILE || "").trim().toLowerCase();
  if (raw === "core" || raw === "standard" || raw === "full") return raw;
  return "standard";
}

/**
 * Decide whether a tool should be advertised under the active profile.
 * `full` admits everything; `core` admits only CORE_TOOLS; `standard` admits
 * everything except STANDARD_EXCLUDED.
 */
export function makeToolFilter(profile: ProfileName = getProfile()): (name: string) => boolean {
  if (profile === "full") return () => true;
  if (profile === "core") {
    const allowed = new Set(CORE_TOOLS);
    return (name) => allowed.has(name);
  }
  const denied = new Set(STANDARD_EXCLUDED);
  return (name) => !denied.has(name);
}
