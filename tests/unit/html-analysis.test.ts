/**
 * HTML analysis for HTML → Figma import: what the page declares, read without a
 * browser. The fixture is modelled on the "# Work Process" section — a heading
 * over a 4-column card grid — plus a flex header and a footer with inline style.
 */
import {
  analyzeHtml,
  countColumns,
  findStylesheetHrefs,
  parseColor,
  parseCss,
  readFlexAlignment,
  readGridCells,
  recommendLayout,
  resolveAssetUrl,
  absolutizeCssUrls,
  resolveVars,
  toPx,
} from "../../src/talk_to_figma_mcp/utils/html-analysis";
import { renderHtmlAnalysis, tokensForMatching } from "../../src/talk_to_figma_mcp/tools/html-import-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({ sendCommandToFigma: jest.fn() }));

const PAGE = `<!doctype html>
<html lang="en"><head><title>Caseway Partners</title>
<link rel="stylesheet" href="css/site.css">
<style>
:root { --ink: #030712; --gray: rgb(115, 115, 115); --gap: 1.6rem; }
html { font-size: 62.5%; }
body { font-family: "Inter", sans-serif; color: var(--ink); }
/* .ignored { color: red } */
h1 { font: 700 6.4rem/1.1 "Figtree", sans-serif; letter-spacing: -0.1rem; }
p { font-size: 1.6rem; line-height: 2.4rem; color: var(--gray); }
.site-header { display: flex; gap: 32px; padding: 2rem 10rem; }
.work .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--gap); }
.card { background: #0B0F14; border-radius: 20px; padding: 24px 24px 12px; }
.card:hover { background: #1f2937; }
.btn { background-color: #f97316; }
@media (max-width: 768px) { .work .grid { grid-template-columns: repeat(2, 1fr); } }
@font-face { font-family: X; src: url(x.woff2); }
</style>
<script>document.write("<section><h2>Injected by script</h2></section>")</script>
</head><body>
<header class="site-header"><nav><a href="/">Home</a><a href="/work">Work</a></nav><a class="btn" href="#c">Contact</a></header>
<section class="work" id="process"><h2>Considered. Crafted. Delivered.</h2>
<div class="grid">
 <div class="card"><h3>Brief &amp; Discovery</h3><p>We sit with partners.</p></div>
 <div class="card"><h3>Strategy</h3><p>Information architecture.</p></div>
 <div class="card"><h3>Design</h3><p>Editorial design.</p></div>
 <div class="card"><h3>Build</h3><p>Engineered on WordPress.</p></div>
</div></section>
<footer><p style="color: #FFF; margin: 0 auto">&copy; 2026</p></footer>
</body></html>`;

describe("CSS reading", () => {
  it("parses rules, keeps @media conditions, skips comments and @font-face", () => {
    const rules = parseCss(".a { color: red } /* .b { color: blue } */ @media (max-width: 768px) { .a { gap: 8px } } @font-face { font-family: X }");
    expect(rules.map((r) => [r.selector, r.media])).toEqual([[".a", null], [".a", "(max-width: 768px)"]]);
  });

  it("resolves custom properties, fallbacks and nested var()", () => {
    const vars = { "--a": "var(--b)", "--b": "12px" };
    expect(resolveVars("var(--a) var(--missing, 4px)", vars)).toBe("12px 4px");
  });

  it("converts rem with the page's root size, and takes clamp()'s desktop maximum", () => {
    expect(toPx("1.6rem", 10)).toBe(16);
    expect(toPx("clamp(1rem, 2vw, 3rem)", 16)).toBe(48);
    expect(toPx("50%", 16)).toBeNull();
  });

  it("normalises hex, rgb and hsl colours", () => {
    expect(parseColor("#0B0F14")).toEqual({ hex: "#0b0f14", alpha: 1 });
    expect(parseColor("rgba(3, 7, 18, .5)")).toEqual({ hex: "#030712", alpha: 0.5 });
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ hex: "#ff0000", alpha: 1 });
    expect(parseColor("#FFF")).toEqual({ hex: "#ffffff", alpha: 1 });
  });

  it("counts grid columns from repeat() and explicit track lists", () => {
    expect(countColumns("repeat(4, 1fr)")).toBe(4);
    expect(countColumns("1fr 2fr [end] 1fr")).toBe(3);
    expect(countColumns("repeat(auto-fit, minmax(240px, 1fr))")).toBeNull();
  });

  it("finds linked stylesheets", () => {
    expect(findStylesheetHrefs(PAGE)).toEqual(["css/site.css"]);
  });
});

