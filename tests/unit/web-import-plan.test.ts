/**
 * The Figma-side importer's planning step: capture → plan tree.
 *
 * planWebImport (src/web_import/runtime.js) is pure, so it runs here against a capture the
 * real extractor produced in real Chrome. What it decides is what a designer
 * gets: Auto Layout vs Grid vs absolute, Hug/Fill, and the layer names.
 * The builder that writes the plan to the canvas needs live Figma and is not
 * covered here.
 */
import * as fs from "fs";
import * as path from "path";
import { loadPlugin } from "../fixtures/figma-plugin-harness";

const RUNTIME = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web_import", "runtime.js"), "utf8");
/** The runtime's functions, as execute_code would see them inside the plugin. */
function loadRuntime(figma: any): any {
  // eslint-disable-next-line no-new-func
  return new Function("figma", RUNTIME + "\nreturn { planWebImport, w2fParseColor, w2fHex, w2fGradient, w2fShadows, __w2fEntry };")(figma);
}

const FIXTURE = path.join(__dirname, "..", "fixtures", "browser-capture", "page.capture.json");
const capture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

let rt: any;
beforeAll(() => { rt = loadRuntime(loadPlugin().figma); });

function find(node: any, pred: (n: any) => boolean): any {
  if (pred(node)) return node;
  for (const c of node.children || []) { const hit = find(c, pred); if (hit) return hit; }
  return null;
}
function all(node: any, out: any[] = []): any[] {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}

describe("planWebImport on a real capture", () => {
  let plan: any;
  beforeAll(() => { plan = rt.planWebImport(capture(), {}); });

  it("builds the page as vertical Auto Layout, fixed width, hug height", () => {
    expect(plan.root.name).toBe("Page-CaptureFixture");
    expect(plan.root.layout.mode).toBe("VERTICAL");
    expect(plan.root.sizing).toEqual({ h: "FIXED", v: "HUG" });
  });

  it("turns flex into Auto Layout with the page's gap and alignment", () => {
    const nav = find(plan.root, (n) => n.name.startsWith("Nav-"));
    expect(nav.layout).toMatchObject({ mode: "HORIZONTAL", gap: 16, primary: "SPACE_BETWEEN", counter: "CENTER" });
    expect(nav.sizing.h).toBe("FILL");
  });

  it("turns a 3-column CSS grid into Grid with Fill cells", () => {
    const grid = find(plan.root, (n) => n.layout && n.layout.mode === "GRID");
    expect(grid.layout).toMatchObject({ columns: 3, rowGap: 24, columnGap: 24 });
    expect(grid.children).toHaveLength(3);
    for (const card of grid.children) expect(card.sizing.h).toBe("FILL");
  });

  it("uses content-driven height for containers (CLAUDE.md §5)", () => {
    const frames = all(plan.root).filter((n) => n.kind === "frame" && n !== plan.root && n.sizing);
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) expect(f.sizing.v).toBe("HUG");
  });

  it("names layers by role and content, never default or duplicated names", () => {
    const names = all(plan.root).map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(["Btn-GetStarted", "Card-One", "Card-Two", "Card-Three", "Heading-HelloToday", "Input-Email", "Section-Features"]));
    for (const name of names) {
      expect(name).toMatch(/^[A-Z][A-Za-z]*-[A-Za-z0-9]+$/);
      const [prefix, desc] = name.split("-");
      expect(desc.toLowerCase()).not.toBe(prefix.toLowerCase());
    }
  });

  it("puts a button's label inside a padded Auto Layout frame", () => {
    const btn = find(plan.root, (n) => n.name === "Btn-GetStarted");
    expect(btn.kind).toBe("frame");
    expect(btn.layout.padding).toEqual([10, 20, 10, 20]);
    expect(btn.children[0]).toMatchObject({ kind: "text", characters: "Get started" });
    expect(btn.fills[0].type).toBe("SOLID");
  });

  it("keeps inline runs as one text layer with styled ranges", () => {
    const h1 = find(plan.root, (n) => n.kind === "text" && n.characters === "Hello world today");
    expect(h1.ranges.map((r: any) => h1.characters.slice(r.start, r.end))).toEqual(["Hello ", "world", " today"]);
    expect(h1.ranges[1].style.weight).toBeGreaterThan(h1.ranges[0].style.weight);
  });

  it("carries the card gradient and shadow", () => {
    const card = find(plan.root, (n) => n.name === "Card-One");
    expect(card.fills[0].type).toBe("GRADIENT_LINEAR");
    expect(card.effects[0]).toMatchObject({ type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 12 });
    expect(card.radii).toEqual([12, 12, 12, 12]);
  });

  it("stores hover, motion and scroll data for the HTML export", () => {
    const btn = find(plan.root, (n) => n.name === "Btn-GetStarted");
    expect(btn.meta.interactions[0].declarations).toEqual({ background: "rgb(234, 88, 12)" });
    expect(btn.meta.motion["transition-duration"]).toBe("0.2s");
    const reveal = find(plan.root, (n) => n.characters === "Revealed on scroll");
    expect(reveal.meta.scrollHint).toMatchObject({ "data-aos": "fade-up" });
  });

  it("lays side-by-side inline boxes out as a row, not absolute", () => {
    const form = find(plan.root, (n) => n.name.startsWith("Form-"));
    expect(form.layout.mode).toBe("HORIZONTAL");
    expect(plan.stats.absoluteContainers).toBe(0);
  });

  it("keeps uneven block spacing exactly, as padding or a named spacer", () => {
    const c = capture();
    // The fixture already has 32px more above the grid than elsewhere (h1 margins).
    const grid = c.nodes.find((n: any) => n.attrs?.id === "features");
    const before = rt.planWebImport(c, {});
    expect(find(before.root, (n) => n.id === grid.id).spaceBefore).toBeCloseTo(32.1, 1);
    // Push the grid and everything below it 40px further down.
    const top = grid.rect.y;
    for (const n of c.nodes) if (n.rect.y >= top) n.rect.y += 40;
    const p = rt.planWebImport(c, {});
    expect(p.root.layout.mode).toBe("VERTICAL");
    expect(find(p.root, (n) => n.id === grid.id).spaceBefore).toBeCloseTo(72.1, 1);
  });
});

