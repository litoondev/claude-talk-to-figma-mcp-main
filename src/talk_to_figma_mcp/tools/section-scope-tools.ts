/**
 * Section Scope Tools
 *
 * These tools let users pin all Figma operations to a specific SECTION node.
 * Once a scope is set:
 *
 *   • CREATION — parentId is auto-injected at the websocket layer so every new
 *     node lands inside the scoped section without the caller having to think
 *     about it.
 *
 *   • MODIFICATION — callers should call `verify_node_in_scope` before editing
 *     a node to confirm the target lives inside the section. The tool returns a
 *     clear error if it doesn't, preventing accidental edits outside the scope.
 *
 * Trigger phrases Claude should recognise as scope-setting intent:
 *   "work only in this section", "focus on [section name]",
 *   "don't touch anything outside", user selects a SECTION node,
 *   user pastes a Figma URL that contains a node-id for a section.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  setScopeState,
  getScopeState,
  clearScopeState,
  hasScopeState,
  findNodeInTree,
  parseNodeIdFromUrl,
  SCOPE_MODIFICATION_COMMANDS,
} from "../utils/section-scope";
import { sendCommandToFigma } from "../utils/websocket";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk up to 15 ancestry levels by repeatedly fetching parentId via get_node_info. */
async function getAncestorIds(nodeId: string): Promise<string[]> {
  const ancestors: string[] = [];
  let currentId = nodeId;

  for (let depth = 0; depth < 15; depth++) {
    let info: any;
    try {
      info = await sendCommandToFigma("get_node_info", { nodeId: currentId });
    } catch {
      break; // node not found or not connected
    }

    // JSON_REST_V1 returns parent info in the document wrapper; some plugin
    // versions surface it directly. Try both.
    const parentId: string | undefined =
      info?.parent?.id ?? info?.parentId ?? undefined;

    if (!parentId) break; // reached the root (page)
    ancestors.push(parentId);
    currentId = parentId;
  }

  return ancestors;
}

/**
 * Determine if a node is inside the active section by:
 *   1. Fetching the full subtree of the section (fast, single call).
 *   2. Searching for the target nodeId in the tree.
 *   3. Fallback: walk ancestor chain via repeated get_node_info calls.
 */
