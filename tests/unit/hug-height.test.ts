/**
 * Exercises the height rules: nothing content-driven may carry a fixed height,
 * and the plugin must not be able to reintroduce one by accident.
 */
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";
import { casewayFile } from "../fixtures/caseway-tokens";

let api: any;

beforeEach(() => {
  clearNodes();
  api = loadPlugin(casewayFile()).api;
});

const report = () => ({
  setToFill: 0,
  setToHug: 0,
  textAutoHeight: 0,
  fixedHeightsReleased: 0,
  fixedWidthsReleased: 0,
  heightConstraintsCleared: 0,
  fixedHeightBlockers: [] as any[],
});

describe("readVerticalSizing", () => {
  it("reads HUG from a vertical stack that sizes to its content", () => {
    const n = makeNode({ layoutMode: "VERTICAL", primaryAxisSizingMode: "AUTO" });
    expect(api.readVerticalSizing(n)).toBe("HUG");
  });

  it("reads FIXED from a vertical stack pinned on its primary axis", () => {
    const n = makeNode({ layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED" });
    expect(api.readVerticalSizing(n)).toBe("FIXED");
  });

  it("reads the counter axis for a horizontal row", () => {
    const hug = makeNode({ layoutMode: "HORIZONTAL", counterAxisSizingMode: "AUTO" });
    const fixed = makeNode({ layoutMode: "HORIZONTAL", counterAxisSizingMode: "FIXED" });
    expect(api.readVerticalSizing(hug)).toBe("HUG");
    expect(api.readVerticalSizing(fixed)).toBe("FIXED");
  });

  it("treats a frame with no auto layout as FIXED — it holds a literal height", () => {
    const n = makeNode({ layoutMode: "NONE", height: 252 });
    expect(api.readVerticalSizing(n)).toBe("FIXED");
  });
});

describe("releaseFixedHeight", () => {
  it("turns a pinned auto layout frame into one that hugs", () => {
    const n = makeNode({ name: "Content", layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED" });
    const r = report();
    expect(api.releaseFixedHeight(n, r)).toBe(true);
    expect(api.readVerticalSizing(n)).toBe("HUG");
    expect(r.fixedHeightsReleased).toBe(1);
  });

  it("leaves an intrinsically sized element alone", () => {
    const icon = makeNode({ name: "icon / chevron", layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED" });
    const avatar = makeNode({ name: "Avatar", layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED" });
    expect(api.releaseFixedHeight(icon, report())).toBe(false);
    expect(api.releaseFixedHeight(avatar, report())).toBe(false);
    expect(api.readVerticalSizing(icon)).toBe("FIXED");
  });

  it("clears a min/max height that would pin a frame reading as Hug", () => {
    const n = makeNode({
      name: "Card",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      minHeight: 380,
      maxHeight: 380,
    });
    const r = report();
    api.releaseFixedHeight(n, r);
    expect(n.minHeight).toBeNull();
    expect(n.maxHeight).toBeNull();
    expect(r.heightConstraintsCleared).toBe(1);
  });

  it("records a non-auto-layout container instead of silently leaving it pinned", () => {
    const wrapper = makeNode({
      name: "Text Wrapper",
      layoutMode: "NONE",
      height: 252,
      children: [makeNode({ type: "TEXT", name: "Body" })],
    });
    const r = report();
    expect(api.releaseFixedHeight(wrapper, r)).toBe(false);
    expect(r.fixedHeightBlockers).toEqual([
      { name: "Text Wrapper", id: wrapper.id, height: 252 },
    ]);
  });

  it("does not record a group — a group has no height of its own", () => {
    const g = makeNode({
      type: "GROUP",
      name: "Group 12",
      layoutMode: "NONE",
      children: [makeNode({ type: "TEXT" })],
    });
    const r = report();
    api.releaseFixedHeight(g, r);
    expect(r.fixedHeightBlockers).toHaveLength(0);
  });

  it("does not record an empty frame", () => {
    const empty = makeNode({ name: "Spacer Frame", layoutMode: "NONE", height: 40 });
    const r = report();
    api.releaseFixedHeight(empty, r);
    expect(r.fixedHeightBlockers).toHaveLength(0);
  });
});

describe("enforceResponsiveSizing", () => {
  it("releases fixed heights throughout a nested tree", () => {
    const text = makeNode({ type: "TEXT", name: "Body", textAutoResize: "NONE" });
    const wrapper = makeNode({
      name: "Text Wrapper",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      children: [text],
    });
    const card = makeNode({
      name: "Card",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      children: [wrapper],
    });
    const root = makeNode({ name: "Section", layoutMode: "VERTICAL", children: [card] });

    const r = report();
    api.enforceResponsiveSizing(root, r);

    expect(api.readVerticalSizing(card)).toBe("HUG");
    expect(api.readVerticalSizing(wrapper)).toBe("HUG");
    expect(r.fixedHeightsReleased).toBe(2);
    expect(r.setToHug).toBe(1); // text is reported separately from containers
  });

  it("converts fixed-height text to auto height", () => {
    const text = makeNode({ type: "TEXT", name: "Heading", textAutoResize: "NONE" });
    const root = makeNode({ layoutMode: "VERTICAL", children: [text] });
    const r = report();
    api.enforceResponsiveSizing(root, r);
    expect(text.textAutoResize).toBe("HEIGHT");
    expect(r.textAutoHeight).toBe(1);
  });

  it("converts truncated text to auto height — truncation is clipping", () => {
    const text = makeNode({ type: "TEXT", name: "Excerpt", textAutoResize: "TRUNCATE" });
    const root = makeNode({ layoutMode: "VERTICAL", children: [text] });
    const r = report();
    api.enforceResponsiveSizing(root, r);
    expect(text.textAutoResize).toBe("HEIGHT");
  });

  it("leaves text that already grows both ways alone", () => {
    const text = makeNode({ type: "TEXT", name: "Label", textAutoResize: "WIDTH_AND_HEIGHT" });
    const root = makeNode({ layoutMode: "VERTICAL", children: [text] });
    const r = report();
    api.enforceResponsiveSizing(root, r);
    expect(text.textAutoResize).toBe("WIDTH_AND_HEIGHT");
    expect(r.textAutoHeight).toBe(0);
  });
});

describe("responsive root sizing", () => {
  it("keeps a horizontal root at fixed viewport width and hug content height", () => {
    const root = makeNode({
      name: "Horizontal Page",
      layoutMode: "HORIZONTAL",
      layoutSizingHorizontal: "HUG",
      layoutSizingVertical: "FIXED",
      minHeight: 900,
    });
    const r = { ...report(), warnings: [] as string[] };

    api.configureResponsiveRootSizing(root, r);

    expect(api.readHorizontalSizing(root)).toBe("FIXED");
    expect(api.readVerticalSizing(root)).toBe("HUG");
    expect(root.minHeight).toBeNull();
    expect(r.warnings).toEqual([]);
  });
});

describe("responsive validation", () => {
  it("flags text whose auto-height setting is still pinned by Auto Layout", () => {
    const text = makeNode({
      type: "TEXT",
      name: "Body Copy",
      textAutoResize: "HEIGHT",
      layoutSizingVertical: "FIXED",
    });
    const root = makeNode({
      name: "Mobile Page",
      layoutMode: "VERTICAL",
      width: 320,
      children: [text],
    });

    const validation = api.validateResponsive(root, 320, "Mobile @ 320px");

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: text.id, type: "text-fixed-height" }),
      ])
    );
  });
});

describe("breakpoint sequencing", () => {
  it("refuses to generate Tablet and Mobile in the same run", async () => {
    const loaded = loadPlugin(casewayFile());
    const source = makeNode({ name: "Desktop", layoutMode: "VERTICAL", width: 1440 });
    (loaded.figma.currentPage as any).selection = [source];

    await expect(
      loaded.api.makeResponsive({ breakpoints: ["tablet", "mobile"] })
    ).rejects.toThrow(/exactly one breakpoint per run/);
  });

  it("analyzes a requested custom width instead of the default preset", async () => {
    const loaded = loadPlugin(casewayFile());
    const source = makeNode({
      name: "Desktop",
      layoutMode: "VERTICAL",
      width: 1440,
      children: [makeNode({ name: "Hero", layoutMode: "HORIZONTAL" })],
    });
    (loaded.figma.currentPage as any).selection = [source];

    const result = await loaded.api.analyzeResponsive({
      breakpoint: "tablet",
      targetWidth: 834,
    });

    expect(result.planWidths).toEqual({ tablet: 834 });
    expect(result.plans.tablet).toBeDefined();
    expect(result.plans.mobile).toBeUndefined();
  });
});

describe("tablet column readability", () => {
  const tabletPreset = { key: "tablet", label: "Tablet", width: 768, sidePadding: 30 };
  const split = (childWidths: number[]) => ({
    kind: "hero",
    fixedWidthChildren: [],
    absoluteChildren: [],
    autoLayout: "HORIZONTAL",
    childCount: 2,
    childWidths,
    itemSpacing: 20,
  });

  it("keeps a balanced split side by side at 768px", () => {
    const behaviors = api.decideBehaviors(split([600, 600]), "tablet", "strict", tabletPreset);
    expect(behaviors).toEqual(expect.arrayContaining(["keep-horizontal", "equalize-split"]));
    expect(behaviors).not.toContain("stack-vertical");
  });

  it("stacks a split whose narrower column would become unreadable", () => {
    const behaviors = api.decideBehaviors(split([900, 300]), "tablet", "strict", tabletPreset);
    expect(behaviors).toEqual(expect.arrayContaining(["stack-vertical", "media-full-width"]));
    expect(behaviors).not.toContain("equalize-split");
  });
});

describe("responsive image preservation", () => {
  it("locks cloned image containers to their desktop aspect ratio", () => {
    const desktopImage = makeNode({
      type: "RECTANGLE",
      name: "Hero Image",
      width: 1200,
      height: 800,
      constrainProportions: false,
      fills: [{ type: "IMAGE", imageHash: "desktop-image", scaleMode: "FILL" }],
    });
    const responsiveImage = makeNode({
      type: "RECTANGLE",
      name: "Hero Image",
      width: 600,
      height: 400,
      constrainProportions: false,
      fills: [{ type: "IMAGE", imageHash: "desktop-image", scaleMode: "FILL" }],
    });
    desktopImage.constrainProportions = false;
    responsiveImage.constrainProportions = false;

    expect(api.preserveImageAspectRatios(desktopImage, responsiveImage)).toBe(1);
    expect(responsiveImage.constrainProportions).toBe(true);
    expect(responsiveImage.fills[0]).toEqual(
      expect.objectContaining({ imageHash: "desktop-image", scaleMode: "FILL" })
    );
    expect(desktopImage.constrainProportions).toBe(false);
  });

  it("matches a reordered responsive image by identity instead of child index", () => {
    const desktopImage = makeNode({ type: "RECTANGLE", name: "Product Image" });
    const desktopText = makeNode({ type: "TEXT", name: "Product Copy" });
    const responsiveImage = makeNode({ type: "RECTANGLE", name: "Product Image" });
    const responsiveText = makeNode({ type: "TEXT", name: "Product Copy" });
    desktopImage.constrainProportions = false;
    responsiveImage.constrainProportions = false;
    responsiveText.constrainProportions = false;

    const desktop = makeNode({ children: [desktopImage, desktopText] });
    const responsive = makeNode({ children: [responsiveText, responsiveImage] });

    expect(api.preserveImageAspectRatios(desktop, responsive)).toBe(1);
    expect(responsiveImage.constrainProportions).toBe(true);
    expect(responsiveText.constrainProportions).toBe(false);
  });
});

describe("responsive frame organization", () => {
  const tabletPreset = { key: "tablet", label: "Tablet", width: 768 };
  const mobilePreset = { key: "mobile", label: "Mobile", width: 320 };

  it("uses clear breakpoint names without carrying the desktop suffix forward", () => {
    expect(api.buildResponsiveName("Single Work Desk", tabletPreset)).toBe(
      "Single Work – 768px Tab"
    );
    expect(api.buildResponsiveName("Single Work / Desktop / 1440", mobilePreset)).toBe(
      "Single Work – 320px Mobile"
    );
  });

  it("uses an exact custom width in the preset and frame name", () => {
    const customTablet = api.resolveResponsivePreset("tablet", 834);
    const customMobile = api.resolveResponsivePreset("mobile", 390);

    expect(customTablet.width).toBe(834);
    expect(customTablet.customWidth).toBe(true);
    expect(customMobile.width).toBe(390);
    expect(api.buildResponsiveName("About / Desktop / 1440", customTablet)).toBe(
      "About – 834px Tab"
    );
    expect(api.buildResponsiveName("About Desk", customMobile)).toBe(
      "About – 390px Mobile"
    );
  });

  it("does not reuse a differently sized frame with the same breakpoint label", () => {
    const desktop = makeNode({ id: "desktop", name: "About Desk", width: 1440 });
    const tablet768 = makeNode({ id: "tablet-768", name: "About – 768px Tab", width: 768 });
    const section = makeNode({ name: "Responsive Frames", children: [desktop, tablet768] });
    const customTablet = api.resolveResponsivePreset("tablet", 834);

    expect(api.findExistingBreakpointFrame(desktop, customTablet, section)).toBeNull();

    const tablet834 = makeNode({ id: "tablet-834", name: "About – 834px Tab", width: 834 });
    section.children.push(tablet834);
    tablet834.parent = section;
    expect(api.findExistingBreakpointFrame(desktop, customTablet, section)).toBe(tablet834);
  });

  it("finds only an existing breakpoint belonging to the same desktop design", () => {
    const desktop = makeNode({ id: "desktop", name: "Single Work Desk", width: 1440 });
    const tablet = makeNode({ id: "tablet", name: "Single Work – 768px Tab", width: 768 });
    const unrelated = makeNode({ id: "other", name: "About – 768px Tab", width: 768 });
    const section = makeNode({ name: "Section 3", children: [desktop, unrelated, tablet] });

    expect(api.findExistingBreakpointFrame(desktop, tabletPreset, section)).toBe(tablet);
    expect(api.findExistingResponsiveFrames(desktop, section).map((f: any) => f.id)).toEqual([
      "tablet",
    ]);
  });

  it("reuses one unambiguous generic breakpoint slot in the same area", () => {
    const desktop = makeNode({ name: "Single Work Desk", width: 1440 });
    const genericSlot = makeNode({ name: "Tab / 768px", width: 768 });
    const section = makeNode({ name: "Section 3", children: [desktop, genericSlot] });

    expect(api.findExistingBreakpointFrame(desktop, tabletPreset, section)).toBe(genericSlot);
  });

  it("orders mobile after tablet and positions it beside that breakpoint", () => {
    const desktop = makeNode({ id: "desktop", name: "Single Work Desk", width: 1440 });
    const mobile = makeNode({ id: "mobile", name: "Single Work – 320px Mobile", width: 320 });
    const tablet = makeNode({ id: "tablet", name: "Single Work – 768px Tab", width: 768 });
    desktop.x = 100;
    desktop.y = 60;
    tablet.x = 1660;
    tablet.y = 60;
    mobile.x = 0;
    mobile.y = 0;

    const section = makeNode({ name: "Section 3", children: [desktop, mobile, tablet] });
    section.insertChild = function (index: number, child: any) {
      const current = this.children.indexOf(child);
      if (current >= 0) {
        this.children.splice(current, 1);
        if (current < index) index--;
      }
      this.children.splice(index, 0, child);
      child.parent = this;
    };

    const r = { warnings: [] as string[] };
    api.placeResponsiveFrame(mobile, desktop, "mobile", section, 120, r);

    expect(section.children.map((child: any) => child.id)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ]);
    expect(mobile.x).toBe(2548);
    expect(mobile.y).toBe(60);
    expect(r.warnings).toEqual([]);
  });

  it("orders mobile after a custom-width tablet", () => {
    const desktop = makeNode({ id: "desktop", name: "About Desk", width: 1440, x: 100 });
    const tablet = makeNode({ id: "tablet", name: "About – 834px Tab", width: 834, x: 1660 });
    const mobile = makeNode({ id: "mobile", name: "About – 390px Mobile", width: 390 });
    const section = makeNode({ children: [desktop, mobile, tablet] });
    const r = { warnings: [] as string[] };

    api.placeResponsiveFrame(mobile, desktop, "mobile", section, 120, r);

    expect(section.children.map((child: any) => child.id)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ]);
    expect(mobile.x).toBe(2614);
  });

  it("refreshes an existing empty breakpoint slot from desktop without changing desktop", async () => {
    const content = makeNode({ name: "Hero Section", layoutMode: "VERTICAL" });
    const desktop = makeNode({
      id: "desktop",
      name: "Single Work Desk",
      width: 1440,
      height: 2400,
      x: 100,
      y: 60,
      layoutMode: "VERTICAL",
      children: [content],
    });
    const placeholder = makeNode({
      id: "tablet-slot",
      name: "Tab / 768px",
      width: 768,
      height: 1200,
    });
    const section = makeNode({ name: "Section 3", children: [desktop, placeholder] });
    registerNodes(section);

    const result = await api.generateBreakpoint(desktop, "tablet", {
      preservation: "strict",
      gutter: 120,
      textStyleIndex: { byId: {}, families: {}, total: 0 },
      cleanLayers: false,
    });

    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.reusedExistingFrame).toBe(true);
    expect(result.replacedEmptyPlaceholder).toBe(true);
    expect(result.frameName).toBe("Single Work – 768px Tab");
    expect(section.children.map((child: any) => child.id)).toEqual(["desktop", result.frameId]);
    expect(desktop.name).toBe("Single Work Desk");
    expect(desktop.width).toBe(1440);
    expect(desktop.height).toBe(2400);
    expect(desktop.children[0]).toBe(content);

    const responsive = section.children[1];
    expect(responsive.width).toBe(768);
    expect(responsive.x).toBe(1660);
    expect(responsive.y).toBe(60);
    expect(responsive.children).toHaveLength(1);
  });

  it("creates the requested custom width without modifying another tablet frame", async () => {
    const loaded = loadPlugin(casewayFile());
    const desktop = makeNode({
      id: "desktop",
      name: "About Desk",
      width: 1440,
      height: 1800,
      layoutMode: "VERTICAL",
      children: [makeNode({ name: "Hero Section", layoutMode: "VERTICAL" })],
    });
    const tablet768 = makeNode({
      id: "tablet-768",
      name: "About – 768px Tab",
      width: 768,
      layoutMode: "VERTICAL",
      children: [makeNode({ name: "Existing Tablet Content" })],
    });
    const section = makeNode({ name: "Responsive Frames", children: [desktop, tablet768] });
    registerNodes(section);
    (loaded.figma.currentPage as any).selection = [desktop];

    const result = await loaded.api.makeResponsive({
      breakpoints: ["tablet"],
      targetWidth: 834,
      cleanLayers: false,
    });

    expect(result.frames[0].width).toBe(834);
    expect(result.frames[0].frameName).toBe("About – 834px Tab");
    expect(result.frames[0].created).toBe(true);
    expect(tablet768.width).toBe(768);
    expect(tablet768.name).toBe("About – 768px Tab");
    expect(desktop.width).toBe(1440);
  });

  it("infers a custom 390px request as Mobile and validates its exact width", async () => {
    const loaded = loadPlugin(casewayFile());
    const desktop = makeNode({
      name: "About Desk",
      width: 1440,
      layoutMode: "VERTICAL",
      children: [makeNode({ name: "Hero Section", layoutMode: "VERTICAL" })],
    });
    const section = makeNode({ name: "Responsive Frames", children: [desktop] });
    registerNodes(section);
    (loaded.figma.currentPage as any).selection = [desktop];

    const result = await loaded.api.makeResponsive({ targetWidth: 390, cleanLayers: false });

    expect(result.frames[0].breakpoint).toBe("Mobile");
    expect(result.frames[0].width).toBe(390);
    expect(result.frames[0].frameName).toBe("About – 390px Mobile");
  });
});

