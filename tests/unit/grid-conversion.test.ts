/**
 * clean_layers' Grid proposals use the same planner as convert_layout mode
 * "grid": a section is proposed when a Grid holds its layers with fewer frames,
 * converts only when the user confirmed its ID, and is put back if anything moved.
 *
 * The fixture mirrors the real "# Work Process" section: padding 120/100,
 * section gap bound to a variable, a 1240px row of four 298px cards with a 16px
 * gap, each card inside two transparent Auto Layout frames, each card instance
 * holding an absolutely positioned BG.
 */
import { loadPlugin, makeNode, placeOnPage, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;

const variable = (id: string, name: string, value: number) => ({
  id, name, resolvedType: "FLOAT" as const, scopes: ["GAP"], variableCollectionId: "c:1", valuesByMode: { m: value },
});

beforeEach(() => {
  clearNodes();
  ({ api } = loadPlugin({
    layoutEngine: true,
    collections: [{ id: "c:1", name: "Spacing", modes: [{ modeId: "m", name: "Desk" }], variableIds: ["v:gap", "v:col", "v:lr"] }],
    variables: [variable("v:gap", "Row Gap", 40), variable("v:col", "Column Gap", 16), variable("v:lr", "Left-Right", 100)],
  }));
});

const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

function card(n: number, spec: any = {}) {
  return makeNode({
    id: `card${n}`, name: "Card", type: "INSTANCE", layoutMode: "VERTICAL", width: 298, height: 380,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", fills: [{ type: "SOLID" }],
    children: [makeNode({ name: "BG", type: "RECTANGLE", layoutPositioning: "ABSOLUTE", width: 298, height: 1 })],
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

function workProcess(overrides: { row?: any } = {}) {
  const cards = [1, 2, 3, 4].map((n) => card(n));
  const heading = makeNode({
    id: "heading", name: "Text_Container", type: "INSTANCE", layoutMode: "VERTICAL", width: 773, height: 100,
    layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG",
    children: [makeNode({ name: "Title", type: "TEXT", width: 773, height: 100 })],
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
  });
  placeOnPage(section);
  registerNodes(section);
  return { section, heading, row, cards };
}

const scan = (extra: any = {}) => api.cleanLayersCommand({ nodeId: "wp", dryRun: true, rename: false, ...extra });
const apply = (extra: any = {}) => api.cleanLayersCommand({ nodeId: "wp", rename: false, ...extra });

describe("proposal", () => {
  it("a scan proposes the section as a 4-column Grid and changes nothing", async () => {
    const { section, row } = workProcess();

    const r = await scan();

    expect(r.gridCandidates).toHaveLength(1);
    expect(r.gridCandidates[0]).toMatchObject({
      id: "wp", name: "# Work Process", mode: "grid", layout: "4-column Grid, 2 row(s), equal columns, gaps 40/16px",
    });
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

  it("a row that paints a background survives, and is proposed as a Grid of its own", async () => {
    workProcess({ row: { fills: [{ type: "SOLID" }] } });
    expect((await scan()).gridCandidates.map((p: any) => p.id)).toEqual(["row"]);
  });

  it("nothing inside a main component", async () => {
    const { section } = workProcess();
    const component = makeNode({ id: "comp", name: "Section", type: "COMPONENT", children: [section] });
    registerNodes(component);
    expect((await scan()).gridCandidates).toEqual([]);
  });
});

describe("confirmed conversion", () => {
  it("leaves # Work Process > Text_Container + 4 Cards as a Grid, heading spanning all columns", async () => {
    const { section, heading, row, cards } = workProcess();

    const r = await apply({ confirmedGridIds: ["wp"] });

    expect(r.gridSkipped).toEqual([]);
    expect(section.layoutMode).toBe("GRID");
    expect(section.children.map((c: any) => c.id)).toEqual(["heading", "card1", "card2", "card3", "card4"]);
    expect(row.removed).toBe(true);
    expect(section.gridColumnCount).toBe(4);
    expect(heading.gridColumnSpan).toBe(4);
    expect(heading.gridChildHorizontalAlign).toBe("CENTER");
    expect(cards.every((c) => c.layoutSizingHorizontal === "FILL")).toBe(true);
    expect(r.gridConverted.map((c: any) => c.id)).toEqual(["wp"]);
  });

  it("keeps gaps, their variables, padding and the section's sizing", async () => {
    const { section } = workProcess();

    await apply({ confirmedGridIds: ["wp"] });

    expect([section.gridRowGap, section.gridColumnGap]).toEqual([40, 16]);
    expect(section.boundVariables).toMatchObject({ gridRowGap: alias("v:gap"), gridColumnGap: alias("v:col"), paddingLeft: alias("v:lr") });
    expect([section.paddingTop, section.paddingRight, section.paddingBottom, section.paddingLeft]).toEqual([120, 100, 120, 100]);
    expect([section.layoutSizingHorizontal, section.layoutSizingVertical]).toEqual(["FIXED", "HUG"]);
  });

  it("is put back when Figma refuses a step", async () => {
    const { section } = workProcess();
    Object.defineProperty(section, "gridColumnGap", {
      configurable: true,
      get: () => 0,
      set: () => { throw new Error("gridColumnGap is not supported"); },
    });

    const r = await apply({ confirmedGridIds: ["wp"] });

    expect(r.gridSkipped[0]).toMatchObject({
      id: "wp",
      name: "# Work Process",
      reason: "Figma refused a step (gridColumnGap is not supported), so it was put back exactly as it was",
      newId: expect.any(String),
    });
    expect(r.gridConverted).toEqual([]);
    // The rest of the cleanup ran on the copy that took the section's place.
    expect(r.layerCountAfter).toBeGreaterThan(0);
  });

  it("reports a confirmed ID that is not a candidate", async () => {
    workProcess();
    const r = await apply({ confirmedGridIds: ["1:999"] });
    expect(r.gridSkipped).toEqual([
      { id: "1:999", name: "1:999", reason: "not found in scope as a frame or group that can convert" },
    ]);
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
