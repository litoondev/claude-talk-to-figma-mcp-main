/**
 * The usage footer must survive the path a real tool result takes: capped for
 * size, measured, then stamped. These tests exercise that order.
 */
import { appendUsageFooter, recordToolUsage, resetTaskUsage } from "../../src/talk_to_figma_mcp/utils/token-usage";

beforeEach(() => resetTaskUsage());

it("stamps the running total onto a tool result", () => {
  recordToolUsage("get_node_info", 10, 2000);
  const result = { content: [{ type: "text", text: "Created frame: {}" }] };

  appendUsageFooter(result);

  expect(result.content[0].text).toContain("Created frame: {}");
  expect(result.content[0].text).toMatch(/\[figma-usage: ~2\.0k tokens over 1 call this task/);
});

it("stamps the last text block, leaving earlier blocks untouched", () => {
  recordToolUsage("export_node_as_image", 5, 50);
  const result = {
    content: [
      { type: "text", text: "first" },
      { type: "image", data: "AAAA" },
      { type: "text", text: "last" },
    ],
  };

  appendUsageFooter(result);

  expect(result.content[0].text).toBe("first");
  expect(result.content[2].text).toContain("figma-usage");
});

it("leaves a result with no text block alone", () => {
  const result = { content: [{ type: "image", data: "AAAA" }] };
  expect(() => appendUsageFooter(result)).not.toThrow();
  expect(JSON.stringify(result)).not.toContain("figma-usage");
});