describe("desktop spacing ceiling", () => {
  it("caps responsive gaps and padding at their desktop references", async () => {
    const desktop = makeNode({
      name: "Desktop Section",
      layoutMode: "VERTICAL",
      itemSpacing: 20,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });
    const responsive = makeNode({
      name: "Tablet Section",
      layoutMode: "VERTICAL",
      itemSpacing: 40,
      paddingTop: 24,
      paddingRight: 12,
      paddingBottom: 32,
      paddingLeft: 16,
    });
    const references = api.buildDesktopSpacingReferences(desktop, responsive);
    const r = { spacingIncreasesPrevented: [], desktopSpacingWarnings: [], warnings: [] };

    const result = await api.enforceDesktopSpacingCeiling(references, r);

    expect(responsive.itemSpacing).toBe(20);
    expect(responsive.paddingTop).toBe(16);
    expect(responsive.paddingRight).toBe(12);
    expect(responsive.paddingBottom).toBe(16);
    expect(responsive.paddingLeft).toBe(16);
    expect(result.prevented).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "itemSpacing", desktop: 20, responsiveBefore: 40 }),
        expect.objectContaining({ property: "paddingTop", desktop: 16, responsiveBefore: 24 }),
        expect.objectContaining({ property: "paddingBottom", desktop: 16, responsiveBefore: 32 }),
      ])
    );
    expect(result.warnings).toEqual([]);
  });

  it("keeps equal or smaller responsive spacing unchanged", async () => {
    const desktop = makeNode({
      name: "Desktop",
      layoutMode: "VERTICAL",
      itemSpacing: 20,
      paddingTop: 16,
    });
    const mobile = makeNode({
      name: "Mobile",
      layoutMode: "VERTICAL",
      itemSpacing: 12,
      paddingTop: 16,
    });

    const result = await api.enforceDesktopSpacingCeiling(
      api.buildDesktopSpacingReferences(desktop, mobile),
      { warnings: [] }
    );

    expect(mobile.itemSpacing).toBe(12);
    expect(mobile.paddingTop).toBe(16);
    expect(result.prevented).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("preserves a variable binding by restoring its desktop mode when tablet grows", async () => {
    const fixture = casewayFile();
    const gapVariable = fixture.variables.find(
      (variable) => variable.name === "Layout/Default/row-gap"
    )!;
    const desktop = makeNode({
      name: "Desktop Row",
      layoutMode: "HORIZONTAL",
      itemSpacing: 20,
      resolvedVariableModes: { "c:styles": "m:desk" },
    });
    const tablet = makeNode({
      name: "Tablet Row",
      layoutMode: "HORIZONTAL",
      itemSpacing: 40,
      boundVariables: {
        itemSpacing: { type: "VARIABLE_ALIAS", id: gapVariable.id },
      },
      explicitVariableModes: { "c:styles": "m:tab" },
    });
    tablet.setExplicitVariableModeForCollection = function (_collection: any, modeId: string) {
      this.explicitVariableModes["c:styles"] = modeId;
      this.itemSpacing = modeId === "m:desk" ? 20 : 40;
    };

    const result = await api.enforceDesktopSpacingCeiling(
      api.buildDesktopSpacingReferences(desktop, tablet),
      { warnings: [] }
    );

    expect(tablet.itemSpacing).toBe(20);
    expect(tablet.explicitVariableModes["c:styles"]).toBe("m:desk");
    expect(tablet.boundVariables.itemSpacing.id).toBe(gapVariable.id);
    expect(result.prevented).toEqual([
      expect.objectContaining({
        property: "itemSpacing",
        method: "preserved desktop variable mode",
      }),
    ]);
  });

  it("does not compare or alter protected absolute-positioned spacing", async () => {
    const desktopAbsolute = makeNode({
      name: "Desktop Art",
      layoutPositioning: "ABSOLUTE",
      layoutMode: "VERTICAL",
      itemSpacing: 20,
    });
    const responsiveAbsolute = makeNode({
      name: "Desktop Art",
      layoutPositioning: "ABSOLUTE",
      layoutMode: "VERTICAL",
      itemSpacing: 80,
    });

    const references = api.buildDesktopSpacingReferences(
      desktopAbsolute,
      responsiveAbsolute
    );
    const result = await api.enforceDesktopSpacingCeiling(references, { warnings: [] });

    expect(references.size).toBe(0);
    expect(responsiveAbsolute.itemSpacing).toBe(80);
    expect(result.prevented).toEqual([]);
  });
});

