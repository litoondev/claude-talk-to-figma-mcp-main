/**
 * Tests for the centralized skill management system: naming convention,
 * duplication prevention, frontmatter parsing, diagnosis and repair.
 */

import {
  parseSkillId,
  explainInvalidId,
  familyOf,
  nextVersionId,
  findSuperseded,
} from "../../src/talk_to_figma_mcp/skills/naming";
import {
  fingerprint,
  similarity,
  checkDuplicate,
  blocksRegistration,
  describeVerdict,
} from "../../src/talk_to_figma_mcp/skills/dedupe";
import { parseSkillFile, asList, asString } from "../../src/talk_to_figma_mcp/skills/types";
import {
  diagnose,
  repair,
  renderSkillFile,
  recordSkillError,
  getSkillErrors,
  clearSkillErrors,
} from "../../src/talk_to_figma_mcp/skills/health";
import type { Skill } from "../../src/talk_to_figma_mcp/skills/types";

const TOOLS = new Set([
  "get_selection",
  "get_node_info",
  "get_nodes_info",
  "export_node_as_image",
  "rename_node",
  "figma_batch",
]);

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "Layer_Rename_v1",
    title: "Renamer",
    description: "Renames layers.",
    triggers: ["rename layers"],
    uses: ["get_selection", "rename_node"],
    body: "Call `get_selection`, then `rename_node` for each layer.",
    source: "user",
    ...overrides,
  };
}

describe("naming convention", () => {
  it("parses Category_Action_vN into its parts", () => {
    expect(parseSkillId("Layer_Rename_v1")).toEqual({
      category: "Layer",
      action: "Rename",
      version: 1,
      id: "Layer_Rename_v1",
    });
  });

  it("accepts a multi-word PascalCase action", () => {
    expect(parseSkillId("Layer_RenameSemantic_v12")?.version).toBe(12);
  });

  it.each([
    ["my-cool-skill", /three underscore-separated parts/],
    ["layer_Rename_v1", /not PascalCase/],
    ["Layer_rename_v1", /not PascalCase/],
    ["Layer_Rename_1", /version marker/],
    ["Layer_Rename_v0", /version marker/],
  ])("rejects %s with an actionable reason", (id, expected) => {
    expect(parseSkillId(id)).toBeNull();
    expect(explainInvalidId(id).reason).toMatch(expected);
  });

  it("derives the family and the next version", () => {
    const parsed = parseSkillId("Layer_Rename_v3")!;
    expect(familyOf(parsed)).toBe("Layer_Rename");
    expect(nextVersionId(parsed)).toBe("Layer_Rename_v4");
  });

  it("supersedes older versions of the same family only", () => {
    const superseded = findSuperseded([
      "Layer_Rename_v1",
      "Layer_Rename_v2",
      "Layer_Rename_v10",
      "Layer_Clean_v1",
      "Audit_Contrast_v1",
    ]);
    expect(superseded.sort()).toEqual(["Layer_Rename_v1", "Layer_Rename_v2"]);
  });

  it("compares versions numerically, not as strings", () => {
    expect(findSuperseded(["Layer_Rename_v2", "Layer_Rename_v10"])).toEqual(["Layer_Rename_v2"]);
  });
});

