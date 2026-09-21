import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStructureTools } from "../../src/talk_to_figma_mcp/tools/structure-tools";

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

  registerStructureTools(server);

  return async function call(args: any) {
    const res = await handlers.audit_structure_match(schemas.audit_structure_match.parse(args), { meta: {} });
    return res.content[0].text as string;
  };
}

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-test-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, "utf8");
  }
  return dir;
}

/** One page, one Hero frame with a heading — the shape every case varies from. */
const heroTree = () => [
  {
    id: "1:1",
    name: "Hero",
    slug: "hero",
    type: "FRAME",
    layout: { mode: "VERTICAL", gap: 16, sizingHorizontal: "FILL", sizingVertical: "HUG" },
    children: [
      { id: "1:2", name: "Title", slug: "title", type: "TEXT", text: "Welcome home" },
      { id: "1:3", name: "Body", slug: "body", type: "TEXT", text: "We build things." },
    ],
  },
];

const contract = (tree: unknown = heroTree(), route = "/") =>
  JSON.stringify({ pages: [{ name: "Home", route, tree }] });

const page = (body: string, css = ".hero{display:flex;flex-direction:column;gap:16px}") =>
  `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;

const goodBody = `<section class="hero"><h1 class="title">Welcome home</h1><p class="body">We build things.</p></section>`;

describe("audit_structure_match", () => {
  it("passes output that mirrors the contract", async () => {
    const call = makeServer();
    const dir = project({ "design-contract.json": contract(), "index.html": page(goodBody) });

    const out = await call({ projectDir: dir });
    expect(out).toContain("STRUCTURE AUDIT PASSED");
    expect(out).toContain("3 nodes in contract, 3 built, 0 invented");
  });

  it("catches a node the output dropped", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(`<section class="hero"><h1 class="title">Welcome home</h1></section>`),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Every contract node is present");
    expect(out).toContain("Body [1:3]");
  });

  it("catches markup with no node behind it", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(`${goodBody}<footer class="extra"><p>Added by the model</p></footer>`),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Nothing in the output is absent from the contract");
    expect(out).toContain("<footer.extra>");
  });

  it("catches children that changed order", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(`<section class="hero"><p class="body">We build things.</p><h1 class="title">Welcome home</h1></section>`),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Children keep Figma's order and nesting");
    expect(out).toContain("child #1 in Figma and #2 in the output");
  });

  it("catches a fixed height on a frame that hugs its content", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(goodBody, ".hero{display:flex;flex-direction:column;gap:16px;height:252px}"),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  HUG / FILL / FIXED sizing is preserved");
    expect(out).toContain("pins height: 252px");
  });

  it("accepts content-driven heights on a hugging frame", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(goodBody, ".hero{display:flex;flex-direction:column;gap:16px;height:auto;width:100%}"),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("PASS  HUG / FILL / FIXED sizing is preserved");
  });

  it("catches a FILL frame pinned to a fixed width", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(goodBody, ".hero{display:flex;flex-direction:column;gap:16px;width:1200px}"),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("pins width: 1200px");
  });

  it("catches a vertical Figma frame laid out as a row", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(goodBody, ".hero{display:flex;flex-direction:row;gap:16px}"),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Layout mode, gap and padding match");
    expect(out).toContain("VERTICAL in Figma; the output is flex-direction: row");
  });

  it("catches a gap that does not match Figma", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(goodBody, ".hero{display:flex;flex-direction:column;gap:40px}"),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("gap is 16 in Figma and 40 in the output");
  });

  it("catches rewritten copy", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(`<section class="hero"><h1 class="title">Welcome to our home</h1><p class="body">We build things.</p></section>`),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("FAIL  Text is verbatim");
    expect(out).toContain("Welcome home");
  });

  it("does not flag smart quotes as a rewrite", async () => {
    const call = makeServer();
    const tree: any = heroTree();
    tree[0].children[1].text = "We don't guess.";
    const dir = project({
      "design-contract.json": contract(tree),
      "index.html": page(`<section class="hero"><h1 class="title">Welcome home</h1><p class="body">We don’t guess.</p></section>`),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("PASS  Text is verbatim");
  });

  it("reads through an anonymous wrapper but not a named frame", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(`<div><section class="hero"><h1 class="title">Welcome home</h1><p class="body">We build things.</p></section></div>`),
    });

    const out = await call({ projectDir: dir });
    expect(out).toContain("STRUCTURE AUDIT PASSED");
    expect(out).toContain("Transparent wrappers passed through");
  });

  it("matches on data-fig-id ahead of position", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "index.html": page(
        `<section data-fig-id="1:1" class="hero"><p data-fig-id="1:3" class="body">We build things.</p>` +
          `<h1 data-fig-id="1:2" class="title">Welcome home</h1></section>`
      ),
    });

    const out = await call({ projectDir: dir });
    // Anchored by id, so the copy is compared against the right node; the swap
    // itself is still reported as drift.
    expect(out).toContain("PASS  Text is verbatim");
    expect(out).toContain("FAIL  Children keep Figma's order and nesting");
  });

  it("uses a DOM snapshot when one is given", async () => {
    const call = makeServer();
    const dir = project({
      "design-contract.json": contract(),
      "snapshot.json": JSON.stringify({
        pages: [
          {
            route: "/",
            root: {
              tag: "section",
              classes: ["hero"],
              styles: { display: "flex", "flex-direction": "column", gap: "16px", height: "252px" },
              children: [
                { tag: "h1", classes: ["title"], text: "Welcome home", styles: {} },
                { tag: "p", classes: ["body"], text: "We build things.", styles: {} },
              ],
            },
          },
        ],
      }),
    });

    const out = await call({ projectDir: dir, domSnapshotPath: path.join(dir, "snapshot.json") });
    expect(out).toContain("DOM snapshot (/)");
    expect(out).toContain("pins height: 252px");
  });

  it("reports UNVERIFIED rather than PASS when a page has no readable output", async () => {
    const call = makeServer();
    const dir = project({ "design-contract.json": contract(), "src/app/page.tsx": `export default () => <div/>;` });

    const out = await call({ projectDir: dir });
    expect(out).toContain("UNVERIFIED");
    expect(out).toContain("pass domSnapshotPath");
    expect(out).not.toContain("STRUCTURE AUDIT PASSED");
  });

  it("reports UNVERIFIED when the contract carries no tree", async () => {
    const call = makeServer();
    const dir = project({ "design-contract.json": JSON.stringify({ pages: [{ route: "/", tree: [] }] }) });

    const out = await call({ projectDir: dir });
    expect(out).toContain("UNVERIFIED  Structure");
    expect(out).toContain('empty "tree"');
  });

  it("says so when there is no contract at all", async () => {
    const call = makeServer();
    const dir = project({ "index.html": page(goodBody) });

    const out = await call({ projectDir: dir });
    expect(out).toContain("No design contract at");
    expect(out).toContain("UNVERIFIED");
  });

  it("refuses a relative or absent projectDir", async () => {
    const call = makeServer();
    expect(await call({ projectDir: "out" })).toContain("must be an absolute path");
    expect(await call({ projectDir: "/nope/does/not/exist" })).toContain("does not exist");
  });
});