describe("page analysis", () => {
  const analysis = analyzeHtml(PAGE);

  it("reads the title, root font size and base family", () => {
    expect(analysis.title).toBe("Caseway Partners");
    expect(analysis.rootFontSize).toBe(10);
    expect(analysis.baseFontFamily).toBe("Inter");
  });

  it("outlines header, section and footer, ignoring what a script would inject", () => {
    expect(analysis.sections.map((s) => s.element)).toEqual(["<header.site-header>", "<section#process.work>", "<footer>"]);
    expect(analysis.sections[1].label).toBe("Considered. Crafted. Delivered.");
    expect(JSON.stringify(analysis)).not.toContain("Injected by script");
  });

  it("recommends a 4-column Figma Grid for the cards, with the tablet override", () => {
    const cards = analysis.sections[1].groups.find((g) => g.itemSignature === "div.card")!;
    expect(cards.count).toBe(4);
    expect(cards.container).toBe("<div.grid>");
    expect(cards.recommendation).toBe("Figma Grid — 4 columns, gap 16; cells: horizontal FILL, vertical FILL");
    expect(cards.responsive).toEqual([
      { media: "(max-width: 768px)", layout: expect.objectContaining({ kind: "grid", columns: 2 }) },
    ]);
  });

  it("recommends horizontal Auto Layout for the flex header", () => {
    const header = analysis.sections[0].groups.find((g) => g.container === "<header.site-header>")!;
    expect(header.recommendation).toBe(
      "Auto Layout — horizontal, gap 32; primary MIN, counter MIN + children Fill height (align-items: stretch)"
    );
  });

  it("collects colours with where they are used, resolving variables", () => {
    const byHex = Object.fromEntries(analysis.tokens.colors.map((c) => [c.hex, c.uses]));
    expect(byHex["#030712"].text).toBe(1);
    expect(byHex["#737373"].text).toBe(1);
    expect(byHex["#0b0f14"].background).toBe(1);
    expect(byHex["#f97316"].background).toBe(1);
    expect(byHex["#ffffff"].text).toBe(1);
  });

  it("reads typography, including the font shorthand and the inherited family", () => {
    expect(analysis.tokens.typography).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: "Figtree", fontSize: 64, fontWeight: 700, lineHeight: "110%", letterSpacing: -1, selectors: ["h1"] }),
        expect.objectContaining({ fontFamily: "Inter", familyInherited: true, fontSize: 16, lineHeight: "24px", selectors: ["p"] }),
      ])
    );
  });

  it("tallies gaps, padding and radii in px", () => {
    expect(analysis.tokens.gaps.map((t) => t.value).sort((a, b) => a - b)).toEqual([16, 32]);
    expect(analysis.tokens.padding.map((t) => t.value).sort((a, b) => a - b)).toEqual([12, 20, 24, 100]);
    expect(analysis.tokens.radii).toEqual([{ value: 20, count: 1 }]);
  });

  it("lists the copy, decoding entities", () => {
    expect(analysis.texts).toEqual(
      expect.arrayContaining([
        { tag: "h2", text: "Considered. Crafted. Delivered." },
        { tag: "h3", text: "Brief & Discovery" },
        { tag: "a", text: "Contact" },
        { tag: "p", text: "© 2026" },
      ])
    );
  });

  it("hands match_design_tokens the values most used first", () => {
    const tokens = tokensForMatching(analysis);
    expect(tokens.colors).toEqual(expect.arrayContaining(["#030712", "#f97316", "#0b0f14"]));
    expect(tokens.spacing).toEqual(expect.arrayContaining([16, 32, 24, 100]));
    expect(tokens.typography[0]).toEqual(expect.objectContaining({ fontSize: expect.any(Number), label: expect.any(String) }));
  });

  it("renders a report that ends with the next step", () => {
    const text = renderHtmlAnalysis(analysis, { location: "/tmp/page.html", stylesheets: [], warnings: [] });
    expect(text).toContain('HTML analysis — "Caseway Partners"');
    expect(text).toContain("4 × div.card in <div.grid> → Figma Grid — 4 columns, gap 16");
    expect(text).toContain("at (max-width: 768px): grid, 2 columns");
    expect(text).toContain("Call match_design_tokens with exactly these values");
  });
});

