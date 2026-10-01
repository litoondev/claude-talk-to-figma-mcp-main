/**
 * Fidelity rules of the web import planner (src/web_import/runtime.js).
 *
 * Each case is a minimal capture shaped like what the extractor records for a
 * real page; every rule here was found by building icon.newsmiles.co in Figma
 * and comparing the export with a 1440px screenshot of the live site:
 *
 *  - ::before/::after are built from computed size and offsets, not dropped.
 *  - A child rotated with `rotate:` or a transform keeps its rotation, and its
 *    parent keeps exact positions.
 *  - Boxes collapsed with scaleX(0) ("underline on hover") are not drawn.
 *  - A tiled radial-gradient dot grid becomes a dot pattern, not a stretched blur.
 *  - CSS filters on a container reach the images inside it.
 *  - An in-flow child that paints above a later sibling it overlaps forces exact
 *    positions and browser paint order.
 *  - A source-less iframe draws nothing; a video shows its poster.
 *  - Browser line breaks are kept for wrapping Figma cannot reproduce.
 */
import * as fs from "fs";
import * as path from "path";
import { loadPlugin } from "../fixtures/figma-plugin-harness";

const RUNTIME = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web_import", "runtime.js"), "utf8");
// eslint-disable-next-line no-new-func
const rt: any = new Function("figma", RUNTIME + "\nreturn { planWebImport, w2fRotation, w2fCollapsed, w2fImageFilters, w2fDotPattern, w2fCropTransform, w2fOutdatedWarning, w2fVisibleDots };")(loadPlugin().figma);

type N = Record<string, any>;
function capture(nodes: N[], styles: N[]) {
  return { schema: "web-to-figma/capture", version: 1, title: "T", url: "https://t.test/", viewport: { width: 1440, height: 900 }, scope: { kind: "page" }, nodes, styles, interactions: [], keyframes: [] };
}
const find = (n: any, pred: (x: any) => boolean): any => (pred(n) ? n : (n.children || []).map((c: any) => find(c, pred)).find(Boolean) || null);
const all = (n: any, out: any[] = []): any[] => { out.push(n); (n.children || []).forEach((c: any) => all(c, out)); return out; };

