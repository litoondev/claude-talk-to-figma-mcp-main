/**
 * Executes the plugin's token engine against a slice of the real Caseway
 * Partners variable file, including the acceptance tests the integration spec
 * defines (§22). These run the actual plugin source — not a reimplementation.
 */
import { loadPlugin, makeNode } from "../fixtures/figma-plugin-harness";
import {
  casewayCollections,
  casewayFile,
  DESK,
  TAB,
  MOBI,
  grayFiveHundred,
} from "../fixtures/caseway-tokens";

let api: any;

beforeAll(() => {
  api = loadPlugin(casewayFile()).api;
});

describe("normalizeTokenName", () => {
  it("collapses a token path to a comparable key", () => {
    expect(api.normalizeTokenName("Text size/Body1/font-size")).toBe("text-size-body1-font-size");
    expect(api.normalizeTokenName("colors/Base/Gray Main")).toBe("colors-base-gray-main");
    expect(api.normalizeTokenName("Layout/Full Width/width")).toBe("layout-full-width-width");
  });

  it("is stable across separator and case differences", () => {
    expect(api.normalizeTokenName("Utilities/Check Box/Redius")).toBe(
      api.normalizeTokenName("utilities/check-box/redius")
    );
  });

  it("survives empty and non-string input", () => {
    expect(api.normalizeTokenName("")).toBe("");
    expect(api.normalizeTokenName(undefined)).toBe("");
  });
});

describe("field type and scope mapping", () => {
  it("maps numeric layout fields to FLOAT", () => {
    for (const field of ["itemSpacing", "paddingLeft", "cornerRadius", "maxWidth", "fontSize"]) {
      expect(api.typeForField(field)).toBe("FLOAT");
    }
  });

  it("maps paint pseudo-fields to COLOR", () => {
    expect(api.typeForField("fills/0/color")).toBe("COLOR");
    expect(api.typeForField("strokes/2/color")).toBe("COLOR");
    expect(api.typeForField("effects/0/color")).toBe("COLOR");
  });

  it("maps string fields to STRING", () => {
    expect(api.typeForField("fontFamily")).toBe("STRING");
    expect(api.typeForField("characters")).toBe("STRING");
  });

  it("returns the scopes Figma expects for a field", () => {
    expect(api.scopesForField("itemSpacing")).toEqual(["GAP"]);
    expect(api.scopesForField("cornerRadius")).toEqual(["CORNER_RADIUS"]);
    expect(api.scopesForField("fills/0/color")).toContain("TEXT_FILL");
    expect(api.scopesForField("strokes/0/color")).toEqual(["STROKE_COLOR"]);
  });

  it("returns undefined for a field it does not know", () => {
    expect(api.typeForField("notARealField")).toBeUndefined();
    expect(api.scopesForField("notARealField")).toBeUndefined();
  });
});

describe("isScopeCompatible", () => {
  it("accepts ALL_SCOPES for any field", () => {
    expect(api.isScopeCompatible({ scopes: ["ALL_SCOPES"] }, ["GAP"])).toBe(true);
  });

  it("accepts an unscoped variable", () => {
    expect(api.isScopeCompatible({ scopes: [] }, ["GAP"])).toBe(true);
  });

  it("accepts an overlapping scope", () => {
    expect(api.isScopeCompatible({ scopes: ["WIDTH_HEIGHT", "GAP"] }, ["GAP"])).toBe(true);
  });

  it("rejects a disjoint scope", () => {
    expect(api.isScopeCompatible({ scopes: ["STROKE_FLOAT"] }, ["GAP"])).toBe(false);
  });
});

describe("buildVariableIndex", () => {
  it("indexes every variable in every collection", async () => {
    const index = await api.buildVariableIndex();
    expect(index.all.length).toBe(casewayFile().variables.length);
    expect(Object.keys(index.collectionById)).toHaveLength(2);
    expect(index.collectionById["c:styles"].name).toBe("styles");
  });

  it("indexes by exact, lowercase and normalized name", async () => {
    const index = await api.buildVariableIndex();
    expect(index.byExactName["colors/Base/Primary"]).toHaveLength(1);
    expect(index.byLowerName["colors/base/primary"]).toHaveLength(1);
    expect(index.byNormalizedName["colors-base-primary"]).toHaveLength(1);
  });
});

