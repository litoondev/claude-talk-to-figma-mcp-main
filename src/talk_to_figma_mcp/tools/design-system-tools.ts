/**
 * Local design system inspection — the "library first" enabler.
 *
 * WHY THIS EXISTS
 * ---------------
 * The project rule is: never design from scratch before checking what the file
 * already defines. That rule only gets followed if following it is cheap.
 *
 * Previously an agent had to call get_styles, get_variables, get_local_components
 * and get_remote_components separately, then reconcile four unrelated shapes,
 * and even then it learned nothing about the file's *spacing rhythm* — which is
 * usually encoded in usage rather than in named tokens.
 *
 * `get_design_system` answers the whole question in one call, and formats the
 * answer as reuse guidance rather than a data dump: what exists, what to reuse,
 * and what the established conventions are.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../utils/websocket";

interface TallyEntry {
  value: number;
  count: number;
}

interface DesignSystemResult {
  scope: string;
  page: { id: string; name: string };
  summary: Record<string, number | boolean>;
  colors: Array<{ id: string; name: string; hex: string | null; type: string | null; opacity: number }>;
  typography: Array<{
    id: string;
    name: string;
    fontFamily: string | null;
    fontStyle: string | null;
    fontSize: number;
    lineHeight: string | null;
    letterSpacing: string | null;
  }>;
  effects: Array<{ id: string; name: string; effects: Array<Record<string, unknown>> }>;
  grids: Array<{ id: string; name: string; layoutGrids: Array<Record<string, unknown>> }>;
  variableCollections: Array<{
    id: string;
    name: string;
    modes: Array<{ modeId: string; name: string }>;
    variableCount: number;
    variables: Array<{ id: string; name: string; resolvedType: string; valuesByMode: Record<string, unknown> }>;
  }>;
  components: Array<{ id: string; name: string; description: string; width: number; height: number }>;
  componentSets: Array<{
    id: string;
    name: string;
    variantProperties: Array<{ property: string; values: string[] }>;
    variantCount: number;
  }>;
  conventions: {
    sampledNodes: number;
    padding: TallyEntry[];
    gaps: TallyEntry[];
    cornerRadii: TallyEntry[];
    fontSizes: TallyEntry[];
    fontFamilies: Array<{ family: string; count: number }>;
    autoLayoutUsage: Record<string, number>;
  };
}

/** Render a frequency tally as "16 (×42), 24 (×18)" — value with usage weight. */
function renderTally(entries: TallyEntry[]): string {
  if (!entries || entries.length === 0) return "none observed";
  return entries.map((e) => `${e.value} (×${e.count})`).join(", ");
}

function section(title: string): string {
  return `\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`;
}