describe("absolute-positioned responsive protection", () => {
  it("detects explicit absolute layers at any depth as protected subtree roots", () => {
    const nested = makeNode({
      id: "absolute",
      name: "Decorative Composition",
      layoutPositioning: "ABSOLUTE",
      children: [makeNode({ id: "inside", name: "Inner Layer" })],
    });
    const section = makeNode({
      name: "Hero Section",
      layoutMode: "VERTICAL",
      children: [makeNode({ name: "Content", children: [nested] })],
    });

    expect(api.collectAbsolutePositionedLayers(section, true).map((n: any) => n.id)).toEqual([
      "absolute",
    ]);
    expect(api.analyzeSection(section, 0, 1).absoluteChildren).toEqual([
      { id: "absolute", name: "Decorative Composition" },
    ]);
  });

  it("excludes the whole absolute subtree from sizing and layer cleanup", () => {
    const text = makeNode({
      id: "absolute-text",
      type: "TEXT",
      name: "Text 8",
      textAutoResize: "NONE",
      layoutSizingVertical: "FIXED",
    });
    const absolute = makeNode({
      id: "absolute",
      name: "Frame 123",
      layoutPositioning: "ABSOLUTE",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      layoutSizingHorizontal: "FIXED",
      children: [text],
    });
    const root = makeNode({
      name: "Tablet",
      layoutMode: "VERTICAL",
      children: [absolute],
    });
    const r = {
      ...report(),
      renamed: [] as string[],
      removed: [] as string[],
      collapsed: [] as string[],
      warnings: [] as string[],
    };

    api.enforceResponsiveSizing(root, r);
    api.cleanLayers(root, {}, r);

    expect(absolute.name).toBe("Frame 123");
    expect(absolute.layoutPositioning).toBe("ABSOLUTE");
    expect(api.readHorizontalSizing(absolute)).toBe("FIXED");
    expect(api.readVerticalSizing(absolute)).toBe("FIXED");
    expect(text.name).toBe("Text 8");
    expect(text.textAutoResize).toBe("NONE");
    expect(r.renamed).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.collapsed).toEqual([]);
  });

  it("copies absolute layers unchanged, skips rebinding, and reports manual adjustment", async () => {
    const absoluteText = makeNode({
      id: "absolute-text",
      type: "TEXT",
      name: "Absolute Caption",
      textAutoResize: "NONE",
      layoutSizingVertical: "FIXED",
    });
    const absolute = makeNode({
      id: "absolute",
      name: "Desktop Art Direction",
      layoutPositioning: "ABSOLUTE",
      x: 720,
      y: 48,
      width: 560,
      height: 420,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 37,
      paddingTop: 23,
      paddingRight: 19,
      paddingBottom: 17,
      paddingLeft: 13,
      resolvedVariableModes: { "c:styles": "m:desk" },
      children: [absoluteText],
    });
    const normal = makeNode({ name: "Hero Content", layoutMode: "VERTICAL" });
    const hero = makeNode({
      name: "Hero Section",
      layoutMode: "HORIZONTAL",
      children: [normal, absolute],
    });
    const desktop = makeNode({
      id: "desktop",
      name: "Single Work Desk",
      width: 1440,
      height: 1800,
      layoutMode: "VERTICAL",
      children: [hero],
    });
    const section = makeNode({ name: "Section 3", children: [desktop] });
    registerNodes(section);

    const result = await api.generateBreakpoint(desktop, "tablet", {
      preservation: "strict",
      gutter: 120,
      textStyleIndex: { byId: {}, families: {}, total: 0 },
      cleanLayers: true,
    });
    const responsive = section.children[1];
    const copiedAbsolute = api.collectAbsolutePositionedLayers(responsive, false)[0];

    expect(result.absoluteLayersPreserved).toEqual([
      { id: copiedAbsolute.id, name: "Desktop Art Direction" },
    ]);
    expect(copiedAbsolute.layoutPositioning).toBe("ABSOLUTE");
    expect(copiedAbsolute.x).toBe(720);
    expect(copiedAbsolute.y).toBe(48);
    expect(copiedAbsolute.width).toBe(560);
    expect(copiedAbsolute.height).toBe(420);
    expect(copiedAbsolute.itemSpacing).toBe(37);
    expect(copiedAbsolute.paddingTop).toBe(23);
    expect(copiedAbsolute.paddingRight).toBe(19);
    expect(copiedAbsolute.paddingBottom).toBe(17);
    expect(copiedAbsolute.paddingLeft).toBe(13);
    expect(copiedAbsolute.boundVariables).toEqual({});
    expect(copiedAbsolute.children[0].name).toBe("Absolute Caption");
    expect(copiedAbsolute.children[0].textAutoResize).toBe("NONE");
    expect(copiedAbsolute.explicitVariableModes["c:styles"]).toBe("m:desk");
    expect(result.absoluteVariableModesPreserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: copiedAbsolute.id, modeId: "m:desk" }),
      ])
    );
    expect(result.warnings.join("\n")).toMatch(/not ungrouped.*manual designer adjustment/i);
    expect(desktop.children[0].children[1]).toBe(absolute);
    expect(absolute.x).toBe(720);
    expect(absoluteText.textAutoResize).toBe("NONE");
  });

  it("reports protected absolute layers as manual QA warnings, not overflow errors", () => {
    const absolute = makeNode({
      id: "absolute",
      name: "Wide Art",
      layoutPositioning: "ABSOLUTE",
      width: 900,
    });
    absolute.absoluteBoundingBox = { x: 0, y: 0, width: 900, height: 100 };
    const root = makeNode({ name: "Tablet", width: 768, children: [absolute] });
    root.absoluteBoundingBox = { x: 0, y: 0, width: 768, height: 1000 };

    const validation = api.validateResponsive(root, 768, "Tablet @ 768px");

    expect(validation.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        type: "absolute-positioned-manual",
        nodeId: "absolute",
      }),
    ]);
  });
});

