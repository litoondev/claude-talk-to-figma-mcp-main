/**
 * Grid conversion: a heading + one row of equal items, buried in wrappers,
 * becomes a Grid holding the items directly — only when the user confirmed the
 * section, and only when the result renders where the old layout did.
 *
 * The fixture mirrors the real "# Work Process" section: padding 120/100,
 * section gap bound to a variable, a 1240px row of four 298px cards with a 16px
 * gap, each card inside two transparent Auto Layout frames, each card instance
 * holding an absolutely positioned BG.
 */
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;

const variable = (id: string, name: string, value: number) => ({
  id, name, resolvedType: "FLOAT" as const, scopes: ["GAP"], variableCollectionId: "c:1", valuesByMode: { m: value },
});

beforeEach(() => {
  clearNodes();
  ({ api } = loadPlugin({ variables: [variable("v:gap", "Row Gap", 40), variable("v:col", "Column Gap", 16)] }));
});

const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

function card(n: number, spec: any = {}) {
  return makeNode({
    id: `card${n}`, name: "Card", type: "INSTANCE", layoutMode: "VERTICAL", width: 298, height: 380,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", fills: [{ type: "SOLID" }],
    children: [makeNode({ name: "BG", type: "RECTANGLE", layoutPositioning: "ABSOLUTE", width: 310, height: 1 })],
    ...spec,
  });
}

function wrapped(item: any, n: number) {
  const inner = makeNode({
    id: `inner${n}`, name: `Frame 214723918${n}`, layoutMode: "HORIZONTAL", width: item.width, height: item.height,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", children: [item],
  });
  return makeNode({
    id: `outer${n}`, name: `Frame 214723919${n}`, layoutMode: "HORIZONTAL", width: item.width, height: item.height,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", children: [inner],
  });
}

function workProcess(overrides: { section?: any; row?: any; cards?: any[] } = {}) {
  const cards = overrides.cards ?? [1, 2, 3, 4].map((n) => card(n));
  const heading = makeNode({
    id: "heading", name: "Text_Container", type: "INSTANCE", layoutMode: "VERTICAL", width: 773, height: 100,
    layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG",
  });
  const row = makeNode({
    id: "row", name: "Container", layoutMode: "HORIZONTAL", width: 1240, height: 380, itemSpacing: 16,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", boundVariables: { itemSpacing: alias("v:col") },
    children: cards.map((c, i) => wrapped(c, i + 1)),
    ...overrides.row,
  });
  const section = makeNode({
    id: "wp", name: "# Work Process", layoutMode: "VERTICAL", width: 1440, height: 780, itemSpacing: 40,
    paddingTop: 120, paddingRight: 100, paddingBottom: 120, paddingLeft: 100, counterAxisAlignItems: "CENTER",
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", fills: [{ type: "SOLID" }],
    boundVariables: { itemSpacing: alias("v:gap"), paddingLeft: alias("v:lr"), paddingRight: alias("v:lr") },
    children: [heading, row],
    ...overrides.section,
  });
  registerNodes(section);
  return { section, heading, row, cards };
}

const scan = (extra: any = {}) => api.cleanLayersCommand({ nodeId: "wp", dryRun: true, rename: false, ...extra });
const apply = (extra: any = {}) => api.cleanLayersCommand({ nodeId: "wp", rename: false, ...extra });

describe("proposal", () => {
  it("a scan proposes the section as a 4-column Grid and changes nothing", async () => {
    const { section, row } = workProcess();

    const r = await scan();

    expect(r.gridCandidates).toEqual([
      {
        id: "wp",
        name: "# Work Process",
        columns: 4,
        headers: ["Text_Container"],
        items: ["Card", "Card", "Card", "Card"],
        itemName: "Card",
        removes: [
          "Container",
          "Frame 2147239191", "Frame 2147239181", "Frame 2147239192", "Frame 2147239182",
          "Frame 2147239193", "Frame 2147239183", "Frame 2147239194", "Frame 2147239184",
        ],
      },
    ]);
    expect(section.layoutMode).toBe("VERTICAL");
    expect(row.removed).toBe(false);
  });

  it("applying without confirmation only lists the proposal", async () => {
    const { section } = workProcess();

    const r = await apply();

    expect(section.layoutMode).toBe("VERTICAL");
    expect(r.gridCandidates.map((p: any) => p.id)).toEqual(["wp"]);
    expect(r.gridConverted).toEqual([]);
  });

  it("a generated responsive frame is never converted — nobody was asked", () => {
    const { section } = workProcess();
    const report = { renamed: [], removed: [], collapsed: [], warnings: [] as string[] };

    api.cleanLayers(section, { rename: false }, report);

    expect(section.layoutMode).toBe("VERTICAL");
  });
});

