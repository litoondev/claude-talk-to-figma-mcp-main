/**
 * convert_layout mode "grid" on the designer's "Single Work" page (probed
 * read-only through the relay, 2026-09-17). Layer order, types, sizes, sizing,
 * padding, gaps, strokes and hidden layers are the real ones; coordinates are
 * made relative to each section.
 *
 * The complaint these guard: asked for a full Grid, sections kept
 * Frame 47806 › Frame 47807 › Title + hidden description, the three paragraph
 * columns were refused, and rows inside a section were never considered.
 */
import { loadPlugin, makeNode, placeOnPage, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

beforeEach(() => {
  clearNodes();
  ({ api, figma } = loadPlugin({ layoutEngine: true }));
});

function onPage(node: any) {
  placeOnPage(node);
  registerNodes(node);
  return node;
}

const al = (name: string, layoutMode: string, spec: any, children: any[]) =>
  makeNode({ name, layoutMode, children, ...spec });
const pad = (top: number, right: number, bottom: number, left: number) =>
  ({ paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left });
const text = (name: string, width: number, height: number, spec: any = {}) =>
  makeNode({ name, type: "TEXT", width, height, ...spec });
const hiddenText = (name: string) =>
  text(name, 520, 32, { visible: false, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
const stroke = [{ type: "SOLID" }];

function box(node: any) {
  const b = node.absoluteBoundingBox;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}
function snapshot(nodes: any[]) {
  return nodes.map((node) => ({ node, box: box(node) }));
}
function expectUnmoved(entries: Array<{ node: any; box: any }>) {
  for (const { node, box: before } of entries) {
    expect(node.removed).toBe(false);
    const after = box(node);
    for (const key of ["x", "y", "width", "height"] as const) {
      if (Math.abs(after[key] - before[key]) > 0.5) throw new Error(`"${node.name}" ${key} moved from ${before[key]} to ${after[key]}`);
    }
  }
}

/** Page Header (4006:93576): three Paragraphs columns, the last one without its divider stroke. */
function paragraphsSection() {
  const column = (bodyHeight: number, spec: any) => {
    const title = text("Title", 150, 18, { layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" });
    const hidden = hiddenText("This is project description");
    const body = text("Body copy", 440, bodyHeight, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" });
    const titleWrap = al("Frame 47807", "VERTICAL", { width: 440, height: 18, itemSpacing: 24, primaryAxisAlignItems: "CENTER",
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [title, hidden]);
    const block = al("Frame 47806", "VERTICAL", { width: 440, height: 42 + bodyHeight, itemSpacing: 24,
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [titleWrap, body]);
    const node = al("Paragraphs", "VERTICAL", { width: 640, height: 618, itemSpacing: 50, ...pad(160, 100, 160, 100), ...spec }, [block]);
    return { node, title, hidden, body, titleWrap, block };
  };
  const columns = [
    column(160, { strokes: stroke, layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL" }),
    column(192, { strokes: stroke, height: 554, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }),
    column(256, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL" }),
  ];
  const section = onPage(al("Page Header", "HORIZONTAL", { id: "ph", width: 1920, height: 618, strokes: stroke,
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG" }, columns.map((c) => c.node)));
  return { section, columns };
}

/** 4 Grid Home (4006:93595): two rows of two image frames; the second row is not Auto Layout. */
function gridHome() {
  const img = (name: string, x = 0) => makeNode({ name, x, width: 930, height: 930, fills: [{ type: "SOLID" }], clipsContent: true,
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
  const a = img("IMG");
  const b = img("Change Bg");
  const c = img("IMG", 929.6);
  const d = img("IMG", -0.4);
  const first = al("1st", "HORIZONTAL", { width: 1920, height: 930, counterAxisAlignItems: "CENTER",
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [a, b]);
  const second = makeNode({ name: "2nd", width: 1920, height: 930, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", children: [c, d] });
  const section = onPage(al("4 Grid Home", "VERTICAL", { id: "home", width: 1920, height: 1860,
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG" }, [first, second]));
  return { section, first, second, images: [a, b, d, c] };
}

/**
 * 2 Overview (4006:93541): logo + intro row, a table of four bordered rows
 * wrapped twice, and a row of two images whose first frame carries two logos.
 * Where the probe abbreviated Fixed/Fill, sizing is inferred from geometry.
 */
function overview() {
  const inner = 1920 - 2 * 129.1667;
  const hidden = (name: string, width: number, height: number) =>
    text(name, width, height, { visible: false, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
  const logo = (size: number) => makeNode({ name: "logo", type: "INSTANCE", width: size, height: size,
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });

  const bigLogo = logo(206.667);
  const logoWrap = al("Frame 1410125453", "HORIZONTAL", { width: 206.667, height: 206.667, itemSpacing: 36.47, counterAxisAlignItems: "CENTER",
    layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" }, [bigLogo, hidden("Lawtons", 1425.4, 207)]);
  const intro = text("Lawtons is one of the UK's most respected…", 1119.167, 290, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" });
  const introRow = al("Frame 1410125666", "HORIZONTAL", { width: inner, height: 290, itemSpacing: 335.8333,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [logoWrap, intro]);

  const g = 25.8333;
  const tableRow = (name: string, label: [string, number], value: [string, number]) => {
    const l = text(label[0], label[1], 46.5, { layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" });
    const v = text(value[0], value[1], 46.5, { layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" });
    const pair = al("Frame 1410125667", "HORIZONTAL", { width: inner, height: 46.5, itemSpacing: g, primaryAxisAlignItems: "SPACE_BETWEEN",
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [l, v]);
    const row = al(name, "VERTICAL", { width: inner, height: 46.5 + 2 * g, itemSpacing: g, ...pad(g, 0, g, 0), strokes: stroke,
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [pair]);
    return { row, pair, l, v };
  };
  const rows = [
    tableRow("Frame 1410125386", ["Industry-", 134.2], ["High-End Furniture e-commerce", 479.6]),
    tableRow("Frame 1410125458", ["User", 67.8], ["Discerning individuals seeking elevated living standards", 837]),
    tableRow("Frame 1410125459", ["Project Timeline", 236.5], ["Project Duration: Approximately 5 weeks", 585.9]),
    tableRow("Frame 1410125460", ["Project Name", 194], ["home box stores", 244.5]),
  ];
  const table = al("Frame 1410125668", "VERTICAL", { width: inner, height: 4 * (46.5 + 2 * g),
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, rows.map((r) => r.row));
  const tableWrap = al("Frame 1410125456", "VERTICAL", { width: inner, height: table.height, itemSpacing: 155,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [table]);

  const smallLogo = (id: string) => al(`Frame ${id}`, "HORIZONTAL", { width: 72.3, height: 72.3, itemSpacing: 12.76, counterAxisAlignItems: "CENTER",
    layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" }, [logo(72.3), hidden("Home Box Stores", 498.9, 55)]);
  const logos = al("Frame 1410125670", "HORIZONTAL", { x: -0.5, y: 0, width: 209.2, height: 123.97, itemSpacing: 12.9167, counterAxisAlignItems: "CENTER",
    ...pad(51.6667, 0, 0, 51.6667), layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" }, [smallLogo("1410125453"), smallLogo("1410125454")]);
  const photo = makeNode({ name: "image 142", type: "RECTANGLE", x: -0.5, y: -2.6, width: 849.5, height: 793.1, fills: [{ type: "SOLID" }] });
  const photoFrame = makeNode({ name: "Frame 1410125669", width: 850.5, height: 790.5, clipsContent: true,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL", children: [photo, logos] });
  const phone = makeNode({ name: "image 145", type: "RECTANGLE", width: 790.5, height: 790.5, fills: [{ type: "SOLID" }],
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
  const imageRow = al("Frame 1410125671", "HORIZONTAL", { width: inner, height: 790.5, itemSpacing: 20.6667,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }, [photoFrame, phone]);

  const section = onPage(al("2 Overview", "VERTICAL", { id: "ov", width: 1920, height: 1983.17, itemSpacing: 155, ...pad(100, 129.1667, 100, 129.1667),
    counterAxisAlignItems: "CENTER", fills: [{ type: "SOLID" }], layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG" },
    [introRow, tableWrap, imageRow]));
  return { section, introRow, logoWrap, bigLogo, intro, table, tableWrap, rows, imageRow, photoFrame, photo, logos, phone };
}

describe("real file: Page Header › three Paragraphs columns", () => {
  it("becomes a 3-column Grid of the columns, each holding its title and copy directly", async () => {
    const { section, columns } = paragraphsSection();
    const before = snapshot([section, ...columns.flatMap((c) => [c.node, c.title, c.body])]);

    const dry = await api.convertLayoutCommand({ nodeId: "ph", mode: "grid", dryRun: true });
    expect(dry.blocked).toEqual([]);
    expect(dry.proposals).toHaveLength(1);
    expect(dry.proposals[0]).toMatchObject({ mode: "grid", layout: "3-column Grid, 1 row(s), equal columns, gaps 0/0px" });

    const r = await api.convertLayoutCommand({ nodeId: "ph", mode: "grid", confirmedIds: ["ph"] });

    expect(r.skipped).toEqual([]);
    expect(section.layoutMode).toBe("GRID");
    expect(section.children).toEqual(columns.map((c) => c.node));
    for (const c of columns) {
      expect(c.block.removed).toBe(true);
      expect(c.titleWrap.removed).toBe(true);
      expect(c.node.children.slice(0, 2)).toEqual([c.title, c.body]);
      expect(c.hidden).toMatchObject({ parent: c.node, visible: false, layoutPositioning: "ABSOLUTE" });
    }
    expect(columns[0].node.layoutSizingVertical).toBe("FILL");
    expect(columns[1].node.layoutSizingVertical).toBe("HUG");
    expectUnmoved(before);
    expect(figma.currentPage.children).toEqual([section]);
  });
});

describe("real file: 4 Grid Home", () => {
  it("becomes a 2 × 2 Grid holding the four image frames directly", async () => {
    const { section, first, second, images } = gridHome();
    const before = snapshot([section, ...images]);

    const dry = await api.convertLayoutCommand({ nodeId: "home", mode: "grid", dryRun: true });
    expect(dry.proposals[0].keptFree).toEqual([]); // image frames hold nothing to convert, so nothing to report

    const r = await api.convertLayoutCommand({ nodeId: "home", mode: "grid", confirmedIds: ["home"] });

    expect(r.skipped).toEqual([]);
    expect(section).toMatchObject({ layoutMode: "GRID", gridRowCount: 2, gridColumnCount: 2 });
    expect(section.children).toEqual(images);
    expect(first.removed).toBe(true);
    expect(second.removed).toBe(true);
    expectUnmoved(before);
  });
});

describe("real file: 2 Overview", () => {
  it("Grid where the layers are rows and columns, Auto Layout for the stack, wrappers gone", async () => {
    const o = overview();
    const leaves = [o.bigLogo, o.intro, ...o.rows.flatMap((r) => [r.row, r.l, r.v]), o.photoFrame, o.photo, o.phone];
    const before = snapshot([o.section, ...leaves]);

    const dry = await api.convertLayoutCommand({ nodeId: "ov", mode: "grid", dryRun: true });
    expect(dry.blocked).toEqual([]);
    expect(dry.proposals).toHaveLength(1);
    expect(dry.proposals[0]).toMatchObject({ mode: "auto_layout", gridRefusal: expect.any(String) });

    const r = await api.convertLayoutCommand({ nodeId: "ov", mode: "grid", confirmedIds: ["ov"] });

    expect(r.skipped).toEqual([]);
    const byName = Object.fromEntries(r.converted.map((c: any) => [c.name, c]));
    // Logo and intro 336px apart are a row, not columns; the logo's one-layer wrapper is removed.
    expect(o.introRow.layoutMode).toBe("HORIZONTAL");
    expect(o.introRow.children.slice(0, 2)).toEqual([o.bigLogo, o.intro]);
    expect(o.logoWrap.removed).toBe(true);
    // The two images: a 2-column Grid.
    expect(o.imageRow.layoutMode).toBe("GRID");
    expect(o.imageRow.children).toEqual([o.photoFrame, o.phone]);
    // Label and value at opposite ends stay a space-between row, without the inner wrapper.
    for (const row of o.rows) {
      expect(row.pair.removed).toBe(true);
      expect(row.row.children).toEqual([row.l, row.v]);
      expect(row.row.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
    }
    // The table was wrapped twice; one frame is left.
    expect([o.table.removed, o.tableWrap.removed].filter(Boolean)).toHaveLength(1);
    expect(byName["2 Overview"]).toMatchObject({ mode: "auto_layout" });
    expectUnmoved(before);
    expect(figma.currentPage.children).toEqual([o.section]);
  });
});

/**
 * Page Header / 04 (4006:108159, probed 2026-09-17): a padded row holding one
 * block — Title in its own wrapper above a long paragraph. Replayed live in
 * Figma, turning the row into a column made its width hug; the resize to the
 * same size changed nothing, so removing the block shrank it to 889px.
 */
describe("real file: Page Header / 04", () => {
  it("becomes a column with Title and the paragraph directly inside, at its full width", async () => {
    const title = text("Title", 169, 28, { layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" });
    const paragraph = text("Consistency: Typography, colour, spacing", 1139, 572, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" });
    const group = al("design system Group", "VERTICAL", { width: 169, height: 28, itemSpacing: 24, primaryAxisAlignItems: "CENTER",
      layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" }, [title]);
    const block = al("design system Block", "VERTICAL", { width: 1139, height: 632, itemSpacing: 32,
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL" }, [group, paragraph]);
    const section = onPage(al("Page Header / 04", "HORIZONTAL", { id: "ph4", width: 1859, height: 952, ...pad(160, 360, 160, 360),
      strokes: stroke, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG" }, [block]));
    const before = snapshot([section, title, paragraph]);

    const r = await api.convertLayoutCommand({ nodeId: "ph4", mode: "grid", confirmedIds: ["ph4"] });

    expect(r.skipped).toEqual([]);
    expect(section).toMatchObject({ layoutMode: "VERTICAL", itemSpacing: 32 });
    expect(section.children).toEqual([title, paragraph]);
    expect([block.removed, group.removed]).toEqual([true, true]);
    expect(section.layoutSizingHorizontal).toBe("FIXED");
    expect(paragraph.layoutSizingHorizontal).toBe("FILL");
    expectUnmoved(before);
  });
});

