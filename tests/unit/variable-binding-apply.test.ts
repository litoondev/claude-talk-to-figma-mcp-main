/**
 * Exercises the paths that actually mutate a node: binding a variable to a
 * property, the batch report, and the sizing guards. These run the real plugin
 * source against mock nodes that mimic Figma's sizing behaviour.
 */
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";
import { casewayFile } from "../fixtures/caseway-tokens";

let api: any;
let figma: any;

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin(casewayFile());
  api = loaded.api;
  figma = loaded.figma;
});

describe("apply_variable_to_node — by token name", () => {
  it("binds a numeric token to itemSpacing", async () => {
    const frame = makeNode({ id: "n:1", name: "Content", layoutMode: "VERTICAL" });
    registerNodes(frame);

    const r = await api.applyVariableToNode({
      nodeId: "n:1",
      variableName: "Layout/Default/row-gap",
      field: "itemSpacing",
    });

    expect(r.variableName).toBe("Layout/Default/row-gap");
    expect(r.matchMethod).toBe("exact");
    expect(r.collectionName).toBe("styles");
    expect(frame.boundVariables.itemSpacing).toEqual({
      type: "VARIABLE_ALIAS",
      id: expect.any(String),
    });
  });

  it("refuses a token that does not exist, and says so without offering a substitute", async () => {
    const frame = makeNode({ id: "n:1", layoutMode: "VERTICAL" });
    registerNodes(frame);

    await expect(
      api.applyVariableToNode({ nodeId: "n:1", variableName: "spacing/72", field: "itemSpacing" })
    ).rejects.toThrow(/not-found/);

    // Nothing was written.
    expect(frame.boundVariables.itemSpacing).toBeUndefined();
  });

  it("refuses a type mismatch before touching the node", async () => {
    const frame = makeNode({ id: "n:1", layoutMode: "VERTICAL" });
    registerNodes(frame);

    await expect(
      api.applyVariableToNode({
        nodeId: "n:1",
        variableName: "colors/Base/Primary",
        field: "itemSpacing",
      })
    ).rejects.toThrow(/wrong-type/);
    expect(frame.boundVariables.itemSpacing).toBeUndefined();
  });

  it("refuses an ambiguous name rather than picking one", async () => {
    const frame = makeNode({ id: "n:1", layoutMode: "VERTICAL" });
    registerNodes(frame);

    await expect(
      api.applyVariableToNode({
        nodeId: "n:1",
        variableName: "utilities check box redius",
        field: "cornerRadius",
      })
    ).rejects.toThrow(/ambiguous/);
  });

  it("binds the alias token itself, not the primitive it points at", async () => {
    const text = makeNode({
      id: "n:t",
      type: "TEXT",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    });
    registerNodes(text);

    const r = await api.applyVariableToNode({
      nodeId: "n:t",
      variableName: "colors/Gray/500",
      field: "fills/0/color",
    });

    expect(r.variableName).toBe("colors/Gray/500");
    const bound = text.fills[0].boundVariables.color;
    const index = await api.buildVariableIndex();
    expect(index.byId[bound.id].name).toBe("colors/Gray/500");
    expect(index.byId[bound.id].name).not.toBe("colors/Base/Gray Main");
  });

  it("rejects a non-SOLID paint instead of corrupting the fill array", async () => {
    const node = makeNode({ id: "n:g", fills: [{ type: "GRADIENT_LINEAR" }] });
    registerNodes(node);

    await expect(
      api.applyVariableToNode({
        nodeId: "n:g",
        variableName: "colors/Base/Primary",
        field: "fills/0/color",
      })
    ).rejects.toThrow(/not SOLID/);
    expect(node.fills[0].boundVariables).toBeUndefined();
  });

  it("rejects a mixed fill rather than flattening it", async () => {
    const node = makeNode({ id: "n:m" });
    node.fills = figma.mixed;
    registerNodes(node);

    await expect(
      api.applyVariableToNode({
        nodeId: "n:m",
        variableName: "colors/Base/Primary",
        field: "fills/0/color",
      })
    ).rejects.toThrow(/mixed/);
  });

  it("rejects a paint index past the end of the array", async () => {
    const node = makeNode({ id: "n:i", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] });
    registerNodes(node);

    await expect(
      api.applyVariableToNode({
        nodeId: "n:i",
        variableName: "colors/Base/Primary",
        field: "fills/3/color",
      })
    ).rejects.toThrow(/out of range/);
  });

  it("binds an effect colour", async () => {
    const node = makeNode({
      id: "n:e",
      effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.25 } }],
    });
    registerNodes(node);

    await api.applyVariableToNode({
      nodeId: "n:e",
      variableName: "colors/Base/Black",
      field: "effects/0/color",
    });
    expect(node.effects[0].boundVariables.color).toBeDefined();
  });

  it("requires a variable reference of some kind", async () => {
    registerNodes(makeNode({ id: "n:1" }));
    await expect(api.applyVariableToNode({ nodeId: "n:1", field: "itemSpacing" })).rejects.toThrow(
      /variableId or variableName/
    );
  });

  it("enforces scope only when asked to", async () => {
    const a = makeNode({ id: "n:a", layoutMode: "VERTICAL" });
    const b = makeNode({ id: "n:b", layoutMode: "VERTICAL" });
    registerNodes(a, b);

    // Border/4 is FLOAT but scoped STROKE_FLOAT — wrong for a gap.
    const lenient = await api.applyVariableToNode({
      nodeId: "n:a",
      variableName: "Border/4",
      field: "itemSpacing",
    });
    expect(lenient.scopeMatch).toBe(false);
    expect(lenient.warning).toMatch(/not scoped/);

    await expect(
      api.applyVariableToNode({
        nodeId: "n:b",
        variableName: "Border/4",
        field: "itemSpacing",
        requireScopeMatch: true,
      })
    ).rejects.toThrow(/scopes/);
  });
});

