/**
 * Reading a browser capture, and the extractor's pure helpers.
 *
 * The capture under test was produced by the real extractor in real headless
 * Chrome (tests/fixtures/browser-capture/chrome-harness.mjs on page.html), not
 * written by hand — LESSONS L3. The live-browser behaviour itself is covered by
 * browser-extractor-chrome.test.ts.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  assertCapture,
  Capture,
  defaultCapturePath,
  outline,
  renderNodes,
  summarizeCapture,
  tokenMatchArgs,
} from "../../src/talk_to_figma_mcp/utils/browser-capture";
import { normalizeHex } from "../../src/talk_to_figma_mcp/utils/token-matching";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const extractor = require("../../browser_extension/extractor.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "browser-capture", "page.capture.json");
const load = (): Capture => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

describe("assertCapture", () => {
  it("accepts a real capture", () => {
    expect(() => assertCapture(load())).not.toThrow();
  });

  it("accepts a capture carrying fields it does not know (L7: pass through, don't police)", () => {
    const c: any = load();
    c.someFutureField = { x: 1 };
    expect(() => assertCapture(c)).not.toThrow();
  });

  it("names the schema it got when handed something else", () => {
    expect(() => assertCapture({ schema: "other", nodes: [], styles: [], tokens: {} })).toThrow(/"other".*web-to-figma\/capture/);
    expect(() => assertCapture(null)).toThrow(/no capture/);
    expect(() => assertCapture({ schema: "web-to-figma/capture" })).toThrow(/nodes, styles or tokens/);
  });
});

describe("summarizeCapture", () => {
  const text = summarizeCapture(load(), "/tmp/x.json");

  it("reports the facts a Figma rebuild needs", () => {
    expect(text).toContain("Saved: /tmp/x.json");
    expect(text).toContain("#f97316");
    // oklch() resolved to sRGB hex, with its source kept
    expect(text).toMatch(/#11161f .*from oklch\(0\.2 0\.02 260\)/);
    expect(text).toMatch(/Helvetica Neue 48px\/56px w700 ls-0\.96px/);
    expect(text).toContain("--brand: #f97316");
    expect(text).toMatch(/≤768.*≥1440/);
    expect(text).toMatch(/\.btn:hover → background: rgb\(234, 88, 12\) \(1 node: n4\)/);
    expect(text).toContain("@keyframes (1): rise");
    expect(text).toMatch(/n22 class: "reveal" → "reveal is-inview"/);
  });

  it("points at the approval rule instead of creating tokens", () => {
    expect(text).toContain("ask before creating anything");
    expect(text).toContain("CLAUDE.md §4");
  });

  it("stays well inside the tool-result cap", () => {
    expect(text.length).toBeLessThan(20000);
  });

  it("does not claim a font is missing when the family has a loaded face", () => {
    const c = load();
    c.fonts = [
      { family: "Inter", weight: "400", style: "normal", status: "loaded" },
      { family: "Inter", weight: "100 900", style: "normal", status: "unloaded" },
    ];
    c.tokens.typography = [{ fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: "24px", letterSpacing: 0, count: 1, sample: "x" }];
    expect(summarizeCapture(c, null)).not.toContain("not loaded");
    c.fonts = [{ family: "Inter", weight: "400", style: "normal", status: "unloaded" }];
    expect(summarizeCapture(c, null)).toContain("not loaded: Inter");
  });
});

describe("tokenMatchArgs", () => {
  it("produces arguments match_design_tokens accepts", () => {
    const args = tokenMatchArgs(load());
    expect(args.colors.length).toBeGreaterThan(0);
    // Every colour must survive the matcher's own normaliser, or it is silently dropped.
    for (const c of args.colors) expect(normalizeHex(c)).toBe(c);
    expect(args.colors).toContain("#f97316");
    // translucent colours are left out: the matcher has no alpha
    expect(args.colors).not.toContain("#030712");
    const h1 = args.typography.find((t) => t.fontSize === 48 && t.fontWeight === 700);
    expect(h1).toMatchObject({ fontFamily: "Helvetica Neue", lineHeight: "56px", letterSpacing: -0.96 });
    expect(args.spacing).toContain(24);
    expect(args.radii).toEqual(expect.arrayContaining([12, 8]));
  });
});

describe("outline", () => {
  it("lists the page's blocks, not the body", () => {
    const ids = outline(load()).map((n) => n.tag);
    expect(ids).toEqual(expect.arrayContaining(["nav", "h1", "section"]));
    expect(ids).not.toContain("body");
  });

  it("opens a wrapper that holds most of the page", () => {
    const c = load();
    // wrap everything under body in a single main
    const body = c.nodes[0];
    const main = { id: "n999", parent: body.id, tag: "main", rect: { ...body.rect }, s: body.s, children: body.children };
    for (const id of body.children || []) c.nodes.find((n) => n.id === id)!.parent = "n999";
    body.children = ["n999"];
    c.nodes.push(main as any);
    const tags = outline(c).map((n) => n.tag);
    expect(tags).not.toContain("main");
    expect(tags).toEqual(expect.arrayContaining(["nav", "section"]));
  });
});

describe("renderNodes", () => {
  it("renders a subtree with styles, runs, pseudo-elements and hover rules", () => {
    const c = load();
    const text = renderNodes(c, undefined, 4);
    expect(text).toMatch(/runs: "Hello " <n6> " today"/);
    expect(text).toContain('::before "★"');
    expect(text).toMatch(/n4 a\.btn .*\n(.*\n)*.*:hover → background: rgb\(234, 88, 12\)/);
    expect(text).toContain("grid-template-columns:");
    expect(text).toMatch(/revealed state: .*"opacity":"1"/);
  });

  it("never exposes a password field's value", () => {
    const c = load();
    const pw = c.nodes.find((n) => (n.media as any)?.type === "password")!;
    expect(pw).toBeDefined();
    expect((pw.media as any).value).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain("hunter2");
    // hidden inputs are not captured at all
    expect(JSON.stringify(c)).not.toContain("csrf");
  });

  it("names the valid range for an unknown node id", () => {
    expect(() => renderNodes(load(), "n5000")).toThrow(/n1…n22/);
  });

  it("says where it stopped instead of cutting silently", () => {
    const text = renderNodes(load(), undefined, 6, 400);
    expect(text).toMatch(/\[Stopped at n\d+ .*nodeId/);
  });

  it("points at deeper children when depth runs out", () => {
    expect(renderNodes(load(), undefined, 0)).toMatch(/… 7 children \(n2, n5, n7/);
  });
});

describe("defaultCapturePath", () => {
  it("is a timestamped file named after the host, in the temp dir", () => {
    const p = defaultCapturePath("https://www.example.com/a?b", new Date("2026-09-30T10:11:12.345Z"));
    expect(p).toBe(path.join(os.tmpdir(), "web-to-figma-captures", "www.example.com-2026-09-30T10-11-12-345.json"));
    expect(defaultCapturePath("not a url")).toContain(`${path.sep}page-`);
  });
});

describe("extractor pure helpers", () => {
  it("parses computed colours", () => {
    expect(extractor.parseColor("rgb(249, 115, 22)")).toEqual({ hex: "#f97316", alpha: 1 });
    expect(extractor.parseColor("rgba(3, 7, 18, 0.12)")).toEqual({ hex: "#030712", alpha: 0.12 });
    expect(extractor.parseColor("rgb(3 7 18 / 50%)")).toEqual({ hex: "#030712", alpha: 0.5 });
    expect(extractor.parseColor("#FFF")).toEqual({ hex: "#ffffff", alpha: 1 });
    expect(extractor.parseColor("oklch(0.2 0.02 260)")).toBeNull(); // resolved by canvas in the browser
  });

  it("finds colours inside shadows and gradients", () => {
    expect(extractor.colorsIn("rgba(0, 0, 0, 0.2) 0px 1px 2px, #fff 0 0 1px")).toEqual(["rgba(0, 0, 0, 0.2)", "#fff"]);
    expect(extractor.colorsIn("linear-gradient(oklch(0.5 0.1 20), rgb(1, 2, 3))")).toEqual(["oklch(0.5 0.1 20)", "rgb(1, 2, 3)"]);
    expect(extractor.colorsIn("none")).toEqual([]);
  });

  it("keeps what matters and drops defaults and irrelevant properties", () => {
    const pruned = extractor.pruneStyle(
      {
        display: "block", "margin-top": "0px", "padding-top": "8px", "flex-direction": "row", "justify-content": "center",
        "flex-grow": "1", color: "rgb(0, 0, 0)", "font-size": "16px", "border-top-width": "0px", "border-top-color": "rgb(1, 2, 3)",
        "transform-origin": "10px 10px", transform: "none", "outline-width": "3px", "outline-style": "none",
      },
      { hasText: false, isSvg: false, flexItem: false, gridItem: false }
    );
    expect(pruned).toEqual({ display: "block", "padding-top": "8px" });
  });

  it("keeps flex-item, text and border properties where they apply", () => {
    const pruned = extractor.pruneStyle(
      { display: "flex", "flex-direction": "column", "flex-grow": "1", color: "rgb(0, 0, 0)", "font-size": "16px",
        "border-top-width": "1px", "border-top-style": "solid", "border-top-color": "rgb(1, 2, 3)" },
      { hasText: true, isSvg: false, flexItem: true, gridItem: false }
    );
    expect(pruned).toMatchObject({ "flex-direction": "column", "flex-grow": "1", color: "rgb(0, 0, 0)", "font-size": "16px", "border-top-color": "rgb(1, 2, 3)" });
  });

  it("reduces an interaction selector to its base element", () => {
    expect(extractor.baseSelector(".btn:hover")).toBe(".btn");
    expect(extractor.baseSelector(".card:hover .title")).toBe(".card .title");
    expect(extractor.baseSelector("a:focus-visible::after")).toBe("a");
    expect(extractor.baseSelector(":hover")).toBeNull();
    expect(extractor.interactionState(".a:hover:focus-visible")).toEqual(["hover", "focus-visible"]);
  });

  it("reads breakpoints in px and em", () => {
    expect(extractor.breakpointOf("(max-width: 768px)")).toEqual({ query: "(max-width: 768px)", minWidth: null, maxWidth: 768 });
    expect(extractor.breakpointOf("screen and (min-width: 60em)")!.minWidth).toBe(960);
    expect(extractor.breakpointOf("print")).toBeNull();
  });

  it("splits cssText respecting quotes and parentheses", () => {
    expect(extractor.parseCssText('background: url("a;b.png") no-repeat; content: ";"; color: rgb(1, 2, 3)')).toEqual({
      background: 'url("a;b.png") no-repeat',
      content: '";"',
      color: "rgb(1, 2, 3)",
    });
  });

  it("collapses whitespace unless white-space preserves it", () => {
    expect(extractor.normalizeText("a \n  b", "normal")).toBe("a b");
    expect(extractor.normalizeText("a \n  b", "pre-wrap")).toBe("a \n  b");
  });
});
