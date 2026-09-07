/**
 * Token accounting for the Figma bridge.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every tool call spends context twice: once for the arguments the model writes,
 * and again for the result text, which is re-read on every subsequent turn. Until
 * now that spend was invisible — a session could burn tens of thousands of tokens
 * reading node trees and nobody, user or model, could see it happen.
 *
 * This module keeps a running tally so the work can be reported back: "that took
 * 47 calls and ~18k tokens, mostly get_node_info".
 *
 * WHAT IT CAN AND CANNOT SEE
 * --------------------------
 * An MCP server sits outside the model's context window. It cannot observe the
 * conversation, the system prompt, or the model's own reasoning, so it cannot
 * report the true total for a session — only the part it is itself responsible
 * for: the bytes crossing this bridge. Counts are estimates from character
 * length (~4 chars/token), not tokenizer output, and every surface says so.
 */

/**
 * Characters per token. Tool traffic is JSON and identifiers rather than prose,
 * which tokenizes slightly denser than English; 4.0 is the conventional estimate
 * and errs high, which is the safer direction for a cost figure.
 */
const CHARS_PER_TOKEN = 4;

/** Estimate the token cost of a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate the token cost of an arbitrary value, as it would be serialised. */
export function estimateValueTokens(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return estimateTokens(JSON.stringify(value) ?? "");
  } catch {
    // Circular or otherwise unserialisable params must never break a tool call.
    return 0;
  }
}

/**
 * Estimate what an MCP tool result costs the model. Only the text blocks count:
 * an image block's bytes are charged by the client, not carried as characters,
 * and counting its base64 length would wildly overstate the figure.
 */
export function estimateResponseTokens(result: unknown): number {
  const candidate = result as { content?: unknown } | null;
  if (!candidate || !Array.isArray(candidate.content)) return estimateValueTokens(result);

  let total = 0;
  for (const item of candidate.content as Array<Record<string, unknown>>) {
    if (item && item.type === "text" && typeof item.text === "string") {
      total += estimateTokens(item.text);
    }
  }
  return total;
}

interface ToolTally {
  calls: number;
  /** Tokens spent on the arguments the model wrote. */
  inputTokens: number;
  /** Tokens spent on the result text handed back to the model. */
  outputTokens: number;
}

interface Usage {
  startedAt: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  byTool: Map<string, ToolTally>;
}

function emptyUsage(): Usage {
  return { startedAt: Date.now(), calls: 0, inputTokens: 0, outputTokens: 0, byTool: new Map() };
}

/** Totals since the process started. */
const session: Usage = emptyUsage();

/**
 * Totals since the last report. Reset by `get_token_usage` when the caller asks
 * for a task-scoped figure, so "what did *this* task cost" stays answerable
 * across several tasks in one long-lived server process.
 */
let sinceCheckpoint: Usage = emptyUsage();

/** Record one completed tool call against both windows. */
export function recordToolUsage(
  tool: string,
  inputTokens: number,
  outputTokens: number
): void {
  for (const usage of [session, sinceCheckpoint]) {
    usage.calls++;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;

    let tally = usage.byTool.get(tool);
    if (!tally) {
      tally = { calls: 0, inputTokens: 0, outputTokens: 0 };
      usage.byTool.set(tool, tally);
    }
    tally.calls++;
    tally.inputTokens += inputTokens;
    tally.outputTokens += outputTokens;
  }
}

export interface ToolUsageRow {
  tool: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageReport {
  scope: "task" | "session";
  /** Epoch ms the window started. */
  startedAt: number;
  elapsedMs: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Per-tool breakdown, most expensive first. */
  byTool: ToolUsageRow[];
  estimated: true;
}

function report(usage: Usage, scope: "task" | "session", topN: number): UsageReport {
  const rows: ToolUsageRow[] = Array.from(usage.byTool.entries())
    .map(([tool, t]) => ({
      tool,
      calls: t.calls,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      totalTokens: t.inputTokens + t.outputTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    scope,
    startedAt: usage.startedAt,
    elapsedMs: Date.now() - usage.startedAt,
    calls: usage.calls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    byTool: topN > 0 ? rows.slice(0, topN) : rows,
    estimated: true,
  };
}

/** Report for the window since the last checkpoint (i.e. the current task). */
export function getTaskUsage(topN = 5): UsageReport {
  return report(sinceCheckpoint, "task", topN);
}

/** Report for everything since the relay process started. */
export function getSessionUsage(topN = 5): UsageReport {
  return report(session, "session", topN);
}

/** Start a fresh task window. Session totals are untouched. */
export function resetTaskUsage(): void {
  sinceCheckpoint = emptyUsage();
}

/**
 * Whether to stamp a running-total footer onto every tool result.
 *
 * An instruction telling the model to call `get_token_usage` at the end of a
 * task is only as good as the model's compliance, and a footer nobody sees is
 * the same as no feature. Putting the number *in* every result makes it
 * structurally present instead of optional. The cost is about a dozen tokens
 * per call — a rounding error against the responses it rides along with.
 *
 * Set FIGMA_MCP_USAGE_FOOTER=off to disable.
 */
const USAGE_FOOTER_ENABLED =
  (process.env.FIGMA_MCP_USAGE_FOOTER || "").trim().toLowerCase() !== "off";

/**
 * Append the running task total to a tool result's text, in a form compact
 * enough to repeat on every call and explicit enough that the model knows it is
 * meant for the user.
 */
export function appendUsageFooter(result: unknown): void {
  if (!USAGE_FOOTER_ENABLED) return;

  const candidate = result as { content?: unknown } | null;
  if (!candidate || !Array.isArray(candidate.content)) return;

  const blocks = candidate.content as Array<Record<string, unknown>>;
  // Stamp the last text block, so the footer reads as a trailer rather than
  // interrupting the payload the caller actually asked for.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block && block.type === "text" && typeof block.text === "string") {
      const total = sinceCheckpoint.inputTokens + sinceCheckpoint.outputTokens;
      block.text +=
        `\n[figma-usage: ~${formatCount(total)} tokens over ` +
        `${sinceCheckpoint.calls} call${sinceCheckpoint.calls === 1 ? "" : "s"} this task ` +
        `— report this to the user when the task is done]`;
      return;
    }
  }
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Render a report as the short block a user should actually see at the end of a
 * task. Kept to a handful of lines: this is a footer, not a document.
 */
export function formatUsageReport(usage: UsageReport): string {
  const label = usage.scope === "task" ? "This task" : "This session";

  if (usage.calls === 0) {
    return `${label}: no Figma tool calls recorded yet.`;
  }

  const lines = [
    `${label} — ~${formatCount(usage.totalTokens)} tokens across ${usage.calls} Figma tool call${
      usage.calls === 1 ? "" : "s"
    } in ${formatElapsed(usage.elapsedMs)}`,
    `  sent ~${formatCount(usage.inputTokens)} · received ~${formatCount(usage.outputTokens)}`,
  ];

  if (usage.byTool.length > 0) {
    lines.push("  most expensive:");
    for (const row of usage.byTool) {
      lines.push(
        `    ${row.tool} — ${row.calls}×, ~${formatCount(row.totalTokens)} tokens`
      );
    }
  }

  lines.push(
    "  (Estimated from payload size at ~4 chars/token. Covers Figma tool traffic only, " +
      "not the rest of the conversation.)"
  );

  return lines.join("\n");
}
