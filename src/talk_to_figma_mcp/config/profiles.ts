/**
 * Tool profiles.
 *
 * The full tool set is 167 tools ≈ 41k tokens of JSON schema, and that schema is
 * re-sent on *every* model request for the whole session. Most sessions use a
 * fraction of it. A profile trims the advertised set to what the work actually
 * needs, which cuts per-request cost and leaves more of the context window for
 * the design itself.
 *
 * Select with the FIGMA_MCP_PROFILE environment variable:
 *   core     — ~64 tools (~18k tokens). Layout, text, colour, variables, responsive.
 *   standard — ~105 tools (~25k tokens). Everything except FigJam, REST comments,
 *              Webflow and activity tracking. **Default.**
 *   full     — all 167 tools (~41k tokens). The previous behaviour.
 *
 * The counts above are asserted against the live registry in
 * tests/unit/tool-counts.test.ts, because a number maintained by hand drifts
 * every time a tool is added and is then quoted in the readme as fact.
 *
 * A profile only changes what is advertised, never what the plugin can do:
 * anything omitted is still reachable through `figma_batch`.
 */

import { hasFigmaToken } from "../utils/figma-rest";
import { hasWebflowToken } from "../utils/webflow-rest";

export type ProfileName = "core" | "standard" | "full";

/**
 * The REST comment/account tools.
 *
 * These are withheld from `standard` for schema cost, but that cost only buys
 * anything when the user has no way to call them. When FIGMA_ACCESS_TOKEN is
 * configured the user has explicitly set comments up, and hiding the tools made
 * the model report — correctly, from what it could see — that it had no way to
 * read Figma comments. So the exclusion is conditional on the token.
 */
export const REST_COMMENT_TOOLS: readonly string[] = [
  "get_figma_account",
  "get_current_file",
  "list_figma_files",
  "get_file_comments",
  "get_my_comments",
  "reply_to_comment",
  "reply_to_comments",
  "delete_comment",
];

/**
 * The Webflow Data API tools.
 *
 * Withheld from `standard` on the same reasoning as the REST comment tools, and
 * with the same exception: the cost of advertising them only buys something
 * while the user has no way to call them. A configured WEBFLOW_TOKEN is the
 * signal that this session intends to touch Webflow, so the exclusion is
 * conditional on the token rather than absolute.
 *
 * These never appear in `core`. Core is the Figma design loop, and a Webflow
 * content call has no place in it.
 */
export const WEBFLOW_TOOLS: readonly string[] = [
  "webflow_list_sites",
  "webflow_get_site",
  "webflow_create_site",
  "webflow_list_pages",
  "webflow_get_page",
  "webflow_update_page_settings",
  "webflow_get_page_content",
  "webflow_update_page_content",
  "webflow_list_collections",
  "webflow_get_collection",
  "webflow_list_items",
  "webflow_create_items",
  "webflow_update_items",
  "webflow_publish_items",
  "webflow_delete_items",
  "webflow_publish_site",
];

/**
 * The Webflow Designer tools — the canvas half, over the relay.
 *
 * Gated separately from the Data API tools: those need a token, these need a
 * Designer extension on the channel, and the two are configured independently.
 * A token says nothing about whether an extension is running, so these cannot
 * ride on `hasWebflowToken()`; they are withheld from `standard` and `core`
 * unless FIGMA_MCP_WEBFLOW_DESIGNER is set, and always available in `full`.
 * Anything withheld is still callable through `figma_batch`.
 */
export const WEBFLOW_DESIGNER_TOOLS: readonly string[] = [
  "webflow_designer_status",
  "webflow_designer_get_structure",
  "webflow_designer_get_styles",
  "webflow_designer_get_variables",
  "webflow_designer_create_variables",
  "webflow_designer_set_tag_style",
  "webflow_designer_set_style",
  "webflow_designer_create_element",
  "webflow_designer_set_text",
  "webflow_designer_delete_element",
  "webflow_designer_create_component",
  "webflow_designer_insert_component",
];

/**
 * The setup checker.
 *
 * Advertised as soon as *either* Webflow feature is configured, because its job
 * is to diagnose a half-configured setup — hiding it until everything works
 * would make it useless exactly when it is needed.
 */
export const WEBFLOW_PREFLIGHT_TOOL = "webflow_preflight";

/** True when the user has opted into the Webflow Designer tools. */
export function webflowDesignerEnabled(): boolean {
  const raw = (process.env.FIGMA_MCP_WEBFLOW_DESIGNER || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/**
 * The minimum set that covers the common loop: inspect the design system,
 * scope to a section, build/adjust a layout, make it responsive, verify.
 */
export const CORE_TOOLS: readonly string[] = [
  // batching — the single biggest cost lever, always present
  "figma_batch",
  // skill catalogue — how a vetted procedure gets loaded instead of improvised
  "figma_skill",
  // cost reporting — the end-of-task footer, cheap enough to keep everywhere
  "get_token_usage",
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
  "export_assets",
  "audit_generated_code",
  "audit_structure_match",
  // creation
  "create_frame",
  "create_text",
  "create_rectangle",
  "group_nodes",
  "clone_node",
  "insert_child",
  "create_component_instance",
  // modification
  "set_layout_sizing",
  "fix_text_sizing",
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
  "set_variable",
  "rename_variable",
  "rename_variables",
  "find_variable",
  "apply_variable_to_node",
  "apply_variable_bindings",
  "get_node_variable_bindings",
  "import_library_variable",
  // HTML / URL import
  "analyze_html",
  "match_design_tokens",
  "place_html_image",
  "set_grid_layout",
  // responsive
  "analyze_responsive",
  "make_responsive",
  "clean_layers",
  "convert_layout",
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
  // REST comments / account — only when no FIGMA_ACCESS_TOKEN is configured;
  // see REST_COMMENT_TOOLS and makeToolFilter.
  ...REST_COMMENT_TOOLS,
  // Webflow Data API — only when no WEBFLOW_TOKEN is configured;
  // see WEBFLOW_TOOLS and makeToolFilter.
  ...WEBFLOW_TOOLS,
  // Webflow Designer — only when FIGMA_MCP_WEBFLOW_DESIGNER is off;
  // see WEBFLOW_DESIGNER_TOOLS and makeToolFilter.
  ...WEBFLOW_DESIGNER_TOOLS,
  // The setup checker — withheld only when neither Webflow feature is on.
  WEBFLOW_PREFLIGHT_TOOL,
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
  // A configured token is the signal that this session intends to use comments.
  if (hasFigmaToken()) {
    for (const name of REST_COMMENT_TOOLS) denied.delete(name);
  }
  // Likewise for Webflow: a token means the user set the integration up, and
  // hiding the tools would have the model report it cannot reach Webflow.
  if (hasWebflowToken()) {
    for (const name of WEBFLOW_TOOLS) denied.delete(name);
  }
  // The Designer tools need a running extension, which no environment variable
  // can prove — so this is an explicit opt-in rather than an inference.
  if (webflowDesignerEnabled()) {
    for (const name of WEBFLOW_DESIGNER_TOOLS) denied.delete(name);
  }
  if (hasWebflowToken() || webflowDesignerEnabled()) {
    denied.delete(WEBFLOW_PREFLIGHT_TOOL);
  }
  return (name) => !denied.has(name);
}