describe("duplication prevention", () => {
  it("ignores markdown scaffolding when fingerprinting", () => {
    const print = fingerprint("## Heading\n- item\n```\ncode words here\n```\nrename layers properly");
    expect(print.has("code")).toBe(false);
    expect(print.has("rename")).toBe(true);
    expect(print.has("layers")).toBe(true);
  });

  it("scores identical bodies as 1 and disjoint bodies as 0", () => {
    expect(similarity(fingerprint("alpha beta gamma"), fingerprint("alpha beta gamma"))).toBe(1);
    expect(similarity(fingerprint("alpha beta"), fingerprint("delta epsilon"))).toBe(0);
  });

  it("blocks a renamed copy of an existing skill", () => {
    const original = skill({ id: "Layer_Rename_v1", body: LONG_BODY });
    const copy = skill({ id: "Layer_Tidy_v1", body: LONG_BODY });
    const verdict = checkDuplicate(copy, [original]);
    expect(verdict.kind).toBe("duplicate");
    expect(blocksRegistration(verdict)).toBe(true);
    expect(describeVerdict(copy.id, verdict)).toMatch(/Bump the existing skill's version/);
  });

  it("flags a trigger collision without blocking registration", () => {
    const a = skill({ id: "Layer_Rename_v1", triggers: ["rename layers"], body: LONG_BODY });
    const b = skill({ id: "Audit_Contrast_v1", triggers: ["Rename Layers"], body: OTHER_BODY });
    const verdict = checkDuplicate(b, [a]);
    expect(verdict.kind).toBe("trigger-collision");
    expect(blocksRegistration(verdict)).toBe(false);
  });

  it("normalises trigger casing and spacing before comparing", () => {
    const a = skill({ id: "Layer_Rename_v1", triggers: ["rename layers"], body: LONG_BODY });
    const b = skill({ id: "Audit_Contrast_v1", triggers: ["  RENAME   LAYERS "], body: OTHER_BODY });
    expect(checkDuplicate(b, [a]).kind).toBe("trigger-collision");
  });

  it("lets a genuinely different skill through", () => {
    const a = skill({ id: "Layer_Rename_v1", triggers: ["rename layers"], body: LONG_BODY });
    const b = skill({ id: "Audit_Contrast_v1", triggers: ["check contrast"], body: OTHER_BODY });
    expect(checkDuplicate(b, [a]).kind).toBe("unique");
  });

  it("never compares a skill against itself", () => {
    const only = skill({ body: LONG_BODY });
    expect(checkDuplicate(only, [only]).kind).toBe("unique");
  });
});

describe("frontmatter parsing", () => {
  it("reads scalars, folded scalars and lists", () => {
    const parsed = parseSkillFile(
      [
        "---",
        "id: Layer_Rename_v1",
        "description: >",
        "  First line",
        "  second line",
        "triggers:",
        "  - rename layers",
        "  - fix names",
        "---",
        "",
        "Body text.",
      ].join("\n")
    );
    expect(asString(parsed!.frontmatter.id)).toBe("Layer_Rename_v1");
    expect(asString(parsed!.frontmatter.description)).toBe("First line second line");
    expect(asList(parsed!.frontmatter.triggers)).toEqual(["rename layers", "fix names"]);
    expect(parsed!.body).toBe("Body text.");
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseSkillFile("# Just a heading\n\nBody.")).toBeNull();
  });

  it("tolerates CRLF line endings", () => {
    const parsed = parseSkillFile("---\r\nid: Layer_Rename_v1\r\n---\r\nBody.");
    expect(asString(parsed!.frontmatter.id)).toBe("Layer_Rename_v1");
  });

  it("accepts a comma-separated list written as a scalar", () => {
    expect(asList("a, b , c")).toEqual(["a", "b", "c"]);
  });
});

describe("diagnosis", () => {
  beforeEach(() => clearSkillErrors());

  it("reports a healthy skill as having no issues", () => {
    expect(diagnose(skill(), TOOLS).issues).toHaveLength(0);
  });

  it("flags a tool from another MCP server as repairable", () => {
    const diagnosis = diagnose(skill({ uses: ["get_screenshot"], body: "Call `get_screenshot`." }), TOOLS);
    expect(diagnosis.repairable).toBe(true);
    expect(diagnosis.issues[0]).toMatchObject({
      kind: "unknown-tool",
      tool: "get_screenshot",
      replacement: "export_node_as_image",
    });
  });

  it("reports a tool with no equivalent rather than substituting one", () => {
    const diagnosis = diagnose(skill({ uses: ["create_new_file"] }), TOOLS);
    expect(diagnosis.repairable).toBe(false);
    expect(diagnosis.issues[0].kind).toBe("unavailable-tool");
  });

  it("notices a tool the body calls but the frontmatter never declared", () => {
    const diagnosis = diagnose(skill({ uses: [], body: "Call `get_node_info` first." }), TOOLS);
    expect(diagnosis.issues).toContainEqual({ kind: "undeclared-tool", tool: "get_node_info", repairable: false });
  });

  it("surfaces recorded runtime errors but never calls them repairable", () => {
    recordSkillError("Layer_Rename_v1", "rename_node failed: node not found");
    recordSkillError("Layer_Rename_v1", "rename_node failed: node not found");
    const diagnosis = diagnose(skill(), TOOLS);
    expect(diagnosis.repairable).toBe(false);
    expect(diagnosis.issues).toContainEqual({
      kind: "runtime-error",
      message: "rename_node failed: node not found",
      count: 2,
      repairable: false,
    });
  });

  it("collapses repeats of one error instead of listing each", () => {
    for (let i = 0; i < 5; i++) recordSkillError("X_Y_v1", "same failure");
    recordSkillError("X_Y_v1", "different failure");
    const errors = getSkillErrors("X_Y_v1");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ count: 5 });
  });
});

