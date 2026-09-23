import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson } from "../utils/schema-helpers";
import { hasFigmaToken, resolveStyleSources } from "../utils/figma-rest";
import { errorResponse, jsonResponse } from "../utils/respond";

/**
 * Register style creation tools to the MCP server
 * This module contains tools for creating reusable styles in Figma
 * @param server - The MCP server instance
 */
export function registerStyleTools(server: McpServer): void {
  server.tool(
    "create_text_style",
    "Create a reusable text style (typography) in Figma's local styles. This is useful for design system consistency.",
    {
      name: z.string().describe("Name for the style (e.g., 'Heading/H1' or 'Body/Large')"),
      fontFamily: z.string().describe("Font family name (e.g., 'Inter', 'Roboto')"),
      fontStyle: z.string().optional().describe("Font style (e.g., 'Regular', 'Bold', 'Italic'). Defaults to 'Regular'."),
      fontSize: z.number().positive().describe("Font size in pixels"),
      letterSpacing: z.number().optional().describe("Letter spacing value (defaults to 0)"),
      letterSpacingUnit: z.enum(["PIXELS", "PERCENT"]).optional().describe("Letter spacing unit (PIXELS or PERCENT, defaults to PIXELS)"),
      lineHeight: z.number().optional().describe("Line height value"),
      lineHeightUnit: z.enum(["PIXELS", "PERCENT", "AUTO"]).optional().describe("Line height unit (PIXELS, PERCENT, or AUTO, defaults to AUTO if no value provided)"),
      textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]).optional().describe("Text case transformation"),
      textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional().describe("Text decoration type"),
    },
    async ({
      name,
      fontFamily,
      fontStyle = "Regular",
      fontSize,
      letterSpacing = 0,
      letterSpacingUnit = "PIXELS",
      lineHeight,
      lineHeightUnit = "AUTO",
      textCase = "ORIGINAL",
      textDecoration = "NONE",
    }) => {
      try {
        const result = await sendCommandToFigma("create_text_style", {
          name,
          fontFamily,
          fontStyle,
          fontSize,
          letterSpacing,
          letterSpacingUnit,
          lineHeight,
          lineHeightUnit: lineHeight === undefined ? "AUTO" : lineHeightUnit,
          textCase,
          textDecoration,
        });

        const typedResult = result as { id: string; name: string; key: string };
        return {
          content: [
            {
              type: "text",
              text: `✅ Created text style "${typedResult.name}"\nID: ${typedResult.id}\nKey: ${typedResult.key}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Error creating text style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_paint_style",
    "Create a reusable color/paint style (SOLID) in Figma's local styles.",
    {
      name: z.string().describe("Name for the style (e.g., 'Brand/Primary' or 'UI/Background')"),
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha/opacity (0-1, default 1)"),
    },
    async ({ name, r, g, b, a = 1 }) => {
      try {
        const result = await sendCommandToFigma("create_paint_style", {
          name,
          r,
          g,
          b,
          a,
        });

        const typedResult = result as { id: string; name: string; key: string };
        return {
          content: [
            {
              type: "text",
              text: `✅ Created paint style "${typedResult.name}"\nID: ${typedResult.id}\nKey: ${typedResult.key}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Error creating paint style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_effect_style",
    "Create a reusable effect style (shadows, blurs) in Figma's local styles.",
    {
      name: z.string().describe("Name for the style (e.g., 'Shadow/Medium' or 'Glass/Blur')"),
      effects: coerceJson(
        z.array(
          z.object({
            type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]).describe("Effect type"),
            radius: z.number().optional().describe("Blur radius"),
            offset: z
              .object({
                x: z.number().describe("X offset"),
                y: z.number().describe("Y offset"),
              })
              .optional()
              .describe("Shadow offset"),
            color: z
              .object({
                r: z.number().min(0).max(1).describe("Red (0-1)"),
                g: z.number().min(0).max(1).describe("Green (0-1)"),
                b: z.number().min(0).max(1).describe("Blue (0-1)"),
                a: z.number().min(0).max(1).optional().describe("Alpha (0-1)"),
              })
              .optional()
              .describe("Effect color"),
            visible: z.boolean().optional().describe("Whether effect is visible"),
            spread: z.number().optional().describe("Spread radius for shadows"),
            blendMode: z.string().optional().describe("Blend mode (e.g., 'NORMAL', 'MULTIPLY')"),
          })
        )
      ).describe("Array of effects to apply and store in the style"),
    },
    async ({ name, effects }) => {
      try {
        const result = await sendCommandToFigma("create_effect_style", {
          name,
          effects,
        });

        const typedResult = result as { id: string; name: string; key: string; effectCount: number };
        return {
          content: [
            {
              type: "text",
              text: `✅ Created effect style "${typedResult.name}" with ${typedResult.effectCount} effect(s)\nID: ${typedResult.id}\nKey: ${typedResult.key}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Error creating effect style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Foreign (remote) style and variable bindings
// ---------------------------------------------------------------------------
//
// Figma groups the style and variable pickers by the file that owns each style
// the document references — not by the libraries the file subscribes to. A
// style that arrived with a pasted layer or a dragged-in instance puts its
// source file in that list permanently, and the Libraries modal offers no
// toggle for it because the library was never subscribed. The section clears
// only when nothing references the style any more.
//
// The plugin half (`audit_remote_styles` in code.js) can see that a style is
// remote and can read its key, but the Plugin API does not expose the owning
// file's name. That is resolved here over REST, so the report says
// "HIP Master V3" rather than a 40-character key. Without a Figma token the
// audit still works — the sources are reported unnamed, and the reason is
// stated rather than left blank.

interface RemoteSource {
  key: string;
  name: string;
  usages: number;
  insideInstance: number;
  sampleNodeIds: string[];
  styleType?: string;
  resolvedType?: string;
}

interface RemoteAudit {
  scope: string;
  nodesScanned: number;
  truncated: boolean;
  remoteStyleCount: number;
  remoteVariableCount: number;
  totalBindings: number;
  styles: RemoteSource[];
  variables: RemoteSource[];
  bindings: unknown[];
  bindingsTruncated: boolean;
  localStyleNames: string[];
  localVariableNames: string[];
  failures: { nodeId: string; reason: string }[];
}

const SCOPE_FIELD = z
  .enum(["selection", "page", "document"])
  .optional()
  .describe(
    "How much to scan. 'selection' (default) is cheapest; 'document' is what you need " +
      "before concluding a source is gone, because one binding anywhere keeps it in the picker."
  );

export function registerRemoteStyleTools(server: McpServer): void {
  server.tool(
    "audit_remote_styles",
    "Find every style and variable binding in a Figma file that points at ANOTHER file. " +
      "Use this when the style or variable picker shows sections for libraries the file does " +
      "not subscribe to — those come from styles carried in by pasted layers or dragged-in " +
      "instances, and no Libraries toggle removes them. Read-only.",
    {
      scope: SCOPE_FIELD,
      nodeId: z.string().optional().describe("Scan this subtree instead of the scope."),
      resolveSources: z
        .boolean()
        .optional()
        .describe(
          "Name the owning file of each remote style via the Figma REST API (default true). " +
            "Needs FIGMA_ACCESS_TOKEN; without it the audit still runs, unnamed."
        ),
    },
    async ({ scope, nodeId, resolveSources = true }) => {
      try {
        const audit = (await sendCommandToFigma("audit_remote_styles", {
          scope,
          nodeId,
        })) as RemoteAudit;

        let sources: Record<string, { fileKey?: string; fileName?: string; reason?: string }> = {};
        let sourceNote: string | null = null;
        if (!resolveSources) {
          sourceNote = "Source files not resolved (resolveSources was false).";
        } else if (!audit.styles.length) {
          sourceNote = null;
        } else if (!hasFigmaToken()) {
          sourceNote =
            "Source files not named: no FIGMA_ACCESS_TOKEN is set, and the Figma plugin " +
            "sandbox cannot read which file owns a style. Set the token to see library names.";
        } else {
          sources = await resolveStyleSources(audit.styles.map((s) => s.key));
        }

        // Group by owning file — the unit the designer actually thinks in, and
        // the unit the picker itself is grouped by.
        const byFile: Record<string, { fileName: string | null; styles: string[]; usages: number }> = {};
        for (const style of audit.styles) {
          const source = sources[style.key];
          const label = source?.fileName || source?.fileKey || "(unresolved)";
          if (!byFile[label]) byFile[label] = { fileName: source?.fileName ?? null, styles: [], usages: 0 };
          byFile[label].styles.push(style.name);
          byFile[label].usages += style.usages;
        }

        const clean = audit.remoteStyleCount === 0 && audit.remoteVariableCount === 0;

        return jsonResponse({
          scope: audit.scope,
          nodesScanned: audit.nodesScanned,
          truncated: audit.truncated,
          clean,
          summary: clean
            ? `No foreign styles or variables in ${audit.nodesScanned} nodes — the picker will show local sources only.`
            : `${audit.totalBindings} binding(s) across ${audit.remoteStyleCount} foreign style(s) ` +
              `and ${audit.remoteVariableCount} foreign variable(s).`,
          sourceFiles: byFile,
          sourceNote,
          styles: audit.styles.map((style) => ({
            ...style,
            sourceFileName: sources[style.key]?.fileName ?? null,
            sourceFileKey: sources[style.key]?.fileKey ?? null,
            sourceUnresolvedReason: sources[style.key]?.reason ?? null,
          })),
          variables: audit.variables,
          bindings: audit.bindings,
          bindingsTruncated: audit.bindingsTruncated,
          localStyleNames: audit.localStyleNames,
          localVariableNames: audit.localVariableNames,
          failures: audit.failures,
          nextStep: clean
            ? null
            : "Run rebind_remote_styles (dryRun defaults to true) to see what would be repointed at local equivalents.",
        });
      } catch (error) {
        return errorResponse("audit remote styles", error);
      }
    }
  );

  server.tool(
    "rebind_remote_styles",
    "Repoint bindings that reference another file's styles or variables at the local " +
      "equivalent of the same name, so the foreign source drops out of the picker. " +
      "Runs as a dry run unless dryRun is explicitly false. Never creates a style and " +
      "never detaches one — anything without a local match is reported, not guessed at.",
    {
      scope: SCOPE_FIELD,
      nodeId: z.string().optional().describe("Rebind this subtree instead of the scope."),
      dryRun: z
        .boolean()
        .optional()
        .describe("Default true. Set false to actually apply the mapping."),
      matchBy: z
        .enum(["name", "leaf"])
        .optional()
        .describe(
          "'leaf' (default) matches 'HIP/Desk/H2' to a local 'H2'. 'name' requires the full " +
            "path to match, which is stricter and safer on files with repeated leaf names."
        ),
      map: coerceJson(z.record(z.string()))
        .optional()
        .describe(
          "Explicit overrides, { remoteStyleKey: localStyleNameOrId }. Takes precedence " +
            "over matchBy for the keys it names."
        ),
    },
    async ({ scope, nodeId, dryRun = true, matchBy = "leaf", map }) => {
      try {
        const result = await sendCommandToFigma("rebind_remote_styles", {
          scope,
          nodeId,
          dryRun,
          matchBy,
          map,
        });
        return jsonResponse(result);
      } catch (error) {
        return errorResponse("rebind remote styles", error);
      }
    }
  );
}
