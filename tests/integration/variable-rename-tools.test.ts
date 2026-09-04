import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/talk_to_figma_mcp/tools/variable-tools";
import { registerDocumentTools } from "../../src/talk_to_figma_mcp/tools/document-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn().mockResolvedValue({ id: "mock:1" }),
}));

function makeServer() {
  const server = new McpServer(
    { name: "test-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const handlers: Record<string, Function> = {};
  const schemas: Record<string, z.ZodObject<any>> = {};

  const originalTool = server.tool.bind(server);
  jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
    if (args.length === 4) {
      const [name, , schema, handler] = args;
      handlers[name] = handler;
      schemas[name] =
        Object.keys(schema).length > 0
          ? z.object(schema)
          : z.object({});
    }
    return (originalTool as any)(...args);
  });

  registerVariableTools(server);
  registerDocumentTools(server);

  const mockSendCommand: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;

  async function call(toolName: string, args: any = {}) {
    mockSendCommand.mockClear();
    const schema = schemas[toolName];
    if (!schema) throw new Error(`No schema for tool ${toolName}`);
    const validated = schema.parse(args);
    return handlers[toolName](validated, { meta: {} });
  }

  return { call, mockSendCommand };
}

describe("rename_variable MCP tool", () => {
  it("forwards rename_variable to Figma and formats response", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      variableId: "v:101",
      oldName: "Pages/Compact/row-gap",
      newName: "Layout/Section/Compact/row-gap",
      collectionName: "styles",
    });

    const res = await call("rename_variable", {
      name: "Pages/Compact/row-gap",
      newName: "Layout/Section/Compact/row-gap",
      collectionName: "styles",
    });

    expect(mockSendCommand).toHaveBeenCalledWith("rename_variable", {
      name: "Pages/Compact/row-gap",
      newName: "Layout/Section/Compact/row-gap",
      collectionName: "styles",
    });
    expect(res.content[0].text).toContain('Renamed variable from "Pages/Compact/row-gap" to "Layout/Section/Compact/row-gap"');
    expect(res.content[0].text).toContain("v:101");
  });
});

describe("rename_variables MCP tool", () => {
  it("forwards pattern-based bulk rename", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      renamedCount: 26,
      errorCount: 0,
      pattern: { find: "Pages/", replace: "Layout/Section/" },
      renamed: [],
    });

    const res = await call("rename_variables", {
      collectionName: "styles",
      find: "Pages/",
      replace: "Layout/Section/",
    });

    expect(mockSendCommand).toHaveBeenCalledWith("rename_variables", {
      collectionName: "styles",
      find: "Pages/",
      replace: "Layout/Section/",
    });
    expect(res.content[0].text).toContain('"renamedCount": 26');
  });

  it("forwards list-based bulk rename", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      renamedCount: 2,
      errorCount: 0,
    });

    const res = await call("rename_variables", {
      renames: [
        { name: "Pages/A", newName: "Layout/A" },
        { name: "Pages/B", newName: "Layout/B" },
      ],
    });

    expect(mockSendCommand).toHaveBeenCalledWith("rename_variables", {
      renames: [
        { name: "Pages/A", newName: "Layout/A" },
        { name: "Pages/B", newName: "Layout/B" },
      ],
    });
    expect(res.content[0].text).toContain('"renamedCount": 2');
  });
});

describe("set_variable MCP tool with newName", () => {
  it("allows renaming via set_variable without value", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      variableId: "v:50",
      oldName: "Pages/Old",
      newName: "Pages/New",
    });

    const res = await call("set_variable", {
      name: "Pages/Old",
      newName: "Pages/New",
    });

    expect(mockSendCommand).toHaveBeenCalledWith("set_variable", {
      name: "Pages/Old",
      newName: "Pages/New",
    });
    expect(res.content[0].text).toContain('Renamed variable "Pages/Old" to "Pages/New"');
  });
});

describe("execute_code MCP tool", () => {
  it("forwards code string and params to Figma", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      result: 42,
    });

    const res = await call("execute_code", {
      code: "return 42;",
    });

    expect(mockSendCommand).toHaveBeenCalledWith("execute_code", {
      code: "return 42;",
    });
    expect(res.content[0].text).toContain('"result": 42');
  });
});

describe("set_file_key & get_file_key MCP tools", () => {
  it("forwards set_file_key URL", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      fileKey: "AbCdEf12345",
    });

    const res = await call("set_file_key", {
      url: "https://www.figma.com/design/AbCdEf12345/My-File",
    });

    expect(mockSendCommand).toHaveBeenCalledWith("set_file_key", {
      url: "https://www.figma.com/design/AbCdEf12345/My-File",
    });
    expect(res.content[0].text).toContain('"fileKey": "AbCdEf12345"');
  });

  it("calls get_file_key", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      fileKey: "AbCdEf12345",
      available: true,
    });

    const res = await call("get_file_key");

    expect(mockSendCommand).toHaveBeenCalledWith("get_file_key");
    expect(res.content[0].text).toContain('"available": true');
  });
});
