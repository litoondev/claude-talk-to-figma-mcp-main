/**
 * The shipped Grid_Convert_v1 skill must satisfy every rule the skill system
 * enforces, name only tools this server registers, and agree with what
 * convert_layout actually does.
 */
import * as fs from "fs";
import * as path from "path";
import { parseSkillFile, asList, asString } from "../../src/talk_to_figma_mcp/skills/types";
import { parseSkillId } from "../../src/talk_to_figma_mcp/skills/naming";

const { BUILTIN_SKILLS } = require("../../src/talk_to_figma_mcp/skills/generated");

function registeredToolNames(): Set<string> {
  const dir = path.join(__dirname, "..", "..", "src", "talk_to_figma_mcp", "tools");
  const names = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)) names.add(match[1]);
  }
  return names;
}

const raw = BUILTIN_SKILLS.find((s: any) => s.id === "Grid_Convert_v1");
const parsed = raw ? parseSkillFile(raw.text) : null;

describe("the shipped Grid_Convert_v1 skill", () => {
  it("is compiled into the bundle with a valid ID, description and triggers", () => {
    expect(raw).toBeDefined();
    expect(parseSkillId(asString(parsed!.frontmatter.id))).not.toBeNull();
    expect(asString(parsed!.frontmatter.description).length).toBeGreaterThan(40);
    expect(asList(parsed!.frontmatter.triggers)).toEqual(expect.arrayContaining(["convert to grid", "full grid"]));
  });

  it("references only tools this server registers", () => {
    const real = registeredToolNames();
    expect(asList(parsed!.frontmatter.uses).filter((tool) => !real.has(tool))).toEqual([]);
  });

  it("goes through convert_layout in order: scan, ask, apply, verify", () => {
    const body = parsed!.body;
    const order = ["export_node_as_image", "dryRun: true", "confirmedIds", "tokensMissing"].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("never hand-builds a grid the plugin refused and never snaps", () => {
    const body = parsed!.body;
    expect(body).toMatch(/Never imitate a refused conversion/);
    expect(body).toMatch(/Never approximate and never snap/);
    expect(asList(parsed!.frontmatter.uses)).not.toEqual(expect.arrayContaining(["execute_code"]));
    expect(asList(parsed!.frontmatter.uses)).not.toEqual(expect.arrayContaining(["set_grid_layout"]));
  });

  it("describes only Grid properties the plugin itself sets", () => {
    const body = parsed!.body;
    const plugin = fs.readFileSync(path.join(__dirname, "..", "..", "src", "claude_mcp_plugin", "code.js"), "utf8");
    for (const property of ["appendChildAt", "gridColumnSpan", "gridChildHorizontalAlign", "gridItemsPositioning", "gridRowGap"]) {
      expect(body).toContain(property);
      expect(plugin).toContain(property);
    }
    expect(body).not.toContain("setGridChildPosition");
  });
});
