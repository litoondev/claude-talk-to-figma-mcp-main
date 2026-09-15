/**
 * The shipped Html_Import_v1 skill must satisfy every rule the skill system
 * enforces, and only name tools this server actually registers.
 */
import * as fs from "fs";
import * as path from "path";
import { parseSkillFile, asList, asString } from "../../src/talk_to_figma_mcp/skills/types";
import { parseSkillId } from "../../src/talk_to_figma_mcp/skills/naming";
import { checkDuplicate } from "../../src/talk_to_figma_mcp/skills/dedupe";

const { BUILTIN_SKILLS } = require("../../src/talk_to_figma_mcp/skills/generated");

/** Every tool name registered anywhere in the server, read from the source. */
function registeredToolNames(): Set<string> {
  const dirs = [
    path.join(__dirname, "..", "..", "src", "talk_to_figma_mcp", "tools"),
    path.join(__dirname, "..", "..", "src", "talk_to_figma_mcp", "skills"),
  ];
  const names = new Set<string>();
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)) names.add(match[1]);
    }
  }
  return names;
}

const raw = BUILTIN_SKILLS.find((s: any) => s.id === "Html_Import_v1");
const parsed = raw ? parseSkillFile(raw.text) : null;

describe("the shipped Html_Import_v1 skill", () => {
  it("is compiled into the bundle", () => {
    expect(raw).toBeDefined();
  });

  it("has a valid ID, description, triggers and a substantial body", () => {
    expect(parseSkillId(asString(parsed!.frontmatter.id))).not.toBeNull();
    expect(asString(parsed!.frontmatter.description).length).toBeGreaterThan(40);
    expect(asList(parsed!.frontmatter.triggers)).toEqual(expect.arrayContaining(["html to figma", "url to figma"]));
    expect(parsed!.body.length).toBeGreaterThan(2000);
  });

  it("references only tools this server registers", () => {
    const real = registeredToolNames();
    const unknown = asList(parsed!.frontmatter.uses).filter((tool) => !real.has(tool));
    expect(unknown).toEqual([]);
  });

  it("walks the designer's workflow in order: analyse, match, build, notes, optimise", () => {
    const body = parsed!.body;
    const order = ["analyze_html", "match_design_tokens", "set_grid_layout", "Import Notes", "clean_layers"].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toMatch(/Never create new variables or styles/);
    expect(body).toMatch(/never imitate a\s+Grid/i);
  });

  it("holds the designer's import conditions: identical, linked, components only for repeats, no compromise", () => {
    const body = parsed!.body;
    expect(body).toMatch(/Nothing is left out, nothing is added/);
    expect(body).toMatch(/never typed/);
    expect(body).toMatch(/Appears 2 or more times[\s\S]*A new component/);
    expect(body).toMatch(/Appears once \| Plain layers/);
    expect(body).toContain("create_component_from_node");
    expect(body).toContain("Components — from HTML");
    expect(body).toMatch(/Never delete the space it occupies/);
    expect(body).toMatch(/never ship a quiet approximation/);
    // Images and icons are placed, not handed back as "check manually".
    expect(body).toContain("set_svg");
    expect(body).not.toMatch(/Check manually:[^\n]*images, icons/);
    // CSS stretch has no Auto Layout frame value; a live import typed STRETCH and Figma refused it.
    expect(body).toMatch(/`align-items: stretch`[\s\S]*has no frame\s+value/);
  });

  it("does not duplicate or collide with the other shipped skills", () => {
    const others = BUILTIN_SKILLS.filter((s: any) => s.id !== "Html_Import_v1").map((s: any) => {
      const p = parseSkillFile(s.text)!;
      return { id: s.id, body: p.body, triggers: asList(p.frontmatter.triggers) };
    });
    const verdict = checkDuplicate({ id: "Html_Import_v1", body: parsed!.body, triggers: asList(parsed!.frontmatter.triggers) }, others);
    expect(verdict.kind).toBe("unique");
  });
});
