/**
 * Section Scope — in-memory state for scoped Figma operations.
 *
 * When a section scope is active, the plugin enforces two rules automatically:
 *
 *   1. CREATION — if a creation command arrives without a parentId, the section's
 *      node ID is injected as parentId so the new element lands inside the section.
 *
 *   2. MODIFICATION — before modifying a node, callers should call
 *      `verify_node_in_scope` (MCP tool) to confirm the target lives inside the
 *      section. This keeps edits from accidentally touching elements outside.
 *
 * This module is deliberately free of imports from the rest of the codebase to
 * avoid circular dependencies (websocket.ts imports this; this imports nothing).
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ScopeState {
  /** Node ID of the active section (e.g. "123:456"). */
  sectionId: string;
  /** Display name of the section for human-readable messages. */
  sectionName: string;
  /** When the scope was set (ISO string). */
  setAt: string;
}

let activeScope: ScopeState | null = null;

export function setScopeState(state: ScopeState): void {
  activeScope = state;
}

export function getScopeState(): ScopeState | null {
  return activeScope;
}

export function clearScopeState(): void {
  activeScope = null;
}

export function hasScopeState(): boolean {
  return activeScope !== null;
}

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

/**
 * Creation commands that produce new nodes.
 * When scope is active, parentId is auto-injected if absent.
 */
export const SCOPE_CREATION_COMMANDS = new Set([
  "create_rectangle",
  "create_frame",
  "create_text",
  "create_ellipse",
  "create_polygon",
  "create_star",
  "create_vector",
  "create_line",
  "create_component_instance",
  "create_component_set",
  "set_svg",
  "clone_node",
  "create_component_from_node",
  // FigJam
  "create_section",
  "create_sticky",
  "create_shape_with_text",
  "create_connector",
]);

/**
 * Modification commands that target a single node via nodeId.
 * Callers should call verify_node_in_scope before running these when scope is active.
 */
export const SCOPE_MODIFICATION_COMMANDS = new Set([
  "set_fill_color",
  "set_stroke_color",
  "set_selection_colors",
  "move_node",
  "resize_node",
  "delete_node",
  "rotate_node",
  "set_corner_radius",
  "set_auto_layout",
  "set_layout_sizing",
  "apply_variable_to_node",
  "get_node_variable_bindings",
  "switch_variable_mode",
  "set_effects",
  "set_effect_style_id",
  "set_text_content",
  "set_font_name",
  "set_font_size",
  "set_font_weight",
  "set_font_style",
  "set_letter_spacing",
  "set_line_height",
  "set_text_align",
  "set_text_case",
  "set_text_decoration",
  "set_paragraph_spacing",
  "set_text_style_id",
  "set_gradient",
  "set_image_fill",
  "set_image_filters",
  "set_node_properties",
  "rename_node",
  "flatten_node",
  "group_nodes",
  "ungroup_nodes",
  "boolean_operation",
  "convert_to_frame",
  "detach_instance",
  "set_instance_variant",
  "set_variable",
]);

// ---------------------------------------------------------------------------
// Tree search utility (no async — called by tools with pre-fetched data)
// ---------------------------------------------------------------------------

/**
 * Recursively search a node tree (as returned by get_node_info / JSON_REST_V1)
 * for a node with the given ID.  Returns the node when found, or null.
 */
export function findNodeInTree(
  tree: Record<string, unknown>,
  targetId: string
): Record<string, unknown> | null {
  if (tree.id === targetId) return tree;

  const children = tree.children;
  if (!Array.isArray(children)) return null;

  for (const child of children as Record<string, unknown>[]) {
    const found = findNodeInTree(child, targetId);
    if (found) return found;
  }

  return null;
}

/**
 * Parse a Figma node ID out of a figma.com URL.
 *
 * Figma desktop/web URLs encode the selected node as either:
 *   ?node-id=123-456   (newer format, hyphen-separated)
 *   ?node-id=123%3A456 (URL-encoded colon)
 *
 * Returns the canonical "123:456" format, or null if not found.
 */
export function parseNodeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const raw = u.searchParams.get("node-id");
    if (!raw) return null;
    // Normalise: replace hyphen separator with colon
    return decodeURIComponent(raw).replace(/-/g, ":");
  } catch {
    // Not a valid URL — might be a bare node ID already
    if (/^\d+:\d+$/.test(url.trim())) return url.trim();
    return null;
  }
}