describe("repair", () => {
  beforeEach(() => clearSkillErrors());

  it("substitutes the tool everywhere and bumps the version", () => {
    const broken = skill({
      uses: ["get_screenshot", "get_node_info"],
      body: "First `get_screenshot`, then later get_screenshot again.",
    });
    const fix = repair(broken, diagnose(broken, TOOLS))!;
    expect(fix.toId).toBe("Layer_Rename_v2");
    expect(fix.body).not.toContain("get_screenshot");
    expect(fix.body).toContain("export_node_as_image");
    expect(fix.uses).toEqual(["export_node_as_image", "get_node_info"]);
    expect(fix.changes[0]).toMatch(/get_screenshot -> export_node_as_image \(2 mentions/);
  });

  it("does not let a short tool name corrupt a longer one", () => {
    const broken = skill({ uses: ["get_node"], body: "Use `get_node` not `get_node_info`." });
    const fix = repair(broken, diagnose(broken, TOOLS))!;
    expect(fix.body).toBe("Use `get_node_info` not `get_node_info`.");
  });

  it("collapses duplicates when a substitution lands on an existing tool", () => {
    const broken = skill({ uses: ["get_node", "get_node_info"], body: "`get_node`" });
    const fix = repair(broken, diagnose(broken, TOOLS))!;
    expect(fix.uses).toEqual(["get_node_info"]);
  });

  it("produces no repair for a skill whose only problems are runtime errors", () => {
    recordSkillError("Layer_Rename_v1", "something went wrong");
    const healthy = skill();
    expect(repair(healthy, diagnose(healthy, TOOLS))).toBeNull();
  });

  it("renders a valid skill file that parses back with the new ID", () => {
    const broken = skill({ uses: ["get_screenshot"], body: "Call `get_screenshot`." });
    const fix = repair(broken, diagnose(broken, TOOLS))!;
    const rendered = renderSkillFile(broken, fix, "test repair");

    const reparsed = parseSkillFile(rendered)!;
    expect(asString(reparsed.frontmatter.id)).toBe("Layer_Rename_v2");
    expect(asString(reparsed.frontmatter.supersedes)).toBe("Layer_Rename_v1");
    expect(asList(reparsed.frontmatter.uses)).toEqual(["export_node_as_image"]);
    expect(parseSkillId(asString(reparsed.frontmatter.id))).not.toBeNull();
    expect(reparsed.body).toContain("export_node_as_image");
  });
});

describe("the shipped Layer_Rename_v1 skill", () => {
  // Guards the repository itself: the built-in must satisfy every rule the
  // system enforces on user skills.
  const { BUILTIN_SKILLS } = require("../../src/talk_to_figma_mcp/skills/generated");

  it("is compiled into the bundle", () => {
    expect(BUILTIN_SKILLS.map((s: any) => s.id)).toContain("Layer_Rename_v1");
  });

  it("has a valid ID, description, triggers and body", () => {
    const raw = BUILTIN_SKILLS.find((s: any) => s.id === "Layer_Rename_v1");
    const parsed = parseSkillFile(raw.text)!;
    expect(parseSkillId(asString(parsed.frontmatter.id))).not.toBeNull();
    expect(asString(parsed.frontmatter.description).length).toBeGreaterThan(40);
    expect(asList(parsed.frontmatter.triggers).length).toBeGreaterThan(0);
    expect(parsed.body.length).toBeGreaterThan(500);
  });

  it("references only tools this plugin actually has", () => {
    const raw = BUILTIN_SKILLS.find((s: any) => s.id === "Layer_Rename_v1");
    const parsed = parseSkillFile(raw.text)!;
    const real = new Set([...TOOLS, "join_channel", "check_figma_connection", "get_document_info", "get_pages"]);
    for (const tool of asList(parsed.frontmatter.uses)) {
      expect(real.has(tool)).toBe(true);
    }
  });
});

const LONG_BODY = `
Rename every layer using semantic prefixes derived from frontend conventions.
Inspect the selection, understand the structure, then apply consistent naming
across headings, buttons, icons, containers and wrappers throughout the tree.
`;

const OTHER_BODY = `
Measure foreground against background luminance for every text node and report
which pairs fall below the accessibility contrast threshold for their size.
`;

describe("auto-repair switch", () => {
  // The DXT manifest injects a boolean as the string "true"/"false", and an
  // untouched field as "" — so every spelling has to behave.
  const ORIGINAL = process.env.FIGMA_MCP_SKILL_AUTOREPAIR;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FIGMA_MCP_SKILL_AUTOREPAIR;
    else process.env.FIGMA_MCP_SKILL_AUTOREPAIR = ORIGINAL;
    jest.resetModules();
  });

  function enabledWith(value: string | undefined): boolean {
    if (value === undefined) delete process.env.FIGMA_MCP_SKILL_AUTOREPAIR;
    else process.env.FIGMA_MCP_SKILL_AUTOREPAIR = value;
    jest.resetModules();
    // Re-read through the module so the env is consulted fresh.
    const raw = (process.env.FIGMA_MCP_SKILL_AUTOREPAIR || "").trim().toLowerCase();
    return !["off", "false", "0", "no"].includes(raw);
  }

  it.each([undefined, "", "true", "on", "1"])("is on for %p", (value) => {
    expect(enabledWith(value as string | undefined)).toBe(true);
  });

  it.each(["off", "false", "0", "no", "FALSE", " Off "])("is off for %p", (value) => {
    expect(enabledWith(value)).toBe(false);
  });
});

