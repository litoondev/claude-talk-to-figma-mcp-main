/**
 * The shipped Prototype_Motion_v1 skill must satisfy every rule the skill
 * system enforces, name only tools this server registers, and — the part that
 * actually rots — keep agreeing with what `set_reactions` really accepts.
 *
 * That last one is the reason this file exists. `set_reactions` declares a
 * narrow Zod schema, and Zod drops undeclared keys silently, so a reaction that
 * needs `direction` or `keyCodes` is written *without* them and no error is
 * raised. The skill routes those cases to `execute_code` instead. If someone
 * later widens the tool's schema, the routing table becomes wrong advice and
 * these tests should fail so it gets updated rather than quietly misleading.
 */
import * as fs from "fs";
import * as path from "path";
import { parseSkillFile, asList, asString } from "../../src/talk_to_figma_mcp/skills/types";
import { parseSkillId } from "../../src/talk_to_figma_mcp/skills/naming";
import { checkDuplicate, blocksRegistration } from "../../src/talk_to_figma_mcp/skills/dedupe";

const { BUILTIN_SKILLS } = require("../../src/talk_to_figma_mcp/skills/generated");

const ROOT = path.join(__dirname, "..", "..");

function registeredToolNames(): Set<string> {
  const dir = path.join(ROOT, "src", "talk_to_figma_mcp", "tools");
  const names = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)) names.add(match[1]);
  }
  return names;
}

/** The `set_reactions` tool definition, where the Zod schema lives. */
function setReactionsSource(): string {
  const source = fs.readFileSync(
    path.join(ROOT, "src", "talk_to_figma_mcp", "tools", "component-tools.ts"),
    "utf8"
  );
  const start = source.indexOf('"set_reactions"');
  const end = source.indexOf('"get_reactions"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const raw = BUILTIN_SKILLS.find((s: any) => s.id === "Prototype_Motion_v1");
const parsed = raw ? parseSkillFile(raw.text) : null;

describe("the shipped Prototype_Motion_v1 skill", () => {
  it("is compiled into the bundle with a valid ID, description and triggers", () => {
    expect(raw).toBeDefined();
    expect(parseSkillId(asString(parsed!.frontmatter.id))).not.toBeNull();
    expect(asString(parsed!.frontmatter.description).length).toBeGreaterThan(40);
    expect(asList(parsed!.frontmatter.triggers)).toEqual(
      expect.arrayContaining(["prototype this", "smart animate", "add motion"])
    );
  });

  it("references only tools this server registers", () => {
    const real = registeredToolNames();
    expect(asList(parsed!.frontmatter.uses).filter((tool) => !real.has(tool))).toEqual([]);
  });

  it("uses the plugin's own prototype tools rather than scripting everything", () => {
    const uses = asList(parsed!.frontmatter.uses);
    expect(uses).toEqual(expect.arrayContaining(["set_reactions", "get_reactions"]));
  });

  it("is not a near-copy of another shipped skill", () => {
    const others = BUILTIN_SKILLS.filter((s: any) => s.id !== "Prototype_Motion_v1").map((s: any) => {
      const p = parseSkillFile(s.text)!;
      return { id: s.id, body: p.body, triggers: asList(p.frontmatter.triggers) };
    });
    const verdict = checkDuplicate(
      { id: "Prototype_Motion_v1", body: parsed!.body, triggers: asList(parsed!.frontmatter.triggers) },
      others
    );
    expect({ kind: verdict.kind, blocks: blocksRegistration(verdict) }).toEqual({
      kind: "unique",
      blocks: false,
    });
  });

  it("plans before it writes, and audits before it reports", () => {
    const body = parsed!.body;
    const order = ["Interaction Map", "ask for approval", "Step 3 — Build", "script H (audit)"].map((s) =>
      body.indexOf(s)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("does not send to a script what set_reactions now carries", () => {
    const schema = setReactionsSource();

    // These were dropped by the tool's Zod schema and the skill used to route
    // them to execute_code. The tool now declares them, so the skill must not
    // still be telling the model to script around it.
    for (const field of [
      "direction",
      "matchLayers",
      "keyCodes",
      "timeout",
      "url",
      "openInNewTab",
      "destinationId",
      "navigation",
      "resetScrollPosition",
      "overlayRelativePosition",
      "overlayPositionType",
      "overlayBackgroundInteraction",
    ]) {
      expect({ field, inToolSchema: schema.includes(field + ":") }).toEqual({ field, inToolSchema: true });
    }

    // The three reasons a script is still the right call.
    const prose = parsed!.body.replace(/\s+/g, " ");
    expect(prose).toMatch(/replaces every reaction on the node/);
    expect(prose).toMatch(/Many nodes at once/);
    expect(prose).toMatch(/UPDATE_MEDIA_RUNTIME/);
  });

  it("leaves the designer's overlay settings alone unless asked", () => {
    const plugin = fs.readFileSync(path.join(ROOT, "src", "claude_mcp_plugin", "code.js"), "utf8");

    // The handler used to default these, silently re-centring every overlay it
    // touched. It must now write them only when the caller supplied one.
    expect(plugin).not.toContain('a.overlayPositionType || "CENTER"');
    expect(plugin).not.toContain('a.overlayBackgroundInteraction || "CLOSE_ON_CLICK_OUTSIDE"');
    expect(plugin).toContain("if (a.overlayPositionType !== undefined)");
    expect(plugin).toContain("if (a.overlayBackgroundInteraction !== undefined)");

    // And the skill must say so, since it is what makes a non-centred overlay work.
    const prose = parsed!.body.replace(/\s+/g, " ");
    expect(prose).toMatch(/only when you pass them/);
    expect(prose).toContain("overlayPositionType");
  });

  it("never animates a top-level frame and never shortens a timeline", () => {
    // Markdown wraps these sentences across lines, so match on the prose, not the layout.
    const prose = parsed!.body.replace(/\s+/g, " ");
    expect(prose).toMatch(/Never animate a top-level frame/);
    expect(prose).toMatch(/Never shorten one unless asked/);
    expect(prose).toMatch(/[Nn]ever fake a timeline/);
  });

  it("ships scripts that are valid async function bodies", () => {
    const blocks = [...parsed!.body.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(8);

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const failures: string[] = [];
    for (const block of blocks) {
      try {
        new AsyncFunction("figma", "params", block);
      } catch {
        // A params example is an object literal, not a body — it must still parse.
        try {
          new Function(`return (${block})`);
        } catch (error) {
          failures.push(block.slice(0, 60).replace(/\n/g, " "));
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
