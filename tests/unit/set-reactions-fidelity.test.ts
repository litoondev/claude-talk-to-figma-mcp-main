/**
 * `set_reactions` must write the reaction that was asked for.
 *
 * This exists because of a defect with no symptom. The MCP tool declared a
 * narrow Zod schema and the plugin handler rebuilt each reaction field by
 * field, so anything neither of them named was dropped *silently* — a
 * `MOVE_IN` lost its `direction` and played the default way, an `ON_KEY_DOWN`
 * lost its `keyCodes` and never fired, a `URL` action lost its `url`. Nothing
 * threw, and the read-back looked plausible, so the only way to notice was to
 * open Present and find the prototype behaving differently from the plan.
 *
 * The handler tests below assert on the object that actually reached
 * `setReactionsAsync`. The schema test asserts the MCP layer in front of it
 * declares the same fields, because a field the Zod schema omits never reaches
 * the handler at all.
 */
import * as fs from "fs";
import * as path from "path";
import { loadPlugin, makeNode, registerNodes, clearNodes } from "../fixtures/figma-plugin-harness";

let api: any;

beforeEach(() => {
  clearNodes();
  ({ api } = loadPlugin());
});

/** Write one reaction and hand back what the node ended up holding. */
async function write(reaction: any, nodeSpec: any = {}) {
  const node = makeNode({ id: "1:1", name: "Trigger", ...nodeSpec });
  registerNodes(node);
  await api.handleCommand("set_reactions", { nodeId: node.id, reactions: [reaction] });
  return node.reactions[0];
}

describe("set_reactions keeps every field of a reaction", () => {
  it("keeps direction and matchLayers on a directional transition", async () => {
    const written = await write({
      trigger: { type: "ON_CLICK" },
      actions: [
        {
          type: "NODE",
          destinationId: "1:1",
          navigation: "OVERLAY",
          transition: {
            type: "MOVE_IN",
            direction: "BOTTOM",
            matchLayers: true,
            easing: { type: "GENTLE" },
            duration: 0.45,
          },
        },
      ],
    });

    expect(written.actions[0].transition).toEqual({
      type: "MOVE_IN",
      direction: "BOTTOM",
      matchLayers: true,
      easing: { type: "GENTLE" },
      duration: 0.45,
    });
  });

  it("keeps a custom cubic bezier and a physical spring", async () => {
    const bezier = { type: "CUSTOM_CUBIC_BEZIER", easingFunctionCubicBezier: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 } };
    const written = await write({
      trigger: { type: "ON_CLICK" },
      actions: [
        { type: "NODE", destinationId: "1:1", navigation: "NAVIGATE", transition: { type: "SMART_ANIMATE", easing: bezier, duration: 0.45 } },
      ],
    });
    expect(written.actions[0].transition.easing).toEqual(bezier);

    const spring = { type: "CUSTOM_SPRING", easingFunctionSpring: { mass: 1, stiffness: 300, damping: 30 } };
    const withSpring = await write({
      trigger: { type: "ON_CLICK" },
      actions: [
        { type: "NODE", destinationId: "1:1", navigation: "NAVIGATE", transition: { type: "SMART_ANIMATE", easing: spring, duration: 0.3 } },
      ],
    });
    expect(withSpring.actions[0].transition.easing).toEqual(spring);
  });

  it("keeps the key codes that make Escape close a modal", async () => {
    const written = await write({
      trigger: { type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: [27] },
      actions: [{ type: "CLOSE" }],
    });
    expect(written.trigger).toEqual({ type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: [27] });
  });

  it("keeps a timeout, a delay and a media hit time", async () => {
    expect((await write({ trigger: { type: "AFTER_TIMEOUT", timeout: 3 }, actions: [{ type: "CLOSE" }] })).trigger)
      .toEqual({ type: "AFTER_TIMEOUT", timeout: 3 });

    expect((await write({ trigger: { type: "MOUSE_LEAVE", delay: 0.2, deprecatedVersion: false }, actions: [{ type: "CLOSE" }] })).trigger)
      .toEqual({ type: "MOUSE_LEAVE", delay: 0.2, deprecatedVersion: false });

    expect((await write({ trigger: { type: "ON_MEDIA_HIT", mediaHitTime: 4.5 }, actions: [{ type: "CLOSE" }] })).trigger)
      .toEqual({ type: "ON_MEDIA_HIT", mediaHitTime: 4.5 });
  });

  it("keeps a URL action's destination", async () => {
    const written = await write({
      trigger: { type: "ON_CLICK" },
      actions: [{ type: "URL", url: "https://example.com", openInNewTab: true }],
    });
    expect(written.actions[0]).toEqual({ type: "URL", url: "https://example.com", openInNewTab: true });
  });

  it("keeps variable and conditional action payloads", async () => {
    const setVariable = await write({
      trigger: { type: "ON_CLICK" },
      actions: [
        {
          type: "SET_VARIABLE",
          variableId: "VariableID:1:2",
          variableValue: { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true },
        },
      ],
    });
    expect(setVariable.actions[0]).toEqual({
      type: "SET_VARIABLE",
      variableId: "VariableID:1:2",
      variableValue: { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true },
    });

    const blocks = [{ condition: { type: "EXPRESSION" }, actions: [{ type: "BACK" }] }];
    const conditional = await write({
      trigger: { type: "ON_CLICK" },
      actions: [{ type: "CONDITIONAL", conditionalBlocks: blocks }],
    });
    expect(conditional.actions[0]).toEqual({ type: "CONDITIONAL", conditionalBlocks: blocks });

    const mode = await write({
      trigger: { type: "ON_CLICK" },
      actions: [{ type: "SET_VARIABLE_MODE", variableCollectionId: "C:1", variableModeId: "M:1" }],
    });
    expect(mode.actions[0]).toEqual({ type: "SET_VARIABLE_MODE", variableCollectionId: "C:1", variableModeId: "M:1" });
  });
});