describe("findCompatibleVariable — strict matching", () => {
  let index: any;
  beforeAll(async () => {
    index = await api.buildVariableIndex();
  });

  it("matches an exact path", () => {
    const r = api.findCompatibleVariable(index, {
      name: "Layout/Default/row-gap",
      resolvedType: "FLOAT",
    });
    expect(r.variable.name).toBe("Layout/Default/row-gap");
    expect(r.matchMethod).toBe("exact");
  });

  it("matches case-insensitively when the exact path misses", () => {
    const r = api.findCompatibleVariable(index, {
      name: "layout/default/row-gap",
      resolvedType: "FLOAT",
    });
    expect(r.variable.name).toBe("Layout/Default/row-gap");
    expect(r.matchMethod).toBe("exact-case-insensitive");
  });

  it("never substitutes a sibling token for another", () => {
    // colors/Primary/500 and colors/Primary/700 have related values. Asking for
    // one must never return the other.
    const five = api.findCompatibleVariable(index, {
      name: "colors/Primary/500",
      resolvedType: "COLOR",
    });
    const seven = api.findCompatibleVariable(index, {
      name: "colors/Primary/700",
      resolvedType: "COLOR",
    });
    expect(five.variable.name).toBe("colors/Primary/500");
    expect(seven.variable.name).toBe("colors/Primary/700");
    expect(five.variable.id).not.toBe(seven.variable.id);
  });

  it("does not fuzzy-match a leaf name shared across path prefixes", () => {
    // "width" alone must not resolve: Layout/Compact, Layout/Default,
    // Layout/Full Width and Utilities/Archive card all define one.
    const r = api.findCompatibleVariable(index, { name: "width", resolvedType: "FLOAT" });
    expect(r.variable).toBeUndefined();
    expect(r.reason).toBe("not-found");
  });

  it("distinguishes tokens that differ only by path prefix", () => {
    const compact = api.findCompatibleVariable(index, {
      name: "Layout/Compact/width",
      resolvedType: "FLOAT",
    });
    const full = api.findCompatibleVariable(index, {
      name: "Layout/Full Width/width",
      resolvedType: "FLOAT",
    });
    expect(compact.variable.name).toBe("Layout/Compact/width");
    expect(full.variable.name).toBe("Layout/Full Width/width");
  });

  it("honours a collection requirement", () => {
    const wrong = api.findCompatibleVariable(index, {
      name: "Layout/Default/row-gap",
      resolvedType: "FLOAT",
      collectionName: "primitives",
    });
    expect(wrong.variable).toBeUndefined();

    const right = api.findCompatibleVariable(index, {
      name: "Layout/Default/row-gap",
      resolvedType: "FLOAT",
      collectionName: "styles",
    });
    expect(right.variable.name).toBe("Layout/Default/row-gap");
  });
});

