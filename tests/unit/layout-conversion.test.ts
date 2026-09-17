/**
 * convert_layout: free-positioned frames and groups become Auto Layout or a
 * Grid that renders exactly where the layers were.
 *
 * Runs the plugin against the harness layout engine, which computes Auto
 * Layout, Grid and group geometry and refuses what Figma refuses, so "nothing
 * moved" is measured rather than assumed. The first block's fixtures are copied
 * from the designer's file (probed read-only through the relay): the layer
 * order, coordinates, sizes and types are the real ones.
 */
import { loadPlugin, makeNode, placeOnPage, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

function setup(options: any = {}) {
  clearNodes();
  ({ api, figma } = loadPlugin({ layoutEngine: true, ...options }));
}

const text = (name: string, x: number, y: number, width: number, height: number, extra: any = {}) =>
  makeNode({ name, type: "TEXT", x, y, width, height, ...extra });

const block = (name: string, x: number, y: number, width: number, height: number, extra: any = {}) =>
  makeNode({ name, type: "INSTANCE", x, y, width, height, ...extra });

/** A group's own x/y are the union of its children, in its parent's coordinate space. */
function group(name: string, children: any[], extra: any = {}) {
  const x = Math.min(...children.map((c) => c.x));
  const y = Math.min(...children.map((c) => c.y));
  const width = Math.max(...children.map((c) => c.x + c.width)) - x;
  const height = Math.max(...children.map((c) => c.y + c.height)) - y;
  return makeNode({ name, type: "GROUP", x, y, width, height, children, ...extra });
}

function onPage(...nodes: any[]) {
  for (const node of nodes) {
    placeOnPage(node);
    registerNodes(node);
  }
}

function box(node: any): Record<string, number> {
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
    for (const key of ["x", "y", "width", "height"]) {
      if (Math.abs(after[key] - before[key]) > 0.5) {
        throw new Error(`"${node.name}" ${key} moved from ${before[key]} to ${after[key]}`);
      }
    }
  }
}

const scan = (nodeId: string, extra: any = {}) => api.convertLayoutCommand({ nodeId, dryRun: true, ...extra });
const apply = (nodeId: string, extra: any = {}) =>
  api.convertLayoutCommand({ nodeId, confirmedIds: [nodeId], ...extra });

// ─── Real layouts from the designer's file ────────────────────────────────

describe("real file: Before & Afters › Slider Button (group of two icon buttons at opposite ends)", () => {
  function sliderButton() {
    const icon = (name: string, x: number) =>
      makeNode({
        name, x, y: 498, width: 44, height: 44, layoutMode: "HORIZONTAL", fills: [{ type: "SOLID" }],
        primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED",
        children: [makeNode({ name: "Icon", x: 12, y: 12, width: 20, height: 20,
          children: [makeNode({ name: "Vector", type: "VECTOR", width: 20, height: 20 })] })],
      });
    const right = icon("Right Icon", 1324.4);
    const left = icon("Left Icon", 71.8);
    const slider = group("Slider Button", [right, left], { id: "slider" });
    const section = makeNode({ id: "before-afters", name: "Before & Afters", width: 1440, height: 600, children: [slider] });
    onPage(section);
    return { section, slider, right, left };
  }

  beforeEach(() => setup());

  it("proposes a horizontal frame that spaces the buttons apart", async () => {
    const { slider } = sliderButton();
    const r = await scan("slider");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ id: "slider", name: "Slider Button", layout: "horizontal, space between" });
    expect(slider.removed).toBe(false);
  });

  it("converts the group to an Auto Layout frame with both buttons exactly where they were", async () => {
    const { section, slider, right, left } = sliderButton();
    const before = snapshot([right, left]);
    const sliderBox = box(slider);

    const r = await apply("slider");

    expect(r.skipped).toEqual([]);
    expect(slider.removed).toBe(true);
    const frame = section.children[0];
    expect(frame).toMatchObject({ type: "FRAME", name: "Slider Button", layoutMode: "HORIZONTAL", primaryAxisAlignItems: "SPACE_BETWEEN" });
    expect(frame.fills).toEqual([]);
    expect(frame.clipsContent).toBe(false);
    expect(frame.children).toEqual([left, right]);
    expect(box(frame)).toEqual(sliderBox);
    expectUnmoved(before);
    expect(figma.currentPage.children).toEqual([section]); // no backup or staging frame left behind
  });
});

describe("real file: Location › Map Container (map with a pin on top)", () => {
  function mapContainer() {
    const map = makeNode({
      name: "Map", x: 0, y: -0.3, width: 280, height: 393, layoutMode: "VERTICAL", fills: [{ type: "SOLID" }],
      primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED",
      children: [block("Location Pop-up ", 20, 26, 240, 306.4)],
    });
    const pin = block("pin", 126.2, 340.3, 28.1, 34.4);
    const container = makeNode({
      id: "map-container", name: "Map Container", width: 288, height: 393,
      layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", children: [map, pin],
    });
    const row = makeNode({
      name: "map and text", width: 288, height: 892, layoutMode: "VERTICAL", itemSpacing: 20,
      primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "FIXED",
      children: [makeNode({ name: "Text", width: 288, height: 479 }), container],
    });
    onPage(row);
    return { row, container, map, pin };
  }

  beforeEach(() => setup());

  it("keeps the overlapping pin where it is as an absolute layer and stacks the map", async () => {
    const { container, map, pin } = mapContainer();
    const before = snapshot([container, map, pin]);

    const r = await apply("map-container");

    expect(r.skipped).toEqual([]);
    expect(r.converted[0]).toMatchObject({ layout: "vertical, gap 0px", absolute: ["pin"] });
    expect(container.layoutMode).toBe("VERTICAL");
    expect(container.children).toEqual([map, pin]);
    expect(pin.layoutPositioning).toBe("ABSOLUTE");
    expect(container.layoutSizingVertical).toBe("HUG");
    expectUnmoved(before);
  });
});

