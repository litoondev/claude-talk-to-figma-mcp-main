/**
 * The documented tool counts must match the registry.
 *
 * `profiles.ts` opens with the size of each profile, and that number is the
 * justification for the whole profile system — the schema is re-sent on every
 * request, so "167 tools ≈ 41k tokens" is what makes trimming worth doing. It
 * was maintained by hand, drifted every time a tool was added, and was quoted
 * onward into the readme as fact. It had reached 162 against a real 167.
 *
 * Counting the registry is the only way to keep the claim honest.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

/** Register everything and collect the names, with no profile filtering. */
function registeredNames(): string[] {
  const names: string[] = [];
  const fake: any = {
    tool: (...args: unknown[]) => {
      if (typeof args[0] === "string") names.push(args[0]);
    },
  };

  const ORIGINAL = { ...process.env };
  process.env.FIGMA_MCP_PROFILE = "full";
  process.env.WEBFLOW_TOKEN = "counting";
  process.env.FIGMA_ACCESS_TOKEN = "counting";
  process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "true";

  try {
    let mod: any;
    jest.isolateModules(() => {
      mod = require("../../src/talk_to_figma_mcp/tools/index");
    });
    mod.registerTools(fake);
  } finally {
    process.env = ORIGINAL;
  }
  return names;
}

describe("documented tool counts", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "src", "talk_to_figma_mcp", "config", "profiles.ts"),
    "utf8"
  );

  it("the header's total matches what actually registers", () => {
    const claimed = Number(/The full tool set is (\d+) tools/.exec(source)?.[1]);
    expect(Number.isFinite(claimed)).toBe(true);
    expect(claimed).toBe(registeredNames().length);
  });

  it("the `full` line quotes the same total as the header", () => {
    const header = /The full tool set is (\d+) tools/.exec(source)?.[1];
    const full = /full\s+— all (\d+) tools/.exec(source)?.[1];
    expect(full).toBe(header);
  });

  it("registers no duplicate tool names", () => {
    const names = registeredNames();
    const seen = new Set<string>();
    const duplicates = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    // A duplicate silently overwrites the earlier registration, so the tool
    // that "exists" is whichever registered last.
    expect(duplicates).toEqual([]);
  });
});
