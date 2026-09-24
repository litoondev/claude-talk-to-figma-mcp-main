/**
 * The "Copy prompt" buttons must paste something that actually works.
 *
 * This exists because of a real defect: the eight operation prompts were
 * one-sentence stubs ("Optimize layer structure by removing unnecessary
 * wrappers and empty frames."), and one UI copied the card's *description*
 * instead of the prompt at all. Pasting that into a conversation gave the model
 * no scope, no tools, no rules and no validation step — so the run either did
 * nothing or restructured more of the file than the user wanted.
 *
 * The prompts now live in `src/claude_mcp_plugin/operation-prompts.js` and are
 * injected into the three UI copies by `scripts/build-operation-prompts.js`.
 * Two things can silently break that:
 *
 *   1. Someone edits a generated block by hand, and the copies drift again.
 *   2. A prompt names a tool this server does not register, which is the exact
 *      failure the skill health pass exists to catch for skills.
 *
 * Both are checked here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.join(__dirname, "..", "..");
const PLUGIN = path.join(ROOT, "src", "claude_mcp_plugin");

const UI_FILES = ["ui.html", "ui-v2.html", "operations-menu.js"];

interface Operation {
  id: string;
  category: string;
  title: string;
  description: string;
  triggers: string[];
  icon: string;
  prompt: string;
}

/** Read the generated block out of a UI file. */
function injectedOperations(file: string): Operation[] {
  const contents = fs.readFileSync(path.join(PLUGIN, file), "utf8");
  const match = contents.match(/const OPERATION_PROMPTS = (\[[\s\S]*?\]);\s*\n\s*\/\* OPERATION_PROMPTS:END \*\//);
  if (!match) throw new Error(`${file} has no generated OPERATION_PROMPTS block`);
  return JSON.parse(match[1]);
}

/** Every tool name registered by the server, as `server.tool("name", ...)`. */
function registeredTools(): Set<string> {
  const toolsDir = path.join(ROOT, "src", "talk_to_figma_mcp", "tools");
  const names = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/server\.tool\(\s*["']([a-z0-9_]+)["']/gi)) names.add(m[1]);
      }
    }
  };
  walk(toolsDir);

  // Registered outside tools/, from the skill repository.
  const integration = fs.readFileSync(
    path.join(ROOT, "src", "talk_to_figma_mcp", "skills", "integration.ts"),
    "utf8"
  );
  for (const m of integration.matchAll(/server\.tool\(\s*["']([a-z0-9_]+)["']/gi)) names.add(m[1]);

  return names;
}

/** Skill IDs a prompt may tell the model to load. */
function builtinSkillIds(): Set<string> {
  return new Set(
    fs
      .readdirSync(path.join(ROOT, "skills"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
}

const operations = injectedOperations("ui.html");

/**
 * Prompts the designer wrote and asked to ship word for word.
 *
 * The shape checks below encode what *we* think a prompt needs — setup, limits,
 * verification, and only tool names this server registers. A prompt handed to us
 * verbatim is the designer's text, so it is checked for being present and
 * identical across the UI copies, and nothing more. Adding an id here is a
 * deliberate, visible decision; it must never be a way to sneak a stub past the
 * guards this file exists to enforce.
 */
const VERBATIM_PROMPTS = new Set(["local_mode_only"]);

describe("operation prompts", () => {
  it("ships the ten panel operations", () => {
    expect(operations.map((op) => op.id)).toEqual([
      "convert_to_grid",
      "rename_layers",
      "make_responsive",
      "optimize_layers",
      "design_system",
      "local_styles_only",
      "local_mode_only",
      "fix_typography",
      "audit_spacing",
      "hug_heights",
    ]);
  });

  it("is identical in every UI copy", () => {
    const reference = JSON.stringify(operations);
    for (const file of UI_FILES.slice(1)) {
      expect({ file, ops: JSON.stringify(injectedOperations(file)) }).toEqual({ file, ops: reference });
    }
  });

  it("is not stale — re-running the generator changes nothing", () => {
    // The source module is ESM and Jest runs CJS here, so rather than import it,
    // run the generator the build runs and prove it is a no-op.
    const before = UI_FILES.map((file) => fs.readFileSync(path.join(PLUGIN, file), "utf8"));
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-operation-prompts.js")], {
      cwd: ROOT,
      stdio: "pipe",
    });
    const after = UI_FILES.map((file) => fs.readFileSync(path.join(PLUGIN, file), "utf8"));

    UI_FILES.forEach((file, i) => {
      expect({ file, current: before[i] === after[i] }).toEqual({ file, current: true });
    });
  });

  describe.each(operations.map((op) => [op.id, op] as const))("%s", (_id, op) => {
    it("stands on its own without the user adding instructions", () => {
      if (VERBATIM_PROMPTS.has(op.id)) {
        // Designer-supplied text: only that it is really there.
        expect(op.prompt.trim().length).toBeGreaterThan(200);
        return;
      }

      // A stub prompt is the defect this file guards against — and so is a
      // bloated one, since every prompt is paid for in tokens on each use.
      expect(op.prompt.length).toBeGreaterThan(900);
      expect(op.prompt.length).toBeLessThan(2000);

      // Connect, read, constrain, verify, report — the shape every prompt needs.
      expect(op.prompt).toContain("join_channel");
      expect(op.prompt).toContain("get_selection");
      expect(op.prompt).toContain("Never:");
      expect(op.prompt).toContain("Verify:");
      expect(op.prompt).toContain("Report:");
      expect(op.prompt).toContain("export_node_as_image");
    });

    it("only names tools the server registers", () => {
      if (VERBATIM_PROMPTS.has(op.id)) return;
      const tools = registeredTools();
      // Tool-shaped words in the prompt: lowercase with an underscore.
      const mentioned = new Set(op.prompt.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) || []);

      // Words that look like tool names but are prose or Figma API properties.
      const notTools = new Set(["card__title", "card__media", "footer__column", "text_style", "node_id"]);

      for (const word of mentioned) {
        if (notTools.has(word)) continue;
        expect({ operation: op.id, tool: word, registered: tools.has(word) }).toEqual({
          operation: op.id,
          tool: word,
          registered: true,
        });
      }
    });

    it("only points at skills that exist", () => {
      const skills = builtinSkillIds();
      for (const m of op.prompt.matchAll(/"([A-Z][A-Za-z]+_[A-Za-z]+_v\d+)"/g)) {
        expect({ operation: op.id, skill: m[1], exists: skills.has(m[1]) }).toEqual({
          operation: op.id,
          skill: m[1],
          exists: true,
        });
      }
    });
  });
});
