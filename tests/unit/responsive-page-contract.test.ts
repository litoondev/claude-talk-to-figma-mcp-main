/**
 * ADAPTA master responsive spec v1.3: legacy token resolution (§2), over-wide
 * tracks (§8) and the page structure contract (§1.2, §5.1, §6, §7, §9.1).
 */
import { loadPlugin, makeNode } from "../fixtures/figma-plugin-harness";
import { casewayFile } from "../fixtures/caseway-tokens";

const box = (x: number, y: number, width: number, height: number) => () => ({ x, y, width, height });

describe("legacy Pages/ token resolution", () => {
  const styles = {
    id: "c:styles",
    name: "styles",
    modes: [
      { modeId: "m:desk", name: "Desk (1440 px)" },
      { modeId: "m:tab", name: "Tab (768 px)" },
      { modeId: "m:mobi", name: "Mobi (320 px)" },
    ],
    variableIds: [] as string[],
  };
  const float = (id: string, name: string, values: number[]) => ({
    id,
    name,
    resolvedType: "FLOAT" as const,
    scopes: ["GAP"],
    variableCollectionId: styles.id,
    valuesByMode: { "m:desk": values[0], "m:tab": values[1], "m:mobi": values[2] },
  });
  const variables = [
    float("v:lr", "Pages/Home/basic/Left-Right", [100, 40, 20]),
    float("v:tb", "Pages/Home/basic/Top-Buttom", [120, 60, 40]),
    float("v:row", "Pages/Home/basic/Row gap", [60, 40, 30]),
    float("v:col", "Pages/Home/basic/Column gap", [60, 40, 30]),
  ];
  styles.variableIds = variables.map((v) => v.id);

  it("binds the legacy names, typos included, when the file has no Layout/ tokens", async () => {
    const api = loadPlugin({ collections: [styles], variables }).api;
    const frame = makeNode({ name: "Hero", layoutMode: "VERTICAL" });

    const result = await api.bindVariablesToSubtree(frame);

    expect(result.tokenGeneration).toBe("Pages");
    expect(frame.boundVariables.paddingLeft.id).toBe("v:lr");
    expect(frame.boundVariables.paddingRight.id).toBe("v:lr");
    expect(frame.boundVariables.paddingTop.id).toBe("v:tb");
    expect(frame.boundVariables.paddingBottom.id).toBe("v:tb");
    expect(result.collections.map((c: any) => c.name)).toContain("styles");
  });

  it("prefers the Layout/ generation and binds vertical padding to section-gap", async () => {
    const api = loadPlugin(casewayFile()).api;
    const frame = makeNode({ name: "Default Content", layoutMode: "VERTICAL" });

    const result = await api.bindVariablesToSubtree(frame);
    const nameOf = (field: string) =>
      result.bindings.find((b: any) => b.field === field)?.variable;

    expect(result.tokenGeneration).toBe("Layout");
    expect(nameOf("paddingLeft")).toBe("Layout/Default/container-padding");
    expect(nameOf("paddingTop")).toBe("Layout/Default/section-gap");
  });
});

describe("over-wide-by-design tracks", () => {
  const api = loadPlugin(casewayFile()).api;

  it("reports a clipped marquee track as verified overflow, not an error", () => {
    const items = [0, 1, 2, 3].map((i) =>
      makeNode({ name: `Logo ${i}`, width: 732, height: 56, absoluteBoundingBox: box(-1304 + i * 732, 0, 732, 56) })
    );
    const track = makeNode({
      name: "Track",
      width: 2928,
      height: 56,
      x: -1304,
      children: items,
      absoluteBoundingBox: box(-1304, 0, 2928, 56),
    });
    const marquee = makeNode({ name: "Marquee", width: 320, height: 56, clipsContent: true, children: [track] });
    const root = makeNode({ name: "Mobile", width: 320, children: [marquee], absoluteBoundingBox: box(0, 0, 320, 56) });
    for (const n of [track, marquee]) for (const c of n.children) c.parent = n;
    marquee.parent = root;

    const v = api.validateResponsive(root, 320, "Mobile");

    expect(v.passed).toBe(true);
    expect(v.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeId: track.id, type: "intentional-overflow", severity: "info" })])
    );
    expect(v.issues.some((i: any) => i.type === "horizontal-overflow" || i.type === "off-canvas")).toBe(false);
  });

  it("still fails a wide row whose parent does not clip", () => {
    const row = makeNode({ name: "Row", width: 900, x: -10, absoluteBoundingBox: box(-10, 0, 900, 50) });
    const root = makeNode({ name: "Mobile", width: 320, children: [row], absoluteBoundingBox: box(0, 0, 320, 50) });
    row.parent = root;

    expect(api.isOverWideByDesign(row)).toBe(false);
    expect(api.validateResponsive(root, 320, "Mobile").passed).toBe(false);
  });
});