// ── The integration spec's acceptance tests (§22) ──────────────────────────
describe("spec acceptance tests", () => {
  let index: any;
  beforeAll(async () => {
    index = await api.buildVariableIndex();
  });

  it("Test 1 — exact colour binds the COLOR variable", () => {
    const r = api.findCompatibleVariable(index, {
      name: "colors/Base/Primary",
      resolvedType: "COLOR",
      allowedScopes: ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL"],
    });
    expect(r.variable.name).toBe("colors/Base/Primary");
    expect(r.variable.resolvedType).toBe("COLOR");
  });

  it("Test 2 — a semantic alias binds itself, not its target and not its hex", () => {
    const r = api.findCompatibleVariable(index, {
      name: "colors/Gray/500",
      resolvedType: "COLOR",
    });
    expect(r.variable.id).toBe(grayFiveHundred.id);
    expect(r.variable.name).toBe("colors/Gray/500");
    expect(r.variable.name).not.toBe("colors/Base/Gray Main");

    // And the value is reported as an alias, so nobody is tempted to copy #525252.
    const described = api.describeVariable(index, r.variable);
    expect(described.valuesByMode["Mode 1"]).toEqual({
      alias: true,
      id: expect.any(String),
      name: "colors/Base/Gray Main",
    });
    expect(JSON.stringify(described)).not.toContain("#525252");
  });

  it("Test 3 — responsive typography selects the mode matching the frame", () => {
    const styles = index.collectionById["c:styles"];
    expect(api.modeForWidth(styles, 1440).modeId).toBe(DESK);
    expect(api.modeForWidth(styles, 768).modeId).toBe(TAB);
    expect(api.modeForWidth(styles, 320).modeId).toBe(MOBI);
  });

  it("Test 4 — a missing spacing value reports not-found and offers no substitute", () => {
    // 72px has no token. spacing/64 and spacing/80 exist and must not be returned.
    const r = api.findCompatibleVariable(index, { name: "spacing/72", resolvedType: "FLOAT" });
    expect(r.variable).toBeUndefined();
    expect(r.reason).toBe("not-found");
    expect(JSON.stringify(r)).not.toContain("spacing/80");
    expect(JSON.stringify(r)).not.toContain("spacing/64");
  });

  it("Test 5 — an ambiguous normalized name binds nothing and names the candidates", () => {
    // "Utilities/Check Box/Redius" and "Utilities/Check-Box/Redius" collide.
    const r = api.findCompatibleVariable(index, {
      name: "utilities check box redius",
      resolvedType: "FLOAT",
    });
    expect(r.variable).toBeUndefined();
    expect(r.reason).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });

  it("Test 6 — a COLOR candidate is rejected for itemSpacing", () => {
    const r = api.findCompatibleVariable(index, {
      name: "colors/Base/Primary",
      resolvedType: api.typeForField("itemSpacing"),
      allowedScopes: api.scopesForField("itemSpacing"),
    });
    expect(r.variable).toBeUndefined();
    expect(r.reason).toBe("wrong-type");
  });

  it("reports wrong-scope distinctly from wrong-type", () => {
    // Border/4 is a FLOAT, so the type is right, but it is scoped STROKE_FLOAT.
    const r = api.findCompatibleVariable(index, {
      name: "Border/4",
      resolvedType: "FLOAT",
      allowedScopes: ["GAP"],
    });
    expect(r.variable).toBeUndefined();
    expect(r.reason).toBe("wrong-scope");
  });
});

describe("describeVariable", () => {
  let index: any;
  beforeAll(async () => {
    index = await api.buildVariableIndex();
  });

  it("labels each mode by name and keeps every breakpoint", () => {
    const v = index.byExactName["Layout/Default/container-padding"][0];
    const d = api.describeVariable(index, v);
    expect(d.collectionName).toBe("styles");
    expect(d.scopes).toContain("GAP");
    expect(d.valuesByMode).toEqual({
      "Desk (1440 px)": { value: 100 },
      "Tab (768 px)": { value: 40 },
      "Mobi (320 px)": { value: 20 },
    });
  });

  it("renders a raw colour as hex", () => {
    const v = index.byExactName["colors/Base/Primary"][0];
    const d = api.describeVariable(index, v);
    expect(String(d.valuesByMode["Mode 1"].hex).toLowerCase()).toContain("04724d");
  });

  it("omits values when asked, for a compact listing", () => {
    const v = index.byExactName["colors/Base/Primary"][0];
    const d = api.describeVariable(index, v, { includeValues: false });
    expect(d.valuesByMode).toBeUndefined();
    expect(d.name).toBe("colors/Base/Primary");
  });
});

describe("get_variables filtering", () => {
  it("returns everything under the default limit", async () => {
    const r = await api.getVariables({});
    expect(r.totalVariables).toBe(casewayFile().variables.length);
    expect(r.truncated).toBe(false);
    expect(r.collections.map((c: any) => c.name).sort()).toEqual(["primitives", "styles"]);
  });

  it("filters by substring of the path", async () => {
    const r = await api.getVariables({ nameContains: "container-padding" });
    expect(r.matchedVariables).toBe(1);
    expect(r.variables[0].name).toBe("Layout/Default/container-padding");
  });

  it("filters by type and by collection", async () => {
    const colors = await api.getVariables({ resolvedType: "COLOR" });
    expect(colors.variables.every((v: any) => v.resolvedType === "COLOR")).toBe(true);

    const styled = await api.getVariables({ collectionName: "styles" });
    expect(styled.variables.every((v: any) => v.collectionName === "styles")).toBe(true);
  });

  it("reports truncation rather than silently dropping results", async () => {
    const r = await api.getVariables({ limit: 3 });
    expect(r.returned).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.matchedVariables).toBeGreaterThan(3);
  });
});

