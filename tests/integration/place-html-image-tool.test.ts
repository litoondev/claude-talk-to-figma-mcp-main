/**
 * place_html_image: the server gets an image's bytes (URL, local file next to the
 * imported page, or data: URI) and places them through set_image — so images from
 * any host and from local .html imports can be placed.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHtmlImportTools, detectImageType } from "../../src/talk_to_figma_mcp/tools/html-import-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

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
  registerHtmlImportTools(server);
  const send: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;
  const call = async (args: any) => {
    send.mockReset();
    send.mockResolvedValue({ name: "Img-Logo" });
    const res = await handlers.place_html_image(schemas.place_html_image.parse(args), { meta: {} });
    return res.content[0].text as string;
  };
  return { call, send };
}

let dir: string;
let page: string;
let outside: string;
const realFetch = global.fetch;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "html-import-"));
  page = path.join(dir, "index.html");
  fs.writeFileSync(page, "<html></html>");
  fs.mkdirSync(path.join(dir, "img"));
  fs.writeFileSync(path.join(dir, "img", "logo.png"), PNG);
  fs.writeFileSync(path.join(dir, "img", "icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  outside = path.join(os.tmpdir(), `outside-${process.pid}.png`);
  fs.writeFileSync(outside, PNG);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
  global.fetch = realFetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("place_html_image", () => {
  it("reads an image next to the imported page and sends its bytes through set_image", async () => {
    const { call, send } = makeServer();

    const text = await call({ nodeId: "1:1", source: path.join(dir, "img", "logo.png"), pageSource: page });

    expect(send).toHaveBeenCalledWith(
      "set_image",
      { nodeId: "1:1", imageData: Buffer.from(PNG).toString("base64"), scaleMode: "FILL" },
      60000
    );
    expect(text).toMatch(/^Placed PNG image \(0 KB, FILL\) on "Img-Logo" from .*logo\.png\.$/);
  });

  it("downloads a URL on the server, whatever host the plugin is allowed to reach", async () => {
    const { call, send } = makeServer();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    })) as any;

    const text = await call({ nodeId: "1:2", source: "https://cdn.example.com/hero.png", scaleMode: "FIT" });

    expect(send.mock.calls[0][1]).toMatchObject({ nodeId: "1:2", scaleMode: "FIT" });
    expect(text).toContain("from https://cdn.example.com/hero.png.");
  });

  it("decodes a base64 data: URI", async () => {
    const { call, send } = makeServer();
    await call({ nodeId: "1:3", source: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses a file outside the imported page's folder", async () => {
    const { call, send } = makeServer();
    const text = await call({ nodeId: "1:1", source: outside, pageSource: page });
    expect(text).toContain("is outside the folder of index.html");
    expect(send).not.toHaveBeenCalled();
  });

  it("requires pageSource for a file path, and an image extension", async () => {
    const { call, send } = makeServer();
    expect(await call({ nodeId: "1:1", source: path.join(dir, "img", "logo.png") })).toContain("pageSource must be");
    expect(await call({ nodeId: "1:1", source: path.join(dir, "index.html"), pageSource: page })).toContain("is not a .png, .jpg, .gif or .webp image");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an SVG and points to set_svg", async () => {
    const { call, send } = makeServer();
    const text = await call({ nodeId: "1:1", source: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E" });
    expect(text).toContain("Use set_svg with its markup instead.");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an image over the plugin's 5 MB limit before sending it", async () => {
    const { call, send } = makeServer();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from(PNG).copy(big);
    const text = await call({ nodeId: "1:1", source: `data:image/png;base64,${big.toString("base64")}` });
    expect(text).toContain("Figma plugins accept up to 5 MB");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a failed download", async () => {
    const { call } = makeServer();
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } })) as any;
    expect(await call({ nodeId: "1:1", source: "https://example.com/missing.png" })).toContain("returned HTTP 404");
  });
});

describe("detectImageType", () => {
  it("reads the format from the bytes", () => {
    expect(detectImageType(PNG)).toBe("png");
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectImageType(new Uint8Array(Buffer.from("GIF89a")))).toBe("gif");
    expect(detectImageType(new Uint8Array(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")))).toBe("webp");
    expect(detectImageType(new Uint8Array(Buffer.from('<?xml version="1.0"?><svg></svg>')))).toBe("svg");
    expect(detectImageType(new Uint8Array(Buffer.from("hello")))).toBeNull();
  });
});
