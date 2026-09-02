/**
 * Response shaping helpers.
 *
 * Every character a tool returns is re-read by the model on each subsequent turn,
 * so response size is a recurring cost, not a one-off one. These helpers keep
 * results to the fields a caller actually needs and put a hard ceiling on the
 * pathological cases (deep node trees, full-page text scans).
 */

/**
 * Maximum characters a single tool response may contain before it is truncated.
 * ~24k chars ≈ 6k tokens. Override with FIGMA_MCP_MAX_RESPONSE_CHARS.
 */
const MAX_RESPONSE_CHARS = (() => {
  const raw = (process.env.FIGMA_MCP_MAX_RESPONSE_CHARS || "").trim();
  const parsed = Number(raw);
  return raw !== "" && Number.isFinite(parsed) && parsed > 1000 ? Math.floor(parsed) : 24_000;
})();

export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  /** The MCP SDK's result type allows extra fields; mirror that so these responses are assignable to it. */
  [key: string]: unknown;
}

/** Wrap text as an MCP tool response, truncating anything oversized. */
export function textResponse(text: string): ToolResponse {
  return { content: [{ type: "text", text: capSize(text) }] };
}

/** Wrap a value as JSON, truncating anything oversized. */
export function jsonResponse(value: unknown): ToolResponse {
  return textResponse(JSON.stringify(value));
}

/**
 * Uniform error response. Keeps the message on one line so a failure costs a
 * handful of tokens rather than a stack trace.
 */
export function errorResponse(action: string, error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return textResponse(`Error ${action}: ${message}`);
}

/**
 * Reduce a Figma node result to the identity fields a caller needs to keep
 * working with it. Creation tools previously echoed the whole node — hundreds of
 * tokens describing properties the caller just supplied.
 */
export function nodeSummary(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return { result } as Record<string, unknown>;
  const node = result as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const field of ["id", "name", "type"]) {
    if (node[field] !== undefined) summary[field] = node[field];
  }
  // Geometry is worth keeping: it is what the caller positions siblings against.
  for (const field of ["x", "y", "width", "height"]) {
    if (typeof node[field] === "number") summary[field] = node[field];
  }
  return Object.keys(summary).length > 0 ? summary : (node as Record<string, unknown>);
}

/** Compact confirmation for a node-creating tool. */
export function createdResponse(kind: string, result: unknown): ToolResponse {
  return textResponse(`Created ${kind}: ${JSON.stringify(nodeSummary(result))}`);
}

/**
 * Truncate an oversized payload and say so, rather than letting a 200 KB node
 * tree land in the transcript. The notice tells the model how to narrow the read.
 */
export function capSize(text: string): string {
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  const kept = text.slice(0, MAX_RESPONSE_CHARS);
  return (
    kept +
    `\n\n[TRUNCATED: response was ${text.length} chars, capped at ${MAX_RESPONSE_CHARS}. ` +
    `Re-query a narrower scope — pass a smaller "depth", target a specific nodeId, ` +
    `or raise FIGMA_MCP_MAX_RESPONSE_CHARS if you genuinely need the full payload.]`
  );
}

/**
 * Apply the size cap to an already-built MCP tool result.
 *
 * Applied centrally when tools are registered, so every tool — including ones
 * added later — inherits the ceiling without each handler having to remember it.
 */
export function capResponse<T>(result: T): T {
  const candidate = result as unknown as { content?: unknown };
  if (!candidate || !Array.isArray(candidate.content)) return result;

  for (const item of candidate.content as Array<Record<string, unknown>>) {
    if (item && item.type === "text" && typeof item.text === "string") {
      item.text = capSize(item.text);
    }
  }
  return result;
}