describe("resize_node — cannot silently pin a hugging container", () => {
  it("refuses a height on a container that sizes to its content", async () => {
    const card = makeNode({
      id: "n:c",
      name: "Card",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO",
      children: [makeNode({ type: "TEXT" })],
    });
    registerNodes(card);

    await expect(api.resizeNode({ nodeId: "n:c", width: 320, height: 380 })).rejects.toThrow(
      /sizes its height to its content/
    );
    expect(api.readVerticalSizing(card)).toBe("HUG");
  });

  it("allows a width-only resize on the same container", async () => {
    const card = makeNode({
      id: "n:c",
      name: "Card",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO",
      children: [makeNode({ type: "TEXT" })],
    });
    registerNodes(card);

    const r = await api.resizeNode({ nodeId: "n:c", width: 320 });
    expect(r.width).toBe(320);
    expect(api.readVerticalSizing(card)).toBe("HUG");
  });

  it("allows a deliberate pin when allowFixedHeight is set", async () => {
    const crop = makeNode({
      id: "n:i",
      name: "Image Crop",
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO",
      children: [makeNode({ type: "TEXT" })],
    });
    registerNodes(crop);

    const r = await api.resizeNode({
      nodeId: "n:i",
      width: 590,
      height: 400,
      allowFixedHeight: true,
    });
    expect(r.height).toBe(400);
  });

  it("still resizes a plain rectangle without argument", async () => {
    const rect = makeNode({ id: "n:r", name: "Divider", type: "RECTANGLE" });
    delete rect.children;
    registerNodes(rect);

    const r = await api.resizeNode({ nodeId: "n:r", width: 100, height: 2 });
    expect(r.height).toBe(2);
  });

  it("requires at least one dimension", async () => {
    registerNodes(makeNode({ id: "n:x" }));
    await expect(api.resizeNode({ nodeId: "n:x" })).rejects.toThrow(/at least one of width/);
  });
});