describe("find_variable command", () => {
  it("derives the required type and scope from the field", async () => {
    const ok = await api.findVariable({ name: "Layout/Default/row-gap", field: "itemSpacing" });
    expect(ok.found).toBe(true);
    expect(ok.variable.name).toBe("Layout/Default/row-gap");

    const bad = await api.findVariable({ name: "colors/Base/Primary", field: "itemSpacing" });
    expect(bad.found).toBe(false);
    expect(bad.reason).toBe("wrong-type");
  });

  it("refuses without a name", async () => {
    await expect(api.findVariable({})).rejects.toThrow(/Missing name/);
  });
});

describe("modeForWidth", () => {
  let styles: any;
  beforeAll(async () => {
    styles = (await api.buildVariableIndex()).collectionById["c:styles"];
  });

  it("puts the boundaries between the reference widths, not on them", () => {
    expect(api.modeForWidth(styles, 1024).name).toBe("Desk (1440 px)");
    expect(api.modeForWidth(styles, 1023).name).toBe("Tab (768 px)");
    expect(api.modeForWidth(styles, 600).name).toBe("Tab (768 px)");
    expect(api.modeForWidth(styles, 599).name).toBe("Mobi (320 px)");
    expect(api.modeForWidth(styles, 375).name).toBe("Mobi (320 px)");
    expect(api.modeForWidth(styles, 390).name).toBe("Mobi (320 px)");
  });

  it("honours configured thresholds", () => {
    expect(api.modeForWidth(styles, 800, { desktopMin: 700 }).name).toBe("Desk (1440 px)");
  });

  it("returns null when no mode matches the breakpoint names", () => {
    const odd = { modes: [{ modeId: "x", name: "Print" }] };
    expect(api.modeForWidth(odd, 1440)).toBeNull();
  });
});

describe("applyBreakpointVariableModes", () => {
  it("replaces an inherited desktop mode with the tablet mode", async () => {
    const frame = makeNode({
      name: "Page / Tablet / 768",
      layoutMode: "VERTICAL",
      explicitVariableModes: { "c:styles": DESK },
    });

    const result = await api.applyBreakpointVariableModes(frame, 768, casewayCollections);

    expect(frame.explicitVariableModes["c:styles"]).toBe(TAB);
    expect(result.applied).toEqual([
      expect.objectContaining({ collectionName: "styles", modeName: "Tab (768 px)" }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("leaves non-responsive collection modes alone", async () => {
    const frame = makeNode({
      name: "Page / Mobile / 320",
      layoutMode: "VERTICAL",
      explicitVariableModes: { "c:primitives": "m:prim" },
    });

    await api.applyBreakpointVariableModes(frame, 320, casewayCollections);

    expect(frame.explicitVariableModes["c:primitives"]).toBe("m:prim");
    expect(frame.explicitVariableModes["c:styles"]).toBe(MOBI);
  });
});

describe("bindVariablesToSubtree", () => {
  it("fills missing bindings without replacing an inherited source binding", async () => {
    const existingId = grayFiveHundred.id;
    const frame = makeNode({
      name: "Default Content",
      layoutMode: "VERTICAL",
      boundVariables: {
        paddingLeft: { type: "VARIABLE_ALIAS", id: existingId },
      },
    });

    const result = await api.bindVariablesToSubtree(frame);

    expect(frame.boundVariables.paddingLeft.id).toBe(existingId);
    expect(frame.boundVariables.paddingRight.id).toBeDefined();
    expect(result.bindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: frame.id, field: "paddingLeft" }),
      ])
    );
  });
});
