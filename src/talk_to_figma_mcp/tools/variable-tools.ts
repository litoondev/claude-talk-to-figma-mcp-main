import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson, coerceBoolean } from "../utils/schema-helpers";

const RESOLVED_TYPE = z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);

const FIELD_HELP =
  "Node property to bind. Numbers: itemSpacing, counterAxisSpacing, paddingTop/Right/Bottom/Left, " +
  "width, height, minWidth, maxWidth, minHeight, maxHeight, opacity, strokeWeight, cornerRadius " +
  "(and per-corner), fontSize, lineHeight, letterSpacing, paragraphSpacing, fontWeight. " +
  "Strings: fontFamily, fontStyle, characters. Colours use the paint form: 'fills/0/color', " +
  "'strokes/0/color', 'effects/0/color'.";

/**
 * Register variable tools to the MCP server
 * This module contains tools for managing Figma Variables (design tokens)
 * @param server - The MCP server instance
 */
export function registerVariableTools(server: McpServer): void {
  // Get Variables Tool
  server.tool(
    "get_variables",
    "List variable collections and variables in the current Figma file, with their type, scopes, " +
      "collection and per-mode values. Aliases are reported as aliases (the token they point at), " +
      "never flattened to a raw value — bind the semantic token, not the primitive it resolves to. " +
      "A mature token file holds hundreds of variables, so filter with nameContains / resolvedType " +
      "/ collectionName rather than listing everything.",
    {
      name: z.string().optional().describe("Exact variable path, e.g. 'colors/Base/Primary'"),
      nameContains: z.string().optional().describe("Substring of the token path, matched loosely for discovery only (e.g. 'container-padding')"),
      resolvedType: RESOLVED_TYPE.optional().describe("Only variables of this type"),
      collectionName: z.string().optional().describe("Only variables in this collection"),
      scope: z.string().optional().describe("Only variables usable in this scope (e.g. GAP, TEXT_FILL, CORNER_RADIUS)"),
      includeValues: coerceBoolean.optional().describe("Include per-mode values (default true). Set false for a compact name listing."),
      limit: z.coerce.number().int().positive().optional().describe("Maximum variables to return (default 200)"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("get_variables", args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Find Variable Tool — strict resolution, no guessing
  server.tool(
    "find_variable",
    "Resolve one token name to exactly one variable, or explain why it cannot. Matching is strict: " +
      "exact path, then case-insensitive path, then normalised name only when a single compatible " +
      "variable matches. Never fuzzy — 'colors/Base/Primary', 'colors/Primary/500' and " +
      "'colors/Primary/700' are different tokens. Returns a reason of not-found, ambiguous, " +
      "wrong-type or wrong-scope so you can tell 'no such token' from 'exists but cannot bind here'.",
    {
      name: z.string().describe("Token path to resolve, e.g. 'Layout/Default/container-padding'"),
      field: z.string().optional().describe("The property you intend to bind. Constrains the required type and scope. " + FIELD_HELP),
      resolvedType: RESOLVED_TYPE.optional().describe("Required type, if not implied by field"),
      collectionName: z.string().optional().describe("Require the variable to come from this collection"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("find_variable", args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error finding variable: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Variable Tool
  server.tool(
    "set_variable",
    "Update the value of an existing variable, or create one when createIfMissing is set. Creating " +
      "a token or a collection expands the design system, so it is refused by default: reuse an " +
      "existing token where one fits, and ask the designer before adding a new one.",
    {
      collectionId: z.string().optional().describe("ID of an existing variable collection"),
      collectionName: z.string().optional().describe("Name of the collection (used if collectionId not provided)"),
      name: z.string().describe("Variable name"),
      resolvedType: RESOLVED_TYPE.describe("Variable type"),
      value: z.any().describe("Variable value. COLOR: {r,g,b,a} (0-1). FLOAT: number. STRING: string. BOOLEAN: boolean."),
      modeId: z.string().optional().describe("Mode ID to set the value for (uses default mode if omitted)"),
      createIfMissing: coerceBoolean.optional().describe("Allow creating the variable or collection when it does not exist. Off by default — confirm with the designer first."),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("set_variable", args);
        const typedResult = result as { variableId: string; variableName: string; collectionName: string };
        return {
          content: [
            {
              type: "text",
              text: `Set variable "${typedResult.variableName}" in collection "${typedResult.collectionName}" (ID: ${typedResult.variableId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting variable: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Apply Variable to Node Tool
  server.tool(
    "apply_variable_to_node",
    "Bind a variable to a node property, keeping the token connection so the layer follows the " +
      "design system and its responsive modes. Pass variableName (the token path) or variableId. " +
      "The name is resolved strictly and the type is checked against the field, so a wrong or " +
      "ambiguous token is refused rather than guessed. If no variable exists for the value, apply " +
      "the exact value manually and report it as not token-connected — never bind a similar token, " +
      "and never copy the resolved value of one that does exist.",
    {
      nodeId: z.string().describe("The ID of the node to bind the variable to"),
      variableName: z.string().optional().describe("Token path, e.g. 'Layout/Default/row-gap'. Preferred over variableId."),
      variableId: z.string().optional().describe("Variable ID, if you already resolved one"),
      field: z.string().describe(FIELD_HELP),
      collectionName: z.string().optional().describe("Require the variable to come from this collection"),
      requireScopeMatch: coerceBoolean.optional().describe("Refuse to bind when the variable's scopes do not cover this field. Off by default, since many files use ALL_SCOPES."),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("apply_variable_to_node", args);
        const typed = result as {
          nodeName: string;
          variableName: string;
          field: string;
          matchMethod: string;
          collectionName: string | null;
          warning?: string;
        };
        const warn = typed.warning ? ` — ${typed.warning}` : "";
        return {
          content: [
            {
              type: "text",
              text:
                `Bound "${typed.variableName}" (${typed.collectionName ?? "unknown collection"}, ` +
                `matched ${typed.matchMethod}) to ${typed.field} on "${typed.nodeName}"${warn}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying variable to node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Batch binding with a report
  server.tool(
    "apply_variable_bindings",
    "Bind many token/property pairs in one pass and return a report splitting what bound from what " +
      "did not. A token that genuinely does not exist is reported as unbound with a reason rather " +
      "than substituted — apply those values manually and flag them as not token-connected. Use " +
      "this instead of many apply_variable_to_node calls when token-connecting a section.",
    {
      bindings: coerceJson(
        z.array(
          z.object({
            nodeId: z.string().describe("Node to bind"),
            field: z.string().describe("Property to bind. " + FIELD_HELP),
            variableName: z.string().optional().describe("Token path to bind"),
            variableId: z.string().optional().describe("Variable ID, if already resolved"),
            collectionName: z.string().optional().describe("Require this collection for this binding"),
          })
        )
      ).describe("Array of {nodeId, field, variableName} bindings"),
      collectionName: z.string().optional().describe("Default collection requirement for every binding"),
      requireScopeMatch: coerceBoolean.optional().describe("Refuse bindings whose scopes do not cover the field"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("apply_variable_bindings", args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying variable bindings: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Inspect what is bound and what is still a raw value
  server.tool(
    "get_node_variable_bindings",
    "Report which of a node's properties carry a variable binding, which are still raw values, and " +
      "which explicit variable modes are set on it. Use this to verify after binding, and to find " +
      "properties that were given a copied value where a token exists.",
    {
      nodeId: z.string().describe("The ID of the node to inspect"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_node_variable_bindings", { nodeId });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading variable bindings: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Switch Variable Mode Tool
  server.tool(
    "switch_variable_mode",
    "Set the explicit variable mode on a node for a collection, so bound variables resolve at the " +
      "right breakpoint (Desk / Tab / Mobi). Identify the collection and mode by name, or omit " +
      "modeName to infer the breakpoint from the width of the nearest ancestor frame. This applies " +
      "a mode — it never copies a mode's resolved values into properties.",
    {
      nodeId: z.string().describe("The ID of the node to switch mode on"),
      collectionName: z.string().optional().describe("Collection name, e.g. 'styles'"),
      collectionId: z.string().optional().describe("Collection ID, if you already have it"),
      modeName: z.string().optional().describe("Mode name, e.g. 'Desk', 'Tab', 'Mobi'. Omit (or pass 'auto') to infer it from the nearest frame's width."),
      modeId: z.string().optional().describe("Mode ID, if you already have it"),
      thresholds: coerceJson(
        z.object({
          desktopMin: z.coerce.number().optional(),
          tabletMin: z.coerce.number().optional(),
        })
      ).optional().describe("Width thresholds for auto mode selection (defaults: desktop ≥1024, tablet ≥600)"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("switch_variable_mode", args);
        const typed = result as {
          nodeName: string;
          collectionName: string;
          modeName: string;
          selectedBy: string;
        };
        return {
          content: [
            {
              type: "text",
              text:
                `Switched to mode "${typed.modeName}" for collection "${typed.collectionName}" on ` +
                `node "${typed.nodeName}" (selected by ${typed.selectedBy})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error switching variable mode: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Team library import
  server.tool(
    "import_library_variable",
    "Import a variable from an enabled team library into this file, so it can be bound like a local " +
      "token. Use this instead of creating a local duplicate when the token an element needs lives " +
      "in a shared library.",
    {
      name: z.string().optional().describe("Token path to find in the enabled libraries"),
      key: z.string().optional().describe("Library variable key, if you already have it"),
      libraryCollectionKey: z.string().optional().describe("Restrict the search to one library collection, to resolve an ambiguous name"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("import_library_variable", args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error importing library variable: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
