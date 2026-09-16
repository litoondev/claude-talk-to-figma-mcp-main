import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResponsiveTools } from "../../src/talk_to_figma_mcp/tools/responsive-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

function makeServer() {
  const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
  const handlers: Record<string, Function> = {};
  const schemas: Record<string, z.ZodObject<any>> = {};
  const originalTool = server.tool.bind(server);
  jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
    if (args.length === 4) {
      const [name, , schema, handler] = args;
      handlers[name] = handler;
      schemas[name] = z.object(schema);
    }
    return (originalTool as any)(...args);
  });
  registerResponsiveTools(server);
  const mockSendCommand: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;
  async function call(args: any = {}) {
    mockSendCommand.mockClear();
    const result = await handlers.convert_layout(schemas.convert_layout.parse(args), { meta: {} });
    return result.content[0].text as string;
  }
  return { call, schema: () => schemas.convert_layout, mockSendCommand };
}

const summary = (extra: any = {}) => ({
  id: "12:3",
  name: "Features",
  type: "FRAME",
  mode: "auto_layout",
  layout: "vertical, gap 60px",
  padding: [80, 92, 80, 100],
  layers: 4,
  wrappers: 1,
  wrappersCreated: 0,
  flattened: [],
  absolute: [],
  layerChange: 0,
  inner: [],
  keptFree: [],
  ...extra,
});

describe("convert_layout MCP tool", () => {
  it("forwards defaults: selection scope, Auto Layout, nothing confirmed, tokens on", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({ dryRun: true, mode: "auto_layout", scope: "selection", targets: [{ id: "1:1", name: "Hero" }], proposals: [], blocked: [] });

    await call({ dryRun: true });

    expect(mockSendCommand).toHaveBeenCalledWith("convert_layout", {
      nodeId: undefined,
      scope: "selection",
      mode: "auto_layout",
      dryRun: true,
      confirmedIds: [],
      bindTokens: true,
    });
  });

  it("rejects an unknown mode at the schema", () => {
    const { schema } = makeServer();
    expect(() => schema().parse({ mode: "flex" })).toThrow();
  });

  it("a scan lists proposals with IDs, reasons for the rest, and asks before applying", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      dryRun: true,
      mode: "auto_layout",
      scope: "page",
      targets: [{ id: "0:1", name: "Page 1", type: "PAGE" }],
      proposals: [
        summary({
          flattened: ["Frame 12"],
          absolute: ["Badge"],
          inner: [{ id: "12:9", name: "Card", layout: "vertical, gap 24px" }],
          keptFree: [{ id: "12:20", name: "Collage", reason: "a free composition, kept as it is" }],
        }),
      ],
      blocked: [{ id: "3750:68504", name: "Hover Interactions page", reason: '"Button" and "Button" are not aligned top, centre or bottom (top edges 19px apart)' }],
      graphicsSkipped: 2,
    });

    const text = await call({ dryRun: true });

    expect(text).toContain("Auto Layout conversion scan — the whole current page (nothing was selected). Nothing modified.");
    expect(text).toContain('"Features" [id 12:3] — vertical, gap 60px, padding 80/92/80/100px; flattens "Frame 12"; keeps "Badge" in place as absolute; converts 1 frame(s) inside first');
    expect(text).toContain('inside: "Card" [id 12:9] — vertical, gap 24px');
    expect(text).toContain('stays free-positioned: "Collage" [id 12:20]');
    expect(text).toContain('"Hover Interactions page" [id 3750:68504] — "Button" and "Button" are not aligned top, centre or bottom');
    expect(text).toContain("2 vector drawing(s) skipped");
    expect(text).toContain("with only the approved IDs in confirmedIds");
    expect(text).toContain("Do not rebuild them by hand with set_auto_layout or move_node.");
  });

  it("an apply reports conversions, refusals, and asks about spacing with no token", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      dryRun: false,
      mode: "grid",
      scope: "node",
      targets: [{ id: "12:3", name: "Team", type: "FRAME" }],
      converted: [summary({ name: "Team", mode: "grid", layout: "3-column Grid, 3 row(s), equal columns, gaps 40/40px" })],
      skipped: [{ id: "9:9", name: "Hero", reason: '"Logo" would move or change size, so it was put back exactly as it was (the layers inside it now have new IDs)' }],
      keptFree: [],
      pending: [],
      tokensBound: ["Team: gridRowGap → Gap/40"],
      tokensMissing: [{ id: "12:3", name: "Team", field: "paddingBottom", value: 50 }, { id: "12:9", name: "Card", field: "itemSpacing", value: 14 }],
    });

    const text = await call({ nodeId: "12:3", mode: "grid", confirmedIds: ["12:3", "9:9"] });

    expect(mockSendCommand).toHaveBeenCalledWith("convert_layout", expect.objectContaining({ mode: "grid", confirmedIds: ["12:3", "9:9"] }));
    expect(text).toContain('Grid conversion — "Team": 1 converted.');
    expect(text).toContain("3-column Grid, 3 row(s), equal columns, gaps 40/40px");
    expect(text).toContain('Not converted — left exactly as it was (1):\n  "Hero" [id 9:9] — "Logo" would move or change size');
    expect(text).toContain("Team: gridRowGap → Gap/40");
    expect(text).toContain('I cannot find an existing local variable for 14px, 50px. Should I keep the manual values or add new tokens?');
  });

  it("reports a plugin failure as text instead of throwing", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockRejectedValueOnce(new Error("Node not found with ID: 1:2"));
    expect(await call({ nodeId: "1:2" })).toBe("Could not convert the layout: Node not found with ID: 1:2");
  });
});
