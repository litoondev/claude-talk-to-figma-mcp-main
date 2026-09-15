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
    return handlers.clean_layers(schemas.clean_layers.parse(args), { meta: {} });
  }

  return { call, schema: () => schemas.clean_layers, mockSendCommand };
}

const scanResult = (extra: any = {}) => ({
  dryRun: true,
  targets: [{ id: "1:1", name: "Hero", type: "SECTION" }],
  frame: { id: "1:1", name: "Hero" },
  layerCount: 42,
  genericNames: [],
  removableLayers: ["Frame 9 (frame)"],
  collapsibleWrappers: ["Frame 3"],
  hiddenLayers: [],
  needsConfirmation: [],
  protectedLayers: [],
  warnings: [],
  ...extra,
});

describe("clean_layers MCP tool — interactive flow", () => {
  it("forwards the confirmation parameters, defaulting to nothing confirmed", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce(scanResult());

    await call({ dryRun: true });

    expect(mockSendCommand).toHaveBeenCalledWith("clean_layers", {
      nodeId: undefined,
      scope: "selection",
      dryRun: true,
      removeAllHidden: false,
      confirmedHiddenIds: [],
      confirmedRiskyIds: [],
      confirmedGridIds: [],
      rename: true,
      removeUnwanted: true,
      collapseWrappers: true,
    });
  });

  it("passes the user's confirmations through unchanged", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({ ...scanResult(), dryRun: false, layerCountBefore: 42, layerCountAfter: 40 });

    await call({ scope: "page", removeAllHidden: true, confirmedRiskyIds: ["2:2"] });

    expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
      scope: "page",
      removeAllHidden: true,
      confirmedRiskyIds: ["2:2"],
    });
  });

  it("rejects an unknown scope", () => {
    const { schema } = makeServer();
    expect(() => schema().parse({ scope: "file" })).toThrow();
  });

  it("a scan with hidden and risky layers tells the model to ask the user first", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce(
      scanResult({
        hiddenLayers: [
          { id: "3:1", name: "Old Banner", type: "FRAME" },
          { id: "3:2", name: "Alt", type: "GROUP" },
        ],
        needsConfirmation: [
          { id: "4:1", name: "Card", type: "FRAME", action: "collapse wrapper", reasons: ["prototype interaction"] },
        ],
        protectedLayers: [{ id: "5:1", name: "Icon", type: "FRAME", reason: "controlled by a component property" }],
      })
    );

    const text = (await call({ dryRun: true })).content[0].text;

    expect(text).toContain('Layer scan — "Hero" (42 layers). Nothing modified.');
    expect(text).toContain("Hidden layers — NOT removed without the user's permission (2):");
    expect(text).toContain('"Old Banner" (frame) [id 3:1]');
    expect(text).toContain('"Card" (frame) [id 4:1] — collapse wrapper: prototype interaction');
    expect(text).toContain('"Icon" (frame) [id 5:1] — controlled by a component property');
    expect(text).toContain('"2 hidden layer(s) were found. Do you want to remove them?"');
    expect(text).toContain('\\"Card\\" has a prototype interaction');
    expect(text).toContain("Then call clean_layers again without dryRun.");
    expect(text).toContain("1 redundant wrappers would be collapsed:");
  });

  it("a scan with nothing to confirm says it can apply directly", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce(scanResult());

    const text = (await call({ dryRun: true })).content[0].text;

    expect(text).toContain("Nothing needs the user's permission");
    expect(text).not.toContain("Do you want to remove them?");
  });

  it("an apply reports confirmed hidden removals and what was kept for confirmation", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      dryRun: false,
      targets: [{ id: "1:1", name: "Hero" }, { id: "1:2", name: "Footer" }],
      frame: { id: "1:1", name: "Hero" },
      layerCountBefore: 50,
      layerCountAfter: 44,
      renamed: [],
      removed: ["Frame 9 (frame)"],
      removedHidden: ["Old Banner (frame)"],
      collapsed: [],
      hiddenLayers: [{ id: "3:2", name: "Alt", type: "GROUP" }],
      needsConfirmation: [
        { id: "4:1", name: "Card", type: "FRAME", action: "remove", reasons: ["export setting"] },
      ],
      protectedLayers: [],
      warnings: [],
    });

    const text = (await call({ confirmedHiddenIds: ["3:1"] })).content[0].text;

    expect(text).toContain('Layer cleanup — 2 layers ("Hero", "Footer"): 50 layers → 44 (6 removed)');
    expect(text).toContain("Removed 1 hidden layers (confirmed by the user):");
    expect(text).toContain("1 hidden layer(s) kept — removal not confirmed.");
    expect(text).toContain('"Card" (frame) [id 4:1] — remove: export setting');
    expect(text).toContain("Ask the user about the layers kept for confirmation");
  });

  const proposal = {
    id: "1:1",
    name: "# Work Process",
    columns: 4,
    headers: ["Text_Container"],
    items: ["Card", "Card", "Card", "Card"],
    itemName: "Card",
    removes: ["Container", "Frame 1", "Frame 2", "Frame 3"],
  };

  it("a scan lists Grid proposals and tells the model to ask before converting", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce(scanResult({ gridCandidates: [proposal] }));

    const text = (await call({ dryRun: true })).content[0].text;

    expect(text).toContain("Grid proposals — converted only with the user's permission (1):");
    expect(text).toContain(
      '"# Work Process" [id 1:1] — 4-column Grid: "Text_Container" spanning all 4 columns, 4 × "Card" ' +
        'directly inside; removes 4 wrapper layer(s) ("Container", "Frame 1", "Frame 2", …)'
    );
    expect(text).toContain('\\"# Work Process\\" can become a 4-column Grid with its items directly inside');
    expect(text).toContain("yes: add 1:1 to confirmedGridIds.");
    expect(text).not.toContain("Nothing needs the user's permission");
  });

  it("passes confirmed Grid IDs and reports conversions and refusals", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockResolvedValueOnce({
      ...scanResult(),
      dryRun: false,
      layerCountBefore: 92,
      layerCountAfter: 79,
      gridCandidates: [],
      gridConverted: [{ ...proposal, removes: ["Container"] }],
      gridSkipped: [{ id: "2:2", name: "# Services", reason: '"Card" would move or resize as a Grid, so the section was left as it was' }],
    });

    const text = (await call({ confirmedGridIds: ["1:1", "2:2"] })).content[0].text;

    expect(mockSendCommand.mock.calls[0][1]).toMatchObject({ confirmedGridIds: ["1:1", "2:2"] });
    expect(text).toContain("Converted to Grid (1):");
    expect(text).toContain('"# Work Process" [id 1:1] — 4-column Grid');
    expect(text).toContain("Grid conversion not applied (1) — left exactly as it was:");
    expect(text).toContain('"# Services" [id 2:2] — "Card" would move or resize as a Grid');
    expect(text).not.toContain("Nothing needed changing");
  });
});
