/**
 * Interactive layer optimization: cleanup removes what is unambiguously dead,
 * and nothing the designer might want — hidden layers, layers carrying a
 * prototype interaction, effect, export setting or mask — without an explicit
 * confirmation carried back by ID.
 */
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;
let figma: any;

beforeEach(() => {
  clearNodes();
  ({ api, figma } = loadPlugin());
});

/** A plain frame root, so empty children are not mistaken for Auto Layout spacers. */
function root(children: any[]) {
  const node = makeNode({ id: "root", name: "Hero", children });
  registerNodes(node);
  return node;
}

const reaction = [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "9:9" }] }];

async function scan(extra: any = {}) {
  return api.cleanLayersCommand({ nodeId: "root", dryRun: true, rename: false, ...extra });
}

async function apply(extra: any = {}) {
  return api.cleanLayersCommand({ nodeId: "root", rename: false, ...extra });
}

describe("hidden layers", () => {
  it("are listed by a scan and never removed by it", async () => {
    const hidden = makeNode({ id: "h1", name: "Old Banner", visible: false, children: [makeNode({ name: "Text" })] });
    root([hidden, makeNode({ name: "Content", fills: [{ type: "SOLID" }] })]);

    const r = await scan();

    expect(r.hiddenLayers).toEqual([{ id: "h1", name: "Old Banner", type: "FRAME" }]);
    expect(hidden.removed).toBe(false);
  });

  it("are kept when applying without the user's confirmation — including empty ones", async () => {
    const hiddenEmpty = makeNode({ id: "h1", name: "Frame 12", visible: false });
    const hiddenFull = makeNode({ id: "h2", name: "Alt State", visible: false, children: [makeNode()] });
    const top = root([hiddenEmpty, hiddenFull]);

    const r = await apply();

    expect(hiddenEmpty.removed).toBe(false);
    expect(hiddenFull.removed).toBe(false);
    expect(top.children).toHaveLength(2);
    expect(r.hiddenLayers.map((e: any) => e.id)).toEqual(["h1", "h2"]);
    expect(r.removedHidden).toEqual([]);
  });

  it("are all removed once the user confirms with removeAllHidden", async () => {
    const a = makeNode({ id: "h1", name: "A", visible: false });
    const b = makeNode({ id: "h2", name: "B", visible: false, children: [makeNode()] });
    root([a, b]);

    const r = await apply({ removeAllHidden: true });

    expect(a.removed).toBe(true);
    expect(b.removed).toBe(true);
    expect(r.removedHidden).toHaveLength(2);
    expect(r.hiddenLayers).toEqual([]);
  });

  it("removes only the confirmed subset when confirmedHiddenIds is given", async () => {
    const a = makeNode({ id: "h1", name: "A", visible: false });
    const b = makeNode({ id: "h2", name: "B", visible: false });
    root([a, b]);

    const r = await apply({ confirmedHiddenIds: ["h2"] });

    expect(a.removed).toBe(false);
    expect(b.removed).toBe(true);
    expect(r.hiddenLayers.map((e: any) => e.id)).toEqual(["h1"]);
  });

  it("never collapses a hidden wrapper, which would make its child visible", async () => {
    const child = makeNode({ name: "Card", fills: [{ type: "SOLID" }] });
    const wrapper = makeNode({ id: "w1", name: "Frame 3", visible: false, children: [child] });
    root([wrapper]);

    const r = await apply();

    expect(wrapper.removed).toBe(false);
    expect(child.parent).toBe(wrapper);
    expect(r.collapsed).toEqual([]);
  });
});

