/**
 * Tests for the cost/latency optimisations: batch reference resolution,
 * the read cache, response size capping and tool profiles.
 */

import { resolveRefs, normalizeParams } from "../../src/talk_to_figma_mcp/utils/batch-refs";
import { capSize, nodeSummary, capResponse } from "../../src/talk_to_figma_mcp/utils/respond";
import {
  withReadCache,
  invalidateCache,
  isNonMutating,
  getCacheStats,
} from "../../src/talk_to_figma_mcp/utils/cache";
import { makeToolFilter, CORE_TOOLS } from "../../src/talk_to_figma_mcp/config/profiles";

describe("figma_batch reference resolution", () => {
  const results = [{ id: "1:10", name: "Hero" }, { id: "1:11", name: "Title" }];

  it("resolves $N.field against an earlier op", () => {
    expect(resolveRefs({ parentId: "$0.id" }, results)).toEqual({ parentId: "1:10" });
  });

  it("resolves $last.field against the most recent op", () => {
    expect(resolveRefs({ nodeId: "$last.id" }, results)).toEqual({ nodeId: "1:11" });
  });

  it("resolves references nested in objects and arrays", () => {
    expect(resolveRefs({ nodeIds: ["$0.id", "$1.id"], meta: { p: "$0.name" } }, results)).toEqual({
      nodeIds: ["1:10", "1:11"],
      meta: { p: "Hero" },
    });
  });

  it("leaves ordinary strings alone", () => {
    expect(resolveRefs({ name: "Hero $ section", nodeId: "1:2" }, results)).toEqual({
      name: "Hero $ section",
      nodeId: "1:2",
    });
  });

  it("throws when a reference points at a failed op", () => {
    expect(() => resolveRefs({ parentId: "$0.id" }, [null])).toThrow(/produced no result/);
  });

  it("throws when the referenced field is missing", () => {
    expect(() => resolveRefs({ x: "$0.width" }, results)).toThrow(/no field "width"/);
  });
});

describe("figma_batch param normalisation", () => {
  it("applies the default alpha to colour objects, matching the single-op tools", () => {
    const out = normalizeParams("create_rectangle", { fillColor: { r: 1, g: 0, b: 0 } });
    expect(out.fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("preserves an explicit alpha of 0", () => {
    const out = normalizeParams("set_fill_color", { color: { r: 0, g: 0, b: 0, a: 0 } });
    expect(out.color).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("supplies the default node name only when none is given", () => {
    expect(normalizeParams("create_frame", {}).name).toBe("Frame");
    expect(normalizeParams("create_frame", { name: "Hero" }).name).toBe("Hero");
  });
});

describe("read cache", () => {
  beforeEach(() => invalidateCache("test"));

  it("serves a second identical read without calling Figma again", async () => {
    const fetcher = jest.fn().mockResolvedValue({ styles: [] });
    await withReadCache("get_styles", {}, fetcher);
    await withReadCache("get_styles", {}, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keys the cache on params, so a different query still fetches", async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true });
    await withReadCache("get_variables", { collection: "a" }, fetcher);
    await withReadCache("get_variables", { collection: "b" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refetches after invalidation", async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true });
    await withReadCache("get_styles", {}, fetcher);
    invalidateCache("set_fill_color");
    await withReadCache("get_styles", {}, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never caches a command outside the cacheable set", async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true });
    await withReadCache("get_node_info", { nodeId: "1:2" }, fetcher);
    await withReadCache("get_node_info", { nodeId: "1:2" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("classifies reads as non-mutating and writes as mutating", () => {
    expect(isNonMutating("get_node_info")).toBe(true);
    expect(isNonMutating("get_styles")).toBe(true);
    expect(isNonMutating("set_fill_color")).toBe(false);
    expect(isNonMutating("create_frame")).toBe(false);
  });

  it("reports hit and miss counters", async () => {
    const before = getCacheStats();
    const fetcher = jest.fn().mockResolvedValue({});
    await withReadCache("get_pages", {}, fetcher);
    await withReadCache("get_pages", {}, fetcher);
    expect(getCacheStats().hits).toBeGreaterThan(before.hits);
  });
});

describe("response shaping", () => {
  it("leaves a normal response untouched", () => {
    expect(capSize("hello")).toBe("hello");
  });

  it("truncates an oversized response and explains how to narrow the query", () => {
    const capped = capSize("x".repeat(60_000));
    expect(capped.length).toBeLessThan(60_000);
    expect(capped).toContain("TRUNCATED");
    expect(capped).toContain("depth");
  });

  it("reduces a created node to identity and geometry", () => {
    const summary = nodeSummary({
      id: "1:2",
      name: "Hero",
      type: "FRAME",
      x: 0,
      y: 0,
      width: 1440,
      height: 600,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      children: new Array(50).fill({ id: "x" }),
    });
    expect(summary).toEqual({ id: "1:2", name: "Hero", type: "FRAME", x: 0, y: 0, width: 1440, height: 600 });
  });

  it("caps text content inside an assembled tool result", () => {
    const result = capResponse({ content: [{ type: "text", text: "y".repeat(60_000) }] });
    expect(result.content[0].text).toContain("TRUNCATED");
  });

  it("passes through a result with no text content", () => {
    const result = { content: [{ type: "image", data: "..." }] } as any;
    expect(capResponse(result)).toBe(result);
  });
});

describe("tool profiles", () => {
  it("advertises everything under full", () => {
    const allow = makeToolFilter("full");
    expect(allow("create_sticky")).toBe(true);
    expect(allow("get_file_comments")).toBe(true);
  });

  it("withholds FigJam, REST comments and activity tools under standard", () => {
    const allow = makeToolFilter("standard");
    expect(allow("create_frame")).toBe(true);
    expect(allow("create_sticky")).toBe(false);
    expect(allow("get_file_comments")).toBe(false);
    expect(allow("get_activity_log")).toBe(false);
  });

  it("admits only the core set under core", () => {
    const allow = makeToolFilter("core");
    expect(allow("create_frame")).toBe(true);
    expect(allow("set_gradient")).toBe(false);
  });

  it("always advertises figma_batch, so withheld tools stay reachable", () => {
    for (const profile of ["core", "standard", "full"] as const) {
      expect(makeToolFilter(profile)("figma_batch")).toBe(true);
    }
  });

  it("keeps the responsive and section-scope workflow in the core set", () => {
    for (const tool of ["make_responsive", "validate_responsive", "set_section_scope", "get_design_system"]) {
      expect(CORE_TOOLS).toContain(tool);
    }
  });
});
