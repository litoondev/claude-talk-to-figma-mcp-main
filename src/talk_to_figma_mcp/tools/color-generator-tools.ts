/**
 * Color Generator MCP Tools
 * Exposes color generation capabilities to Claude
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generateColorScale,
  adjustScaleSaturation,
  formatColorScale,
  exportAsVariableDefinitions,
  hexToRgb,
  rgbToHsl,
} from "../utils/color-generator.js";

export function registerColorGeneratorTools(server: McpServer): void {
  /**
   * Generate a Tailwind-like color scale from a base hex color
   */
  server.tool(
    "generate_color_scale",
    "Generate a Tailwind CSS-like color scale from a base hex color. Creates 11 color stops " +
      "(50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950) using HSL lightness adjustments. " +
      "Perfect for creating consistent color palettes for your design system. " +
      "Use this to generate colors, then create_color_variables to add them to Figma.",
    {
      baseColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .describe("Base color as hex code (e.g., '#8C41F1')"),
      colorName: z
        .string()
        .optional()
        .describe("Name for the color palette (e.g., 'Primary', 'Violet', 'Electric'). Defaults to 'Color'."),
      saturationAdjustment: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("Multiply saturation by this factor (0.5 = desaturated, 1.5 = more vibrant). Default is 1.0 (no adjustment)."),
    },
    async (args) => {
      try {
        let scale = generateColorScale(args.baseColor, args.colorName || "Color");

        if (args.saturationAdjustment && args.saturationAdjustment !== 1) {
          scale = adjustScaleSaturation(scale, args.saturationAdjustment);
        }

        const formatted = formatColorScale(scale);

        return {
          content: [
            {
              type: "text",
              text: formatted + "\n\n✓ Use `create_color_variables` to add these to your Figma design system.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating color scale: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  /**
   * Create Figma variables from a generated color scale
   */
  server.tool(
    "create_color_variables",
    "Create Figma color variables from a generated color scale. " +
      "First generate a scale with generate_color_scale, then use this tool to create all 11 variables " +
      "in your Figma design system. Variables are created in the specified collection with naming like " +
      "'ColorName/50', 'ColorName/100', etc. Existing variables are updated, new ones are created.",
    {
      baseColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .describe("Base color as hex code (e.g., '#8C41F1')"),
      colorName: z
        .string()
        .optional()
        .describe("Name for the color palette (e.g., 'Primary', 'Violet'). Defaults to 'Color'."),
      collectionName: z
        .string()
        .optional()
        .describe("Figma variable collection name (e.g., 'Colors', 'Design Tokens'). Creates if it doesn't exist."),
      saturationAdjustment: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("Multiply saturation by this factor before creating variables (optional)."),
    },
    async (args) => {
      try {
        let scale = generateColorScale(args.baseColor, args.colorName || "Color");

        if (args.saturationAdjustment && args.saturationAdjustment !== 1) {
          scale = adjustScaleSaturation(scale, args.saturationAdjustment);
        }

        const collectionName = args.collectionName || "Colors";
        const variables = exportAsVariableDefinitions(scale, collectionName);

        // Format as a summary for the user
        const summary = [
          `📦 Creating ${variables.length} color variables in '${collectionName}' collection:`,
          `   ${scale.name} palette (${args.baseColor})`,
          "",
          "Variable names:",
        ];

        [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach(weight => {
          const stop = scale.stops[weight];
          summary.push(`  • ${stop.name.padEnd(20)} = ${stop.hex}`);
        });

        summary.push(
          "",
          "Next steps:",
          "1. Call figma_batch with these operations:",
          ...variables.map((v, i) =>
            `   ${JSON.stringify(v)}${i < variables.length - 1 ? ',' : ''}`
          ),
          "",
          "Or use set_variable individually for each one."
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
              text: `Error creating color variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  /**
   * Analyze a hex color
   */
  server.tool(
    "analyze_color",
    "Analyze a hex color and return its RGB and HSL components. Useful for understanding " +
      "a color before generating variations.",
    {
      hexColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .describe("Color as hex code (e.g., '#8C41F1')"),
    },
    async (args) => {
      try {
        const rgb = hexToRgb(args.hexColor);
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

        const analysis = [
          `Color Analysis: ${args.hexColor}`,
          "",
          `RGB: rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
          `HSL: hsl(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)`,
          "",
          "Components:",
          `  • Hue:        ${hsl.h}° (0-360)`,
          `  • Saturation: ${hsl.s}% (0-100)`,
          `  • Lightness:  ${hsl.l}% (0-100)`,
        ];

        return {
          content: [
            {
              type: "text",
              text: analysis.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error analyzing color: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