describe("layers that need a specific confirmation", () => {
  it("keeps a purposeless wrapper that carries a prototype interaction", async () => {
    const child = makeNode({ name: "Card", fills: [{ type: "SOLID" }] });
    const wrapper = makeNode({ id: "w1", name: "Frame 3", children: [child] });
    wrapper.reactions = reaction;
    const top = root([wrapper]);

    const scanned = await scan();
    expect(scanned.needsConfirmation).toEqual([
      { id: "w1", name: "Frame 3", type: "FRAME", action: "collapse wrapper", reasons: ["prototype interaction"] },
    ]);
    expect(scanned.collapsibleWrappers).toEqual([]);

    await apply();
    expect(wrapper.removed).toBe(false);
    expect(child.parent).toBe(wrapper);

    const confirmed = await apply({ confirmedRiskyIds: ["w1"] });
    expect(wrapper.removed).toBe(true);
    expect(child.parent).toBe(top);
    expect(confirmed.collapsed).toEqual(["Frame 3"]);
  });

  it("keeps a zero-size layer with an export setting or an effect", async () => {
    const exported = makeNode({ id: "e1", name: "Slice", width: 0, height: 40 });
    exported.exportSettings = [{ format: "PNG" }];
    const shadowed = makeNode({ id: "e2", name: "Line", width: 200, height: 0, effects: [{ type: "DROP_SHADOW" }] });
    root([exported, shadowed]);

    const r = await apply();

    expect(exported.removed).toBe(false);
    expect(shadowed.removed).toBe(false);
    const reasons = Object.fromEntries(r.needsConfirmation.map((e: any) => [e.id, e.reasons]));
    expect(reasons).toEqual({ e1: ["export setting"], e2: ["effect"] });
  });

  it("asks specifically about a hidden layer with an interaction inside, instead of the blanket hidden prompt", async () => {
    const button = makeNode({ name: "Button" });
    button.reactions = reaction;
    const hidden = makeNode({ id: "h1", name: "Modal", visible: false, children: [button] });
    root([hidden]);

    const scanned = await scan();
    expect(scanned.hiddenLayers).toEqual([]);
    expect(scanned.needsConfirmation[0]).toMatchObject({
      id: "h1",
      action: "remove hidden layer",
      reasons: ["prototype interaction on a child layer"],
    });

    await apply({ removeAllHidden: true });
    expect(hidden.removed).toBe(false);

    await apply({ confirmedRiskyIds: ["h1"] });
    expect(hidden.removed).toBe(true);
  });

  it("treats a prototype flow starting point as needing confirmation", async () => {
    const child = makeNode({ name: "Screen", fills: [{ type: "SOLID" }] });
    const wrapper = makeNode({ id: "w1", name: "Frame 1", children: [child] });
    root([wrapper]);
    figma.currentPage.flowStartingPoints = [{ nodeId: "w1", name: "Flow 1" }];

    const r = await apply();

    expect(wrapper.removed).toBe(false);
    expect(r.needsConfirmation[0].reasons).toEqual(["prototype flow starting point"]);
  });
});

describe("protected layers", () => {
  it("never removes a hidden layer inside a main component, even when confirmed", async () => {
    const variantLayer = makeNode({ id: "v1", name: "Icon Right", visible: false });
    const component = makeNode({ id: "c1", name: "Button", type: "COMPONENT", children: [variantLayer] });
    root([component]);

    const r = await apply({ removeAllHidden: true, confirmedHiddenIds: ["v1"], confirmedRiskyIds: ["v1"] });

    expect(variantLayer.removed).toBe(false);
    expect(r.protectedLayers).toEqual([
      { id: "v1", name: "Icon Right", type: "FRAME", reason: "part of a main component's variant structure" },
    ]);
  });

  it("never removes a layer bound to a component property", async () => {
    const bound = makeNode({ id: "b1", name: "Badge", visible: false });
    bound.componentPropertyReferences = { visible: "Show badge#1:0" };
    root([bound]);

    const r = await apply({ removeAllHidden: true });

    expect(bound.removed).toBe(false);
    expect(r.protectedLayers[0].reason).toBe("controlled by a component property");
  });
});

