/**
 * Token accounting — the numbers behind the end-of-task cost footer.
 *
 * The tally is module-level state shared by the whole server process, so these
 * tests reset the task window between cases and treat the session window as
 * cumulative, exactly as the running server does.
 */
import {
  estimateResponseTokens,
  estimateValueTokens,
  formatUsageReport,
  getSessionUsage,
  getTaskUsage,
  recordToolUsage,
  resetTaskUsage,
} from "../../src/talk_to_figma_mcp/utils/token-usage";

beforeEach(() => resetTaskUsage());

describe("estimation", () => {
  it("charges text blocks at ~4 chars per token", () => {
    expect(estimateResponseTokens({ content: [{ type: "text", text: "x".repeat(8000) }] })).toBe(2000);
  });

  it("does not charge image blocks as characters", () => {
    // Base64 bytes are billed by the client, not carried into the transcript;
    // counting them would overstate a screenshot by orders of magnitude.
    expect(estimateResponseTokens({ content: [{ type: "image", data: "A".repeat(40_000) }] })).toBe(0);
  });

  it("survives unserialisable params rather than breaking the call", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateValueTokens(circular)).toBe(0);
  });
});

describe("tallying", () => {
  it("sums calls and ranks the most expensive tool first", () => {
    recordToolUsage("rename_node", 20, 10);
    recordToolUsage("get_node_info", 10, 2000);

    const task = getTaskUsage();
    expect(task.calls).toBe(2);
    expect(task.totalTokens).toBe(2040);
    expect(task.byTool[0].tool).toBe("get_node_info");
  });

  it("resets the task window without touching session totals", () => {
    recordToolUsage("get_selection", 5, 100);
    const sessionBefore = getSessionUsage().calls;

    resetTaskUsage();

    expect(getTaskUsage().calls).toBe(0);
    expect(getSessionUsage().calls).toBe(sessionBefore);
  });
});

describe("formatting", () => {
  it("renders a short footer naming the costly tool", () => {
    recordToolUsage("get_node_info", 10, 2000);
    const text = formatUsageReport(getTaskUsage());

    expect(text).toContain("This task");
    expect(text).toContain("get_node_info");
    expect(text).toMatch(/Estimated from payload size/);
  });

  it("says so plainly when nothing has been spent", () => {
    expect(formatUsageReport(getTaskUsage())).toContain("no Figma tool calls");
  });
});
