/**
 * The manifest and the code must agree about configuration.
 *
 * This exists because of a real bug: `FIGMA_MCP_WEBFLOW_DESIGNER` gated twelve
 * Webflow Designer tools, was read correctly by `profiles.ts`, was documented in
 * the readme — and was never added to `manifest.json`. So in the shipped
 * extension there was no way to turn it on, and the tools could not be reached
 * at all. Everything typechecked, every test passed, and the feature was dead.
 *
 * Nothing in the type system connects a `process.env` read to a manifest entry,
 * so this walks the source for the reads and checks each one is declared.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src", "talk_to_figma_mcp");

/**
 * Env vars the server may read without the manifest supplying them.
 *
 * The rule is about which direction the default points:
 *
 *  - A **default-on escape hatch** (`FIGMA_MCP_CACHE=off`) works fully without
 *    the manifest. Not declaring it only means the UI has no switch for turning
 *    a working feature off, which is a deliberate choice for a niche knob.
 *  - A **default-off gate** (`FIGMA_MCP_WEBFLOW_DESIGNER=true`) is dead without
 *    the manifest. The feature cannot be reached at all, which is the bug this
 *    file was written for — so those must never be listed here.
 *
 * Anything added below should be default-on, or read only by tests and a
 * hand-written claude_desktop_config.json.
 */
const NOT_USER_CONFIGURABLE = new Set([
  "NODE_ENV",
  // Default-on escape hatches: caching and the usage footer both work unless
  // explicitly set to "off", so the extension needs no field for them.
  "FIGMA_MCP_CACHE",
  "FIGMA_MCP_USAGE_FOOTER",
  // Tuning knobs deliberately left out of the UI: they exist for tests and for
  // a hand-written claude_desktop_config.json, not for the extension's form.
  "FIGMA_API_BASE_URL",
  "FIGMA_API_MAX_RETRIES",
  "FIGMA_API_TIMEOUT_MS",
  "WEBFLOW_API_BASE_URL",
  "WEBFLOW_API_MAX_RETRIES",
  "WEBFLOW_API_TIMEOUT_MS",
  // Accepted as an alias for WEBFLOW_TOKEN, which is the one the manifest sets.
  "WEBFLOW_API_TOKEN",
  // Alias for FIGMA_ACCESS_TOKEN, same reasoning.
  "FIGMA_PERSONAL_ACCESS_TOKEN",
  // Set by the relay, not by the extension host.
  "SOCKET_PORT",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function envReads(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const name = match[1];
      const where = path.relative(ROOT, file);
      const list = found.get(name) ?? [];
      if (!list.includes(where)) list.push(where);
      found.set(name, list);
    }
  }
  return found;
}

describe("manifest.json and the server agree on configuration", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const env: Record<string, string> = manifest.server.mcp_config.env;
  const userConfig: Record<string, unknown> = manifest.user_config;

  it("every env var the server reads is supplied by the manifest", () => {
    const reads = envReads();
    const undeclared: string[] = [];

    for (const [name, files] of reads) {
      if (NOT_USER_CONFIGURABLE.has(name)) continue;
      if (!(name in env)) undeclared.push(`${name} (read in ${files.join(", ")})`);
    }

    // A miss here means a feature that cannot be switched on in the shipped
    // extension, however well it works locally.
    expect(undeclared).toEqual([]);
  });

  it("nothing allowlisted is a default-off gate in disguise", () => {
    // An allowlisted var must be harmless to omit. A var whose feature is OFF
    // until it is set is not harmless — it is unreachable — so the source must
    // show it being compared against an "off" spelling, not an "on" one.
    const sources = walk(SRC).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const offending: string[] = [];

    for (const name of NOT_USER_CONFIGURABLE) {
      if (!sources.includes(`process.env.${name}`)) continue;
      // Skip the ones that are plainly not feature gates.
      if (/_BASE_URL$|_MAX_RETRIES$|_TIMEOUT_MS$|_TOKEN$|^NODE_ENV$|^SOCKET_PORT$/.test(name)) continue;

      const gate = new RegExp(
        `process\\.env\\.${name}[\\s\\S]{0,160}?!==\\s*"(off|false|0|no)"`
      );
      if (!gate.test(sources)) offending.push(name);
    }

    expect(offending).toEqual([]);
  });

  it("every manifest env value points at a user_config field that exists", () => {
    const dangling: string[] = [];
    for (const [name, value] of Object.entries(env)) {
      const match = /^\$\{user_config\.([a-z0-9_]+)\}$/.exec(String(value));
      if (!match) continue;
      if (!(match[1] in userConfig)) dangling.push(`${name} -> user_config.${match[1]}`);
    }
    // An unsubstituted placeholder reaches the server as a literal string and
    // surfaces as a baffling auth error; getFigmaToken/getWebflowToken catch
    // that case, but the right fix is for the field to exist.
    expect(dangling).toEqual([]);
  });

  it("every user_config field is wired to an env var", () => {
    const wired = new Set(
      Object.values(env)
        .map((v) => /^\$\{user_config\.([a-z0-9_]+)\}$/.exec(String(v))?.[1])
        .filter(Boolean) as string[]
    );
    const orphans = Object.keys(userConfig).filter((key) => !wired.has(key));
    // An orphan is a field the user can fill in that reaches nothing.
    expect(orphans).toEqual([]);
  });

  it("the Webflow Designer tools can actually be switched on", () => {
    // The specific bug this file was written for.
    expect(env.FIGMA_MCP_WEBFLOW_DESIGNER).toBe("${user_config.webflow_designer}");
    expect(userConfig.webflow_designer).toBeDefined();
    expect((userConfig.webflow_designer as any).type).toBe("boolean");
    // Off by default: the tools cost schema on every request and need an
    // extension running before they do anything.
    expect((userConfig.webflow_designer as any).default).toBe(false);
  });

  it("the gate accepts what a DXT boolean actually sends", () => {
    const ORIGINAL = process.env.FIGMA_MCP_WEBFLOW_DESIGNER;
    const load = () => {
      let mod: any;
      jest.isolateModules(() => {
        mod = require("../../src/talk_to_figma_mcp/config/profiles");
      });
      return mod.webflowDesignerEnabled();
    };

    try {
      // A DXT boolean arrives as the string "true"/"false"; an untouched
      // field arrives empty.
      process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "true";
      expect(load()).toBe(true);
      process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "false";
      expect(load()).toBe(false);
      process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "";
      expect(load()).toBe(false);
      delete process.env.FIGMA_MCP_WEBFLOW_DESIGNER;
      expect(load()).toBe(false);
    } finally {
      if (ORIGINAL === undefined) delete process.env.FIGMA_MCP_WEBFLOW_DESIGNER;
      else process.env.FIGMA_MCP_WEBFLOW_DESIGNER = ORIGINAL;
    }
  });
});
