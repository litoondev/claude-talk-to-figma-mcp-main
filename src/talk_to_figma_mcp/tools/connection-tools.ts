/**
 * Connection diagnostic and cross-verification tools.
 *
 * WHY THIS EXISTS
 * ---------------
 * The MCP server uses TWO separate Figma connections:
 *
 *   1. Plugin bridge (WebSocket relay) — all design read/write operations.
 *      Authenticated by the Figma plugin running in the user's browser.
 *
 *   2. REST API (api.figma.com) — comments only, plus cross-verification.
 *      Authenticated by FIGMA_ACCESS_TOKEN (personal access token).
 *
 * These are completely independent.  The plugin bridge can be connected while
 * the REST token is missing, wrong, or scoped to a different account — which
 * is exactly the scenario that caused the "this integration doesn't have access
 * to this file" error when attempting REST cross-verification.
 *
 * Tools registered here let Claude (and the user) understand what's available
 * BEFORE attempting an operation, avoiding confusing mid-task failures.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getFigmaToken,
  hasFigmaToken,
  getCurrentUser,
  getFileMetadata,
  getFileNodes,
  FigmaRestError,
} from "../utils/figma-rest";
import { sendCommandToFigma, joinChannel } from "../utils/websocket";

// ---------------------------------------------------------------------------
// Helper: extract file key from a Figma URL or bare key
// ---------------------------------------------------------------------------

function parseFileKey(input: string): string {
  // Full URL: https://www.figma.com/file/<key>/... or /design/<key>/...
  const match = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  // Bare key (alphanumeric, typically 22 chars)
  if (/^[a-zA-Z0-9]{10,}$/.test(input.trim())) return input.trim();
  throw new Error(
    `Cannot parse a Figma file key from "${input}". ` +
      "Pass either a full figma.com URL or the bare file key."
  );
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerConnectionTools(server: McpServer): void {
  // ── 1. check_figma_connection ─────────────────────────────────────────────
  server.tool(
    "check_figma_connection",
    "Diagnose both Figma connections — the plugin bridge (WebSocket) and the REST API " +
      "(FIGMA_ACCESS_TOKEN). Call this before attempting REST cross-verification to know " +
      "whether it will succeed. Optionally pass a fileKey or Figma URL to also confirm " +
      "that the REST token has view access to that specific file. " +
      "Returns a structured status for each transport so you can decide the best " +
      "verification strategy without hitting a confusing mid-task failure.",
    {
      channel: z
        .string()
        .optional()
        .describe(
          "WebSocket channel name to test the plugin bridge on. " +
            "If omitted the check skips the plugin bridge ping."
        ),
      fileKeyOrUrl: z
        .string()
        .optional()
        .describe(
          "Figma file key or full figma.com URL. When provided, the REST check also " +
            "confirms whether the token can access that specific file."
        ),
    },
    async ({ channel, fileKeyOrUrl }) => {
      const report: Record<string, unknown> = {};

      // ── Plugin bridge ──────────────────────────────────────────────────────
      if (channel) {
        try {
          await joinChannel(channel);
          const result = await sendCommandToFigma("get_document_info", {});
          report.pluginBridge = {
            status: "connected",
            fileKey: (result as any)?.fileKey ?? null,
            fileName: (result as any)?.name ?? null,
          };
        } catch (err) {
          report.pluginBridge = {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
            hint: "Make sure the Figma plugin is open and joined to this channel.",
          };
        }
      } else {
        report.pluginBridge = {
          status: "skipped",
          hint: "Pass `channel` to also test the plugin bridge.",
        };
      }

      // ── REST token ────────────────────────────────────────────────────────
      if (!hasFigmaToken()) {
        report.restApi = {
          status: "no_token",
          message:
            "FIGMA_ACCESS_TOKEN is not set. REST-based features (comments, cross-verification) " +
            "are unavailable.",
          fix:
            "Create a personal access token at https://www.figma.com/developers/api#access-tokens " +
            "(scopes: files:read, file_comments:write) and add it to the MCP server env:\n" +
            '  "env": { "FIGMA_ACCESS_TOKEN": "figd_your_token_here" }',
        };
      } else {
        try {
          const me = await getCurrentUser();
          report.restApi = {
            status: "connected",
            account: { id: me.id, handle: me.handle, email: me.email ?? null },
          };
        } catch (err) {
          report.restApi = {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
            hint:
              err instanceof FigmaRestError && (err.status === 401 || err.status === 403)
                ? "The token is present but Figma rejected it. Regenerate it and update FIGMA_ACCESS_TOKEN."
                : "Unexpected REST API error — check network connectivity.",
          };
        }
      }

      // ── Per-file access check ─────────────────────────────────────────────
      if (fileKeyOrUrl && (report.restApi as any)?.status === "connected") {
        try {
          const fileKey = parseFileKey(fileKeyOrUrl);
          const meta = await getFileMetadata(fileKey);
          (report.restApi as any).fileAccess = {
            fileKey,
            accessible: true,
            fileName: meta.name,
            lastModified: meta.lastModified,
          };
        } catch (err) {
          (report.restApi as any).fileAccess = {
            accessible: false,
            message: err instanceof Error ? err.message : String(err),
            hint:
              "The REST token is valid but cannot access this file. " +
              "Ensure the token's Figma account has at least viewer access to the file.",
          };
        }
      }

      // ── Summary ───────────────────────────────────────────────────────────
      const pluginOk = (report.pluginBridge as any)?.status === "connected";
      const restOk = (report.restApi as any)?.status === "connected";
      const fileOk = (report.restApi as any)?.fileAccess?.accessible ?? null;

      report.summary = {
        pluginBridge: pluginOk ? "✅ connected" : "⚠️  " + (report.pluginBridge as any)?.status,
        restApi: restOk ? "✅ connected" : "⚠️  " + (report.restApi as any)?.status,
        ...(fileOk !== null
          ? { fileAccess: fileOk ? "✅ accessible" : "❌ not accessible" }
          : {}),
        crossVerificationAvailable:
          restOk && (fileOk === null || fileOk)
            ? "✅ yes — use get_node_via_rest to verify edits"
            : "❌ no — REST token missing or lacks file access; trust plugin bridge confirmation only",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }
  );

  // ── 2. get_node_via_rest ──────────────────────────────────────────────────
  server.tool(
    "get_node_via_rest",
    "Read one or more Figma nodes directly from Figma's servers via the REST API — " +
      "completely independent of the plugin bridge. Use this to cross-verify that a " +
      "plugin edit was actually persisted (not just reported as saved locally). " +
      "Requires FIGMA_ACCESS_TOKEN with files:read scope and view access to the file. " +
      "If the token is missing or lacks access, call check_figma_connection first — " +
      "it will explain exactly what's wrong and how to fix it.",
    {
      fileKeyOrUrl: z
        .string()
        .describe("Figma file key (e.g. 'aBcDeFgHiJkL') or full figma.com URL."),
      nodeIds: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe(
          "Node IDs to fetch (e.g. ['1:23', '4:56']). " +
            "Get node IDs from get_node_info or get_selection via the plugin bridge."
        ),
    },
    async ({ fileKeyOrUrl, nodeIds }) => {
      // Friendly pre-check: surface token issues before hitting the API
      if (!hasFigmaToken()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "no_token",
                  message:
                    "FIGMA_ACCESS_TOKEN is not set — REST cross-verification is unavailable.",
                  fix:
                    "Create a personal access token at https://www.figma.com/developers/api#access-tokens " +
                    "(scope: files:read) and set it as FIGMA_ACCESS_TOKEN in the MCP server env.",
                  alternative:
                    "The plugin bridge already confirms edits in real time — " +
                    "use get_node_info via the plugin channel to verify instead.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      let fileKey: string;
      try {
        fileKey = parseFileKey(fileKeyOrUrl);
      } catch (err) {
        return {
          content: [{ type: "text", text: (err as Error).message }],
          isError: true,
        };
      }

      try {
        const data = await getFileNodes(fileKey, nodeIds);

        // Build a concise summary per requested node
        const nodes = nodeIds.map((id) => {
          const entry = data.nodes[id];
          if (!entry) {
            return { id, found: false };
          }
          const doc = entry.document;
          return {
            id,
            found: true,
            name: doc.name,
            type: doc.type,
            // Include a few common properties for quick inspection
            ...(doc.fills !== undefined ? { fills: doc.fills } : {}),
            ...(doc.characters !== undefined ? { characters: doc.characters } : {}),
            ...(doc.absoluteBoundingBox !== undefined
              ? { absoluteBoundingBox: doc.absoluteBoundingBox }
              : {}),
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  fileName: data.name,
                  fileKey,
                  source: "figma_rest_api",
                  note:
                    "This data comes directly from Figma's servers, independent of the plugin bridge.",
                  nodes,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const isAccess =
          err instanceof FigmaRestError && (err.status === 401 || err.status === 403 || err.status === 404);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: isAccess ? "access_denied" : "rest_api_error",
                  message: err instanceof Error ? err.message : String(err),
                  hint: isAccess
                    ? "The REST token's Figma account cannot access this file. " +
                      "Run check_figma_connection with this fileKey to diagnose. " +
                      "Possible causes: (1) token belongs to a different account than the plugin, " +
                      "(2) file is not shared with the token's account, " +
                      "(3) token lacks files:read scope."
                    : "Unexpected error — check FIGMA_ACCESS_TOKEN and network connectivity.",
                  alternative:
                    "Use get_node_info via the plugin bridge to read node state instead.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
