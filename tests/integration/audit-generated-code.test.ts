import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuditTools } from "../../src/talk_to_figma_mcp/tools/audit-tools";

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

  registerAuditTools(server);

  return async function call(args: any) {
    const res = await handlers.audit_generated_code(schemas.audit_generated_code.parse(args), { meta: {} });
    return res.content[0].text as string;
  };
}

/** Build a small generated project on disk. */
function project(files: Record<string, string>, binaries: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, "utf8");
  }
  for (const rel of binaries) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  return dir;
}

const manifest = (files: string[]) =>
  JSON.stringify({ assets: files.map((f, i) => ({ id: `a${i}`, file: f, kind: "image", nodes: [] })) });

describe("audit_generated_code", () => {
  it("passes a project whose images all resolve", async () => {
    const call = makeServer();
    const dir = project(
      {
        "index.html": `<img src="assets/hero.png" alt="Team"><div style="background:url('assets/bg.png')"></div>`,
        "assets/assets.manifest.json": manifest(["hero.png", "bg.png"]),
      },
      ["assets/hero.png", "assets/bg.png"]
    );

    const out = await call({ projectDir: dir });
    expect(out).toContain("AUDIT PASSED");
    expect(out).toContain("PASS  Every image path resolves");
  });

  it("catches a placeholder service", async () => {
    const call = makeServer();
    const dir = project({ "index.html": `<img src="https://placehold.co/600x400" alt="x">` });

    const out = await call({ projectDir: dir });
    expect(out).toContain("AUDIT FAILED");
    expect(out).toContain("placehold.co");
    expect(out).toContain("index.html:1");
  });

  it("catches lorem ipsum and an empty src", async () => {
    const call = makeServer();
    const dir = project({ "page.html": `<p>Lorem ipsum dolor sit</p>\n<img src="">` });

    const out = await call({ projectDir: dir });
    expect(out).toContain("lorem ipsum");
    expect(out).toContain("empty src");
  });

  it("catches an image path that points at nothing", async () => {
    const call = makeServer();
    const dir = project({ "index.html": `<img src="assets/missing.png">` }, []);

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Every image path resolves");
    expect(out).toContain("assets/missing.png");
  });

  it("resolves a root-relative path against public/", async () => {
    const call = makeServer();
    const dir = project({ "src/app/page.tsx": `<img src="/assets/hero.png" />` }, ["public/assets/hero.png"]);

    const out = await call({ projectDir: dir });
    expect(out).toContain("PASS  Every image path resolves");
  });

  it("flags an exported asset the code never uses", async () => {
    const call = makeServer();
    const dir = project(
      {
        "index.html": `<img src="assets/hero.png">`,
        "assets/assets.manifest.json": manifest(["hero.png", "source/images/orphan.jpg"]),
      },
      ["assets/hero.png"]
    );

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Every exported asset is referenced");
    expect(out).toContain("orphan.jpg");
  });

  it("ignores remote, data and templated references", async () => {
    const call = makeServer();
    const dir = project({
      "index.html":
        `<img src="https://cdn.example.com/a.png">` +
        `<img src="data:image/png;base64,iVBOR">` +
        "<img src={`/assets/${name}.png`}>",
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("PASS  Every image path resolves");
  });

  it("flags raw hex in a component but not in the token file", async () => {
    const call = makeServer();
    const dir = project({
      "src/components/Button.tsx": `export const B = () => <button style={{ color: "#ff0055" }} />;`,
      "src/styles/tokens.css": `:root { --color-primary: #ff0055; }`,
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  No raw hex/px in component code");
    expect(out).toContain("Button.tsx");
    expect(out).not.toContain("tokens.css");
  });

  it("flags arbitrary Tailwind values", async () => {
    const call = makeServer();
    const dir = project({ "src/Card.tsx": `<div className="bg-[#1a2b3c] p-[13px]" />` });

    const out = await call({ projectDir: dir });
    expect(out).toContain("arbitrary Tailwind");
  });

  it("can be told to skip the token check", async () => {
    const call = makeServer();
    const dir = project({ "src/Card.tsx": `<div style={{ color: "#abcdef" }} />` });

    const out = await call({ projectDir: dir, checkTokens: false });
    expect(out).not.toContain("raw hex");
    expect(out).toContain("AUDIT PASSED");
  });

  it("does not walk node_modules", async () => {
    const call = makeServer();
    const dir = project({
      "index.html": `<p>fine</p>`,
      "node_modules/pkg/demo.html": `<img src="https://placehold.co/1x1">`,
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("AUDIT PASSED");
  });

  it("says the manifest is missing rather than claiming coverage", async () => {
    const call = makeServer();
    const dir = project({ "index.html": `<p>hi</p>` });

    const out = await call({ projectDir: dir });
    expect(out).toContain("UNVERIFIED");
    expect(out).toContain("run export_assets first");
  });

  it("refuses a relative or absent projectDir", async () => {
    const call = makeServer();
    expect(await call({ projectDir: "out" })).toContain("must be an absolute path");
    expect(await call({ projectDir: "/nope/does/not/exist" })).toContain("does not exist");
  });
});