describe("set_reactions and the destination frame's overlay settings", () => {
  it("writes them when asked", async () => {
    const overlay = makeNode({ id: "2:1", name: "Sheet" });
    const trigger = makeNode({ id: "1:1", name: "Open" });
    registerNodes(overlay, trigger);

    await api.handleCommand("set_reactions", {
      nodeId: trigger.id,
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [
            {
              type: "NODE",
              destinationId: overlay.id,
              navigation: "OVERLAY",
              overlayPositionType: "BOTTOM_CENTER",
              overlayBackgroundInteraction: "CLOSE_ON_CLICK_OUTSIDE",
            },
          ],
        },
      ],
    });

    expect(overlay.overlayPositionType).toBe("BOTTOM_CENTER");
    expect(overlay.overlayBackgroundInteraction).toBe("CLOSE_ON_CLICK_OUTSIDE");
  });

  it("leaves the designer's own settings alone when not asked", async () => {
    // The handler used to default these to CENTER and CLOSE_ON_CLICK_OUTSIDE,
    // so merely linking a button re-positioned someone else's overlay frame.
    const overlay = makeNode({
      id: "2:1",
      name: "Dropdown",
      overlayPositionType: "MANUAL",
      overlayBackgroundInteraction: "NONE",
    });
    const trigger = makeNode({ id: "1:1", name: "Open" });
    registerNodes(overlay, trigger);

    await api.handleCommand("set_reactions", {
      nodeId: trigger.id,
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "NODE", destinationId: overlay.id, navigation: "OVERLAY" }],
        },
      ],
    });

    expect(overlay.overlayPositionType).toBe("MANUAL");
    expect(overlay.overlayBackgroundInteraction).toBe("NONE");
  });
});

describe("the MCP schema in front of the handler", () => {
  /**
   * A field the Zod schema does not declare is stripped before the handler ever
   * sees it, so the handler tests above would still pass while the tool stayed
   * broken end to end.
   */
  it("declares every field the handler forwards", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "talk_to_figma_mcp", "tools", "component-tools.ts"),
      "utf8"
    );
    const schema = source.slice(source.indexOf('"set_reactions"'), source.indexOf('"get_reactions"'));

    for (const field of [
      "direction",
      "matchLayers",
      "easingFunctionCubicBezier",
      "easingFunctionSpring",
      "device",
      "keyCodes",
      "timeout",
      "mediaHitTime",
      "deprecatedVersion",
      "url",
      "openInNewTab",
      "variableId",
      "variableValue",
      "variableCollectionId",
      "variableModeId",
      "conditionalBlocks",
      "overlayPositionType",
      "overlayBackgroundInteraction",
      "preserveScrollPosition",
    ]) {
      expect({ field, declared: schema.includes(field + ":") }).toEqual({ field, declared: true });
    }
  });
});