describe("layout recommendation", () => {
  const flex = (over: object) => ({ kind: "flex" as const, columns: null, direction: "row" as const, wrap: false, rowGap: 24, columnGap: 24, ...over });

  it("uses Auto Layout for a single-column grid", () => {
    expect(recommendLayout({ kind: "grid", columns: 1, direction: "row", wrap: false, rowGap: 8, columnGap: 8 }, 3, false)).toBe("Auto Layout — vertical, gap 8");
  });

  it("uses a Grid for equal items that wrap, Auto Layout otherwise", () => {
    expect(recommendLayout(flex({ wrap: true }), 6, false)).toMatch(/^Figma Grid — 6 equal items that wrap/);
    expect(recommendLayout(flex({}), 6, false)).toBe("Auto Layout — horizontal, gap 24");
    expect(recommendLayout(flex({ direction: "column" }), 2, false)).toBe("Auto Layout — vertical, gap 24");
  });
});

/**
 * Copied from the structure of a real page (Bootstrap's pricing example), which
 * the first fixture never had: an icon sprite used through <use>, a fixed theme
 * toggle, a hidden block, equal columns each holding a list and a button with an
 * icon, a comparison table, plus the image kinds a page mixes: a logo, a CSS
 * background, a <picture> and a video poster.
 */