describe("page structure contract", () => {
  const api = loadPlugin(casewayFile()).api;

  const section = (name: string, y: number, height: number, extra: any = {}) =>
    makeNode({ name, y, height, width: 320, ...extra });

  const page = (name: string, width: number, height: number, sections: any[]) => {
    const container = makeNode({ name: "Container", width, height: 0, children: sections });
    const last = sections.filter((s) => s.visible !== false).pop();
    container.height = last ? last.y + last.height : 0;
    return makeNode({ name, width, height, children: [container] });
  };

  it("ignores hidden sections at stale positions and flags the 17826px template height", () => {
    const mobile = page("Page_Home--320px", 320, 17826, [
      section("Header_Mst", 0, 886),
      section("# Highlights/Mobi", 886, 1074, { visible: false }),
      section("# 123 Section/Mobi", 886, 3094),
      section("Footer", 3980, 5203),
    ]);

    const r = api.auditPageStructure(mobile);

    expect(r.breakpoint).toBe("mobile");
    expect(r.visibleCount).toBe(3);
    expect(r.hidden).toEqual(["# Highlights/Mobi"]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toContain("17826px (known template default)");
    expect(r.issues[0]).toContain("Trailing empty space: 8643px");
  });

  it("reports real overlaps, suffix contradictions, components and sub-pixel widths", () => {
    const tablet = page("Home - 768px", 768.18896484375, 3000, [
      section("Header", 0, 900, { width: 768.18896484375 }),
      section("# Our Doctors/Desk", 850, 1000, { width: 768, type: "COMPONENT" }),
    ]);
    tablet.height = 1850;

    const r = api.auditPageStructure(tablet);

    expect(r.breakpoint).toBe("tablet");
    expect(r.issues).toEqual(['"# Our Doctors/Desk" overlaps "Header" by 50px.']);
    expect(r.suffixMismatches).toEqual(["# Our Doctors/Desk"]);
    expect(r.components).toEqual(["# Our Doctors/Desk"]);
    expect(r.subPixel).toHaveLength(2);
  });

  it("compares visible, hidden and absent sections against the sibling breakpoint by width", () => {
    const tablet = page("Page_Home - 768px", 768, 400, [
      section("Header/Tab", 0, 100),
      section("Brand Logos/Tab", 100, 50, { visible: false }),
      section("InstaSlider", 100, 100),
      section("InstaSlider", 200, 100),
      section("Footer", 300, 100),
    ]);
    const mobile = page("Page_Home - 320px", 320, 300, [
      section("Header/Mobi", 0, 100),
      section("InstaSlider/Mobi", 100, 100),
      section("Footer", 200, 100),
    ]);
    const board = makeNode({ name: "Board", width: 5000, children: [tablet, mobile] });
    tablet.parent = board;
    mobile.parent = board;

    const [parity] = api.auditPageStructure(tablet).parity;

    expect(parity.breakpoint).toBe("mobile");
    expect(parity.onlyHere).toEqual(["InstaSlider"]);
    expect(parity.onlyThere).toEqual([]);
    expect(parity.hiddenHereAbsentThere).toEqual(["Brand Logos"]);
  });

  it("skips frames that are not a breakpoint width", () => {
    expect(api.auditPageStructure(makeNode({ name: "Card", width: 500 }))).toBeNull();
  });
});
