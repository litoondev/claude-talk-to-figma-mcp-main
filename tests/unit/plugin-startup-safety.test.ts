/**
 * The Figma plugin must open, whatever the web import does.
 *
 * Releases that put the importer inside code.js coincided with "An error
 * occurred while running this plugin" in Figma, with no console output to say
 * why. The importer now lives in src/web_import/runtime.js and is sent with
 * each import through the plugin's existing execute_code command. These tests
 * hold that arrangement:
 *
 *  - code.js carries none of the importer, and evaluates in QuickJS (the engine
 *    family Figma's sandbox is built on).
 *  - The runtime compiles as an execute_code body and runs through the real
 *    executeCode, end to end, against the plugin harness.
 *  - The copies the callers load are the same as the source.
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { loadPlugin } from "../fixtures/figma-plugin-harness";

const ROOT = path.join(__dirname, "..", "..");
const CODE = path.join(ROOT, "src", "claude_mcp_plugin", "code.js");
const RUNTIME_PATH = path.join(ROOT, "src", "web_import", "runtime.js");
const RUNTIME = fs.readFileSync(RUNTIME_PATH, "utf8");
const CAPTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "browser-capture", "page.capture.json"), "utf8"));
const CALL = "\nreturn JSON.stringify(await __w2fEntry(params));";

describe("the plugin itself", () => {
  it("evaluates in QuickJS with a stand-in figma global", () => {
    const loader = path.join(ROOT, "tests", "fixtures", "quickjs-load.mjs");
    const res = spawnSync(process.execPath, [loader, CODE], { encoding: "utf8", timeout: 60_000 });
    expect(res.stdout.trim() + res.stderr).toBe("OK");
  });

  it("carries none of the web importer", () => {
    const code = fs.readFileSync(CODE, "utf8");
    expect(code).not.toMatch(/planWebImport|importWebCapture|createWebImport/);
  });
});

describe("the web import runtime", () => {
  it("compiles as an execute_code body", () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    expect(() => new AsyncFunction("figma", "params", RUNTIME + CALL)).not.toThrow();
  });

  it("runs through the plugin's real execute_code", async () => {
    const { api } = loadPlugin();
    const reply = await api.handleCommand("execute_code", { code: RUNTIME + CALL, params: { op: "plan", capture: CAPTURE } });
    const plan = JSON.parse(reply.result);
    expect(plan.root.name).toBe("Page-CaptureFixture");
    expect(plan.stats.grids).toBe(1);
  });

  it("returns a bad capture as an execute_code error, not a crash", async () => {
    const { api } = loadPlugin();
    await expect(api.handleCommand("execute_code", { code: RUNTIME + CALL, params: { op: "import", capture: { nope: true } } }))
      .rejects.toThrow(/Not a Web-to-Figma capture/);
  });

  it("is copied unchanged to the server and the extension", () => {
    const ext = fs.readFileSync(path.join(ROOT, "browser_extension", "web-import-runtime.js"), "utf8");
    expect(ext.endsWith(RUNTIME)).toBe(true);
    const ts = fs.readFileSync(path.join(ROOT, "src", "talk_to_figma_mcp", "web-import", "runtime.generated.ts"), "utf8");
    expect(ts).toContain(JSON.stringify(RUNTIME));
  });
});
