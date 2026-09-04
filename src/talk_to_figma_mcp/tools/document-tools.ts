import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, joinChannel } from "../utils/websocket";
import { filterFigmaNode } from "../utils/figma-helpers";
import { coerceJson } from "../utils/schema-helpers";
import { catalogueSummary } from "../skills/integration";

/**
 * Register document-related tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerDocumentTools(server: McpServer): void {
  // Document Info Tool
  server.tool(
    "get_document_info",
    "Get detailed information about the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_document_info");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Selection Tool
  server.tool(
    "get_selection",
    "Read what the user currently has selected in Figma, with each node's full " +
      "ancestor path and its enclosing SECTION. " +
      "CALL THIS FIRST — before asking any clarifying question — whenever the user " +
      "refers to their selection rather than naming a node: 'the selected section', " +
      "'this frame', 'these cards', 'update this', 'the one I picked', 'here', " +
      "'current', or any bare 'it'/'that' pointing at the canvas. " +
      "The selection is the answer to 'which one?', so do not ask the user to choose " +
      "between sections, frames, or components while something is selected — read it. " +
      "Only ask when this returns selectionCount 0, or when the selection genuinely " +
      "cannot satisfy the request (for example they asked about a section and neither " +
      "the selected node nor any of its ancestors is one). " +
      "If the user wants to rename the selected layer(s) or group, do NOT ask what to name them; " +
      "inspect their children with get_nodes_info and rename them autonomously using frontend " +
      "semantic conventions (Prefix-DescriptiveName, following Layer_Rename_v1).",
    {},
    async () => {
      try {
        const result = (await sendCommandToFigma("get_selection")) as {
          selectionCount?: number;
          selection?: Array<{ id?: string; name?: string; type?: string; childCount?: number }>;
        };
        let text = JSON.stringify(result);
        if (result && typeof result.selectionCount === "number" && result.selectionCount > 0) {
          text +=
            "\n\n[Workflow Directive: If renaming these layers, NEVER ask the user what to name them. " +
            "Inspect their children with get_nodes_info, decide semantic names (Prefix-DescriptiveName in PascalCase), " +
            "and rename them immediately with figma_batch or rename_node.]";
        }
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Node Info Tool
  server.tool(
    "get_node_info",
    "Get detailed information about a specific node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to get information about"),
      depth: z.number().int().min(0).optional().describe("How many child levels to include in full detail. Deeper levels return only id/name/type stubs."),
    },
    async ({ nodeId, depth }) => {
      try {
        const result = await sendCommandToFigma("get_node_info", { nodeId });
        const filtered = filterFigmaNode(result, depth ?? 1);
        const coordinateNote = filtered.absoluteBoundingBox && filtered.localPosition
          ? "absoluteBoundingBox contains global coordinates (relative to canvas). localPosition contains local coordinates (relative to parent, use these for move_node)."
          : undefined;

        const payload = coordinateNote ? { ...filtered, _note: coordinateNote } : filtered;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Nodes Info Tool
  server.tool(
    "get_nodes_info",
    "Get detailed information about multiple nodes in Figma",
    {
      nodeIds: coerceJson(z.array(z.string())).describe("Array of node IDs to get information about"),
      depth: z.number().int().min(0).optional().describe("How many child levels to include in full detail. Deeper levels return only id/name/type stubs.")
    },
    async ({ nodeIds, depth }) => {
      try {
        const results = await sendCommandToFigma('get_nodes_info', { nodeIds }) as any[];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results.map((result) => filterFigmaNode(result.document || result.info, depth ?? 1)))
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Get Styles Tool
  server.tool(
    "get_styles",
    "Get all styles from the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_styles");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting styles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Local Components Tool
  server.tool(
    "get_local_components",
    "Get all local components from the Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_local_components");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting local components: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Remote Components Tool
  server.tool(
    "get_remote_components",
    "Get available components from team libraries in Figma",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_remote_components");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting remote components: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node",
    {
      nodeId: z.string().describe("ID of the node to scan"),
    },
    async ({ nodeId }) => {
      try {
        // Initial response to indicate we're starting the process
        const initialStatus = {
          type: "text" as const,
          text: "Starting text node scanning. This may take a moment for large designs...",
        };

        // Use the plugin's scan_text_nodes function with chunking flag
        const result = await sendCommandToFigma("scan_text_nodes", {
          nodeId,
          useChunking: true,  // Enable chunking on the plugin side
          // Larger chunks now that scanning no longer pauses on every node:
          // fewer chunks means fewer progress round trips and a faster scan.
          chunkSize: 25
        });

        // If the result indicates chunking was used, format the response accordingly
        if (result && typeof result === 'object' && 'chunks' in result) {
          const typedResult = result as {
            success: boolean,
            totalNodes: number,
            processedNodes: number,
            chunks: number,
            textNodes: Array<any>
          };

          const summaryText = `
          Scan completed:
          - Found ${typedResult.totalNodes} text nodes
          - Processed in ${typedResult.chunks} chunks
          `;

          return {
            content: [
              initialStatus,
              {
                type: "text" as const,
                text: summaryText
              },
              {
                type: "text" as const,
                text: JSON.stringify(typedResult.textNodes, null, 2)
              }
            ],
          };
        }

        // If chunking wasn't used or wasn't reported in the result format, return the result as is
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning text nodes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Join Channel Tool
  server.tool(
    "join_channel",
    "Join a specific channel to communicate with Figma",
    {
      channel: z.string().describe("The name of the channel to join"),
    },
    async ({ channel }) => {
      try {
        if (!channel) {
          // If no channel provided, ask the user for input
          return {
            content: [
              {
                type: "text",
                text: "Please provide a channel name to join:",
              },
            ],
            followUp: {
              tool: "join_channel",
              description: "Join the specified channel",
            },
          };
        }

        // Use joinChannel instead of sendCommandToFigma to ensure currentChannel is updated
        await joinChannel(channel);

        // Every Figma session starts here, which makes this the one place
        // guaranteed to put the skill catalogue in context before any work
        // begins. Without it a skill is only found by a model that thought to
        // go looking — and for a task that looks simple, it never does.
        const catalogue = catalogueSummary();
        const text = catalogue
          ? `Successfully joined channel: ${channel}\n\n` +
            `Skills available for this session — load one with figma_skill({name}) BEFORE ` +
            `starting any task it covers, and follow it rather than improvising:\n${catalogue}`
          : `Successfully joined channel: ${channel}`;

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error joining channel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Export Node as Image Tool
  server.tool(
    "export_node_as_image",
    "Export a node as an image from Figma",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z
        .enum(["PNG", "JPG", "SVG", "PDF"])
        .optional()
        .describe("Export format"),
      scale: z.coerce.number().positive().optional().describe("Export scale"),
    },
    async ({ nodeId, format, scale }) => {
      try {
        const result = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: format || "PNG",
          scale: scale || 1,
        }, 120000); // 120 second timeout for image export
        const typedResult = result as { imageData: string; mimeType: string };

        return {
          content: [
            {
              type: "image",
              data: typedResult.imageData,
              mimeType: typedResult.mimeType || "image/png",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Page Tool
  server.tool(
    "create_page",
    "Create a new page in the current Figma document",
    {
      name: z.string().describe("Name for the new page"),
    },
    async ({ name }) => {
      try {
        const result = await sendCommandToFigma("create_page", { name });
        const typedResult = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Created page "${typedResult.name}" with ID: ${typedResult.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Delete Page Tool
  server.tool(
    "delete_page",
    "Delete a page from the current Figma document",
    {
      pageId: z.string().describe("ID of the page to delete"),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("delete_page", { pageId });
        const typedResult = result as { success: boolean; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Deleted page "${typedResult.name}" successfully`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Rename Page Tool
  server.tool(
    "rename_page",
    "Rename an existing page in the Figma document",
    {
      pageId: z.string().describe("ID of the page to rename"),
      name: z.string().describe("New name for the page"),
    },
    async ({ pageId, name }) => {
      try {
        const result = await sendCommandToFigma("rename_page", { pageId, name });
        const typedResult = result as { id: string; name: string; oldName: string };
        return {
          content: [
            {
              type: "text",
              text: `Renamed page from "${typedResult.oldName}" to "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Pages Tool
  server.tool(
    "get_pages",
    "Get all pages in the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_pages");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting pages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Current Page Tool
  server.tool(
    "set_current_page",
    "DEPRECATED — this stateful command is blocked by the relay server. Instead, pass the target page's node ID as parentId on creation commands (e.g., create_rectangle, create_frame). Use get_pages to discover page IDs.",
    {
      pageId: z.string().describe("ID of the page to switch to"),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("set_current_page", { pageId });
        const typedResult = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Switched to page "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error switching page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Duplicate Page Tool
  server.tool(
    "duplicate_page",
    "Duplicate an existing page in the Figma document, creating a complete copy of all its contents",
    {
      pageId: z.string().describe("ID of the page to duplicate"),
      name: z.string().optional().describe("Optional name for the duplicated page (defaults to 'Original Name (Copy)')"),
    },
    async ({ pageId, name }) => {
      try {
        const result = await sendCommandToFigma("duplicate_page", { pageId, name });
        const typedResult = result as { id: string; name: string; originalName: string };
        return {
          content: [
            {
              type: "text",
              text: `Duplicated page "${typedResult.originalName}" → "${typedResult.name}" with ID: ${typedResult.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error duplicating page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get File Key Tool
  server.tool(
    "get_file_key",
    "Get the Figma file key and file metadata for the current document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_file_key");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting file key: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set File Key Tool
  server.tool(
    "set_file_key",
    "Configure or update the Figma file key or file URL for the active session. This sets the fallback " +
      "file key used by REST API tools (such as comments) when figma.fileKey is unavailable or null in the plugin.",
    {
      fileKey: z.string().optional().describe("Figma file key (the segment after /design/ or /file/ in the URL)"),
      url: z.string().optional().describe("Full Figma file URL (e.g. 'https://www.figma.com/design/XXXX/My-File')"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("set_file_key", args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting file key: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Execute Code Tool
  server.tool(
    "execute_code",
    "Execute arbitrary JavaScript code directly inside the Figma Plugin environment. 'figma' and 'params' " +
      "are in scope. Supports async/await. Returns the evaluated result. Use when an operation is not covered " +
      "by existing tools or when performing custom batch operations.",
    {
      code: z.string().describe("JavaScript code to execute in Figma plugin context"),
      params: z.any().optional().describe("Optional parameters object accessible via 'params' inside the script"),
    },
    async (args) => {
      try {
        const result = await sendCommandToFigma("execute_code", args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing code in Figma: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}