describe("real file: Buttons & Hover States › Hover Interactions page (hand-placed, not aligned)", () => {
  beforeEach(() => setup());

  it("refuses to snap layers into place and names the ones that are out of line", async () => {
    const page = makeNode({
      id: "hover", name: "Hover Interactions page", x: 50, y: 1904, width: 1296, height: 587, fills: [{ type: "SOLID" }],
      children: [
        text("Hover Interactions", 99, 56, 1026, 131),
        text("Play Hover Interactions frame and hover over button to see button interactions.", 112, 187, 691, 30),
        block("Button", 99, 418, 224, 60),
        block("Button", 447, 437, 176, 30),
      ],
    });
    onPage(page);
    const order = page.children.slice();

    const r = await scan("hover");

    expect(r.proposals).toEqual([]);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].reason).toMatch(/"Button" and "Button" are not aligned top, centre or bottom \(top edges 19px apart\)/);

    const applied = await apply("hover");
    expect(applied.converted).toEqual([]);
    expect(applied.skipped[0].reason).toMatch(/not aligned/);
    expect(page.layoutMode).toBe("NONE");
    expect(page.children).toEqual(order);
  });
});

describe("real file: Fixed footer › Wave (rotated divider made of overlapping frames)", () => {
  beforeEach(() => setup());

  const wave = (extra: any = {}) =>
    makeNode({
      id: "wave", name: "Wave", width: 1440, height: 76, ...extra,
      children: [
        makeNode({ name: "div.fold-divider:mask", x: 0, y: -52.4, width: 1440, height: 138.1 }),
        makeNode({ name: "div.fold-divider", x: 0, y: -52, width: 1440, height: 138, fills: [{ type: "SOLID" }] }),
      ],
    });

  it("is left alone because it is rotated", async () => {
    onPage(wave({ rotation: 180 }));
    const r = await scan("wave");
    expect(r.blocked[0]).toMatchObject({ id: "wave", reason: "rotated" });
  });

  it("would still be refused unrotated: every layer reaches past its edges", async () => {
    onPage(wave());
    const r = await scan("wave");
    expect(r.blocked[0].reason).toBe("every layer overlaps another or reaches past its edges");
  });
});

