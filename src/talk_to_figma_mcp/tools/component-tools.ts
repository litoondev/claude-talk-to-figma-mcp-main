import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson } from "../utils/schema-helpers";

/**
 * Register component-related tools to the MCP server
 * This module contains tools for working with components in Figma
 * @param server - The MCP server instance
 */
export function registerComponentTools(server: McpServer): void {
  // Create Component Instance Tool
  server.tool(
    "create_component_instance",
    "Create an instance of a component in Figma",
    {
      componentKey: z.string().describe("Key of the component to instantiate"),
      x: z.coerce.number().describe("X position (local coordinates, relative to parent)"),
      y: z.coerce.number().describe("Y position (local coordinates, relative to parent)"),
      parentId: z.string().optional().describe("Parent node ID. REQUIRED — server enforces this. Use page node ID for top-level elements. Get page IDs via get_pages tool."),
    },
    async ({ componentKey, x, y, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_component_instance", {
          componentKey,
          x,
          y,
          parentId,
        });
        const typedResult = result as any;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(typedResult),
            }
          ]
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component instance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Component from Node Tool
  server.tool(
    "create_component_from_node",
    "Convert an existing node (frame, group, etc.) into a reusable component in Figma",
    {
      nodeId: z.string().describe("The ID of the node to convert into a component"),
      name: z.string().optional().describe("Optional new name for the component"),
      parentId: z.string().optional().describe("Parent node ID. REQUIRED — server enforces this. Use page node ID for top-level elements. Get page IDs via get_pages tool."),
    },
    async ({ nodeId, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_component_from_node", {
          nodeId,
          name,
          parentId,
        });
        const typedResult = result as { id: string; name: string; key: string };
        return {
          content: [
            {
              type: "text",
              text: `Created component "${typedResult.name}" with ID: ${typedResult.id} and key: ${typedResult.key}. You can now create instances of this component using the key.`,
            }
          ]
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component from node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Component Set from Components Tool
  server.tool(
    "create_component_set",
    "Create a component set (variants) from multiple component nodes in Figma",
    {
      componentIds: coerceJson(z.array(z.string())).describe("Array of component node IDs to combine into a component set"),
      name: z.string().optional().describe("Optional name for the component set"),
      parentId: z.string().optional().describe("Parent node ID. REQUIRED — server enforces this. Use page node ID for top-level elements. Get page IDs via get_pages tool."),
    },
    async ({ componentIds, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_component_set", {
          componentIds,
          name,
          parentId,
        });
        const typedResult = result as { id: string; name: string; key: string; variantCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Created component set "${typedResult.name}" with ID: ${typedResult.id}, key: ${typedResult.key}, containing ${typedResult.variantCount} variants.`,
            }
          ]
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component set: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Instance Variant Tool
  server.tool(
    "set_instance_variant",
    "Change the variant properties of a component instance without recreating it. This preserves instance overrides and is more efficient than delete + create workflow.",
    {
      nodeId: z.string().describe("The ID of the instance node to modify"),
      properties: coerceJson(z.record(z.string())).describe("Variant properties to set as key-value pairs (e.g., { \"State\": \"Hover\", \"Size\": \"Large\" })"),
    },
    async ({ nodeId, properties }) => {
      try {
        const result = await sendCommandToFigma("set_instance_variant", {
          nodeId,
          properties,
        });
        const typedResult = result as { id: string; name: string; properties: Record<string, string> };
        return {
          content: [
            {
              type: "text",
              text: `Successfully changed variant properties of instance "${typedResult.name}" (ID: ${typedResult.id}). New properties: ${JSON.stringify(typedResult.properties)}`,
            }
          ]
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting instance variant: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Reactions Tool (Prototype Interactions)
  server.tool(
    "set_reactions",
    "Set prototype interactions (reactions) on a node in Figma: navigation, overlays, hover/press states, key and timeout triggers, links, and variable actions. " +
      "For component variants, set on the default variant to add 'While hovering -> Change to hover variant'. " +
      "Every field declared here reaches Figma; a field this schema does not declare is dropped, so check the read-back in the result rather than assuming.",
    {
      nodeId: z.string().describe("The ID of the node to set reactions on"),
      reactions: coerceJson(
        z.array(
          z.object({
            trigger: z
              .object({
                type: z
                  .string()
                  .describe(
                    "ON_CLICK, ON_HOVER, ON_PRESS, ON_DRAG, MOUSE_ENTER, MOUSE_LEAVE, MOUSE_UP, MOUSE_DOWN, AFTER_TIMEOUT, ON_KEY_DOWN, ON_MEDIA_HIT, ON_MEDIA_END"
                  ),
                delay: z
                  .number()
                  .optional()
                  .describe("Delay before a MOUSE_* trigger fires"),
                timeout: z
                  .number()
                  .optional()
                  .describe("How long AFTER_TIMEOUT waits once the frame is shown"),
                deprecatedVersion: z
                  .boolean()
                  .optional()
                  .describe("Set false on MOUSE_ENTER/MOUSE_LEAVE for the current behaviour"),
                device: z
                  .string()
                  .optional()
                  .describe("KEYBOARD, for ON_KEY_DOWN"),
                keyCodes: z
                  .array(z.number())
                  .optional()
                  .describe("Key codes for ON_KEY_DOWN, e.g. [27] for Escape"),
                mediaHitTime: z
                  .number()
                  .optional()
                  .describe("Playback position in seconds, for ON_MEDIA_HIT"),
              })
              .describe("The trigger for this reaction"),
            actions: z
              .array(
                z.object({
                  type: z
                    .string()
                    .describe(
                      "NODE, BACK, CLOSE, URL, SET_VARIABLE, SET_VARIABLE_MODE, CONDITIONAL"
                    ),
                  destinationId: z
                    .string()
                    .optional()
                    .describe("Target node ID (for NODE type)"),
                  navigation: z
                    .string()
                    .optional()
                    .describe(
                      "NAVIGATE, SWAP or OVERLAY (top-level frame), SCROLL_TO (layer in the same frame), CHANGE_TO (variant of the same component set)"
                    ),
                  transition: z
                    .object({
                      type: z
                        .string()
                        .optional()
                        .describe(
                          "DISSOLVE, SMART_ANIMATE, SCROLL_ANIMATE, MOVE_IN, MOVE_OUT, PUSH, SLIDE_IN, SLIDE_OUT"
                        ),
                      direction: z
                        .string()
                        .optional()
                        .describe("LEFT, RIGHT, TOP or BOTTOM — required by the directional types"),
                      matchLayers: z
                        .boolean()
                        .optional()
                        .describe("Smart-animate matching layers during a directional transition"),
                      easing: z
                        .object({
                          type: z
                            .string()
                            .describe(
                              "EASE_IN, EASE_OUT, EASE_IN_AND_OUT, LINEAR, EASE_IN_BACK, EASE_OUT_BACK, EASE_IN_AND_OUT_BACK, GENTLE, QUICK, BOUNCY, SLOW, CUSTOM_CUBIC_BEZIER, CUSTOM_SPRING"
                            ),
                          easingFunctionCubicBezier: z
                            .object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() })
                            .optional()
                            .describe("Control points, for CUSTOM_CUBIC_BEZIER"),
                          easingFunctionSpring: z
                            .object({
                              mass: z.number(),
                              stiffness: z.number(),
                              damping: z.number(),
                            })
                            .optional()
                            .describe("Physical spring, for CUSTOM_SPRING (prototype springs, not Motion's {bounce})"),
                        })
                        .optional()
                        .describe("Easing"),
                      duration: z.number().optional().describe("Duration in seconds"),
                    })
                    .optional()
                    .describe("Transition animation"),
                  overlayRelativePosition: z
                    .object({
                      x: z.number(),
                      y: z.number(),
                    })
                    .optional()
                    .describe(
                      "Position of the overlay relative to the viewport top-left (for OVERLAY navigation)"
                    ),
                  overlayPositionType: z
                    .string()
                    .optional()
                    .describe(
                      "Written to the destination frame: CENTER, TOP_LEFT, TOP_CENTER, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_CENTER, BOTTOM_RIGHT or MANUAL. Omit to leave the frame's own setting alone"
                    ),
                  overlayBackgroundInteraction: z
                    .string()
                    .optional()
                    .describe(
                      "Written to the destination frame: NONE or CLOSE_ON_CLICK_OUTSIDE. Omit to leave the frame's own setting alone"
                    ),
                  url: z.string().optional().describe("Destination (for URL type)"),
                  openInNewTab: z.boolean().optional().describe("Open the URL in a new tab"),
                  variableId: z.string().optional().describe("For SET_VARIABLE"),
                  variableValue: z.any().optional().describe("For SET_VARIABLE — the typed value object"),
                  variableCollectionId: z.string().optional().describe("For SET_VARIABLE_MODE"),
                  variableModeId: z.string().optional().describe("For SET_VARIABLE_MODE"),
                  conditionalBlocks: z
                    .any()
                    .optional()
                    .describe("For CONDITIONAL — blocks of {condition, actions}; read one built in the UI first to copy its exact shape"),
                  // New fields from PR #82
                  resetVideoPosition: z.boolean().optional(),
                  resetScrollPosition: z.boolean().optional(),
                  resetInteractiveComponents: z.boolean().optional(),
                  preserveScrollPosition: z.boolean().optional(),
                })
              )
              .describe("Actions to perform when triggered"),
          })
        )
      ).describe("Array of reactions to set on the node"),
    },
    async ({ nodeId, reactions }) => {
      try {
        const result = await sendCommandToFigma("set_reactions", {
          nodeId,
          reactions,
        });
        const typedResult = result as Record<string, unknown>;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(typedResult),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting reactions: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Get Reactions (Prototype Interactions) Tool
  server.tool(
    "get_reactions",
    "Read all prototype interactions (reactions) from a node in Figma. Useful for debugging and inspecting existing interactions.",
    {
      nodeId: z.string().describe("The ID of the node to read reactions from"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_reactions", {
          nodeId,
        });
        const typedResult = result as Record<string, unknown>;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(typedResult),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting reactions: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Detach Instance Tool
  server.tool(
    "detach_instance",
    "Detach a component instance, converting it into a regular frame. This breaks the link with the main component.",
    {
      instanceId: z.string().describe("The ID of the instance to detach"),
    },
    async ({ instanceId }) => {
      try {
        const result = await sendCommandToFigma("detach_instance", { nodeId: instanceId });
        const typedResult = result as { success: boolean; frameId: string; frameName: string; frameType: string };
        return {
          content: [
            {
              type: "text",
              text: `✅ Detached instance "${typedResult.frameName}" (Original ID: ${instanceId})\nNew regular frame ID: ${typedResult.frameId}\nType: ${typedResult.frameType}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Error detaching instance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}