describe("real-page noise and assets", () => {
  const NOISY = `<html><head><style>
    .d-none { display: none !important; }
    .position-fixed { position: fixed !important; }
    .bottom-0 { bottom: 0 !important; }
    .end-0 { right: 0 !important; }
    .row { display: flex; flex-wrap: wrap; }
    .btn { display: inline-flex; gap: 8px; color: #0d6efd; }
    .hero { background-image: url("../bg/hero.jpg"); width: 1200px; height: 400px; }
  </style></head><body>
  <svg xmlns="http://www.w3.org/2000/svg" class="d-none"><symbol id="check" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></symbol></svg>
  <div class="dropdown position-fixed bottom-0 end-0"><button class="btn"><span>Theme</span></button><ul><li>Light</li><li>Dark</li></ul></div>
  <div hidden><p>Old banner</p><img src="old.png"><p>More</p></div>
  <main>
    <div class="hero"><img src="img/logo.png" alt="Caseway logo" width="120" height="40"><h1>Pricing</h1></div>
    <div class="row">
      <div class="col"><ul class="list"><li>A</li><li>B</li></ul><button class="btn"><svg class="bi" width="16" height="16" fill="currentColor" aria-hidden="true"><use href="#check"/></svg><span>Buy</span></button></div>
      <div class="col"><ul class="list"><li>A</li><li>B</li></ul><button class="btn"><svg class="bi" width="16" height="16" fill="currentColor" aria-hidden="true"><use href="#check"/></svg><span>Buy</span></button></div>
      <div class="col"><ul class="list"><li>A</li><li>B</li></ul><button class="btn"><svg class="bi" width="16" height="16" fill="currentColor" aria-hidden="true"><use href="#check"/></svg><span>Buy</span></button></div>
    </div>
    <div class="compare"><table><thead><tr><th>x</th><th>Free</th><th>Pro</th></tr></thead>
      <tbody><tr><td>a</td><td>1</td><td>2</td></tr><tr><td>b</td><td>1</td><td>2</td></tr></tbody></table></div>
    <div class="media"><h2>Team</h2><picture><source srcset="a.webp 1x, a@2x.webp 2x"><img src="a.jpg" alt="Team photo"></picture><video poster="//cdn.example.com/poster.jpg"></video></div>
  </main></body></html>`;
  const analysis = analyzeHtml(NOISY, [], { baseUrl: "https://example.com/pricing/index.html" });
  const sectionOf = (element: string) => analysis.sections.find((s) => s.element === element)!;

  it("builds the fixed overlay at its declared position, skips only what is invisible", () => {
    expect(analysis.sections.map((s) => s.element)).toEqual([
      "<div.dropdown.position-fixed.bottom-0>", "<div.hero>", "<div.row>", "<div.compare>", "<div.media>",
    ]);
    expect(analysis.sections[0].overlay).toEqual({ top: null, right: "0", bottom: "0", left: null });
    expect(analysis.sections[0].recommendation).toBe("fixed overlay — place at its declared position (right: 0, bottom: 0)");
    expect(analysis.skipped).toEqual([
      { element: "<svg.d-none>", reason: "icon sprite or decoration" },
      { element: "<div>", reason: "hidden" },
    ]);
    const copy = analysis.texts.map((t) => t.text);
    expect(copy).toEqual(expect.arrayContaining(["Theme", "Light"]));
    expect(copy).not.toEqual(expect.arrayContaining(["Old banner"]));
  });

  it("lists the equal columns once, collapses identical lists, and agrees the row is a Grid", () => {
    const row = sectionOf("<div.row>");
    expect(row.groups.find((g) => g.itemSignature === "div.col")).toMatchObject({ count: 3, repeats: 1 });
    expect(row.groups.find((g) => g.itemSignature === "li")).toMatchObject({ count: 2, repeats: 3, container: "<ul.list>" });
    expect(row.groups.some((g) => g.container.startsWith("<button"))).toBe(false);
    expect(row.recommendation).toMatch(/^Figma Grid — 3 equal items that wrap/);
  });

  it("summarises a table once instead of a line per row", () => {
    expect(sectionOf("<div.compare>").groups).toEqual([
      expect.objectContaining({
        container: "<table>",
        itemSignature: "rows",
        count: 3,
        recommendation: "Table — vertical Auto Layout of 3 rows, each a horizontal Auto Layout of 3 cells",
      }),
    ]);
  });

  it("lists every visible image and icon in document order, with absolute sources", () => {
    expect(analysis.assets.map((a) => [a.id, a.section, a.kind, a.element, a.source, a.alt, a.width, a.height])).toEqual([
      ["asset-1", 2, "css-background", "<div.hero>", "https://example.com/bg/hero.jpg", "", 1200, 400],
      ["asset-2", 2, "img", "<img>", "https://example.com/pricing/img/logo.png", "Caseway logo", 120, 40],
      ["asset-3", 3, "inline-svg", "<svg.bi>", null, "", 16, 16],
      ["asset-4", 3, "inline-svg", "<svg.bi>", null, "", 16, 16],
      ["asset-5", 3, "inline-svg", "<svg.bi>", null, "", 16, 16],
      ["asset-6", 5, "picture", "<img>", "https://example.com/pricing/a.jpg", "Team photo", null, null],
      ["asset-7", 5, "video-poster", "<video>", "https://cdn.example.com/poster.jpg", "", null, null],
    ]);
  });

  it("keeps aria-hidden icons: they are hidden from screen readers, not from view", () => {
    expect(analysis.assets.filter((a) => a.kind === "inline-svg")).toHaveLength(3);
  });

  it("makes sprite icons self-contained: <use> resolved, currentColor filled, viewBox and namespace set", () => {
    const markup = analysis.assets[2].svgMarkup!;
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('viewBox="0 0 16 16"');
    expect(markup).toContain('<path d="M0 0h16v16H0z"/>');
    expect(markup).toContain('fill="#0d6efd"');
    expect(markup).not.toMatch(/currentColor|<use/);
  });

  it("reports assets compactly and prints SVG markup only when asked", () => {
    const loaded = { location: "https://example.com/pricing/index.html", stylesheets: [], warnings: [] };
    const text = renderHtmlAnalysis(analysis, loaded);
    expect(text).toContain("section: fixed overlay — place at its declared position (right: 0, bottom: 0)");
    expect(text).toContain("IMAGES & ICONS — place every one");
    expect(text).toContain('[asset-2] §2 img <img> — https://example.com/pricing/img/logo.png — alt "Caseway logo" — 120×40');
    expect(text).toContain('[asset-3] §3 inline-svg <svg.bi> — inline SVG, ');
    expect(text).toContain('(pass svgMarkupFor: ["asset-3"]) — alt "" — 16×16');
    expect(text).toContain('[asset-6] §5 picture <img> — https://example.com/pricing/a.jpg — alt "Team photo" — size not declared');
    expect(text).not.toContain("SVG MARKUP");
    expect(text).toContain("2 × li in <ul.list> (3 alike) → Auto Layout — vertical (items stack)");

    const withMarkup = renderHtmlAnalysis(analysis, loaded, { svgMarkupFor: ["asset-3", "asset-2"] });
    expect(withMarkup).toContain(`[asset-3] ${analysis.assets[2].svgMarkup}`);
    expect(withMarkup).toContain("[asset-2] not an inline SVG in this report");
  });
});