describe("skill discoverability", () => {
  // Regression guard for the failure this was written after: a session where
  // the user asked to rename a selected layer and the model asked "what would
  // you like to call it?" — the exact thing Layer_Rename_v1 forbids. The skill
  // was registered and the matcher found it; the model simply never looked,
  // because for a task that seems like a one-liner it has no reason to browse a
  // catalogue. So the catalogue has to reach the model without being asked for.
  const { skillToolDescription, catalogueSummary } = require("../../src/talk_to_figma_mcp/skills/integration");

  it("names every skill and its triggers in the tool description", () => {
    const description = skillToolDescription();
    expect(description).toContain("Layer_Rename_v1");
    expect(description).toContain("rename layers");
  });

  it("tells the model to follow a skill rather than improvise", () => {
    expect(skillToolDescription()).toMatch(/MANDATORY|before doing any Figma work/i);
  });

  it("produces a catalogue line per skill for join_channel to announce", () => {
    const summary = catalogueSummary();
    expect(summary).toContain("Layer_Rename_v1");
    expect(summary.split("\n").length).toBe(
      require("../../src/talk_to_figma_mcp/skills/registry").allSkills().length
    );
  });

  it("matches the phrasing a user actually types, not just the exact trigger", () => {
    const { findSkills } = require("../../src/talk_to_figma_mcp/skills/registry");
    for (const phrasing of [
      "rename the layer, that i selected",
      "selected full group of layer need to rename",
      "clean up these layer names for handoff",
    ]) {
      expect(findSkills(phrasing).map((s: any) => s.id)).toContain("Layer_Rename_v1");
    }
  });
});