describe("unambiguous cleanup still happens without asking", () => {
  it("removes empty layers and collapses purposeless wrappers", async () => {
    const empty = makeNode({ id: "x1", name: "Frame 9" });
    const child = makeNode({ name: "Card", fills: [{ type: "SOLID" }] });
    const wrapper = makeNode({ id: "w1", name: "Frame 3", children: [child] });
    const top = root([empty, wrapper]);

    const r = await apply();

    expect(empty.removed).toBe(true);
    expect(wrapper.removed).toBe(true);
    expect(child.parent).toBe(top);
    expect(r.needsConfirmation).toEqual([]);
    expect(r.hiddenLayers).toEqual([]);
  });

  it("a scan reports the same removals and collapses without performing them", async () => {
    const empty = makeNode({ id: "x1", name: "Frame 9" });
    const child = makeNode({ name: "Card", fills: [{ type: "SOLID" }] });
    const wrapper = makeNode({ id: "w1", name: "Frame 3", children: [child] });
    const top = root([empty, wrapper]);

    const r = await scan();

    expect(r.removableLayers).toEqual(["Frame 9 (frame)"]);
    expect(r.collapsibleWrappers).toEqual(["Frame 3"]);
    expect(empty.removed).toBe(false);
    expect(wrapper.removed).toBe(false);
    expect(top.children).toEqual([empty, wrapper]);
  });

  it("runs the full default pass, renaming included, without error", async () => {
    root([makeNode({ id: "h1", name: "Frame 5", visible: false }), makeNode({ name: "Frame 2", fills: [{ type: "SOLID" }] })]);

    const r = await api.cleanLayersCommand({ nodeId: "root" });

    expect(r.dryRun).toBe(false);
    expect(r.hiddenLayers.map((e: any) => e.id)).toEqual(["h1"]);
  });
});

describe("scope", () => {
  it("cleans every selected node, once, when a node and its ancestor are both selected", async () => {
    const innerHidden = makeNode({ id: "h1", name: "Inner", visible: false });
    const a = makeNode({ id: "a", name: "Section A", children: [innerHidden] });
    const b = makeNode({ id: "b", name: "Section B", children: [makeNode({ id: "h2", name: "Other", visible: false })] });
    registerNodes(a, b);
    figma.currentPage.selection = [a, innerHidden, b];

    const r = await api.cleanLayersCommand({ dryRun: true, rename: false });

    expect(r.targets.map((t: any) => t.id)).toEqual(["a", "b"]);
    expect(r.hiddenLayers.map((e: any) => e.id)).toEqual(["h1", "h2"]);
  });

  it("scans the whole current page with scope 'page'", async () => {
    figma.currentPage.id = "0:1";
    figma.currentPage.name = "Page 1";
    figma.currentPage.children = [makeNode({ id: "h1", name: "Hidden", visible: false })];

    const r = await api.cleanLayersCommand({ scope: "page", dryRun: true, rename: false });

    expect(r.targets).toEqual([{ id: "0:1", name: "Page 1", type: undefined }]);
    expect(r.hiddenLayers.map((e: any) => e.id)).toEqual(["h1"]);
  });

  it("refuses to guess when nothing is selected", async () => {
    await expect(api.cleanLayersCommand({ dryRun: true })).rejects.toThrow(/Nothing selected/);
  });
});

describe("generated responsive frames (no one to ask)", () => {
  it("keep hidden and risky layers and say so in warnings", () => {
    const wrapper = makeNode({ name: "Frame 3", children: [makeNode({ fills: [{ type: "SOLID" }] })] });
    wrapper.reactions = reaction;
    const frame = makeNode({ name: "Tablet", children: [makeNode({ name: "Hidden", visible: false }), wrapper] });
    const report = { renamed: [], removed: [], collapsed: [], warnings: [] as string[] };

    api.cleanLayers(frame, { rename: false }, report);

    expect(frame.children).toHaveLength(2);
    expect(report.warnings.some((w) => /1 hidden layer\(s\) were kept/.test(w))).toBe(true);
    expect(report.warnings.some((w) => /1 layer\(s\) carry a prototype interaction/.test(w))).toBe(true);
  });
});

/**
 * Mirrors a real file ("# Work Process"): every card sits inside two Auto Layout
 * "Block" frames that paint nothing, pad nothing and match the card's size.
 */
