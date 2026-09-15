import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/talk_to_figma_mcp/tools/modification-tools";

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
  registerModificationTools(server);
  const mockSendCommand: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;
  const call = async (args: any) => {
    mockSendCommand.mockClear();
    return handlers.set_grid_layout(schemas.set_grid_layout.parse(args), { meta: {} });
  };
  return { call, schema: () => schemas.set_grid_layout, mockSendCommand };
}

describe("set_grid_layout MCP tool", () => {
  it("forwards the grid spec, accepting spans given as a JSON string", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      name: "# Work Process",
      columns: 4,
      rows: 2,
      rowGap: 60,
      columnGap: 16,
      positioning: "ROW_AUTO_FLOW",
      placement: [
        { id: "1:1", row: 0, column: 0, columnSpan: 4 },
        { id: "1:2", row: 1, column: 0, columnSpan: 1 },
      ],
    });

    const res = await call({ nodeId: "1:0", columns: "4", rowGap: 60, columnGap: 16, spans: '[{"nodeId":"1:1","columnSpan":4}]' });

    expect(mockSendCommand).toHaveBeenCalledWith("set_grid_layout", {
      nodeId: "1:0",
      columns: 4,
      rowGap: 60,
      columnGap: 16,
      columnSizes: undefined,
      rowSizes: undefined,
      spans: [{ nodeId: "1:1", columnSpan: 4 }],
    });
    expect(res.content[0].text).toBe(
      'Grid on "# Work Process": 4 columns × 2 rows, row gap 60, column gap 16 (auto-flow). 1:1 spans 4 columns. ' +
        "If the gaps come from tokens, bind them with apply_variable_bindings (gridRowGap, gridColumnGap)."
    );
  });

  it("rejects a column count outside 1–24 and an unknown track type", () => {
    const { schema } = makeServer();
    expect(() => schema().parse({ nodeId: "1:0", columns: 0 })).toThrow();
    expect(() => schema().parse({ nodeId: "1:0", columns: 25 })).toThrow();
    expect(() => schema().parse({ nodeId: "1:0", columns: 2, columnSizes: [{ type: "AUTO" }] })).toThrow();
  });

  it("reports the plugin's refusal instead of throwing", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockRejectedValueOnce(new Error('Could not build the grid on "Row": refused. The frame was restored.'));

    const res = await call({ nodeId: "1:0", columns: 3 });

    expect(res.content[0].text).toBe(
      'Error setting grid layout: Could not build the grid on "Row": refused. The frame was restored.'
    );
  });
});
