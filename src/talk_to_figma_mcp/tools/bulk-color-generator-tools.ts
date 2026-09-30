/**
 * Bulk Color Scale Generator
 * Generates color scales for multiple existing colors at once
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generateColorScale,
  adjustScaleSaturation,
  exportAsVariableDefinitions,
  hexToRgb,
  rgbToHsl,
  rgbToHex,
} from "../utils/color-generator.js";
import { sendCommandToFigma } from "../utils/websocket.js";

interface ColorDefinition {
  name: string;
  hex: string;
  saturationAdjustment?: number;
}

export function registerBulkColorGeneratorTools(server: McpServer): void {
  /**
   * Bulk generate color scales from a list of hex colors
   */
  server.tool(
    "generate_bulk_color_scales",
    "Generate Tailwind-like color scales for multiple colors at once. " +
      "Pass an array of color names and hex values, and get all scales generated. " +
      "Perfect for building complete design system palettes (Primary, Secondary, Accent, etc.). " +
      "Use this before create_bulk_color_variables to create everything in Figma.",
    {
      colors: z
        .array(
          z.object({
            name: z.string().describe("Color name (e.g., 'Primary', 'Secondary')"),
            hex: z
              .string()
              .regex(/^#[0-9A-Fa-f]{6}$/)
              .describe("Hex color code (e.g., '#0066FF')"),
            saturationAdjustment: z
              .number()
              .min(0)
              .max(2)
              .optional()
              .describe("Optional saturation multiplier (0-2)"),
          })
        )
        .describe("Array of color definitions to generate scales for"),
    },
    async (args) => {
      try {
        const scales = args.colors.map(color => {
          let scale = generateColorScale(color.hex, color.name);
          if (color.saturationAdjustment && color.saturationAdjustment !== 1) {
            scale = adjustScaleSaturation(scale, color.saturationAdjustment);
          }
          return scale;
        });

        const summary = [
          `📦 Generated ${scales.length} color scales:`,
          "",
        ];

        scales.forEach(scale => {
          summary.push(`✓ ${scale.name.padEnd(20)} (${scale.baseColor})`);
          summary.push(
            `  50: ${scale.stops[50].hex} | 500: ${scale.stops[500].hex} | 950: ${scale.stops[950].hex}`
          );
        });

        summary.push(
          "",
          "Next: Call create_bulk_color_variables with these colors to add them to Figma."
        );

        return {
          content: [
            {
              type: "text",
              text: summary.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating bulk scales: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  /**
   * Create bulk color variables in Figma
   */
  server.tool(
    "create_bulk_color_variables",
    "Create Figma color variables for multiple color scales at once. " +
      "Pass an array of color definitions (name and hex) and optionally specify the collection. " +
      "This creates 11 variables per color (50-950) in a single operation — far more efficient than one-by-one creation.",
    {
      colors: z
        .array(
          z.object({
            name: z.string().describe("Color name (e.g., 'Primary', 'Secondary')"),
            hex: z
              .string()
              .regex(/^#[0-9A-Fa-f]{6}$/)
              .describe("Hex color code"),
            saturationAdjustment: z
              .number()
              .min(0)
              .max(2)
              .optional()
              .describe("Optional saturation multiplier"),
          })
        )
        .describe("Array of color definitions"),
      collectionName: z
        .string()
        .optional()
        .describe("Figma collection name (default: 'Colors')"),
    },
    async (args) => {
      try {
        const collectionName = args.collectionName || "Colors";
        const allVariables = [];

        // Generate scales and collect all variables
        args.colors.forEach(color => {
          let scale = generateColorScale(color.hex, color.name);
          if (color.saturationAdjustment && color.saturationAdjustment !== 1) {
            scale = adjustScaleSaturation(scale, color.saturationAdjustment);
          }
          const variables = exportAsVariableDefinitions(scale, collectionName);
          allVariables.push(...variables);
        });

        // Group by color for reporting
        const report = [
          `📦 Creating ${allVariables.length} color variables in "${collectionName}" collection`,
          "",
          "Colors and their 50/500/950 stops:",
        ];

        const colorNames = new Set<string>();
        allVariables.forEach(v => {
          const colorName = v.name.split("/")[0];
          colorNames.add(colorName);
        });

        colorNames.forEach(colorName => {
          const stops = allVariables.filter(v => v.name.startsWith(colorName + "/"));
          if (stops.length > 0) {
            const stop50 = stops.find(s => s.name.endsWith("/50"));
            const stop500 = stops.find(s => s.name.endsWith("/500"));
            const stop950 = stops.find(s => s.name.endsWith("/950"));

            report.push(
              `  ${colorName}: ${stop50?.value || "?"} → ${stop500?.value || "?"} → ${stop950?.value || "?"}`
            );
          }
        });

        report.push(
          "",
          "Use figma_batch to create all variables efficiently:",
          `figma_batch with ${allVariables.length} set_variable operations`
        );

        // Return the variables in a format suitable for figma_batch
        return {
          content: [
            {
              type: "text",
              text: report.join("\n"),
            },
            {
              type: "text",
              text: `Variables ready for figma_batch:\n${JSON.stringify(allVariables, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating bulk variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  /**
   * Extract colors from existing Figma variables and generate scales
   */
  server.tool(
    "extract_and_scale_colors",
    "Read existing Figma variables/colors by name pattern, generate scales for them, " +
      "and prepare to create the new variables. Example: pass ['Primary', 'Secondary', 'Accent'] " +
      "to read the current Primary, Secondary, and Accent colors from your file, generate their scales, " +
      "and show what will be created. Perfect for upgrading an existing simple color system to a full token set.",
    {
      colorNames: z
        .array(z.string())
        .describe(
          "Names of colors to extract (e.g., ['Primary', 'Secondary', 'Accent']). " +
            "These should match existing variable names or styles in your Figma file."
        ),
      collectionName: z
        .string()
        .optional()
        .describe("Figma collection to read from (default: 'Colors')"),
      outputCollectionName: z
        .string()
        .optional()
        .describe("Collection name for new scaled variables (default: same as input collection)"),
    },
    async (args) => {
      try {
        const readCollection = args.collectionName || "Colors";
        const writeCollection = args.outputCollectionName || readCollection;

        // Try to read the variables from Figma
        const readResult = await sendCommandToFigma("get_variables", {
          collectionName: readCollection,
          includeValues: true,
        });

        const variables = (readResult as any).variables || [];
        const foundColors: ColorDefinition[] = [];

        // Match requested color names
        args.colorNames.forEach(requestedName => {
          const matchedVar = variables.find((v: any) =>
            v.name.toLowerCase().includes(requestedName.toLowerCase())
          );

          if (matchedVar && matchedVar.valuesByMode) {
            const value = Object.values(matchedVar.valuesByMode)[0];
            if (
              value &&
              typeof value === "object" &&
              "r" in value &&
              "g" in value &&
              "b" in value
            ) {
              const rgb = value as { r: number; g: number; b: number };
              const hex = rgbToHex(
                Math.round(rgb.r * 255),
                Math.round(rgb.g * 255),
                Math.round(rgb.b * 255)
              );
              foundColors.push({
                name: requestedName,
                hex,
              });
            }
          }
        });

        if (foundColors.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  `No matching colors found in "${readCollection}" collection. ` +
                  `Tried to find: ${args.colorNames.join(", ")}. ` +
                  `Available variables: ${variables.map((v: any) => v.name).join(", ")}`,
              },
            ],
          };
        }

        // Generate scales
        const scales = foundColors.map(color => generateColorScale(color.hex, color.name));

        const report = [
          `✓ Found ${foundColors.length} colors in "${readCollection}" collection:`,
          "",
        ];

        foundColors.forEach((color, i) => {
          report.push(`  ${color.name}: ${color.hex}`);
        });

        report.push(
          "",
          `Will create ${scales.length * 11} variables in "${writeCollection}" collection`,
          "",
          "Preview (50 / 500 / 950):"
        );

        scales.forEach(scale => {
          report.push(
            `  ${scale.name}: ${scale.stops[50].hex} → ${scale.stops[500].hex} → ${scale.stops[950].hex}`
          );
        });

        report.push(
          "",
          `Next: Call create_bulk_color_variables with these colors to create all scales:`
        );

        const colorsForCreate = foundColors.map(c => ({
          name: c.name,
          hex: c.hex,
        }));

        report.push(JSON.stringify(colorsForCreate));

        return {
          content: [
            {
              type: "text",
              text: report.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error extracting colors: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
