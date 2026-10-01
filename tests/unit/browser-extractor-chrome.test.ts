/**
 * The extractor in a real browser.
 *
 * Runs browser_extension/extractor.js inside the installed headless Chrome
 * against tests/fixtures/browser-capture/page.html. What it guards cannot be
 * checked against a mock DOM: getComputedStyle values, oklch() resolution, the
 * scroll probe firing a real IntersectionObserver reveal, and what a password
 * field gives up.
 *
 * With no Chrome on the machine the suite is skipped and says so — it does not
 * pass (LESSONS L10: an unverified check is reported, not counted as green).
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.setTimeout(90_000);

const ROOT = path.join(__dirname, "..", "..");
const HARNESS = path.join(ROOT, "tests", "fixtures", "browser-capture", "chrome-harness.mjs");
const PAGE = path.join(ROOT, "tests", "fixtures", "browser-capture", "page.html");

function run(opts: Record<string, unknown>): { status: number | null; capture?: any; stderr: string } {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w2f-")), "capture.json");
  const res = spawnSync(process.execPath, [HARNESS, PAGE, JSON.stringify(opts), out], { encoding: "utf8", timeout: 90_000 });
  const capture = res.status === 0 ? JSON.parse(fs.readFileSync(out, "utf8")) : undefined;
  return { status: res.status, capture, stderr: res.stderr };
}

const first = run({});
const noChrome = first.status === 2;
const suite = noChrome ? describe.skip : describe;

if (noChrome) {
  // eslint-disable-next-line no-console
  console.warn("SKIPPED browser-extractor-chrome: no Chrome found (set CHROME_PATH). The extractor is UNVERIFIED in a browser on this machine.");
}

suite("extractor in headless Chrome", () => {
  const c = first.capture;

  it("ran", () => {
    if (first.status !== 0) throw new Error(`harness failed: ${first.stderr}`);
    expect(c.schema).toBe("web-to-figma/capture");
    expect(c.warnings).toEqual([]);
  });

  it("reads computed layout: flex nav, 3-column grid, sticky", () => {
    const nav = c.nodes.find((n: any) => n.tag === "nav");
    expect(nav.sticky).toBe(true);
    expect(c.styles[nav.s]).toMatchObject({ display: "flex", "justify-content": "space-between", "column-gap": "16px" });
    const grid = c.nodes.find((n: any) => n.attrs?.id === "features");
    expect(c.styles[grid.s]["grid-template-columns"].split(" ")).toHaveLength(3);
    expect(grid.children).toHaveLength(3);
  });

  it("resolves oklch() and var() to the colours actually painted", () => {
    const ink = c.tokens.colors.find((x: any) => x.source === "oklch(0.2 0.02 260)");
    expect(ink.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.cssVariables.find((v: any) => v.name === "--brand").hex).toBe("#f97316");
  });

  it("keeps inline runs in order and normalises their text", () => {
    const h1 = c.nodes.find((n: any) => n.tag === "h1");
    expect(h1.text).toBe("Hello today");
    expect(h1.runs.map((r: any) => r.text ?? `<${c.nodes.find((n: any) => n.id === r.node).tag}>`)).toEqual(["Hello ", "<strong>", " today"]);
  });

  it("maps hover rules to the elements they style, shorthand kept", () => {
    const btn = c.nodes.find((n: any) => n.attrs?.class === "btn");
    const rule = c.interactions.find((i: any) => i.selector === ".btn:hover");
    expect(rule.nodes).toEqual([btn.id]);
    expect(rule.declarations).toEqual({ background: "rgb(234, 88, 12)" });
    expect(c.styles[btn.s]["transition-duration"]).toBe("0.2s");
  });

  it("records keyframes, the running animation, and pseudo-element content", () => {
    expect(c.keyframes.map((k: any) => k.name)).toContain("rise");
    const h1 = c.nodes.find((n: any) => n.tag === "h1");
    expect(c.animations.find((a: any) => a.name === "rise").node).toBe(h1.id);
    const card = c.nodes.find((n: any) => n.attrs?.class === "card");
    expect(card.pseudo.before.content).toBe('"★"');
  });

  it("fires the scroll reveal during the probe and records it", () => {
    const p = c.nodes.find((n: any) => n.text === "Revealed on scroll");
    expect(c.scroll.probed).toBe(true);
    expect(c.scroll.hints).toContainEqual(expect.objectContaining({ node: p.id, attribute: "class", from: "reveal", to: "reveal is-inview" }));
    expect(p.scrollHint).toMatchObject({ "data-aos": "fade-up" });
    expect(p.revealed.opacity).toBe("1");
  });

  it("never captures a typed password or a hidden input", () => {
    const raw = JSON.stringify(c);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("csrf");
    expect(c.nodes.find((n: any) => n.media?.type === "text").media.value).toBe("a@b.co");
  });

  it("captures only the requested section with scope selector", () => {
    const res = run({ scope: "selector", selector: "#features" });
    expect(res.status).toBe(0);
    expect(res.capture.nodes[0].attrs.id).toBe("features");
    expect(res.capture.nodes.every((n: any) => n.tag !== "nav")).toBe(true);
    expect(res.capture.scope.contextBackground).toBeNull(); // body is transparent here
    expect(res.capture.scroll.probed).toBe(false);
  });

  it("converts images the way Figma needs them, keeping transparency", () => {
    const res = spawnSync(process.execPath, [HARNESS, "about:blank"], {
      encoding: "utf8", timeout: 90_000,
      env: { ...process.env, W2F_EVAL: path.join(ROOT, "tests", "fixtures", "browser-capture", "image-convert.js") },
    });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    // transparent WebP → PNG (89 50 4E 47), scaled to twice its displayed 100×60
    expect(out.webp).toMatchObject({ kind: "image", mime: "image/png", width: 180, height: 120, head: [137, 80, 78, 71] });
    // opaque WebP → JPEG (FF D8 FF)
    expect(out.opaqueWebp.mime).toBe("image/jpeg");
    expect(out.opaqueWebp.head.slice(0, 3)).toEqual([255, 216, 255]);
    expect(out.svg).toEqual({ kind: "svg", starts: "<svg" });
    expect(out.bad).toContain("could not decode");
  });

  describe("dot patterns (regression: issue list 2026-10-01)", () => {
    const PATTERNS = path.join(ROOT, "tests", "fixtures", "browser-capture", "patterns.html");
    const RUNTIME = fs.readFileSync(path.join(ROOT, "src", "web_import", "runtime.js"), "utf8");
    let cap: any;
    beforeAll(() => {
      const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w2f-")), "p.json");
      const res = spawnSync(process.execPath, [HARNESS, PATTERNS, JSON.stringify({ autoScroll: false }), out], { encoding: "utf8", timeout: 90_000 });
      if (res.status !== 0) throw new Error(res.stderr);
      cap = JSON.parse(fs.readFileSync(out, "utf8"));
    });

    it("stamps the extension build so outdated installs are reported", () => {
      expect(cap.extractorBuild).toBeGreaterThanOrEqual(3);
    });

    it("records ::before and ::after radial-gradient dot grids", () => {
      const welc = cap.nodes.find((n: any) => n.attrs?.class === "welc");
      expect(cap.styles[welc.pseudo.before.s]["background-image"]).toMatch(/radial-gradient/);
      expect(cap.styles[welc.pseudo.after.s]["background-size"]).toBe("20px 20px");
    });

    it("turns both pseudo dot grids into dot patterns of the right size and colour", () => {
      // eslint-disable-next-line no-new-func
      const rt = new Function("figma", RUNTIME + "\nreturn { planWebImport, w2fVisibleDots };")({});
      const plan = rt.planWebImport(cap, {});
      const all: any[] = [];
      const walk = (n: any) => { all.push(n); (n.children || []).forEach(walk); };
      walk(plan.root);
      const before = all.find((n) => /::before$/.test(n.id));
      const after = all.find((n) => /::after$/.test(n.id));
      expect(before.rect).toMatchObject({ x: 20, y: 10, w: 132, h: 132 });
      expect(before.patterns[0]).toMatchObject({ r: 3.4, tw: 26, th: 26, color: { r: 239 / 255 } });
      expect(rt.w2fVisibleDots(132, 132, before.patterns[0])).toEqual({ cols: 5, rows: 5 }); // the 5×5 the page shows
      expect(after.patterns[0].tw).toBe(20);
      expect(after.patterns[0].r).toBeCloseTo(0.15 * Math.hypot(20, 20) / 2, 3);
    });

    it("expands an SVG <pattern> fill into real, coloured shapes", () => {
      const svg = cap.nodes.find((n: any) => n.tag === "svg").svg as string;
      expect(svg).not.toMatch(/<rect[^>]*fill="url\(/);       // the flattened-to-empty fill is gone
      expect(svg).toContain('data-pattern="dp3022"');
      const circles = (svg.match(/<circle/g) || []).length - 1; // minus the one left in <defs>
      expect(circles).toBe(24 * 30);                          // the tiles the 662×847 slice actually shows
      expect(svg).toMatch(/<circle[^>]*fill="#009ad7"/);      // var(--blue) resolved, not black
      expect(svg).not.toMatch(/<circle[^>]*fill="#000000"/);
      expect(svg).toMatch(/opacity="0.22"/);
      expect(cap.stats.svgPatternsExpanded).toBe(1);
    });
  });

  it("warns, first, when the page's stylesheets did not load", () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w2f-")), "u.json");
    const res = spawnSync(process.execPath, [HARNESS, path.join(ROOT, "tests", "fixtures", "browser-capture", "unstyled.html"), JSON.stringify({ autoScroll: false }), out], { encoding: "utf8", timeout: 90_000 });
    expect(res.status).toBe(0);
    const cap = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(cap.warnings[0]).toMatch(/^PAGE NOT FULLY STYLED: 1 stylesheet\(s\) did not load .*this-stylesheet-does-not-exist\.css/);
  });

  it("names the selector that matched nothing", () => {
    const res = run({ scope: "selector", selector: "#nope" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('No element matches the selector "#nope"');
  });
});