describe("double-nested Auto Layout wrappers", () => {
  function block(n: number, sizing: any = {}) {
    // As in the real file: the card's BG is absolutely positioned inside the instance.
    const card = makeNode({
      id: `card${n}`, name: "Card", type: "INSTANCE", layoutMode: "VERTICAL",
      width: 298, height: 380, fills: [{ type: "SOLID" }],
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED",
      children: [
        makeNode({ name: "BG", type: "RECTANGLE", layoutPositioning: "ABSOLUTE", width: 310, height: 1 }),
        makeNode({ name: "Section container", layoutMode: "VERTICAL", width: 250, height: 254 }),
      ],
    });
    const inner = makeNode({
      id: `inner${n}`, name: `0${n} Block`, layoutMode: "HORIZONTAL", width: 298, height: 380,
      children: [card], ...sizing,
    });
    const outer = makeNode({
      id: `outer${n}`, name: `0${n} Block`, layoutMode: "HORIZONTAL", width: 298, height: 380,
      children: [inner], ...sizing,
    });
    return { card, inner, outer };
  }

  function workProcess(blocks: any[]) {
    const container = makeNode({
      id: "container", name: "Container", layoutMode: "HORIZONTAL", width: 1240, height: 380,
      children: blocks.map((b) => b.outer),
    });
    const heading = makeNode({ id: "heading", name: "Text_Container", type: "INSTANCE", layoutMode: "VERTICAL" });
    const top = makeNode({
      id: "root", name: "# Work Process", layoutMode: "VERTICAL", width: 1440, height: 780,
      fills: [{ type: "SOLID" }], children: [heading, container],
    });
    top.clipsContent = true;
    registerNodes(top);
    return { top, container };
  }

  it("a scan lists both wrapper levels of every block", async () => {
    const blocks = [1, 2, 3, 4].map((n) => block(n));
    workProcess(blocks);

    const r = await scan();

    expect(r.collapsibleWrappers).toHaveLength(8);
    expect(blocks.every((b) => !b.outer.removed && !b.inner.removed)).toBe(true);
  });

  it("applying leaves Container > Card directly, one Auto Layout level", async () => {
    const blocks = [1, 2, 3, 4].map((n) => block(n));
    const { container } = workProcess(blocks);

    const r = await apply();

    expect(container.children.map((c: any) => c.id)).toEqual(["card1", "card2", "card3", "card4"]);
    expect(blocks.every((b) => b.outer.removed && b.inner.removed)).toBe(true);
    expect(r.collapsed).toHaveLength(8);
  });

  it("hands a Fill wrapper's sizing to the card so it still fills the row", async () => {
    const b = block(1, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL" });
    const { container } = workProcess([b]);

    await apply();

    expect(b.card.parent).toBe(container);
    expect(b.card.layoutSizingHorizontal).toBe("FILL");
    expect(b.card.layoutSizingVertical).toBe("FILL");
  });

  it.each([
    ["padding", { paddingLeft: 16 }],
    ["a fill", { fills: [{ type: "SOLID" }] }],
    ["a stroke", { strokes: [{ type: "SOLID" }] }],
    ["a bound variable", { boundVariables: { itemSpacing: { type: "VARIABLE_ALIAS", id: "v:1" } } }],
    ["a max width", { maxWidth: 320 }],
    ["a different size than its child", { width: 320 }],
  ])("keeps an Auto Layout wrapper with %s", async (_label, spec) => {
    const card = makeNode({ id: "card", name: "Card", type: "INSTANCE", layoutMode: "VERTICAL", width: 298, height: 380 });
    const wrapper = makeNode({
      id: "w", name: "Block", layoutMode: "HORIZONTAL", width: 298, height: 380, children: [card], ...spec,
    });
    const container = makeNode({ id: "root", name: "Container", layoutMode: "HORIZONTAL", width: 1240, height: 380, children: [wrapper] });
    registerNodes(container);

    await apply();

    expect(wrapper.removed).toBe(false);
    expect(card.parent).toBe(wrapper);
  });

  it("keeps the child where it was when the parent has no Auto Layout", async () => {
    const card = makeNode({ id: "card", name: "Card", type: "INSTANCE", width: 298, height: 380 });
    const wrapper = makeNode({
      id: "w", name: "Block", layoutMode: "HORIZONTAL", x: 40, y: 60, width: 298, height: 380, children: [card],
    });
    root([wrapper]);

    await apply();

    expect(wrapper.removed).toBe(true);
    expect([card.x, card.y]).toEqual([40, 60]);
  });

  it("undoes the move when Figma refuses the sizing change", async () => {
    const b = block(1, { layoutSizingHorizontal: "FILL" });
    workProcess([b]);
    const card = b.card;
    const descriptor = Object.getOwnPropertyDescriptor(card, "layoutSizingHorizontal")!;
    Object.defineProperty(card, "layoutSizingHorizontal", {
      configurable: true,
      get: descriptor.get,
      set(value) {
        if (value === "FILL" && card.parent?.id === "container") throw new Error("refused");
        descriptor.set!.call(card, value);
      },
    });

    const r = await apply();

    expect(b.inner.removed).toBe(true); // collapsing into its sibling-sized outer is still fine
    expect(b.outer.removed).toBe(false);
    expect(card.parent).toBe(b.outer);
    expect(b.outer.parent?.id).toBe("container");
    expect(r.collapsed).toEqual(["01 Block"]);
  });

  it("never flattens layers inside a main component", async () => {
    const b = block(1);
    const component = makeNode({ id: "comp", name: "Process Card", type: "COMPONENT", layoutMode: "HORIZONTAL", width: 298, height: 380, children: [b.outer] });
    root([component]);

    await apply();

    expect(b.outer.removed).toBe(false);
    expect(b.inner.removed).toBe(false);
  });

  it("keeps a plain wrapper whose child is offset inside an Auto Layout parent", async () => {
    const child = makeNode({ name: "Card", fills: [{ type: "SOLID" }], x: 20, y: 10, width: 200, height: 50 });
    const wrapper = makeNode({ id: "w", name: "Frame 3", width: 240, height: 70, children: [child] });
    const container = makeNode({ id: "root", name: "Row", layoutMode: "HORIZONTAL", children: [wrapper] });
    registerNodes(container);

    await apply();

    expect(wrapper.removed).toBe(false);
  });

  it("collapses the single-level state the file is in now: Container > 02 Block (Fill/Hug) > Card (Fill/Fixed)", async () => {
    const blocks = [1, 2, 3, 4].map((n) => block(n, { layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" }));
    // The inner level was already removed by hand; wrap each card once.
    for (const b of blocks) {
      b.outer.children.splice(0, 1);
      b.outer.appendChild(b.card);
    }
    const { container } = workProcess(blocks);

    const scanned = await scan();
    expect(scanned.collapsibleWrappers).toEqual(["01 Block", "02 Block", "03 Block", "04 Block"]);

    const r = await apply();

    expect(container.children.map((c: any) => c.id)).toEqual(["card1", "card2", "card3", "card4"]);
    expect(blocks.every((b) => b.card.layoutSizingHorizontal === "FILL")).toBe(true);
    expect(blocks.every((b) => b.card.layoutSizingVertical === "FIXED" && b.card.height === 380)).toBe(true);
    expect(r.collapsed).toHaveLength(4);
  });

  it("collapses a plain wrapper whose child holds an absolute layer deeper down", async () => {
    const card = makeNode({
      id: "card", name: "Card", fills: [{ type: "SOLID" }],
      children: [makeNode({ name: "BG", layoutPositioning: "ABSOLUTE" })],
    });
    const wrapper = makeNode({ id: "w", name: "Frame 3", children: [card] });
    const top = root([wrapper]);

    await apply();

    expect(wrapper.removed).toBe(true);
    expect(card.parent).toBe(top);
  });
});