export function registerDesignSystemTools(server: McpServer): void {
  server.tool(
    "get_design_system",
    "ALWAYS CALL THIS FIRST, before creating or modifying anything in Figma. " +
      "Returns everything the local file already defines — colour styles, text styles, " +
      "effects, grids, variables/tokens with their modes, components and component sets " +
      "with their variant properties — plus the spacing, radius and type conventions " +
      "actually observed in the file. " +
      "Use it to reuse what exists instead of inventing new values: pick an existing " +
      "component or variant, bind an existing colour variable, and match the established " +
      "spacing rhythm. Only introduce a new style, token or component when this returns " +
      "nothing suitable. One call replaces get_styles + get_variables + get_local_components.",
    {
      scope: z
        .enum(["page", "document"])
        .optional()
        .describe(
          "'page' (default) inspects the current page and is fast. 'document' loads and " +
            "scans every page — use when components live on a dedicated library page."
        ),
      includeVariables: z
        .boolean()
        .optional()
        .describe("Include variable collections and tokens. Default true."),
      includeComponents: z
        .boolean()
        .optional()
        .describe("Include components and component sets. Default true."),
      sampleLimit: z
        .number()
        .int()
        .positive()
        .max(20000)
        .optional()
        .describe(
          "How many nodes to sample when deriving spacing/radius conventions. Default 4000."
        ),
    },
    async ({ scope, includeVariables, includeComponents, sampleLimit }) => {
      try {
        const result = (await sendCommandToFigma("get_design_system", {
          scope: scope ?? "page",
          includeVariables: includeVariables ?? true,
          includeComponents: includeComponents ?? true,
          sampleLimit: sampleLimit ?? 4000,
        })) as DesignSystemResult;

        const lines: string[] = [];
        const s = result.summary ?? {};

        lines.push(
          `Local design system — page "${result.page?.name ?? "?"}" (scope: ${result.scope})`
        );
        lines.push(
          `${s.colorStyles ?? 0} colour styles · ${s.textStyles ?? 0} text styles · ` +
            `${s.effectStyles ?? 0} effects · ${s.gridStyles ?? 0} grids · ` +
            `${s.variables ?? 0} variables in ${s.variableCollections ?? 0} collections · ` +
            `${s.components ?? 0} components · ${s.componentSets ?? 0} component sets`
        );

        // ── Variables first: these are the strongest reuse signal ─────────
        if (result.variableCollections?.length) {
          lines.push(section("VARIABLES / TOKENS — bind to these, do not hardcode"));
          for (const collection of result.variableCollections) {
            const modes = collection.modes.map((m) => m.name).join(", ");
            lines.push(`\n  ${collection.name}  [modes: ${modes || "default"}]`);
            for (const v of collection.variables.slice(0, 60)) {
              const values = Object.values(v.valuesByMode)
                .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
                .join(" / ");
              lines.push(`    ${v.name}  (${v.resolvedType})  ${values}`);
            }
            if (collection.variables.length > 60) {
              lines.push(`    … ${collection.variables.length - 60} more`);
            }
          }
        } else if (s.variablesAvailable === false) {
          lines.push(section("VARIABLES"));
          lines.push("  Variables API unavailable in this Figma build.");
        } else {
          lines.push(section("VARIABLES"));
          lines.push("  No variables defined locally.");
        }

        // ── Components ────────────────────────────────────────────────────
        if (result.componentSets?.length || result.components?.length) {
          lines.push(section("COMPONENTS — reuse before creating"));
          for (const set of result.componentSets ?? []) {
            const props = set.variantProperties
              .map((p) => `${p.property}=[${p.values.join("|")}]`)
              .join("  ");
            lines.push(
              `  [SET] ${set.name}  (${set.variantCount} variants)  ${props}`
            );
            lines.push(`        id: ${set.id}`);
          }
          for (const c of (result.components ?? []).slice(0, 80)) {
            const desc = c.description ? `  — ${c.description.slice(0, 60)}` : "";
            lines.push(`  ${c.name}  ${c.width}×${c.height}  id: ${c.id}${desc}`);
          }
          if ((result.components?.length ?? 0) > 80) {
            lines.push(`  … ${result.components.length - 80} more components`);
          }
        } else {
          lines.push(section("COMPONENTS"));
          lines.push(
            "  None found in this scope. Try scope:'document' — components often live " +
              "on a separate library page."
          );
        }

        // ── Typography ────────────────────────────────────────────────────
        if (result.typography?.length) {
          lines.push(section("TEXT STYLES — apply these rather than setting fonts by hand"));
          for (const t of result.typography) {
            lines.push(
              `  ${t.name}  ${t.fontFamily ?? "?"} ${t.fontStyle ?? ""} ${t.fontSize}px` +
                `  lh:${t.lineHeight ?? "?"}  ls:${t.letterSpacing ?? "?"}  id: ${t.id}`
            );
          }
        }

        // ── Colours ───────────────────────────────────────────────────────
        if (result.colors?.length) {
          lines.push(section("COLOUR STYLES"));
          for (const c of result.colors) {
            const alpha = c.opacity !== 1 ? ` @${Math.round(c.opacity * 100)}%` : "";
            lines.push(`  ${c.name}  ${c.hex ?? c.type ?? "?"}${alpha}  id: ${c.id}`);
          }
        }

        // ── Effects & grids ───────────────────────────────────────────────
        if (result.effects?.length) {
          lines.push(section("EFFECT STYLES"));
          for (const e of result.effects) {
            const detail = e.effects
              .map((x) => `${x.type}${x.radius !== undefined ? ` r${x.radius}` : ""}`)
              .join(", ");
            lines.push(`  ${e.name}  ${detail}  id: ${e.id}`);
          }
        }
        if (result.grids?.length) {
          lines.push(section("GRID STYLES"));
          for (const g of result.grids) {
            const detail = g.layoutGrids
              .map((x) => `${x.pattern}${x.count ? ` ×${x.count}` : ""}`)
              .join(", ");
            lines.push(`  ${g.name}  ${detail}  id: ${g.id}`);
          }
        }

        // ── Observed conventions ──────────────────────────────────────────
        const conv = result.conventions;
        if (conv) {
          lines.push(section("OBSERVED CONVENTIONS — match this rhythm"));
          lines.push(`  Sampled ${conv.sampledNodes} nodes.`);
          lines.push(`  Padding values:  ${renderTally(conv.padding)}`);
          lines.push(`  Gap values:      ${renderTally(conv.gaps)}`);
          lines.push(`  Corner radii:    ${renderTally(conv.cornerRadii)}`);
          lines.push(`  Font sizes:      ${renderTally(conv.fontSizes)}`);
          if (conv.fontFamilies?.length) {
            lines.push(
              `  Font families:   ` +
                conv.fontFamilies.map((f) => `${f.family} (×${f.count})`).join(", ")
            );
          }
          const al = conv.autoLayoutUsage ?? {};
          lines.push(
            `  Auto layout:     ${al.VERTICAL ?? 0} vertical, ${al.HORIZONTAL ?? 0} horizontal, ` +
              `${al.NONE ?? 0} none`
          );
        }

        lines.push(section("HOW TO USE THIS"));
        lines.push(
          "  1. Reuse an existing component or variant exactly when it fits.\n" +
            "  2. Compose existing components when it does not.\n" +
            "  3. Extend the system — a new variant using existing tokens — when needed.\n" +
            "  4. Create something genuinely new only as a last resort.\n" +
            "  Bind colours with apply_variable_to_node; apply text styles with\n" +
            "  set_text_style_id; instantiate with create_component_instance.\n" +
            "  Use the values listed above rather than inventing new ones."
        );

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text:
                `Could not read the local design system: ${detail}\n\n` +
                "This needs the Figma plugin connected. Run join_channel first, or " +
                "check_figma_connection to diagnose.",
            },
          ],
        };
      }
    }
  );
}
