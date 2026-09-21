import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAssetTools } from "../../src/talk_to_figma_mcp/tools/asset-tools";

jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

jest.mock("../../src/talk_to_figma_mcp/utils/figma-rest", () => ({
  hasFigmaToken: jest.fn(() => false),
  getImageFillUrls: jest.fn(),
  getRenderedImageUrls: jest.fn(),
  downloadAssetBinary: jest.fn(),
}));

const rest = require("../../src/talk_to_figma_mcp/utils/figma-rest");

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

  registerAssetTools(server);

  const mockSendCommand: jest.Mock = require("../../src/talk_to_figma_mcp/utils/websocket").sendCommandToFigma;

  async function call(args: any = {}) {
    mockSendCommand.mockClear();
    return handlers.export_assets(schemas.export_assets.parse(args), { meta: {} });
  }

  return { call, mockSendCommand };
}

const asset = (over: any = {}) => ({
  assetId: "img-hero-a1b2",
  nodeId: "1:10",
  name: "Hero Photo",
  slug: "hero-photo",
  kind: "image",
  mode: "bytes",
  page: "Home",
  rootId: "1:1",
  rootWidth: 1440,
  rendered: { width: 1280, height: 720 },
  layout: "FILL",
  cornerRadius: 16,
  opacity: 1,
  insideInstance: false,
  imageHash: "hash-a",
  scaleMode: "FILL",
  focalPoint: { x: 0.5, y: 0.4 },
  intrinsic: { width: 3200, height: 2000 },
  isBackground: false,
  ...over,
});

