/**
 * set_grid_layout: build a Figma Grid on a frame whose children already exist —
 * placing each child in reading order and spanning it before its neighbours
 * arrive, because Figma refuses a span over a child already placed beside it.
 */
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;
let staging: any[];

beforeEach(() => {
  clearNodes();
  ({ api, figma } = loadPlugin());
  staging = [];
  figma.createFrame = () => {
    const frame = makeNode({ name: "Frame" });
    staging.push(frame);
    return frame;
  };
});

const item = (id: string, spec: any = {}) =>
  makeNode({ id, name: id, layoutMode: "VERTICAL", width: 298, height: 380, layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", ...spec });

function section(children: any[], spec: any = {}) {
  const frame = makeNode({
    id: "s", name: "# Work Process", layoutMode: "VERTICAL", width: 1440, height: 780,
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", children, ...spec,
  });
  registerNodes(frame);
  return frame;
}

describe("building a grid", () => {
  it("puts a heading across 4 columns and the cards in the row below, in reading order", async () => {
    const heading = item("heading", { layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" });
    const cards = [1, 2, 3, 4].map((n) => item(`card${n}`));
    const frame = section([heading, ...cards]);

    const r = await api.setGridLayout({ nodeId: "s", columns: 4, rowGap: 60, columnGap: 16, spans: [{ nodeId: "heading", columnSpan: 4 }] });

    expect(frame.layoutMode).toBe("GRID");
    expect(frame.children.map((c: any) => c.id)).toEqual(["heading", "card1", "card2", "card3", "card4"]);
    expect(heading.gridColumnSpan).toBe(4);
    expect(heading._gridCell).toEqual({ row: 0, column: 0 });
    expect(cards.map((c) => c._gridCell)).toEqual([
      { row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 1, column: 3 },
    ]);
    expect([frame.gridRowGap, frame.gridColumnGap]).toEqual([60, 16]);
    expect(frame.gridColumnSizes.every((t: any) => t.type === "FLEX" && t.value === 1)).toBe(true);
    expect(frame.gridRowSizes.every((t: any) => t.type === "HUG")).toBe(true);
    expect([frame.gridItemsPositioning, frame.gridAutoTracks]).toEqual(["ROW_AUTO_FLOW", "ROWS"]);
    expect(cards.every((c) => c.layoutSizingHorizontal === "FILL")).toBe(true);
    expect(r).toMatchObject({ columns: 4, rows: 2, positioning: "ROW_AUTO_FLOW" });
    expect(staging.every((f) => f.removed)).toBe(true);
  });

  it("moves an item whose span does not fit the rest of the row to the next row", async () => {
    section([item("a"), item("b"), item("c"), item("d")]);

    const r = await api.setGridLayout({ nodeId: "s", columns: 3, spans: [{ nodeId: "c", columnSpan: 2 }] });

    expect(r.rows).toBe(2);
    expect(r.placement).toEqual([
      { id: "a", row: 0, column: 0, columnSpan: 1 },
      { id: "b", row: 0, column: 1, columnSpan: 1 },
      { id: "c", row: 1, column: 0, columnSpan: 2 },
      { id: "d", row: 1, column: 2, columnSpan: 1 },
    ]);
  });

  it("uses HUG columns when the frame's width hugs its content, since FLEX is invalid there", async () => {
    const frame = section([item("a"), item("b")], { layoutSizingHorizontal: "HUG" });

    await api.setGridLayout({ nodeId: "s", columns: 2 });

    expect(frame.gridColumnSizes.map((t: any) => t.type)).toEqual(["HUG", "HUG"]);
  });

  it("leaves absolutely positioned children where they are", async () => {
    const badge = item("badge", { layoutPositioning: "ABSOLUTE" });
    const frame = section([item("a"), badge, item("b")]);

    const r = await api.setGridLayout({ nodeId: "s", columns: 2 });

    expect(badge.parent).toBe(frame);
    expect(badge._gridCell).toBeUndefined();
    expect(r.placement.map((p: any) => p.id)).toEqual(["a", "b"]);
  });
});

describe("refusing and restoring", () => {
  it("refuses FLEX columns on a hugging frame before changing anything", async () => {
    const frame = section([item("a"), item("b")], { layoutSizingHorizontal: "HUG" });

    await expect(api.setGridLayout({ nodeId: "s", columns: 2, columnSizes: [{ type: "FLEX" }, { type: "FLEX" }] }))
      .rejects.toThrow(/FLEX columns are not valid/);
    expect(frame.layoutMode).toBe("VERTICAL");
    expect(staging).toHaveLength(0);
  });

  it("restores the frame when Figma refuses a step, losing nothing", async () => {
    const cards = [item("a"), item("b"), item("c")];
    const frame = section(cards);
    Object.defineProperty(frame, "gridColumnGap", {
      configurable: true,
      get: () => 0,
      set: () => { throw new Error("gridColumnGap is not supported"); },
    });

    await expect(api.setGridLayout({ nodeId: "s", columns: 3, columnGap: 16 }))
      .rejects.toThrow('Could not build the grid on "# Work Process": gridColumnGap is not supported. The frame was restored.');
    expect(frame.layoutMode).toBe("VERTICAL");
    expect(frame.children.map((c: any) => c.id)).toEqual(["a", "b", "c"]);
    expect(cards.every((c) => c.layoutSizingHorizontal === "FILL")).toBe(true);
    expect(staging.every((f) => f.removed)).toBe(true);
  });

  it("rejects a span for a node that is not a child", async () => {
    section([item("a")]);
    await expect(api.setGridLayout({ nodeId: "s", columns: 2, spans: [{ nodeId: "elsewhere", columnSpan: 2 }] }))
      .rejects.toThrow('"elsewhere" is not an in-flow child of "# Work Process"');
  });

  it("rejects a column count below 1", async () => {
    section([item("a")]);
    await expect(api.setGridLayout({ nodeId: "s", columns: 0 })).rejects.toThrow(/columns must be a whole number/);
  });
});
