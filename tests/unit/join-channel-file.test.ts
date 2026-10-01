/**
 * join_channel says which file Claude is editing, and that no link is needed.
 *
 * A real session joined the channel, then asked the user to share the Figma
 * file with "can edit" and paste the link before it would build — the flow of
 * Figma's own connector, which was also loaded. The plugin needs neither: it
 * edits the file it runs in, and Figma only runs plugins where the user can
 * edit. These tests hold the three places that now say so.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
}));
jest.mock("../../src/talk_to_figma_mcp/skills/integration", () => ({
  catalogueSummary: () => "",
}));

import { registerDocumentTools } from "../../src/talk_to_figma_mcp/tools/document-tools";
import { SERVER_INSTRUCTIONS } from "../../src/talk_to_figma_mcp/config/instructions";

function joinTool() {
  const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } });
  const handlers: Record<string, Function> = {};
  const schemas: Record<string, z.ZodObject<any>> = {};
  const original = server.tool.bind(server);
  jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
    const name = args[0];
    handlers[name] = args[args.length - 1];
    if (args.length === 4) schemas[name] = z.object(args[2]);
    return (original as any)(...args);
  });
  registerDocumentTools(server);
  const ws = require("../../src/talk_to_figma_mcp/utils/websocket");
  return {
    ws,
    join: async (channel: string) => {
      const res = await handlers.join_channel(schemas.join_channel.parse({ channel }), { meta: {} });
      return res.content[0].text as string;
    },
  };
}

describe("join_channel", () => {
  it("names the connected file and page, and rules out asking for a link", async () => {
    const { ws, join } = joinTool();
    ws.joinChannel.mockResolvedValue(undefined);
    ws.sendCommandToFigma.mockReset().mockResolvedValue({ fileName: "Demo", name: "Home", editorType: "figma" });
    const text = await join("v43av860");
    expect(text).toContain("Successfully joined channel: v43av860");
    expect(text).toContain('Connected to "Demo", page "Home".');
    expect(text).toMatch(/Do NOT ask the user for a Figma link, a share link or "can edit" permission/);
    expect(ws.sendCommandToFigma).toHaveBeenCalledWith("get_document_info", {}, 8000);
  });

  it("stays a successful join when the plugin does not answer in time (L12)", async () => {
    const { ws, join } = joinTool();
    ws.joinChannel.mockResolvedValue(undefined);
    ws.sendCommandToFigma.mockReset().mockRejectedValue(undefined); // rejects the way Figma can (L6)
    const text = await join("v43av860");
    expect(text).toContain("Successfully joined channel: v43av860");
    expect(text).toContain("did not report its file yet");
    expect(text).toContain("Do NOT ask the user for a Figma link");
    expect(text).not.toMatch(/Error|OFFLINE/);
  });

  it("works with a plugin that predates fileName", async () => {
    const { ws, join } = joinTool();
    ws.joinChannel.mockResolvedValue(undefined);
    ws.sendCommandToFigma.mockReset().mockResolvedValue({ name: "Page 1" });
    expect(await join("c")).toContain('Connected to the file open in Figma, page "Page 1".');
  });
});

describe("join_channel without a channel ID", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const status = (rows: any[]) => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ channelClients: rows }) }) as any;
  };

  it("joins the only channel holding the Figma plugin, also for 'ws://localhost:3055'", async () => {
    const { ws, join } = joinTool();
    ws.joinChannel.mockReset().mockResolvedValue(undefined);
    ws.sendCommandToFigma.mockReset().mockResolvedValue({ fileName: "Demo", name: "Home" });
    status([{ channel: "ru98imtq", figma: 1, browser: 1, agents: 0, other: 0 }, { channel: "idle", figma: 0, browser: 0, agents: 1, other: 0 }]);
    expect(await join("ws://localhost:3055")).toContain("Successfully joined channel: ru98imtq");
    expect(ws.joinChannel).toHaveBeenCalledWith("ru98imtq");
  });

  it("prefers the channel that also has the browser extension", async () => {
    const { ws, join } = joinTool();
    ws.joinChannel.mockReset().mockResolvedValue(undefined);
    ws.sendCommandToFigma.mockReset().mockResolvedValue({});
    status([{ channel: "a", figma: 1, browser: 0, agents: 0, other: 0 }, { channel: "b", figma: 1, browser: 1, agents: 0, other: 0 }]);
    await join("");
    expect(ws.joinChannel).toHaveBeenCalledWith("b");
  });

  it("asks when it is ambiguous, and names the channels", async () => {
    const { ws, join } = joinTool();
    ws.joinChannel.mockReset();
    status([{ channel: "a", figma: 1, browser: 0, agents: 0, other: 0 }, { channel: "b", figma: 1, browser: 0, agents: 0, other: 0 }]);
    const text = await join("");
    expect(text).toMatch(/Several channels have a Figma plugin: a, b/);
    expect(ws.joinChannel).not.toHaveBeenCalled();
  });

  it("says what to do when no plugin or no relay is there", async () => {
    const { join } = joinTool();
    status([{ channel: "x", figma: 0, browser: 0, agents: 1, other: 0 }]);
    expect(await join("")).toContain("No Figma plugin is connected to the relay");
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;
    expect(await join("")).toMatch(/Could not reach the relay.*npm run socket/);
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ status: "running" }) }) as any;
    expect(await join("")).toContain("older build");
  });
});

describe("server instructions", () => {
  it("forbid the share-link detour and switching connectors", () => {
    expect(SERVER_INSTRUCTIONS).toContain("## 0. Where Your Edits Go (MANDATORY)");
    expect(SERVER_INSTRUCTIONS).toMatch(/NEVER ask the user for a Figma link, a share link, or "can edit" permission/);
    expect(SERVER_INSTRUCTIONS).toMatch(/NEVER switch to another Figma connector/);
  });
});