describe("wrapper collapse", () => {
  it("removes an invisible single-child wrapper with the same box", () => {
    const c = capture();
    const grid = c.nodes.find((n: any) => n.attrs?.id === "features");
    const body = c.nodes[0];
    const wrapper = { id: "w1", parent: body.id, tag: "div", rect: { ...grid.rect }, s: c.nodes.find((n: any) => n.tag === "div" && !n.children).s, children: [grid.id] };
    grid.parent = "w1";
    body.children = body.children.map((id: string) => (id === grid.id ? "w1" : id));
    c.nodes.push(wrapper);
    const p = rt.planWebImport(c, {});
    expect(find(p.root, (n) => n.id === "w1")).toBeNull();
    expect(find(p.root, (n) => n.id === grid.id).layout.mode).toBe("GRID");
    expect(p.stats.collapsed).toBe(1);
  });
});

describe("colour parsing in the plugin", () => {
  it("reads rgb, hex and the modern spaces Chrome reports", () => {
    const hex = (v: string) => { const c = rt.w2fParseColor(v); return c && rt.w2fHex(c); };
    expect(hex("rgb(249, 115, 22)")).toBe("#f97316");
    expect(hex("#fff")).toBe("#ffffff");
    // Values Chrome's own canvas produced for these in the extractor run
    expect(hex("oklch(0.2 0.02 260)")).toBe("#11161f");
    expect(hex("oklab(0.627955 0.224863 0.125846)")).toBe("#ff0000");
    expect(hex("color(srgb 1 1 1 / 0.5)")).toBe("#ffffff");
    expect(rt.w2fParseColor("color(srgb 1 1 1 / 0.5)").a).toBe(0.5);
    // CSS lab() is D50: red is lab(54.29 80.81 69.89), not the D65 textbook value
    expect(hex("lab(54.29 80.81 69.89)")).toBe("#ff0000");
  });

  it("converts linear, oklab-stop and conic gradients; refuses repeating ones", () => {
    expect(rt.w2fGradient("linear-gradient(rgb(255, 255, 255), rgb(243, 244, 246))").type).toBe("GRADIENT_LINEAR");
    const ok = rt.w2fGradient("linear-gradient(rgba(11, 11, 11, 0.8) 0%, oklab(0.15 0 0) 100%)");
    expect(ok.gradientStops).toHaveLength(2);
    expect(rt.w2fGradient("conic-gradient(from 90deg, rgb(255, 0, 0), rgb(0, 0, 255))").type).toBe("GRADIENT_ANGULAR");
    expect(rt.w2fGradient("repeating-linear-gradient(red 0px, blue 4px)")).toBeNull();
  });

  it("parses multi-layer and inset shadows", () => {
    const fx = rt.w2fShadows("rgba(0, 0, 0, 0.2) 0px 1px 2px 0px, rgb(35, 37, 42) 0px 0px 0px 1px inset");
    expect(fx.map((e: any) => e.type)).toEqual(["DROP_SHADOW", "INNER_SHADOW"]);
    expect(fx[1].spread).toBe(1);
  });
});

describe("refuses what is not a capture", () => {
  it("names what is missing", () => {
    expect(() => rt.planWebImport({ hello: 1 }, {})).toThrow(/nodes and styles are missing/);
  });
});