async function isNodeInActiveScope(
  targetNodeId: string,
  sectionId: string
): Promise<{ inScope: boolean; method: string }> {
  // Strategy 1: fetch section subtree and search (fast, one round-trip)
  try {
    const sectionTree = await sendCommandToFigma("get_node_info", { nodeId: sectionId }) as Record<string, unknown>;
    if (findNodeInTree(sectionTree, targetNodeId)) {
      return { inScope: true, method: "subtree_search" };
    }
    // If sectionTree was returned successfully the section exists; target not found in it
    return { inScope: false, method: "subtree_search" };
  } catch {
    // Section not reachable — fall through to ancestor walk
  }

  // Strategy 2: walk ancestor chain (slower, multiple round-trips)
  try {
    const ancestors = await getAncestorIds(targetNodeId);
    if (ancestors.includes(sectionId)) {
      return { inScope: true, method: "ancestor_walk" };
    }
    return { inScope: false, method: "ancestor_walk" };
  } catch {
    return { inScope: false, method: "error" };
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSectionScopeTools(server: McpServer): void {
  // ── 1. set_section_scope ─────────────────────────────────────────────────
  server.tool(
    "set_section_scope",
    "Pin all subsequent Figma operations to a specific SECTION node. " +
      "After calling this tool: (1) every creation command (create_rectangle, create_frame, etc.) " +
      "will automatically place the new node inside the section without needing an explicit parentId, " +
      "and (2) you should call verify_node_in_scope before modifying any node to ensure it lives " +
      "inside the section. " +
      "Triggers: user selects a section in Figma, says 'work only in this section', " +
      "'focus on [section name]', 'don't touch anything outside this section', " +
      "or shares a Figma URL containing a node-id for a section. " +
      "If the user selects a section before asking you to do work, call get_selection first, " +
      "then pass the selected node's ID here to lock scope.",
    {
      sectionIdOrUrl: z
        .string()
        .optional()
        .describe(
          "Section node ID ('123:456') or a full Figma URL with ?node-id=... pointing to a SECTION. " +
            "If omitted, the current Figma selection is used — the selected node must be a SECTION."
        ),
    },
    async ({ sectionIdOrUrl }) => {
      let resolvedId: string | null = null;

      // Resolve the node ID from whatever the caller provided
      if (!sectionIdOrUrl) {
        // Use current selection
        let selectionResult: any;
        try {
          selectionResult = await sendCommandToFigma("get_selection");
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "not_connected",
                  message: "Could not reach Figma plugin to read selection.",
                  hint: "Make sure the plugin is open and joined to the channel.",
                }),
              },
            ],
            isError: true,
          };
        }

        const nodes: any[] = selectionResult?.nodes ?? selectionResult?.selection ?? [];
        if (nodes.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "no_selection",
                  message: "Nothing is selected in Figma.",
                  hint: "Select a SECTION node in Figma first, or pass sectionIdOrUrl explicitly.",
                }),
              },
            ],
            isError: true,
          };
        }
        if (nodes.length > 1) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "multiple_selection",
                  message: `${nodes.length} nodes are selected. Select exactly one SECTION.`,
                  selectedIds: nodes.map((n: any) => ({ id: n.id, name: n.name, type: n.type })),
                }),
              },
            ],
            isError: true,
          };
        }
        resolvedId = nodes[0].id;
      } else {
        // Try to parse as URL first, then fall back to bare node ID
        resolvedId = parseNodeIdFromUrl(sectionIdOrUrl) ?? sectionIdOrUrl.trim();
      }

      // Validate: fetch the node and confirm type === SECTION
      let nodeInfo: any;
      try {
        nodeInfo = await sendCommandToFigma("get_node_info", { nodeId: resolvedId });
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "node_not_found",
                message: `Could not fetch node "${resolvedId}": ${err instanceof Error ? err.message : String(err)}`,
                hint: "Check that the node ID is correct and the file is open in Figma.",
              }),
            },
          ],
          isError: true,
        };
      }

      const nodeType: string = (nodeInfo as any)?.type ?? "";
      // Figma SECTION type string (design sections and FigJam sections both use "SECTION")
      if (nodeType !== "SECTION") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "not_a_section",
                message: `Node "${resolvedId}" is a ${nodeType || "unknown type"}, not a SECTION.`,
                hint: "Only SECTION nodes can be used as a scope target. Select or reference a section.",
                nodeInfo: { id: (nodeInfo as any)?.id, name: (nodeInfo as any)?.name, type: nodeType },
              }),
            },
          ],
          isError: true,
        };
      }

      const sectionName: string = (nodeInfo as any)?.name ?? resolvedId;

      setScopeState({
        sectionId: resolvedId,
        sectionName,
        setAt: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Section scope set to "${sectionName}" (${resolvedId}).`,
              rules: [
                "All creation commands (create_rectangle, create_frame, create_text, etc.) will " +
                  "automatically place new nodes inside this section.",
                "Before modifying any existing node, call verify_node_in_scope to confirm it " +
                  "lives inside the section. The tool returns an error if it doesn't.",
                "Call clear_section_scope when you're done working in this section.",
              ],
              scope: getScopeState(),
            }),
          },
        ],
      };
    }
  );

  // ── 2. clear_section_scope ───────────────────────────────────────────────
  server.tool(
    "clear_section_scope",
    "Remove the active section scope so operations are no longer restricted to a specific section. " +
      "Call this when the user is done working within a scoped section, or says something like " +
      "'work anywhere now', 'stop limiting to this section', 'clear scope'.",
    {},
    async () => {
      if (!hasScopeState()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ message: "No section scope was active." }),
            },
          ],
        };
      }

      const previous = getScopeState();
      clearScopeState();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Section scope cleared. Was scoped to "${previous?.sectionName}" (${previous?.sectionId}).`,
              note: "Operations are no longer restricted to any section.",
            }),
          },
        ],
      };
    }
  );

  // ── 3. get_section_scope ─────────────────────────────────────────────────
  server.tool(
    "get_section_scope",
    "Return the currently active section scope, or indicate that no scope is set. " +
      "Call this at the start of a task to know whether operations are restricted to a section.",
    {},
    async () => {
      const scope = getScopeState();

      if (!scope) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                active: false,
                message: "No section scope is currently set. Operations apply to the whole document.",
                tip: "Call set_section_scope to restrict all edits to a specific section.",
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              active: true,
              scope,
              rules: [
                "Creation commands auto-place nodes inside this section.",
                "Call verify_node_in_scope before modifying any existing node.",
              ],
            }),
          },
        ],
      };
    }
  );

  // ── 4. verify_node_in_scope ───────────────────────────────────────────────
  server.tool(
    "verify_node_in_scope",
    "Confirm that a node lives inside the active section scope before modifying it. " +
      `Call this before any modification command (${[...SCOPE_MODIFICATION_COMMANDS].slice(0, 6).join(", ")}, …) ` +
      "when a section scope is active. Returns an error with a clear message if the node is " +
      "outside the section — in that case, do NOT proceed with the modification. " +
      "If no scope is active, the check is skipped and the node is considered safe to modify.",
    {
      nodeId: z
        .string()
        .describe("The ID of the node you are about to modify (e.g. '123:456')."),
    },
    async ({ nodeId }) => {
      const scope = getScopeState();

      // No scope active — all nodes are valid targets
      if (!scope) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                inScope: true,
                reason: "no_scope_active",
                message: "No section scope is set — node can be modified freely.",
              }),
            },
          ],
        };
      }

      // Node IS the section itself — allow (e.g., renaming the section)
      if (nodeId === scope.sectionId) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                inScope: true,
                reason: "node_is_scope_root",
                message: `Node ${nodeId} is the scoped section itself — modification allowed.`,
              }),
            },
          ],
        };
      }

      const { inScope, method } = await isNodeInActiveScope(nodeId, scope.sectionId);

      if (inScope) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                inScope: true,
                method,
                message: `Node ${nodeId} is inside section "${scope.sectionName}" — modification allowed.`,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              inScope: false,
              method,
              error: "out_of_scope",
              message:
                `Node ${nodeId} is NOT inside the active section "${scope.sectionName}" ` +
                `(${scope.sectionId}). Modification blocked to prevent unintended edits outside the scope.`,
              action:
                "Do NOT proceed with the modification. " +
                "If the user wants to edit this node, call clear_section_scope first, " +
                "or ask the user to confirm they want to work outside the section.",
            }),
          },
        ],
        isError: true,
      };
    }
  );
}