/** Reply as the plugin would: scan once, then hand back base64 in slices. */
function respondWith(assets: any[], files: Record<string, { buf: Buffer; ext: string; mime: string }>, chunkSize = 8) {
  return (command: string, params: any) => {
    if (command === "scan_assets") return Promise.resolve({ assets, failures: [], scanned: assets.length });
    if (command === "export_asset_chunk") {
      const file = files[params.assetId];
      if (!file) return Promise.reject(new Error(`no fixture for ${params.assetId}`));
      const b64 = file.buf.toString("base64");
      const total = Math.max(1, Math.ceil(b64.length / chunkSize));
      return Promise.resolve({
        assetId: params.assetId,
        chunkIndex: params.chunkIndex,
        totalChunks: total,
        data: b64.slice(params.chunkIndex * chunkSize, (params.chunkIndex + 1) * chunkSize),
        mimeType: file.mime,
        ext: file.ext,
        byteSize: file.buf.length,
      });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  };
}

describe("export_assets", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-test-"));
    rest.hasFigmaToken.mockReturnValue(false);
    rest.getImageFillUrls.mockReset();
    rest.getRenderedImageUrls.mockReset();
    rest.downloadAssetBinary.mockReset();
  });

  it("reassembles a chunked file byte-for-byte", async () => {
    const { call, mockSendCommand } = makeServer();
    // Deliberately not a round multiple of the chunk size.
    const original = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
    mockSendCommand.mockImplementation(
      respondWith([asset()], { "img-hero-a1b2": { buf: original, ext: "jpg", mime: "image/jpeg" } }, 700)
    );

    const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
    expect(manifest.assets).toHaveLength(1);
    const written = fs.readFileSync(path.join(outDir, manifest.assets[0].file));
    expect(written.equals(original)).toBe(true);
    expect(res.content[0].text).toContain("Exported 1 file(s)");
  });

  it("keeps the real extension instead of assuming PNG", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockImplementation(
      respondWith([asset()], { "img-hero-a1b2": { buf: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ext: "jpg", mime: "image/jpeg" } })
    );

    await call({ rootNodeIds: ["1:1"], outputDir: outDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
    expect(manifest.assets[0].format).toBe("jpg");
    expect(manifest.assets[0].file).toMatch(/\.jpg$/);
  });

  it("stores one file for the same photo placed many times, keeping every usage", async () => {
    const { call, mockSendCommand } = makeServer();
    const placements = [
      asset({ nodeId: "1:10", page: "Home", rootWidth: 1440 }),
      asset({ nodeId: "1:20", page: "Home", rootWidth: 768 }),
      asset({ nodeId: "1:30", page: "About", rootWidth: 375 }),
    ];
    mockSendCommand.mockImplementation(
      respondWith(placements, { "img-hero-a1b2": { buf: Buffer.from("same-photo"), ext: "png", mime: "image/png" } })
    );

    await call({ rootNodeIds: ["1:1"], outputDir: outDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
    expect(manifest.assets).toHaveLength(1);
    // One file, three usages — breakpoints derived from the frame widths.
    expect(manifest.assets[0].nodes.map((n: any) => n.breakpoint)).toEqual(["desktop", "tablet", "mobile"]);
  });

  it("files icons separately from photos", async () => {
    const { call, mockSendCommand } = makeServer();
    const assets = [
      asset(),
      asset({ assetId: "icon-arrow-c3d4", nodeId: "1:40", kind: "icon", mode: "svg", slug: "arrow-right", imageHash: null }),
    ];
    mockSendCommand.mockImplementation(
      respondWith(assets, {
        "img-hero-a1b2": { buf: Buffer.from("photo"), ext: "jpg", mime: "image/jpeg" },
        "icon-arrow-c3d4": { buf: Buffer.from("<svg/>"), ext: "svg", mime: "image/svg+xml" },
      })
    );

    await call({ rootNodeIds: ["1:1"], outputDir: outDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
    const files = manifest.assets.map((a: any) => a.file).sort();
    expect(files[0]).toMatch(/^source\/icons\/icon-arrow-right-.*\.svg$/);
    expect(files[1]).toMatch(/^source\/images\/img-hero-photo-.*\.jpg$/);
  });

  it("reports a failed asset instead of writing a placeholder", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockImplementation((command: string) => {
      if (command === "scan_assets") return Promise.resolve({ assets: [asset()], failures: [], scanned: 1 });
      return Promise.reject(new Error("image not found for hash hash-a"));
    });

    const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });

    expect(res.content[0].text).toContain("MUST be raised with the user");
    expect(res.content[0].text).toContain("image not found");
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
    expect(manifest.failures).toHaveLength(1);
    expect(manifest.assets).toHaveLength(0);
  });

  it("rejects a zero-byte export rather than writing an empty file", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockImplementation(
      respondWith([asset()], { "img-hero-a1b2": { buf: Buffer.alloc(0), ext: "png", mime: "image/png" } })
    );

    const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });
    expect(res.content[0].text).toContain("zero bytes");
  });

  it("refuses a relative outputDir", async () => {
    const { call } = makeServer();
    const res = await call({ rootNodeIds: ["1:1"], outputDir: "assets" });
    expect(res.content[0].text).toContain("must be an absolute path");
  });

  it("says why nothing was found instead of reporting success", async () => {
    const { call, mockSendCommand } = makeServer();
    mockSendCommand.mockImplementation(() => Promise.resolve({ assets: [], failures: [], scanned: 120 }));

    const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });
    expect(res.content[0].text).toContain("No assets found");
    expect(res.content[0].text).toContain('fills[].type === "IMAGE"');
  });

  describe("REST fallback", () => {
    /** The plugin refuses; REST must quietly rescue the asset. */
    function pluginRefuses() {
      const { call, mockSendCommand } = makeServer();
      mockSendCommand.mockImplementation((command: string) => {
        if (command === "scan_assets") return Promise.resolve({ assets: [asset()], failures: [], scanned: 1 });
        if (command === "get_file_key") return Promise.resolve({ fileKey: "FILEKEY123" });
        return Promise.reject(new Error("export timed out"));
      });
      return { call, mockSendCommand };
    }

    it("rescues an asset the plugin could not export", async () => {
      const { call } = pluginRefuses();
      rest.hasFigmaToken.mockReturnValue(true);
      rest.getImageFillUrls.mockResolvedValue({ "hash-a": "https://figma-alpha.s3/img.jpg" });
      rest.downloadAssetBinary.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));

      const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });

      expect(res.content[0].text).toContain("REST fallback rescued 1 asset");
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
      expect(manifest.assets).toHaveLength(1);
      // Extension comes from the bytes, not from the request.
      expect(manifest.assets[0].format).toBe("jpg");
      expect(manifest.failures).toHaveLength(0);
    });

    it("resolves the file key from the plugin when none is passed", async () => {
      const { call } = pluginRefuses();
      rest.hasFigmaToken.mockReturnValue(true);
      rest.getImageFillUrls.mockResolvedValue({ "hash-a": "https://cdn/img.png" });
      rest.downloadAssetBinary.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      await call({ rootNodeIds: ["1:1"], outputDir: outDir });
      expect(rest.getImageFillUrls).toHaveBeenCalledWith("FILEKEY123");
    });

    it("renders through /v1/images for a node with no image hash", async () => {
      const { call, mockSendCommand } = makeServer();
      mockSendCommand.mockImplementation((command: string) => {
        if (command === "scan_assets")
          return Promise.resolve({
            assets: [asset({ assetId: "icon-a", kind: "icon", mode: "svg", slug: "arrow", imageHash: null })],
            failures: [],
            scanned: 1,
          });
        return Promise.reject(new Error("sandbox refused"));
      });
      rest.hasFigmaToken.mockReturnValue(true);
      rest.getRenderedImageUrls.mockResolvedValue({ "1:10": "https://cdn/arrow.svg" });
      rest.downloadAssetBinary.mockResolvedValue(Buffer.from("<svg xmlns='x'/>"));

      await call({ rootNodeIds: ["1:1"], outputDir: outDir, fileKey: "K" });

      expect(rest.getRenderedImageUrls).toHaveBeenCalledWith("K", ["1:10"], "svg", 2);
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
      expect(manifest.assets[0].file).toMatch(/\.svg$/);
    });

    it("reports both failures when REST cannot rescue either", async () => {
      const { call } = pluginRefuses();
      rest.hasFigmaToken.mockReturnValue(true);
      rest.getImageFillUrls.mockResolvedValue({});

      const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });
      expect(res.content[0].text).toContain("plugin: export timed out");
      expect(res.content[0].text).toContain("REST: no REST url for image hash hash-a");
    });

    it("explains that no token is set rather than failing silently", async () => {
      const { call } = pluginRefuses();
      rest.hasFigmaToken.mockReturnValue(false);

      const res = await call({ rootNodeIds: ["1:1"], outputDir: outDir });
      expect(res.content[0].text).toContain("FIGMA_ACCESS_TOKEN is not set");
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.manifest.json"), "utf8"));
      expect(manifest.restFallbackAvailable).toBe(false);
    });

    it("never sends the access token to the asset CDN", async () => {
      const { call } = pluginRefuses();
      rest.hasFigmaToken.mockReturnValue(true);
      rest.getImageFillUrls.mockResolvedValue({ "hash-a": "https://cdn/img.png" });
      rest.downloadAssetBinary.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      await call({ rootNodeIds: ["1:1"], outputDir: outDir });

      // The CDN url is pre-signed; it takes a url and nothing else.
      expect(rest.downloadAssetBinary).toHaveBeenCalledWith("https://cdn/img.png");
      expect(rest.downloadAssetBinary.mock.calls[0]).toHaveLength(1);
    });
  });
});