describe("asset URL resolution", () => {
  it("resolves against a page URL, a local file, protocol-relative and data URIs", () => {
    expect(resolveAssetUrl("img/a.png", "https://example.com/p/index.html")).toBe("https://example.com/p/img/a.png");
    expect(resolveAssetUrl("img/a.png?v=2", "/Users/me/site/index.html")).toBe("/Users/me/site/img/a.png");
    expect(resolveAssetUrl("//cdn.example.com/a.png", "/Users/me/site/index.html")).toBe("https://cdn.example.com/a.png");
    expect(resolveAssetUrl("data:image/png;base64,AA", "https://example.com/")).toBe("data:image/png;base64,AA");
  });

  it("rewrites stylesheet urls against the stylesheet's own location", () => {
    const css = '.a { background: url(../img/x.png) } .b { background: url("data:image/png;base64,AA") }';
    const out = absolutizeCssUrls(css, "https://cdn.example.com/css/site.css");
    expect(out).toContain('url("https://cdn.example.com/img/x.png")');
    expect(out).toContain('url("data:image/png;base64,AA")');
  });
});

/**
 * CSS alignment → Figma. Found on a live import: align-items: stretch was sent to
 * Figma as counterAxisAlignItems STRETCH, which does not exist.
 */
describe("alignment", () => {
  it("maps justify-content and align-items to primary and counter alignment", () => {
    expect(readFlexAlignment({ "justify-content": "space-between", "align-items": "center" }, "row")).toEqual({
      primary: "SPACE_BETWEEN", counter: "CENTER", fillCrossAxis: false, unsupported: [],
    });
    expect(readFlexAlignment({ "justify-content": "flex-end", "align-items": "flex-end" }, "column")).toMatchObject({ primary: "MAX", counter: "MAX" });
    expect(readFlexAlignment({ "place-content": "center" }, "row").primary).toBe("CENTER");
  });

  it("never produces STRETCH: stretch, and the CSS default, become counter MIN with children filling", () => {
    expect(readFlexAlignment({}, "row")).toEqual({ primary: "MIN", counter: "MIN", fillCrossAxis: true, unsupported: [] });
    expect(readFlexAlignment({ "align-items": "stretch" }, "column")).toMatchObject({ counter: "MIN", fillCrossAxis: true });
  });

  it("keeps baseline for rows only, and reports what Figma cannot express", () => {
    expect(readFlexAlignment({ "align-items": "baseline" }, "row").counter).toBe("BASELINE");
    expect(readFlexAlignment({ "align-items": "first baseline" }, "column").counter).toBe("MIN");
    expect(readFlexAlignment({ "justify-content": "space-around" }, "row").unsupported).toEqual(["justify-content: space-around"]);
  });

  it("reads grid cell alignment, defaulting to FILL", () => {
    expect(readGridCells({})).toEqual({ horizontal: "FILL", vertical: "FILL" });
    expect(readGridCells({ "place-items": "center" })).toEqual({ horizontal: "CENTER", vertical: "CENTER" });
    expect(readGridCells({ "align-items": "start", "justify-items": "end" })).toEqual({ horizontal: "MAX", vertical: "MIN" });
  });

  it("appends the alignment to each recommendation without changing its start", () => {
    const layout = (style: Record<string, string>) =>
      analyzeHtml(`<style>.x{${Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";")}}</style><div class="x"><p>a</p><p>b</p><p>c</p></div>`)
        .sections[0].recommendation;
    expect(layout({ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "24px" }))
      .toBe("Auto Layout — horizontal, gap 24; primary SPACE_BETWEEN, counter CENTER");
    expect(layout({ display: "flex", "flex-direction": "column" }))
      .toBe("Auto Layout — vertical; primary MIN, counter MIN + children Fill width (align-items: stretch)");
    expect(layout({ display: "flex", "justify-content": "space-evenly", "align-items": "center" }))
      .toBe("Auto Layout — horizontal; primary MIN, counter CENTER, justify-content: space-evenly has no Figma equivalent");
    expect(layout({ display: "grid", "grid-template-columns": "repeat(3, 1fr)", "place-items": "center" }))
      .toBe("Figma Grid — 3 columns; cells: horizontal CENTER, vertical CENTER");
    expect(layout({ display: "flex", "flex-wrap": "wrap", "align-items": "flex-start" }))
      .toBe("Figma Grid — 3 equal items that wrap; use the column count the desktop design shows; cells: horizontal FILL, vertical MIN");
  });
});
