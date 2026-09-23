/**
 * The audit's verdict, not its status line.
 *
 * Ledger L10: a check that could not run must never read as a pass. A walk
 * that hit its node budget or failed on a subtree has not seen the whole file,
 * and one binding anywhere is enough to keep a source in the style picker — so
 * "nothing found" from a partial scan is a false all-clear.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRemoteStyleTools } from "../../src/talk_to_figma_mcp/tools/style-tools";

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

  registerRemoteStyleTools(server);
  const mockSendCommand: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;

  async function audit(args: any = {}) {
    return handlers.audit_remote_styles(schemas.audit_remote_styles.parse(args), { meta: {} });
  }
  return { audit, mockSendCommand };
}

const pluginResult = (extra: any = {}) => ({
  scope: "document",
  nodesScanned: 1200,
  truncated: false,
  remoteStyleCount: 0,
  remoteVariableCount: 0,
  totalBindings: 0,
  styles: [],
  variables: [],
  bindings: [],
  bindingsTruncated: false,
  localStyleNames: [],
  localVariableNames: [],
  failures: [],
  ...extra,
});

const parse = (res: any) => JSON.parse(res.content[0].text);

describe("audit_remote_styles verdict", () => {
  it("calls a complete scan with nothing foreign clean", async () => {
    const { audit, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValue(pluginResult());

    const r = parse(await audit({ scope: "document", resolveSources: false }));

    expect(r.verdict).toBe("clean");
    expect(r.clean).toBe(true);
  });

  it("refuses to call a truncated scan clean", async () => {
    const { audit, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValue(pluginResult({ truncated: true }));

    const r = parse(await audit({ scope: "document", resolveSources: false }));

    expect(r.verdict).toBe("incomplete");
    expect(r.clean).toBe(false);
    expect(r.summary).toContain("SCAN INCOMPLETE");
    expect(r.summary).toContain("not an all-clear");
  });

  it("refuses to call a scan with unreadable subtrees clean", async () => {
    const { audit, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValue(
      pluginResult({ failures: [{ nodeId: "4:1", reason: "walk failed: undefined" }] })
    );

    const r = parse(await audit({ scope: "document", resolveSources: false }));

    expect(r.verdict).toBe("incomplete");
    expect(r.clean).toBe(false);
    expect(r.nextStep).toContain("until the scan completes");
  });

  it("reports found sources regardless of completeness", async () => {
    const { audit, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValue(
      pluginResult({
        truncated: true,
        remoteStyleCount: 1,
        totalBindings: 12,
        styles: [{ key: "k1", name: "Desk/H2 Desk", usages: 12, insideInstance: 0, sampleNodeIds: [] }],
      })
    );

    const r = parse(await audit({ scope: "document", resolveSources: false }));

    expect(r.verdict).toBe("foreign-sources-found");
    expect(r.clean).toBe(false);
  });

  it("says why sources are unnamed rather than leaving the field blank", async () => {
    const { audit, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValue(
      pluginResult({
        remoteStyleCount: 1,
        totalBindings: 1,
        styles: [{ key: "k1", name: "Desk/H2 Desk", usages: 1, insideInstance: 0, sampleNodeIds: [] }],
      })
    );

    const r = parse(await audit({ scope: "document", resolveSources: false }));

    expect(r.sourceNote).toContain("resolveSources was false");
    expect(r.styles[0].sourceFileName).toBeNull();
  });
});