describe("confirmed conversion", () => {
  it("leaves # Work Process > Text_Container + 4 Cards as a Grid, heading spanning all columns", async () => {
    const { section, heading, row, cards } = workProcess();

    const r = await apply({ confirmedGridIds: ["wp"] });

    expect(section.layoutMode).toBe("GRID");
    expect(section.children.map((c: any) => c.id)).toEqual(["heading", "card1", "card2", "card3", "card4"]);
    expect(row.removed).toBe(true);
    expect(section.gridColumnCount).toBe(4);
    expect(section.gridColumnSizes.every((t: any) => t.type === "FLEX" && t.value === 1)).toBe(true);
    expect(section.gridAutoTracks).toBe("ROWS");
    expect(section.gridItemsPositioning).toBe("ROW_AUTO_FLOW");
    expect(heading.gridColumnSpan).toBe(4);
    expect(heading.gridChildHorizontalAlign).toBe("CENTER");
    expect(cards.every((c) => c.layoutSizingHorizontal === "FILL" && c.layoutSizingVertical === "FIXED")).toBe(true);
    expect(r.gridConverted).toEqual([expect.objectContaining({ id: "wp", columns: 4, removes: ["Container"] })]);
  });

  it("keeps gaps, their variables, padding and the section's sizing", async () => {
    const { section } = workProcess();

    await apply({ confirmedGridIds: ["wp"] });

    expect([section.gridRowGap, section.gridColumnGap]).toEqual([40, 16]);
    expect(section.boundVariables.gridRowGap).toEqual(alias("v:gap"));
    expect(section.boundVariables.gridColumnGap).toEqual(alias("v:col"));
    expect([section.paddingTop, section.paddingRight, section.paddingBottom, section.paddingLeft]).toEqual([120, 100, 120, 100]);
    expect([section.layoutSizingHorizontal, section.layoutSizingVertical]).toEqual(["FIXED", "HUG"]);
  });
});

describe("undone when the Grid would not match", () => {
  function expectRestored(section: any, row: any, cards: any[]) {
    expect(section.layoutMode).toBe("VERTICAL");
    expect(section.children.map((c: any) => c.id)).toEqual(["heading", "row"]);
    expect(row.removed).toBe(false);
    expect(row.layoutPositioning).toBe("AUTO");
    expect(row.children.map((c: any) => c.id)).toEqual(["card1", "card2", "card3", "card4"]);
    expect(cards.every((c) => c.layoutSizingHorizontal === "FILL")).toBe(true);
    expect(section.boundVariables.itemSpacing).toEqual(alias("v:gap"));
  }

  it("when a card would move", async () => {
    const cards = [1, 2, 3, 4].map((n) =>
      card(n, {
        absoluteBoundingBox: (node: any) => ({
          x: (n - 1) * 314 + (node.parent?.layoutMode === "GRID" ? 6 : 0), y: 220, width: 298, height: 380,
        }),
      })
    );
    const { section, row } = workProcess({ cards });

    const r = await apply({ confirmedGridIds: ["wp"] });

    expect(r.gridSkipped).toEqual([
      { id: "wp", name: "# Work Process", reason: '"Card" would move or resize as a Grid, so the section was left as it was' },
    ]);
    expectRestored(section, row, cards);
  });

  it("when Figma refuses a step", async () => {
    const { section, row, cards } = workProcess();
    Object.defineProperty(section, "gridColumnGap", {
      configurable: true,
      get: () => 0,
      set: () => { throw new Error("gridColumnGap is not supported"); },
    });

    const r = await apply({ confirmedGridIds: ["wp"] });

    expect(r.gridSkipped[0].reason).toBe(
      "Figma refused a step (gridColumnGap is not supported), so the section was left as it was"
    );
    expectRestored(section, row, cards);
  });

  it("reports a confirmed ID that is not a candidate", async () => {
    workProcess();

    const r = await apply({ confirmedGridIds: ["1:999"] });

    expect(r.gridSkipped).toEqual([
      { id: "1:999", name: "1:999", reason: "not found in the selection as a heading + equal-row section" },
    ]);
  });
});

describe("not proposed", () => {
  it.each([
    ["the row has padding", { row: { paddingLeft: 8 } }],
    ["the row paints a background", { row: { fills: [{ type: "SOLID" }] } }],
    ["the row wraps", { row: { layoutWrap: "WRAP" } }],
    ["the row spaces items apart", { row: { primaryAxisAlignItems: "SPACE_BETWEEN" } }],
    ["the row is narrower than the section's content", { row: { width: 1200 } }],
    ["the section's width hugs its content", { section: { layoutSizingHorizontal: "HUG" } }],
  ])("when %s", async (_label, overrides) => {
    workProcess(overrides as any);
    expect((await scan()).gridCandidates).toEqual([]);
  });

  it("when the items differ in width", async () => {
    workProcess({ cards: [card(1), card(2), card(3), card(4, { width: 320 })] });
    expect((await scan()).gridCandidates).toEqual([]);
  });

  it("when an item is hidden", async () => {
    workProcess({ cards: [card(1), card(2), card(3), card(4, { visible: false })] });
    expect((await scan()).gridCandidates).toEqual([]);
  });

  it("inside a main component", async () => {
    const { section } = workProcess();
    const component = makeNode({ id: "comp", name: "Section", type: "COMPONENT", children: [section] });
    registerNodes(component);
    expect((await scan()).gridCandidates).toEqual([]);
  });

  it("with more than one heading — Figma may place them side by side and refuse the span", async () => {
    const { section } = workProcess();
    section.insertChild(0, makeNode({ name: "Eyebrow", type: "TEXT", width: 120, height: 20 }));
    expect((await scan()).gridCandidates).toEqual([]);
  });
});

describe("test harness fidelity", () => {
  // Found on a real file: the heading's span was set after the cards were placed beside it.
  it("refuses a column span over a child already placed beside it, as Figma does", () => {
    const heading = makeNode({ name: "Heading" });
    const cardNode = makeNode({ name: "Card" });
    const grid = makeNode({ layoutMode: "GRID", children: [heading, cardNode] });
    grid.gridColumnCount = 4;

    expect(() => { heading.gridColumnSpan = 4; }).toThrow("existing children in adjacent columns");

    cardNode.remove();
    heading.gridColumnSpan = 4;
    expect(heading.gridColumnSpan).toBe(4);
  });
});