describe("set_auto_layout — height hugs by default", () => {
  it("hugs vertically when converting a pre-sized frame", async () => {
    const frame = makeNode({ id: "n:f", name: "Section", height: 252 });
    registerNodes(frame);

    const r = await api.setAutoLayout({ nodeId: "n:f", layoutMode: "VERTICAL" });
    expect(r.layoutSizingVertical).toBe("HUG");
    expect(api.readVerticalSizing(frame)).toBe("HUG");
  });

  it("clears a leftover min/max height when hugging", async () => {
    const frame = makeNode({ id: "n:f", height: 252, minHeight: 252, maxHeight: 252 });
    registerNodes(frame);

    await api.setAutoLayout({ nodeId: "n:f", layoutMode: "VERTICAL" });
    expect(frame.minHeight).toBeNull();
    expect(frame.maxHeight).toBeNull();
  });

  it("honours an explicit FIXED request and keeps the constraint", async () => {
    const frame = makeNode({ id: "n:f", height: 252, minHeight: 252 });
    registerNodes(frame);

    const r = await api.setAutoLayout({
      nodeId: "n:f",
      layoutMode: "VERTICAL",
      layoutSizingVertical: "FIXED",
    });
    expect(r.layoutSizingVertical).toBe("FIXED");
    expect(frame.minHeight).toBe(252);
  });
});