describe("pure helpers", () => {
  it("reads rotation from transform and from the rotate property", () => {
    expect(rt.w2fRotation({ transform: "matrix(0.997564, -0.0697565, 0.0697565, 0.997564, 0, 0)" })).toBeCloseTo(-4, 1);
    expect(rt.w2fRotation({ transform: "matrix(1, 0, 0, 1, 0, -7)", rotate: "-4deg" })).toBe(-4);
    expect(rt.w2fRotation({ rotate: "0.25turn" })).toBe(90);
    expect(rt.w2fRotation({ transform: "matrix(1, 0, 0, 1, 10, 0)" })).toBe(0);
  });

  it("knows a box scaled to nothing is not drawn", () => {
    expect(rt.w2fCollapsed({ transform: "matrix(0, 0, 0, 1, 0, 0)" })).toBe(true);
    expect(rt.w2fCollapsed({ scale: "0 1" })).toBe(true);
    expect(rt.w2fCollapsed({ transform: "matrix(0, 1, -1, 0, 0, 0)" })).toBe(false); // a 90° rotation, not a collapse
  });

  it("turns CSS filters into Figma image filters", () => {
    expect(rt.w2fImageFilters("grayscale(1) contrast(0.9) brightness(1.07)")).toEqual({ saturation: -1, contrast: expect.closeTo(-0.1, 5), exposure: expect.closeTo(0.07, 5) });
    expect(rt.w2fImageFilters("drop-shadow(rgba(0,0,0,.3) 0px 6px 8px)")).toBeNull();
  });

  it("crops images the way object-fit / object-position do", () => {
    // 1568×759 photo in a 620×700 box, cover, position 83.3% 50% (the mother-and-toddler photo)
    const t = rt.w2fCropTransform("cover", "83.3% 50%", 620, 700, 1568, 759);
    const s = 700 / 759, dw = 1568 * s;
    expect(t[0][0]).toBeCloseTo(620 / dw, 6);               // shows 620px of the scaled width
    expect(t[0][2]).toBeCloseTo((0.833 * (dw - 620)) / dw, 6); // starting 83.3% of the way across
    expect(t[1]).toEqual([0, 1, -0]);                        // full height, no vertical offset
    // centred cover equals a symmetric crop; keywords work
    expect(rt.w2fCropTransform("cover", "center top", 100, 100, 200, 100)[0][2]).toBeCloseTo(0.25, 6);
    expect(rt.w2fCropTransform("cover", "left", 100, 100, 200, 100)[0][2]).toBeCloseTo(0, 6);
    // no object-fit = fill: stretched to the box, as the browser draws it
    expect(rt.w2fCropTransform("fill", "50% 50%", 300, 100, 100, 100)).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  it("reports a capture from an outdated extension, in plain words", () => {
    expect(rt.w2fOutdatedWarning({})).toMatch(/^OUTDATED EXTENSION: .*Reload it in chrome:\/\/extensions/);
    expect(rt.w2fOutdatedWarning({ extractorBuild: 2 })).toMatch(/build 2/);
    expect(rt.w2fOutdatedWarning({ extractorBuild: 3 })).toBeNull();
  });

  it("creates only the dots a box shows", () => {
    expect(rt.w2fVisibleDots(132, 132, { r: 3.4, tw: 26, th: 26 })).toEqual({ cols: 5, rows: 5 });
    expect(rt.w2fVisibleDots(140, 26, { r: 3.4, tw: 26, th: 26 })).toEqual({ cols: 6, rows: 1 }); // 6th dot starts at 139.6 < 140
  });

  it("recognises a tiled dot grid", () => {
    expect(rt.w2fDotPattern("radial-gradient(circle, rgb(239, 70, 75) 2px, rgba(0, 0, 0, 0) 2.5px)", "26px 26px")).toMatchObject({ r: 2, tw: 26, th: 26 });
    expect(rt.w2fDotPattern("radial-gradient(circle, rgb(0, 0, 0) 2px, rgba(0, 0, 0, 0) 2.5px)", "auto")).toBeNull();
  });
});

describe("planWebImport fidelity", () => {
  const block = { display: "block", width: "1440px" };

  it("builds ::before/::after from their computed box", () => {
    const styles = [block, { display: "block", position: "relative", width: "200px", height: "100px", "background-color": "rgb(255, 255, 255)" },
      { display: "block", position: "absolute", width: "20px", height: "2px", top: "10px", left: "30px", "background-color": "rgb(239, 70, 75)" }];
    const plan = rt.planWebImport(capture([
      { id: "n1", parent: null, tag: "body", rect: { x: 0, y: 0, w: 1440, h: 300 }, s: 0, children: ["n2"] },
      { id: "n2", parent: "n1", tag: "div", rect: { x: 100, y: 50, w: 200, h: 100 }, s: 1, pseudo: { after: { content: '""', s: 2 } } },
    ], styles), {});
    const deco = find(plan.root, (n) => n.id === "n2::after");
    expect(deco).toMatchObject({ kind: "frame", rect: { x: 130, y: 60, w: 20, h: 2 } });
    expect(plan.stats.pseudoBuilt).toBe(1);
  });

  it("keeps a rotated child rotated, in a parent with exact positions", () => {
    const styles = [block, { display: "block", width: "600px" }, { display: "block", width: "300px", height: "200px", rotate: "-4deg" }];
    const plan = rt.planWebImport(capture([
      { id: "n1", parent: null, tag: "body", rect: { x: 0, y: 0, w: 1440, h: 400 }, s: 0, children: ["n2"] },
      { id: "n2", parent: "n1", tag: "div", rect: { x: 0, y: 0, w: 600, h: 300 }, s: 1, children: ["n3"], attrs: { class: "photos" } },
      { id: "n3", parent: "n2", tag: "img", rect: { x: 10, y: 10, w: 313, h: 220 }, s: 2, media: { src: "https://t.test/a.jpg" } },
    ], styles), {});
    const img = find(plan.root, (n) => n.id === "n3");
    expect(img.rotation).toBe(-4);
    expect(img.baseSize).toEqual({ w: 300, h: 200 });
    expect(find(plan.root, (n) => n.id === "n2").layout.mode).toBe("NONE");
  });

  it("orders by paint and keeps exact positions when an in-flow child must sit above a later one", () => {
    const styles = [block,
      { display: "block", position: "relative", "z-index": "30", width: "1440px", height: "0px" },
      { display: "block", position: "absolute", width: "300px", height: "200px", top: "-100px" },
      { display: "block", position: "relative", width: "1440px", height: "500px", "background-color": "rgb(20, 60, 90)" }];
    const plan = rt.planWebImport(capture([
      { id: "n1", parent: null, tag: "body", rect: { x: 0, y: 0, w: 1440, h: 800 }, s: 0, children: ["n2", "n4"] },
      { id: "n2", parent: "n1", tag: "div", rect: { x: 0, y: 300, w: 1440, h: 0 }, s: 1, children: ["n3"] },
      { id: "n3", parent: "n2", tag: "img", rect: { x: 800, y: 200, w: 300, h: 200 }, s: 2, media: { src: "https://t.test/kids.jpg" } },
      { id: "n4", parent: "n1", tag: "section", rect: { x: 0, y: 300, w: 1440, h: 500 }, s: 3 },
    ], styles), {});
    expect(plan.root.layout.mode).toBe("NONE");
    expect(plan.root.children.map((c: any) => c.id)).toEqual(["n4", expect.stringMatching(/^n[23]$/)]);
    expect(plan.stats.stackingFallbacks).toBe(1);
  });

  it("does not draw a scaled-to-nothing decoration, an empty iframe, or a video's file", () => {
    const styles = [block, { display: "block", width: "100px" }, { display: "block", position: "absolute", width: "100px", height: "2px", transform: "matrix(0, 0, 0, 1, 0, 0)", "background-color": "rgb(0, 0, 0)" }, { display: "block", width: "1440px", height: "900px" }];
    const plan = rt.planWebImport(capture([
      { id: "n1", parent: null, tag: "body", rect: { x: 0, y: 0, w: 1440, h: 1000 }, s: 0, children: ["n2", "n3", "n4"] },
      { id: "n2", parent: "n1", tag: "a", rect: { x: 0, y: 0, w: 100, h: 20 }, s: 1, text: "Locations", pseudo: { after: { content: '""', s: 2 } } },
      { id: "n3", parent: "n1", tag: "iframe", rect: { x: 0, y: 0, w: 1440, h: 900 }, s: 3, media: { iframe: true, src: null } },
      { id: "n4", parent: "n1", tag: "video", rect: { x: 0, y: 20, w: 1440, h: 900 }, s: 3, media: { video: true, src: "https://t.test/hero.mp4", poster: "https://t.test/hero.jpg" } },
    ], styles), {});
    const ids = all(plan.root).map((n) => n.id);
    expect(ids).not.toContain("n2::after");
    expect(ids).not.toContain("n3");
    expect(find(plan.root, (n) => n.id === "n4").src).toBe("https://t.test/hero.jpg");
  });

  it("passes a container's filter to its images and draws tiled dots", () => {
    const styles = [block, { display: "block", width: "800px", filter: "grayscale(1)" }, { display: "block", width: "256px", height: "256px" },
      { display: "block", width: "120px", height: "120px", "background-image": "radial-gradient(circle, rgb(239, 70, 75) 2px, rgba(0, 0, 0, 0) 2.5px)", "background-size": "26px 26px", "background-repeat": "repeat" }];
    const plan = rt.planWebImport(capture([
      { id: "n1", parent: null, tag: "body", rect: { x: 0, y: 0, w: 1440, h: 600 }, s: 0, children: ["n2", "n4"] },
      { id: "n2", parent: "n1", tag: "div", rect: { x: 0, y: 0, w: 800, h: 256 }, s: 1, children: ["n3"] },
      { id: "n3", parent: "n2", tag: "img", rect: { x: 0, y: 0, w: 256, h: 256 }, s: 2, media: { src: "https://tile.test/1.png" } },
      { id: "n4", parent: "n1", tag: "div", rect: { x: 0, y: 300, w: 120, h: 120 }, s: 3 },
    ], styles), {});
    expect(find(plan.root, (n) => n.id === "n3").filters).toEqual({ saturation: -1 });
    expect(find(plan.root, (n) => n.id === "n4").patterns).toEqual([expect.objectContaining({ r: 2, tw: 26, th: 26 })]);
  });

  it("keeps the browser's line breaks for a heading", () => {
    const styles = [block, { display: "block", width: "673px", "font-size": "40px", "line-height": "52px", "font-weight": "700", "font-family": "Inter" }];
    const plan = rt.planWebImport(capture([
      { id: "n1", parent: null, tag: "body", rect: { x: 0, y: 0, w: 1440, h: 300 }, s: 0, children: ["n2"] },
      { id: "n2", parent: "n1", tag: "h2", rect: { x: 0, y: 0, w: 673, h: 104 }, s: 1, text: "Gentle Care From Dentists Who Chose Kids", lines: ["Gentle Care From", "Dentists Who Chose Kids"] },
    ], styles), {});
    const h2 = find(plan.root, (n) => n.id === "n2");
    expect(h2.breakAt).toEqual([16]);
    expect(h2.hardAll).toBe(true);
  });
});