describe("real file: Master Design Components › Group 9437 (component set beside two labels)", () => {
  beforeEach(() => setup());

  it("is refused: the set and the label column share no top, centre or bottom edge", async () => {
    const g = group("Group 9437", [
      makeNode({ name: "Frame 1410125106", x: 399, y: 625, width: 237, height: 252, layoutMode: "HORIZONTAL",
        primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED" }),
      makeNode({ name: "Frame 1410125108", x: 399, y: 243, width: 276, height: 252, layoutMode: "HORIZONTAL",
        primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED" }),
      makeNode({ name: "Office_Hours", type: "COMPONENT_SET", x: 0, y: 170, width: 371, height: 870 }),
    ], { id: "g9437" });
    onPage(makeNode({ name: "Frame 1410125111", width: 700, height: 1100, children: [g] }));

    const r = await scan("g9437");

    expect(r.proposals).toEqual([]);
    expect(r.blocked[0].reason).toMatch(/"Office_Hours" and "Frame 1410125108" are not aligned top, centre or bottom/);
  });
});

// ─── Auto Layout conversion ───────────────────────────────────────────────

describe("Auto Layout mode", () => {
  beforeEach(() => setup());

  /** A static card: title and body 8px apart, a button 24px below. */
  function card(id = "card", x = 0, y = 0, extra: any = {}) {
    const title = text("Title", 24, 24, 252, 30);
    const body = text("Body", 24, 62, 252, 60);
    const button = block("Button", 24, 146, 120, 40);
    const node = makeNode({ id, name: "Card", x, y, width: 300, height: 200, fills: [{ type: "SOLID" }], children: [title, body, button], ...extra });
    return { node, title, body, button };
  }

  it("groups the closest layers first so one gap describes each frame", async () => {
    const c = card();
    onPage(c.node);
    const before = snapshot([c.node, c.title, c.body, c.button]);

    const r = await apply("card");

    expect(r.converted[0]).toMatchObject({ layout: "vertical, gap 24px", padding: [24, 24, 14, 24], wrappersCreated: 1 });
    const [column, button] = c.node.children;
    expect(column).toMatchObject({ name: "Column", layoutMode: "VERTICAL", itemSpacing: 8, fills: [], clipsContent: false });
    expect(column.children).toEqual([c.title, c.body]);
    expect(button).toBe(c.button);
    expect(c.node).toMatchObject({ layoutMode: "VERTICAL", itemSpacing: 24, paddingTop: 24, paddingBottom: 14 });
    expect(c.node.layoutSizingVertical).toBe("HUG");
    expect(c.node.layoutSizingHorizontal).toBe("FIXED");
    expectUnmoved(before);
  });

  it("dissolves a group that only held layers, reusing its name for the column it becomes", async () => {
    const c = card();
    const textGroup = group("Text", [c.title, c.body]);
    c.node.children.splice(0, 2);
    c.node.children.unshift(textGroup);
    textGroup.parent = c.node;
    onPage(c.node);
    const before = snapshot([c.title, c.body, c.button]);

    const r = await apply("card");

    expect(r.converted[0].flattened).toEqual(["Text"]);
    expect(textGroup.removed).toBe(true);
    expect(c.node.children[0]).toMatchObject({ name: "Text", type: "FRAME", layoutMode: "VERTICAL" });
    expect(c.node.children[0].children).toEqual([c.title, c.body]);
    expectUnmoved(before);
  });

  it("flattens a section: the transparent row frame is kept as the row, cards convert first", async () => {
    const cards = [0, 1, 2].map((i) => card(`card${i}`, i * 324, 0).node);
    const row = makeNode({ id: "frame12", name: "Frame 12", x: 100, y: 200, width: 948, height: 200, children: cards });
    const heading = text("Heading", 100, 80, 940, 60);
    const section = makeNode({ id: "section", name: "Features", width: 1140, height: 480, fills: [{ type: "SOLID" }], children: [heading, row] });
    onPage(section);
    const leaves = cards.reduce((all: any[], c: any) => all.concat(c.children), []);
    const before = snapshot([heading, ...cards, ...leaves]);

    const dry = await scan("section");
    expect(dry.proposals[0]).toMatchObject({ layout: "vertical, gap 60px", padding: [80, 92, 80, 100], wrappersCreated: 0 });
    expect(dry.proposals[0].inner.map((j: any) => j.id)).toEqual(["card0", "card1", "card2"]);

    const r = await apply("section");

    expect(r.skipped).toEqual([]);
    expect(r.converted.map((c: any) => c.name)).toEqual(["Card", "Card", "Card", "Features"]);
    expect(section.children).toEqual([heading, row]);
    expect(row).toMatchObject({ layoutMode: "HORIZONTAL", itemSpacing: 24 });
    for (const c of cards) expect(c.layoutMode).toBe("VERTICAL");
    expectUnmoved(before);
  });

  it("keeps a hidden layer out of the flow and in the frame", async () => {
    const c = card();
    const ghost = makeNode({ name: "Old badge", x: 200, y: 10, width: 80, height: 80, visible: false });
    c.node.children.push(ghost);
    ghost.parent = c.node;
    onPage(c.node);
    const before = snapshot([c.title, c.body, c.button]);

    await apply("card");

    expect(ghost.parent).toBe(c.node);
    expect(ghost.visible).toBe(false);
    expectUnmoved(before);
  });

  it("keeps Fill width in an Auto Layout parent and hugs the height", async () => {
    const c = card("card", 0, 0, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED" });
    const parent = makeNode({ name: "Column", width: 300, height: 200, layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "FIXED", children: [c.node] });
    onPage(parent);
    const before = snapshot([c.node, c.title, c.body, c.button]);

    await apply("card");

    expect(c.node.layoutSizingHorizontal).toBe("FILL");
    expect(c.node.layoutSizingVertical).toBe("HUG");
    expectUnmoved(before);
  });

  it("refuses when a new order would paint a shadow over its neighbour", async () => {
    const right = block("Right", 220, 20, 100, 60);
    const left = block("Left", 20, 20, 180, 60, { renderOutset: 30 });
    onPage(makeNode({ id: "pair", name: "Pair", width: 400, height: 100, children: [right, left] }));

    const r = await scan("pair");

    expect(r.blocked[0].reason).toBe('"Left" would end up underneath "Right" where they overlap');
  });

  it("refuses a composition where most layers overlap (real file: InstaSlider › Real Smiles Image Group)", async () => {
    onPage(makeNode({
      id: "collage", name: "Real Smiles Image Group ", width: 618, height: 548, fills: [{ type: "SOLID" }],
      children: [
        block("Shape", 450, 233, 196, 252),
        block("Banner Container", 581.3, -6, 528.9, 539.2),
        block("Image Wrapper", 304.2, 81, 244.6, 209.7),
        block("Image Wrapper", 260.7, 293.3, 254.8, 230),
        block("Phone Frame", 138.9, 51.3, 214, 436.1),
        block("Video Highlight Container", 278.2, 202.5, 147.7, 147.7),
        block("Video Thumbnails Container", 546.7, 205.6, 83.4, 94.1),
        block("Line Container", 94.3, 19.7, 48.2, 51.4),
        block("Shape", 481.5, 490.7, 78.1, 39),
      ],
    }));
    const r = await scan("collage");
    expect(r.proposals).toEqual([]);
    expect(r.blocked[0].reason).toMatch(/of its 9 layers overlap or reach past its edges — a free composition, kept as it is/);
  });

  it("keeps a single overlapping badge as an overlay rather than calling it a composition", async () => {
    const cardNode = makeNode({ id: "badged", name: "Card", width: 300, height: 200, fills: [{ type: "SOLID" }],
      children: [block("Image", 0, 0, 300, 200), block("Badge", 260, -10, 50, 24)] });
    onPage(cardNode);
    const r = await scan("badged");
    expect(r.proposals[0].absolute).toEqual(["Badge"]);
  });

  it("skips drawings made only of vectors without listing them", async () => {
    onPage(makeNode({
      id: "logo", name: "Shape", width: 78, height: 39,
      children: [0, 27, 54].map((x) => makeNode({ name: "Vector", type: "VECTOR", x, width: 24, height: 39 })),
    }));
    const r = await scan("logo");
    expect(r).toMatchObject({ proposals: [], blocked: [], graphicsSkipped: 1 });
  });

  it("never enters a component instance or a main component", async () => {
    const inside = makeNode({ name: "Loose", width: 100, height: 100, children: [text("A", 0, 0, 50, 20), text("B", 0, 40, 50, 20)] });
    onPage(
      makeNode({ id: "inst", name: "Card", type: "INSTANCE", width: 200, height: 200, children: [inside] }),
      makeNode({ id: "comp", name: "Card", type: "COMPONENT", width: 200, height: 200,
        children: [makeNode({ name: "Loose", width: 100, height: 100, children: [text("A", 0, 0, 50, 20), text("B", 0, 40, 50, 20)] })] })
    );
    for (const id of ["inst", "comp"]) {
      const r = await scan(id);
      expect(r.proposals).toEqual([]);
    }
  });
});

// ─── Grid conversion ──────────────────────────────────────────────────────

describe("Grid mode", () => {
  beforeEach(() => setup());

  /** Heading over two rows of three equal cards, 40px gaps. */
  function gridSection(cardSpec: (row: number, column: number) => any = () => ({})) {
    const heading = text("Heading", 40, 40, 920, 50);
    const cards: any[] = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        cards.push(block(`Card ${r + 1}.${c + 1}`, 40 + c * 320, 130 + r * 280, 280, 240, cardSpec(r, c)));
      }
    }
    const section = makeNode({ id: "grid", name: "Team", width: 1000, height: 700, fills: [{ type: "SOLID" }], children: [heading, ...cards] });
    onPage(section);
    return { section, heading, cards };
  }

  it("builds a Grid with the heading spanning every column and the cards directly inside", async () => {
    const { section, heading, cards } = gridSection();
    const before = snapshot([section, heading, ...cards]);

    const dry = await scan("grid", { mode: "grid" });
    expect(dry.proposals[0]).toMatchObject({ layout: "3-column Grid, 3 row(s), equal columns, gaps 40/40px", padding: [40, 40, 50, 40] });

    const r = await apply("grid", { mode: "grid" });

    expect(r.skipped).toEqual([]);
    expect(section).toMatchObject({ layoutMode: "GRID", gridColumnCount: 3, gridRowCount: 3, gridRowGap: 40, gridColumnGap: 40 });
    expect(section.gridColumnSizes.every((t: any) => t.type === "FLEX")).toBe(true);
    expect(section.gridRowSizes.every((t: any) => t.type === "HUG")).toBe(true);
    expect(section.children).toEqual([heading, ...cards]);
    expect(heading.gridColumnSpan).toBe(3);
    for (const c of cards) expect(c.layoutSizingHorizontal).toBe("FILL");
    expect(section).toMatchObject({ gridItemsPositioning: "ROW_AUTO_FLOW", gridAutoTracks: "ROWS" });
    expectUnmoved(before);
    expect(figma.currentPage.children).toEqual([section]);
  });

  it("keeps manual placement when the last row leaves a column empty, which auto-flow would fill", async () => {
    const { section, heading, cards } = gridSection();
    const [removedCard] = section.children.splice(4, 1); // the first card of the second row
    removedCard.parent = null;
    const kept = cards.filter((c) => c !== removedCard);
    const before = snapshot([section, heading, ...kept]);

    const r = await apply("grid", { mode: "grid" });

    expect(r.skipped).toEqual([]);
    expect(section.gridItemsPositioning).toBe("MANUAL");
    expectUnmoved(before);
  });

  it("uses Auto Layout, with the reason, when the columns are not evenly spaced", async () => {
    const { section } = gridSection();
    section.children[3].x += 10; // the third card of the first row
    section.children[6].x += 10;
    const r = await scan("grid", { mode: "grid" });
    expect(r.proposals.map((p: any) => p.mode)).not.toContain("grid");
    for (const p of r.proposals) expect(p.gridRefusal).toBe("its columns are not evenly spaced (gaps 40, 50px)");
  });

  it("uses Auto Layout for a single column and says why it is not a Grid", async () => {
    onPage(makeNode({ id: "list", name: "List", width: 300, height: 200, children: [text("A", 0, 0, 100, 20), text("B", 0, 40, 100, 20)] }));
    const r = await scan("list", { mode: "grid" });
    expect(r.proposals[0]).toMatchObject({ mode: "auto_layout", layout: "vertical, gap 20px",
      gridRefusal: "its layers form a single column — use Auto Layout instead of a Grid" });
  });

  it("keeps a hidden layer as a hidden absolute layer where it was, outside the Grid cells", async () => {
    const { section, heading, cards } = gridSection();
    const hidden = block("Draft", 600, 10, 10, 10, { visible: false });
    section.children.push(hidden);
    hidden.parent = section;
    const before = snapshot([section, heading, ...cards]);

    const r = await apply("grid", { mode: "grid" });

    expect(r.skipped).toEqual([]);
    expect(section.layoutMode).toBe("GRID");
    expect(hidden).toMatchObject({ parent: section, visible: false, layoutPositioning: "ABSOLUTE", x: 600, y: 10 });
    expectUnmoved(before);
  });

  it("uses an empty spacer row instead of a wrapper when the heading sits further from the cards", async () => {
    const heading = text("Heading", 40, 40, 920, 50);
    const sub = text("Sub", 40, 106, 920, 24); // 16 below the heading
    const cards = [0, 1, 2].map((c) => block(`Card ${c + 1}`, 40 + c * 320, 178, 280, 240)); // 48 below the sub
    const section = makeNode({ id: "spaced", name: "Features", width: 1000, height: 458, fills: [{ type: "SOLID" }], children: [heading, sub, ...cards] });
    onPage(section);
    const before = snapshot([section, heading, sub, ...cards]);

    const dry = await scan("spaced", { mode: "grid" });
    expect(dry.proposals[0]).toMatchObject({ mode: "grid", wrappersCreated: 0,
      layout: "3-column Grid, 4 row(s), spacer row(s) 16px, equal columns, gaps 16/40px" });

    const r = await apply("spaced", { mode: "grid" });

    expect(r.skipped).toEqual([]);
    expect(section.children).toEqual([heading, sub, ...cards]);
    expect(section.gridRowSizes.map((t: any) => t.type)).toEqual(["HUG", "HUG", "FIXED", "HUG"]);
    expect(section.gridItemsPositioning).toBe("MANUAL");
    expectUnmoved(before);
  });

  it("refuses a larger row gap a spacer row cannot reproduce (less than twice the row gap)", async () => {
    const section = makeNode({ id: "tight", name: "Tight", width: 1000, height: 400, children: [
      text("Heading", 40, 40, 920, 50),
      ...[0, 1, 2].map((c) => block(`A${c}`, 40 + c * 320, 110, 280, 100)), // 20 below
      ...[0, 1, 2].map((c) => block(`B${c}`, 40 + c * 320, 240, 280, 100)), // 30 below: 30 < 2 × 20
    ] });
    onPage(section);
    const r = await scan("tight", { mode: "grid" });
    expect(r.proposals.every((p: any) => p.mode !== "grid")).toBe(true);
    expect(r.proposals[0].gridRefusal).toBe("its rows are not evenly spaced (gaps 20, 30px)");
  });

  it("chooses the Grid when it leaves no more layers than Auto Layout", async () => {
    const icons = makeNode({ id: "icons", name: "Icons", width: 400, height: 60, children: [
      block("Logo A", 20, 10, 40, 40), block("Logo B", 72, 10, 40, 40),
    ] });
    onPage(icons);
    const r = await scan("icons", { mode: "grid" });
    expect(r.proposals[0]).toMatchObject({ mode: "grid", gridRefusal: null });
  });

  it("uses Auto Layout for two items at opposite ends of one row", async () => {
    onPage(makeNode({ id: "pair", name: "Row", width: 1000, height: 40, children: [text("Label", 0, 0, 100, 40), text("Value", 800, 0, 200, 40)] }));
    const r = await scan("pair", { mode: "grid" });
    expect(r.proposals[0]).toMatchObject({ mode: "auto_layout", layout: "horizontal, space between",
      gridRefusal: "its items are spaced apart, not laid out in columns — a row" });
  });
});

// ─── Safety: confirmation, rollback, scope ────────────────────────────────

describe("safety", () => {
  beforeEach(() => setup());

  function cardSection() {
    const cards = [0, 1].map((i) =>
      makeNode({ id: `c${i}`, name: `Card ${i + 1}`, x: 20 + i * 220, y: 20, width: 200, height: 120, fills: [{ type: "SOLID" }],
        children: [text("Title", 16, 16, 168, 24), text("Body", 16, 56, 168, 48)] })
    );
    const section = makeNode({ id: "s", name: "Section", width: 460, height: 160, children: cards });
    onPage(section);
    return { section, cards };
  }

  it("a dry run changes nothing", async () => {
    const { section, cards } = cardSection();
    const tree = JSON.stringify([section.children.map((c: any) => c.id), cards.map((c: any) => c.children.map((t: any) => t.name))]);
    await scan("s");
    expect(JSON.stringify([section.children.map((c: any) => c.id), cards.map((c: any) => c.children.map((t: any) => t.name))])).toBe(tree);
    expect(section.layoutMode).toBe("NONE");
    expect(figma.currentPage.children).toEqual([section]);
  });

  it("converts nothing that was not confirmed, and lists it as pending", async () => {
    const { section } = cardSection();
    const r = await api.convertLayoutCommand({ nodeId: "s", confirmedIds: [] });
    expect(r.converted).toEqual([]);
    expect(r.pending.map((p: any) => p.id)).toEqual(["s"]);
    expect(section.layoutMode).toBe("NONE");
  });

  it("converts only a confirmed card inside an unconfirmed section", async () => {
    const { section, cards } = cardSection();
    const r = await api.convertLayoutCommand({ nodeId: "s", confirmedIds: ["c1"] });
    expect(r.converted.map((c: any) => c.id)).toEqual(["c1"]);
    expect(r.pending).toEqual([]);
    expect(cards[1].layoutMode).toBe("VERTICAL");
    expect(cards[0].layoutMode).toBe("NONE");
    expect(section.layoutMode).toBe("NONE");
  });

  it("scans the whole page when nothing is selected", async () => {
    cardSection();
    const r = await api.convertLayoutCommand({ dryRun: true });
    expect(r.scope).toBe("page");
    expect(r.proposals.map((p: any) => p.id)).toEqual(["s"]);
  });

  it("puts the design back when the result drifts: gaps that look even add up to more than half a pixel", async () => {
    const ys = [0, 30.5, 61, 91.5, 121.5, 151.5, 181.5]; // gaps 10.5, 10.5, 10.5, 10, 10, 10
    const rows = ys.map((y, i) => block("ABCDEFG"[i], 0, y, 100, 20));
    onPage(makeNode({ id: "list", name: "List", width: 100, height: 201.5, children: rows }));

    const dry = await scan("list");
    expect(dry.proposals).toHaveLength(1); // every gap is within half a pixel of the others

    const r = await apply("list");

    expect(r.converted).toEqual([]);
    expect(r.skipped[0].reason).toBe(
      '"D" would move or change size, so it was put back exactly as it was'
    );
    const [restored] = figma.currentPage.children;
    // The copy that took its place is a new node, and the reply says which.
    expect(r.skipped[0].newId).toBe(restored.id);
    expect(r.skipped[0].newId).not.toBe(r.skipped[0].id);
    expect(figma.currentPage.children).toHaveLength(1);
    expect(restored.layoutMode).toBe("NONE");
    expect(restored.children.map((c: any) => c.y)).toEqual(ys);
  });

  it("puts the design back when Figma refuses a step midway", async () => {
    const title = text("Title", 24, 24, 252, 30);
    const body = text("Body", 24, 62, 252, 60);
    const button = block("Button", 24, 146, 120, 40);
    const cardNode = makeNode({ id: "card", name: "Card", x: 10, y: 10, width: 300, height: 200, children: [title, body, button] });
    onPage(cardNode);
    const before = box(cardNode);
    figma.createFrame = () => {
      throw new Error("frame limit reached");
    };

    const r = await apply("card");

    expect(r.converted).toEqual([]);
    expect(r.skipped[0].reason).toBe(
      "Figma refused a step (frame limit reached), so it was put back exactly as it was"
    );
    const [restored] = figma.currentPage.children;
    // The copy that took its place is a new node, and the reply says which.
    expect(r.skipped[0].newId).toBe(restored.id);
    expect(r.skipped[0].newId).not.toBe(r.skipped[0].id);
    expect(figma.currentPage.children).toHaveLength(1);
    expect(restored).toMatchObject({ name: "Card", visible: true, layoutMode: "NONE" });
    expect(box(restored)).toEqual(before);
    expect(restored.children.map((c: any) => [c.name, c.x, c.y])).toEqual([["Title", 24, 24], ["Body", 24, 62], ["Button", 24, 146]]);
  });
});

// ─── Tokens ───────────────────────────────────────────────────────────────

describe("spacing tokens", () => {
  const primitive = (id: string, name: string, value: number) => ({
    id, name, resolvedType: "FLOAT" as const, scopes: [], variableCollectionId: "primitives", valuesByMode: { p: value },
  });
  const styles = (id: string, name: string, values: any[]) => ({
    id, name, resolvedType: "FLOAT" as const, scopes: [], variableCollectionId: "styles",
    valuesByMode: { desk: values[0], tab: values[1], mobi: values[2] },
  });
  const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

  beforeEach(() =>
    setup({
      collections: [
        { id: "primitives", name: "primitives", modes: [{ modeId: "p", name: "Mode 1" }], variableIds: ["sp8", "sp16", "sp24"] },
        { id: "styles", name: "styles", modes: [{ modeId: "desk", name: "Desk" }, { modeId: "tab", name: "Tab" }, { modeId: "mobi", name: "Mobi" }], variableIds: ["gap24", "gap12", "lr"] },
      ],
      variables: [
        primitive("sp8", "spacing/8", 8),
        primitive("sp16", "spacing/16", 16),
        primitive("sp24", "spacing/24", 24),
        styles("gap24", "Gap/24", [alias("sp24"), alias("sp24"), alias("sp24")]),
        styles("gap12", "Gap/12", [12, 10, 8]),
        styles("lr", "Pages/Home/basic/Left-Right", [24, 24, 24]),
      ],
    })
  );

  it("binds measured gaps and padding to the file's scale, and reports values with no token", async () => {
    const title = text("Title", 24, 24, 252, 30);
    const body = text("Body", 24, 62, 252, 60);
    const button = block("Button", 24, 146, 120, 40);
    const cardNode = makeNode({ id: "card", name: "Card", width: 300, height: 200, children: [title, body, button] });
    onPage(cardNode);

    const r = await apply("card");

    const column = cardNode.children[0];
    expect(column.boundVariables.itemSpacing).toEqual(alias("sp8"));
    expect(cardNode.boundVariables).toMatchObject({
      itemSpacing: alias("gap24"), paddingTop: alias("gap24"), paddingLeft: alias("gap24"), paddingRight: alias("gap24"),
    });
    expect(cardNode.boundVariables.paddingBottom).toBeUndefined();
    expect(r.tokensMissing).toEqual([{ id: "card", name: "Card", field: "paddingBottom", value: 14 }]);
  });

  it("does not bind a token whose value changes between breakpoints", async () => {
    onPage(makeNode({ id: "pair", name: "Pair", width: 100, height: 72, children: [text("A", 0, 0, 100, 30), text("B", 0, 42, 100, 30)] }));
    const r = await apply("pair");
    const frame = figma.currentPage.children[0];
    expect(frame.boundVariables.itemSpacing).toBeUndefined();
    expect(r.tokensMissing).toEqual([{ id: "pair", name: "Pair", field: "itemSpacing", value: 12 }]);
  });
});

// ─── Harness fidelity ─────────────────────────────────────────────────────

describe("layout engine fidelity (behaviour confirmed live in Figma)", () => {
  beforeEach(() => setup());

  it("refuses absolute positioning outside Auto Layout", () => {
    const child = block("A", 0, 0, 10, 10);
    onPage(makeNode({ name: "Free", children: [child] }));
    expect(() => { child.layoutPositioning = "ABSOLUTE"; }).toThrow(/auto-layout/);
  });

  it("deletes a group when its last child leaves", () => {
    const a = block("A", 0, 0, 10, 10);
    const g = group("G", [a]);
    const frame = makeNode({ name: "Host", children: [g] });
    onPage(frame);
    frame.appendChild(a);
    expect(g.removed).toBe(true);
  });

  it("creates frames white and clipped on the page, and duplicates to the page", () => {
    const frame = figma.createFrame();
    expect(frame.fills[0].type).toBe("SOLID");
    expect(frame.clipsContent).toBe(true);
    const host = makeNode({ name: "Host", children: [block("A", 0, 0, 10, 10)] });
    onPage(host);
    const copy = host.children[0].clone();
    expect(copy.parent).toBe(figma.currentPage);
  });

  it("re-stacks children immediately when a frame gets Auto Layout", () => {
    const a = block("A", 20, 30, 100, 40);
    const b = block("B", 20, 90, 60, 20);
    const frame = makeNode({ name: "F", width: 400, height: 300, children: [a, b] });
    onPage(frame);
    frame.layoutMode = "VERTICAL";
    expect(box(frame)).toEqual({ x: 0, y: 0, width: 400, height: 60 });
    expect(box(b)).toEqual({ x: 0, y: 40, width: 60, height: 20 });
  });
});

// ─── Rebuilding layouts that already use Auto Layout ──────────────────────

/**
 * The real "# Work Process" tree (probed read-only earlier, see
 * grid-conversion.test.ts): a padded section holding a heading and a row of
 * four Card instances, each card inside two transparent Auto Layout frames.
 * Gap and padding are bound to the file's variables.
 */
describe("Auto Layout already in place: structural wrappers are removed", () => {
  const variable = (id: string, name: string, value: number) => ({
    id, name, resolvedType: "FLOAT" as const, scopes: ["GAP"], variableCollectionId: "c", valuesByMode: { m: value },
  });
  const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

  beforeEach(() =>
    setup({
      collections: [{ id: "c", name: "Spacing", modes: [{ modeId: "m", name: "Desk" }], variableIds: ["v:gap", "v:col", "v:lr", "v:tb"] }],
      variables: [variable("v:gap", "Row Gap", 40), variable("v:col", "Column Gap", 16), variable("v:lr", "Left-Right", 100), variable("v:tb", "Top-Bottom", 120)],
    })
  );

  function workProcess() {
    const cards = [1, 2, 3, 4].map((n) =>
      makeNode({
        id: `card${n}`, name: "Card", type: "INSTANCE", layoutMode: "VERTICAL", width: 298, height: 380,
        layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", fills: [{ type: "SOLID" }],
        children: [makeNode({ name: "BG", type: "RECTANGLE", layoutPositioning: "ABSOLUTE", width: 298, height: 1 })],
      })
    );
    const wrapped = cards.map((c, i) => {
      const inner = makeNode({ id: `inner${i}`, name: `Frame 214723918${i}`, layoutMode: "HORIZONTAL", width: 298, height: 380,
        layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", children: [c] });
      return makeNode({ id: `outer${i}`, name: `Frame 214723919${i}`, layoutMode: "HORIZONTAL", width: 298, height: 380,
        layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", children: [inner] });
    });
    const heading = makeNode({
      id: "heading", name: "Text_Container", type: "INSTANCE", layoutMode: "VERTICAL", width: 773, height: 100,
      layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG", children: [text("Title", 0, 0, 773, 100)],
    });
    const row = makeNode({
      id: "row", name: "Container", layoutMode: "HORIZONTAL", width: 1240, height: 380, itemSpacing: 16,
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", boundVariables: { itemSpacing: alias("v:col") }, children: wrapped,
    });
    const section = makeNode({
      id: "wp", name: "# Work Process", layoutMode: "VERTICAL", width: 1440, height: 780, itemSpacing: 40,
      paddingTop: 120, paddingRight: 100, paddingBottom: 120, paddingLeft: 100, counterAxisAlignItems: "CENTER",
      layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", fills: [{ type: "SOLID" }],
      boundVariables: { itemSpacing: alias("v:gap"), paddingLeft: alias("v:lr"), paddingRight: alias("v:lr"), paddingTop: alias("v:tb"), paddingBottom: alias("v:tb") },
      children: [heading, row],
    });
    onPage(section);
    return { section, heading, row, cards, wrapped };
  }

  it("proposes rebuilding the section with the eight card wrappers removed", async () => {
    const { section, row } = workProcess();

    const r = await scan("wp");

    expect(r.blocked).toEqual([]);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ id: "wp", rebuild: true, layout: "vertical, gap 40px", padding: [120, 100, 120, 100], wrappersCreated: 0, layerChange: -8 });
    expect(r.proposals[0].flattened).toHaveLength(8);
    expect(row.children).toHaveLength(4); // nothing modified
    expect(section.children).toHaveLength(2);
  });

  it("Auto Layout: heading and one row holding the cards directly, tokens and Fill kept, nothing moved", async () => {
    const { section, heading, row, cards, wrapped } = workProcess();
    const before = snapshot([section, heading, row, ...cards]);

    const r = await apply("wp");

    expect(r.skipped).toEqual([]);
    expect(section.children).toEqual([heading, row]);
    expect(row.children).toEqual(cards);
    expect(wrapped.every((w) => w.removed)).toBe(true);
    expect(row).toMatchObject({ layoutMode: "HORIZONTAL", itemSpacing: 16 });
    expect(row.layoutSizingHorizontal).toBe("FILL");
    expect(row.boundVariables.itemSpacing).toEqual(alias("v:col"));
    expect(section.boundVariables).toMatchObject({ itemSpacing: alias("v:gap"), paddingLeft: alias("v:lr"), paddingTop: alias("v:tb") });
    expect(r.tokensMissing).toEqual([]);
    expectUnmoved(before);
    expect(figma.currentPage.children).toEqual([section]);
  });

  it("Grid: the cards sit directly in the section and the row and column gaps keep their variables", async () => {
    const { section, heading, row, cards } = workProcess();
    const before = snapshot([section, heading, ...cards]);

    const r = await apply("wp", { mode: "grid" });

    expect(r.skipped).toEqual([]);
    expect(section.layoutMode).toBe("GRID");
    expect(section.children).toEqual([heading, ...cards]);
    expect(row.removed).toBe(true);
    expect(heading.gridColumnSpan).toBe(4);
    expect(section.boundVariables).toMatchObject({ gridRowGap: alias("v:gap"), gridColumnGap: alias("v:col"), paddingLeft: alias("v:lr") });
    expect(r.tokensMissing).toEqual([]);
    expectUnmoved(before);
  });

  it("does not propose an Auto Layout frame with nothing to remove, and does not list it as blocked", async () => {
    const title = text("Title", 0, 0, 252, 30, { layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
    const body = text("Body", 0, 38, 252, 60, { layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
    const clean = makeNode({ id: "clean", name: "Card", layoutMode: "VERTICAL", itemSpacing: 8, width: 252, height: 98,
      layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG", children: [title, body] });
    onPage(clean);

    const r = await scan("clean");

    expect(r.proposals).toEqual([]);
    expect(r.blocked).toEqual([]);
  });

  /** Heading and paragraph each in their own Auto Layout frame (the pattern the spec forbids). */
  function doubleWrappedCard(extra: any = {}) {
    const heading = text("Heading", 0, 0, 252, 30, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" });
    const paragraph = text("Paragraph", 0, 0, 252, 60, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" });
    const wrap = (id: string, child: any, h: number, more: any = {}) =>
      makeNode({ id, name: `Frame ${id}`, layoutMode: "VERTICAL", width: 252, height: h,
        layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", children: [child], ...more });
    const headingWrap = wrap("hw", heading, 30, extra.headingWrap);
    const paragraphWrap = wrap("pw", paragraph, 60);
    const button = block("Button", 0, 0, 120, 40, { layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" });
    const cardNode = makeNode({
      id: "card", name: "Card", layoutMode: "VERTICAL", itemSpacing: 16, paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
      width: 300, height: 226, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", fills: [{ type: "SOLID" }],
      children: [headingWrap, paragraphWrap, button],
    });
    onPage(cardNode);
    return { cardNode, heading, paragraph, button, headingWrap, paragraphWrap };
  }

  it("removes one-layer Auto Layout wrappers: heading, paragraph and button sit in the card, text keeps Fill", async () => {
    const c = doubleWrappedCard();
    const before = snapshot([c.cardNode, c.heading, c.paragraph, c.button]);

    const r = await apply("card");

    expect(r.skipped).toEqual([]);
    expect(c.cardNode.children).toEqual([c.heading, c.paragraph, c.button]);
    expect(c.headingWrap.removed).toBe(true);
    expect(c.paragraphWrap.removed).toBe(true);
    expect(c.heading.layoutSizingHorizontal).toBe("FILL");
    expect(c.paragraph.layoutSizingHorizontal).toBe("FILL");
    expect(c.cardNode).toMatchObject({ itemSpacing: 16, paddingTop: 24 });
    expectUnmoved(before);
  });

  it("removes a clipping wrapper when nothing inside it is cut off", async () => {
    const c = doubleWrappedCard({ headingWrap: { clipsContent: true, cornerRadius: 0 } });
    const r = await apply("card");
    expect(r.skipped).toEqual([]);
    expect(c.headingWrap.removed).toBe(true);
  });

  it("keeps a wrapper that paints something (a fill) as a layer of its own", async () => {
    const c = doubleWrappedCard({ headingWrap: { fills: [{ type: "SOLID" }] } });
    const r = await apply("card");
    expect(r.skipped).toEqual([]);
    expect(c.headingWrap.removed).toBe(false);
    expect(c.paragraphWrap.removed).toBe(true);
    expect(c.cardNode.children).toEqual([c.headingWrap, c.paragraph, c.button]);
  });

  it("keeps a wrapper whose width is bound to a variable", async () => {
    const c = doubleWrappedCard({ headingWrap: { boundVariables: { width: alias("v:lr") } } });
    const r = await scan("card");
    expect(r.proposals[0].flattened).toEqual(["Frame pw"]);
  });

  it("refuses to rebuild a frame whose first layer paints on top", async () => {
    const c = doubleWrappedCard();
    c.cardNode.itemReverseZIndex = true;
    const r = await scan("card");
    expect(r.proposals).toEqual([]);
    expect(r.blocked[0].reason).toMatch(/first layer on top/);
  });
});