describe("set_layout_sizing", () => {
  it("sets hug on an auto layout frame", async () => {
    const frame = makeNode({ id: "n:f", layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED" });
    registerNodes(frame);

    const r = await api.setLayoutSizing({ nodeId: "n:f", vertical: "HUG" });
    expect(r.applied).toContain("vertical → HUG");
    expect(api.readVerticalSizing(frame)).toBe("HUG");
  });

  it("explains that a frame cannot hug without auto layout", async () => {
    const frame = makeNode({ id: "n:f", layoutMode: "NONE" });
    registerNodes(frame);

    await expect(api.setLayoutSizing({ nodeId: "n:f", vertical: "HUG" })).rejects.toThrow(
      /Auto Layout/
    );
  });

  it("explains that FILL needs an auto layout parent", async () => {
    const child = makeNode({ id: "n:c" });
    const parent = makeNode({ layoutMode: "NONE", children: [child] });
    registerNodes(parent);

    await expect(api.setLayoutSizing({ nodeId: "n:c", horizontal: "FILL" })).rejects.toThrow(
      /parent does not use Auto Layout/
    );
  });

  it("hugs a text node through auto height, not layout sizing", async () => {
    const text = makeNode({ id: "n:t", type: "TEXT", textAutoResize: "NONE" });
    const parent = makeNode({ layoutMode: "VERTICAL", children: [text] });
    registerNodes(parent);

    const r = await api.setLayoutSizing({ nodeId: "n:t", horizontal: "FILL", vertical: "HUG" });
    expect(text.textAutoResize).toBe("HEIGHT");
    expect(r.applied).toContain("vertical → HUG (auto height)");
  });

  it("requires at least one axis", async () => {
    registerNodes(makeNode({ id: "n:f" }));
    await expect(api.setLayoutSizing({ nodeId: "n:f" })).rejects.toThrow(/horizontal or vertical/);
  });
});
