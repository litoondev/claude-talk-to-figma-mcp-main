/**
 * Token spend reporting — tell the user what the work cost.
 *
 * WHY THIS EXISTS
 * ---------------
 * A single Figma task can run dozens of tool calls, and the expensive ones are
 * not the obvious ones: reading a deep node tree costs far more than creating a
 * frame. None of that was visible to the person paying for it.
 *
 * `get_token_usage` closes that gap. The server tallies every tool call as it
 * happens (see utils/token-usage.ts) and this tool renders the tally, so the
 * agent can end a task with a one-line cost footer.
 *
 * The figure covers *this bridge only*. The server cannot see the conversation,
 * so it cannot report a session total for the model — and the tool's output says
 * so, to stop the number being quoted as something it is not.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatUsageReport,
  getSessionUsage,
  getTaskUsage,
  resetTaskUsage,
} from "../utils/token-usage";
import { textResponse } from "../utils/respond";

export function registerUsageTools(server: McpServer): void {
  server.tool(
    "get_token_usage",
    "Report the estimated token cost of the Figma tool calls made so far — total, " +
      "split into sent/received, with a per-tool breakdown of the most expensive " +
      "operations. Call this once at the end of a task and show the result to the " +
      "user so they can see what the work cost. Covers traffic over this Figma " +
      "bridge only (the server cannot see the rest of the conversation), and counts " +
      "are estimated from payload size, not tokenizer output.",
    {
      scope: z
        .enum(["task", "session"])
        .optional()
        .describe(
          "'task' (default) reports spend since the last reset — use this for an " +
            "end-of-task summary. 'session' reports everything since the relay started."
        ),
      reset: z
        .boolean()
        .optional()
        .describe(
          "Start a fresh task window after reporting, so the next task's figure is " +
            "measured from zero. Defaults to true when scope is 'task'. Session " +
            "totals are never reset."
        ),
      topTools: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("How many tools to list in the breakdown (default 5, 0 for none)."),
      format: z
        .enum(["text", "json"])
        .optional()
        .describe(
          "'text' (default) returns a short block ready to show the user; 'json' " +
            "returns the raw numbers."
        ),
    },
    async ({ scope, reset, topTools, format }) => {
      const window = scope ?? "task";
      const usage =
        window === "session" ? getSessionUsage(topTools ?? 5) : getTaskUsage(topTools ?? 5);

      // Reporting a task is what ends it, so the window rolls over by default.
      // A session report is a read of a cumulative counter and never resets.
      if (window === "task" && (reset ?? true)) resetTaskUsage();

      return format === "json"
        ? textResponse(JSON.stringify(usage))
        : textResponse(formatUsageReport(usage));
    }
  );
}
