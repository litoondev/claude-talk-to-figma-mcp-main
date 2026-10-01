/**
 * browser_* tools: what reaches the extension, what is saved, what the model
 * gets back, and how failures read. The extension is mocked at the socket
 * boundary; its reply is a real capture produced in Chrome.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBrowserCaptureTools } from "../../src/talk_to_figma_mcp/tools/browser-capture-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  sendCommandToBrowser: jest.fn(),
  sendCommandToFigma: jest.fn(),
}));

const FIXTURE = path.join(__dirname, "..", "fixtures", "browser-capture", "page.capture.json");
const capture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

function makeServer() {
  const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
  const handlers: Record<string, Function> = {};
  const schemas: Record<string, z.ZodObject<any>> = {};
  const originalTool = server.tool.bind(server);
  jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
    const [name, , schema, handler] = args;
    handlers[name] = handler;
    schemas[name] = z.object(schema);
    return (originalTool as any)(...args);
  });
  registerBrowserCaptureTools(server);
  const send: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToBrowser;
  const figma: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;
  const call = async (name: string, args: any = {}) => {
    const res = await handlers[name](schemas[name].parse(args), { meta: {} });
    return res.content[0].text as string;
  };
  return { call, send, figma };
}

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-tools-")); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("browser_capture", () => {
  it("asks the extension with the caller's options and a timeout inside the relay's 120 s", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockResolvedValue(capture);
    const saveTo = path.join(dir, "a.json");
    await call("browser_capture", { scope: "selector", selector: "#features", maxNodes: 800, autoScroll: "false", saveTo });
    const [command, params, timeout] = send.mock.calls[0];
    expect(command).toBe("browser_capture");
    expect(params).toMatchObject({ scope: "selector", selector: "#features", maxNodes: 800, autoScroll: false });
    expect(timeout).toBeLessThan(120_000);
  });

  it("saves the full capture and returns the summary pointing at it", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockResolvedValue(capture);
    const saveTo = path.join(dir, "nested", "b.json");
    const text = await call("browser_capture", { saveTo });
    expect(JSON.parse(fs.readFileSync(saveTo, "utf8")).nodes).toHaveLength(capture.nodes.length);
    expect(text).toContain(`Saved: ${saveTo}`);
    expect(text).toContain("OUTLINE");
    expect(text).toContain('"colors":[');
  });

  it("refuses bad arguments before bothering the browser", async () => {
    const { call, send } = makeServer();
    send.mockReset();
    expect(await call("browser_capture", { scope: "selector" })).toMatch(/needs a selector/);
    expect(await call("browser_capture", { url: "javascript:alert(1)" })).toMatch(/must be http\(s\)/);
    expect(await call("browser_capture", { saveTo: "relative.json" })).toMatch(/absolute path/);
    expect(send).not.toHaveBeenCalled();
  });

  it("passes the extension's own error through with how to connect", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockRejectedValue(new Error("No Web-to-Figma browser extension connected to this channel"));
    const text = await call("browser_capture", {});
    expect(text).toContain("No Web-to-Figma browser extension connected");
    expect(text).toContain("same channel ID");
  });

  it("survives a rejection that is not an Error (L6)", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockRejectedValue(undefined);
    const text = await call("browser_capture", {});
    expect(text).toMatch(/^Error capturing the page in the browser/);
  });

  it("rejects a reply that is not a capture instead of saving junk", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockResolvedValue({ hello: "world" });
    const saveTo = path.join(dir, "junk.json");
    const text = await call("browser_capture", { saveTo });
    expect(text).toMatch(/Not a Web-to-Figma capture/);
    expect(fs.existsSync(saveTo)).toBe(false);
  });
});

describe("browser_capture_nodes", () => {
  it("reads a subtree of a saved capture", async () => {
    const { call } = makeServer();
    const file = path.join(dir, "c.json");
    fs.writeFileSync(file, JSON.stringify(capture));
    const grid = capture.nodes.find((n: any) => n.attrs?.id === "features");
    const text = await call("browser_capture_nodes", { path: file, nodeId: grid.id, depth: 1 });
    expect(text.split("\n")[0]).toMatch(new RegExp(`^${grid.id} section#features\\.grid`));
    expect(text).toContain("::before");
  });

  it("explains a missing or relative path", async () => {
    const { call } = makeServer();
    expect(await call("browser_capture_nodes", { path: path.join(dir, "missing.json") })).toMatch(/No capture file at/);
    expect(await call("browser_capture_nodes", { path: "x.json" })).toMatch(/must be absolute/);
  });
});

describe("browser_status and browser_pick", () => {
  it("status reports the extension's answer, or how to connect", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockResolvedValue({ extension: "Web-to-Figma", activeTab: { url: "https://a.b" } });
    expect(await call("browser_status")).toContain("https://a.b");
    send.mockReset().mockRejectedValue(new Error("Request to Figma timed out"));
    expect(await call("browser_status")).toContain("browser_extension/");
  });

  it("pick waits longer than the user is given to click", async () => {
    const { call, send } = makeServer();
    send.mockReset().mockResolvedValue({ label: "section#features" });
    const text = await call("browser_pick", { timeoutSec: 30 });
    expect(send.mock.calls[0][1]).toEqual({ timeoutSec: 30 });
    expect(send.mock.calls[0][2]).toBeGreaterThan(30_000);
    expect(text).toContain('scope "selection"');
  });
});

describe("browser_capture_to_figma", () => {
  const importResult = {
    rootId: "10:1", rootName: "Page-CaptureFixture", width: 1265, height: 2100, sourceHeight: 2110.8,
    created: { frames: 11, texts: 12, images: 1, svgs: 1, autoLayouts: 10, grids: 1, absoluteContainers: 0 },
    remap: {
      colors: { bound: 5, unmatched: [{ value: "#f97316", count: 2 }] },
      textStyles: { applied: 3, unmatched: [] },
      spacing: { bound: 4, unmatched: [{ value: "18.8", count: 3 }] },
      radius: { bound: 1, unmatched: [] },
    },
    fonts: { substituted: [{ from: "Helvetica Neue", to: "Inter" }] },
    images: [
      { nodeId: "10:5", src: "https://x.test/a.webp", scaleMode: "FILL", width: 100, height: 50 },
      { nodeId: "10:6", src: "https://x.test/a.webp", scaleMode: "FILL", width: 100, height: 50 },
      { nodeId: "10:7", src: "https://x.test/logo.svg", svg: true },
    ],
    warnings: ["3 ::before/::after decorations were not built"],
    elapsedMs: 1200,
  };

  it("captures, sends the capture straight to the plugin, then fills images through the extension", async () => {
    const { call, send, figma } = makeServer();
    send.mockReset().mockImplementation(async (command: string, params: any) => {
      if (command === "browser_capture") return capture;
      if (command === "browser_fetch_images") {
        return { images: params.images.map((i: any) => (i.src.endsWith(".svg") ? { src: i.src, ok: true, kind: "svg", svg: "<svg/>" } : { src: i.src, ok: true, kind: "image", base64: "iVBORw0KGgo=" })) };
      }
      throw new Error("unexpected " + command);
    });
    figma.mockReset().mockImplementation(async (command: string, params: any) => {
      if (command !== "execute_code") throw new Error("unexpected " + command);
      const p = params.params;
      if (p.op === "import") return { success: true, result: JSON.stringify(importResult) };
      if (p.op === "place") return { success: true, result: JSON.stringify({ placed: p.items.length, failed: [] }) };
      throw new Error("unexpected op " + p.op);
    });

    const text = await call("browser_capture_to_figma", { scope: "selector", selector: "#features", parentId: "1:2" });
    // Laid out at the Desktop breakpoint unless told otherwise, whatever the window size.
    expect(send.mock.calls.find((c) => c[0] === "browser_capture")![1].width).toBe(1440);

    const [, execParams] = figma.mock.calls.find((c) => c[0] === "execute_code" && c[1].params.op === "import")!;
    // The importer travels with the call; the plugin needs no code of its own for it.
    expect(execParams.code).toContain("async function __w2fEntry");
    const importParams = execParams.params;
    expect(importParams.parentId).toBe("1:2");
    expect(importParams.remap).toBe(true);
    expect(importParams.capture.nodes).toHaveLength(capture.nodes.length);
    // tokens and motion lists stay on disk; the plugin gets only what it builds from
    expect(importParams.capture.tokens).toBeUndefined();
    expect(importParams.capture.cssVariables).toBeUndefined();
    // one fetch per unique source, both placeholders filled
    const fetched = send.mock.calls.find((c) => c[0] === "browser_fetch_images")![1].images.map((i: any) => i.src);
    expect(fetched).toEqual(["https://x.test/a.webp", "https://x.test/logo.svg"]);
    const placed = figma.mock.calls.find((c) => c[0] === "execute_code" && c[1].params.op === "place")![1].params.items;
    expect(placed.map((i: any) => i.nodeId).sort()).toEqual(["10:5", "10:6", "10:7"]);
    expect(placed.find((i: any) => i.nodeId === "10:7").svg).toBe("<svg/>");

    expect(text).toContain('Built "Page-CaptureFixture" (10:1)');
    expect(text).toContain("10 Auto Layout, 1 Grid");
    expect(text).toContain("Images: 3 placed via browser extension");
    expect(text).toContain("not in your system — colours: #f97316×2");
    expect(text).toContain("Helvetica Neue → Inter");
    expect(text).toContain("CLAUDE.md §4");
  });

  it("imports a saved capture without the browser, and keeps the path in errors", async () => {
    const { call, send, figma } = makeServer();
    const file = path.join(dir, "saved.json");
    fs.writeFileSync(file, JSON.stringify(capture));
    send.mockReset();
    figma.mockReset().mockRejectedValue(new Error("No Figma plugin connected to this channel"));
    const text = await call("browser_capture_to_figma", { path: file });
    expect(send).not.toHaveBeenCalled();
    expect(text).toContain(`capture saved at ${file}`);
    expect(text).toContain("No Figma plugin connected");
  });

  it("reports images that failed without failing the import", async () => {
    const { call, send, figma } = makeServer();
    send.mockReset().mockImplementation(async (command: string, params: any) => {
      if (command === "browser_capture") return capture;
      return { images: params.images.map((i: any) => ({ src: i.src, ok: false, error: "HTTP 403" })) };
    });
    figma.mockReset().mockImplementation(async (_c: string, params: any) => ({
      success: true,
      result: JSON.stringify(params.params.op === "import" ? importResult : { placed: 0, failed: [] }),
    }));
    const text = await call("browser_capture_to_figma", {});
    expect(text).toContain("Built");
    expect(text).toMatch(/Images: 0 placed via browser extension, 2 failed/);
    expect(text).toContain("HTTP 403");
  });
});
