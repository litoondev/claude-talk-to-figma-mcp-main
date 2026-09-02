import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson, coerceBoolean } from "../utils/schema-helpers";
import { normalizeParams, resolveRefs } from "../utils/batch-refs";
import { nodeSummary, textResponse, errorResponse } from "../utils/respond";
import { logger } from "../utils/logger";

/**
 * Batch execution.
 *
 * Building one section normally costs 20–40 separate tool calls, and each call is
 * a full model turn: the whole conversation is re-read, the whole tool schema is
 * re-sent, and the round trip to the plugin is paid in wall-clock time. Batching
 * collapses that into a single turn, which is where most of the cost and latency
 * of a design session actually lives.
 *
 * Ops run sequentially — the Figma plugin processes one command at a time, and
 * later ops routinely depend on nodes earlier ops created.
 */

const OpSchema = z.object({
  command: z.string().describe("Figma command name — the same name as the equivalent single tool, e.g. 'create_frame', 'set_fill_color', 'set_auto_layout'"),
  params: z.record(z.any()).optional().describe("Parameters for the command, identical to the single tool's arguments"),
});

export function registerBatchTools(server: McpServer): void {
  server.tool(
    "figma_batch",
    "Run many Figma commands in ONE call. Strongly preferred over issuing the same commands one at a time: it is far cheaper and several times faster, because a batch costs one round trip instead of one per command. " +
      "Each op is {command, params} using the exact same name and arguments as the equivalent single tool. Ops run in order. " +
      "Use $N.field to reference an earlier op's result — e.g. create a frame at index 0, then pass \"$0.id\" as the parentId of later ops, or \"$last.id\" for the previous op. " +
      "This also reaches commands not advertised under the current profile. " +
      "Example: [{\"command\":\"create_frame\",\"params\":{\"x\":0,\"y\":0,\"width\":1440,\"height\":600,\"name\":\"Hero\",\"parentId\":\"1:2\"}},{\"command\":\"set_auto_layout\",\"params\":{\"nodeId\":\"$0.id\",\"layoutMode\":\"VERTICAL\",\"itemSpacing\":24}},{\"command\":\"create_text\",\"params\":{\"x\":0,\"y\":0,\"text\":\"Headline\",\"parentId\":\"$0.id\"}}]",
    {
      ops: coerceJson(z.array(OpSchema).min(1).max(100)).describe(
        "Ordered list of commands to execute, max 100"
      ),
      stopOnError: coerceBoolean
        .optional()
        .describe("Stop at the first failing op (default true). Set false to run every op and collect the failures."),
    },
    async ({ ops, stopOnError }) => {
      const halt = stopOnError !== false;
      const results: Array<Record<string, unknown> | null> = [];
      const report: Array<Record<string, unknown>> = [];
      let failed = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        try {
          const withRefs = resolveRefs(op.params ?? {}, results) as Record<string, unknown>;
          const params = normalizeParams(op.command, withRefs);

          const raw = await sendCommandToFigma(op.command as any, params);
          const summary = nodeSummary(raw);
          results.push(summary);
          report.push({ i, command: op.command, ok: true, ...summary });
        } catch (error) {
          failed++;
          results.push(null);
          const message = error instanceof Error ? error.message : String(error);
          report.push({ i, command: op.command, ok: false, error: message });
          logger.error(`[figma_batch] op ${i} (${op.command}) failed: ${message}`);

          if (halt) {
            report.push({
              i: i + 1,
              skipped: ops.length - i - 1,
              note: "remaining ops not run (stopOnError)",
            });
            break;
          }
        }
      }

      const ran = report.filter((entry) => entry.ok !== undefined).length;
      const header = `Batch: ${ran - failed}/${ops.length} succeeded${failed ? `, ${failed} failed` : ""}.`;

      try {
        return textResponse(`${header}\n${JSON.stringify(report)}`);
      } catch (error) {
        return errorResponse("serialising batch result", error);
      }
    }
  );
}