describe("apply_variable_bindings — batch report", () => {
  it("splits bound from unbound and never substitutes", async () => {
    const a = makeNode({ id: "n:a", name: "Section", layoutMode: "VERTICAL" });
    const b = makeNode({ id: "n:b", name: "Card", layoutMode: "VERTICAL" });
    registerNodes(a, b);

    const r = await api.applyVariableBindings({
      bindings: [
        { nodeId: "n:a", field: "itemSpacing", variableName: "Layout/Default/row-gap" },
        { nodeId: "n:a", field: "paddingLeft", variableName: "Layout/Default/container-padding" },
        { nodeId: "n:b", field: "itemSpacing", variableName: "spacing/72" },
        { nodeId: "n:b", field: "cornerRadius", variableName: "colors/Base/Primary" },
        { nodeId: "n:missing", field: "itemSpacing", variableName: "Gap/24" },
      ],
    });

    expect(r.checked).toBe(5);
    expect(r.boundCount).toBe(2);
    expect(r.unboundCount).toBe(2);
    expect(r.errorCount).toBe(1);

    expect(r.unbound.find((u: any) => u.requestedTokenName === "spacing/72").reason).toBe(
      "not-found"
    );
    expect(r.unbound.find((u: any) => u.property === "cornerRadius").reason).toBe("wrong-type");
    expect(r.errors[0].message).toMatch(/node not found/);

    // The two that did bind, actually bound.
    expect(a.boundVariables.itemSpacing).toBeDefined();
    expect(a.boundVariables.paddingLeft).toBeDefined();
    expect(b.boundVariables.itemSpacing).toBeUndefined();
  });

  it("keeps going after one binding throws", async () => {
    const good = makeNode({ id: "n:g", layoutMode: "VERTICAL" });
    const gradient = makeNode({ id: "n:x", fills: [{ type: "GRADIENT_LINEAR" }] });
    registerNodes(good, gradient);

    const r = await api.applyVariableBindings({
      bindings: [
        { nodeId: "n:x", field: "fills/0/color", variableName: "colors/Base/Primary" },
        { nodeId: "n:g", field: "itemSpacing", variableName: "Gap/24" },
      ],
    });

    expect(r.errorCount).toBe(1);
    expect(r.boundCount).toBe(1);
    expect(good.boundVariables.itemSpacing).toBeDefined();
  });

  it("refuses an empty batch", async () => {
    await expect(api.applyVariableBindings({ bindings: [] })).rejects.toThrow(/non-empty array/);
  });
});

describe("get_node_variable_bindings", () => {
  it("separates bound properties from raw values", async () => {
    const frame = makeNode({
      id: "n:r",
      name: "Hero",
      layoutMode: "VERTICAL",
      itemSpacing: 60,
      paddingLeft: 100,
    });
    registerNodes(frame);

    await api.applyVariableToNode({
      nodeId: "n:r",
      variableName: "Layout/Default/row-gap",
      field: "itemSpacing",
    });

    const r = await api.getNodeVariableBindings({ nodeId: "n:r" });
    expect(r.boundProperties.itemSpacing.variableName).toBe("Layout/Default/row-gap");
    expect(r.boundProperties.itemSpacing.collectionName).toBe("styles");

    const raw = r.unboundProperties.map((u: any) => u.property);
    expect(raw).toContain("paddingLeft");
    expect(raw).not.toContain("itemSpacing");
  });
});

describe("set_variable — does not expand the design system silently", () => {
  it("refuses to create a variable that does not exist", async () => {
    await expect(
      api.setVariable({
        collectionName: "styles",
        name: "Layout/Default/brand-new-token",
        resolvedType: "FLOAT",
        value: 42,
      })
    ).rejects.toThrow(/createIfMissing/);
  });

  it("refuses to create a collection that does not exist", async () => {
    await expect(
      api.setVariable({
        collectionName: "invented",
        name: "whatever",
        resolvedType: "FLOAT",
        value: 1,
      })
    ).rejects.toThrow(/createIfMissing/);
  });
});
