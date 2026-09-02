/**
 * Wiring the skill registry into the MCP server.
 *
 * Two entry points, because there are two ways a skill gets used:
 *
 *   - As an MCP prompt, one per skill. This is how a person invokes a skill
 *     deliberately — it shows up in the client's prompt picker by name.
 *   - Through the `figma_skill` tool, which is how the *model* reaches one
 *     mid-conversation when the user just describes what they want without
 *     naming a skill.
 *
 * Both serve the same body from the same registry, so they can never disagree.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { allSkills, loadRegistry, findSkills, getSkill, writeUserSkill } from "./registry";
import { diagnose, repair, renderSkillFile, logDiagnosis, recordSkillError, getSkillErrors } from "./health";
import { Skill } from "./types";
import { textResponse, errorResponse } from "../utils/respond";
import { logger } from "../utils/logger";

/** Tool names registered on this server, filled in during registration. */
let availableTools: Set<string> = new Set();

/** Tell the skill system which tools exist, so diagnosis judges against reality. */
export function setAvailableTools(tools: Iterable<string>): void {
  availableTools = new Set(tools);
}

export function getAvailableTools(): ReadonlySet<string> {
  return availableTools;
}

/**
 * Should a repairable skill be rewritten automatically?
 *
 * On by default: the only repairs this performs are one-for-one substitutions of
 * a tool that does not exist for the one that does, which is strictly better
 * than letting the model call something that will fail. Set
 * FIGMA_MCP_SKILL_AUTOREPAIR=off (or false) to review repairs instead of
 * applying them.
 */
function autoRepairEnabled(): boolean {
  // A DXT boolean arrives as the string "true"/"false", and an untouched field
  // arrives empty — so accept every spelling of "no" and default to on.
  const raw = (process.env.FIGMA_MCP_SKILL_AUTOREPAIR || "").trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(raw);
}

/**
 * Diagnose every skill and, where a repair is mechanical and unambiguous, write
 * the next version out. Returns a line per skill that changed.
 */
export function runHealthPass(): string[] {
  const notes: string[] = [];

  for (const skill of allSkills()) {
    const diagnosis = diagnose(skill, availableTools);
    logDiagnosis(diagnosis);

    if (!diagnosis.repairable) continue;

    const fix = repair(skill, diagnosis);
    if (!fix) continue;

    if (!autoRepairEnabled()) {
      notes.push(`${skill.id}: repair available (${fix.changes.join("; ")}) — auto-repair is off`);
      continue;
    }

    try {
      const contents = renderSkillFile(
        skill,
        fix,
        `Automatic repair: tool names corrected against the running plugin.`
      );
      writeUserSkill(fix.toId, contents);
      notes.push(`${skill.id} -> ${fix.toId}: ${fix.changes.join("; ")}`);
    } catch (error) {
      logger.warn(
        `[skills] could not write repair for ${skill.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (notes.length) {
    // Re-read so the repaired versions are the ones served from here on.
    loadRegistry(true);
  }
  return notes;
}

/** Register one MCP prompt per skill. */
export function registerSkillPrompts(server: McpServer): void {
  for (const skill of allSkills()) {
    server.prompt(skill.id, skill.description, () => ({
      messages: [{ role: "assistant" as const, content: { type: "text" as const, text: renderForModel(skill) } }],
      description: skill.description,
    }));
  }
}

/**
 * The `figma_skill` tool: one tool, three modes, so the schema cost stays small.
 *
 *   no arguments  -> the catalogue
 *   name          -> that skill's full instructions
 *   query         -> the best matching skills
 */
export function registerSkillTools(server: McpServer): void {
  server.tool(
    "figma_skill",
    skillToolDescription(),
    {
      name: z.string().optional().describe("Skill ID to load in full, e.g. Layer_Rename_v1"),
      query: z.string().optional().describe("Describe the task to find matching skills, e.g. 'clean up messy layer names'"),
    },
    async ({ name, query }) => {
      try {
        if (name) {
          const skill = getSkill(name);
          if (!skill) {
            const suggestions = findSkills(name, 3);
            return textResponse(
              `No skill named "${name}".` +
                (suggestions.length ? ` Closest: ${suggestions.map((s) => s.id).join(", ")}.` : "") +
                ` Call figma_skill with no arguments to see the catalogue.`
            );
          }
          return textResponse(renderForModel(skill));
        }

        if (query) {
          const matches = findSkills(query);
          if (matches.length === 0) {
            return textResponse(
              `No skill matches "${query}". Available: ${allSkills().map((s) => s.id).join(", ") || "none"}.`
            );
          }
          return textResponse(
            `Matching skills, best first. Load one with figma_skill({name}).\n\n${matches.map(catalogueLine).join("\n")}`
          );
        }

        return textResponse(renderCatalogue());
      } catch (error) {
        return errorResponse("loading skill", error);
      }
    }
  );
}

/**
 * The `figma_skill` description, built from the registry at registration time.
 *
 * The catalogue has to be IN the description, not behind a call. A model looking
 * at "rename this layer" reasons that it is a one-liner and calls `rename_node`;
 * it never occurs to it to go browsing a catalogue first. Naming the skills and
 * their triggers here is what makes it notice that a procedure already exists —
 * a few dozen tokens to stop the model improvising a job that was already solved.
 */
export function skillToolDescription(): string {
  const skills = allSkills();

  const preamble =
    "Load a Figma workflow skill — a vetted, step-by-step procedure for a recurring design task. " +
    "Call with `name` to load one in full, `query` to search, or no arguments for the catalogue.";

  if (skills.length === 0) return preamble;

  const catalogue = skills
    .map((skill) => `${skill.id} (${skill.triggers.slice(0, 5).join(", ") || skill.title})`)
    .join("; ");

  return (
    `${preamble}\n\n` +
    `MANDATORY: before doing any Figma work that one of these skills covers, load it and follow it. ` +
    `Do not improvise a job a skill already defines — the skill encodes decisions (including when NOT to ask the user) ` +
    `that you would otherwise get wrong.\n\n` +
    `Available: ${catalogue}`
  );
}

/** One line per skill, for callers that want to show the catalogue inline. */
export function catalogueSummary(): string {
  const skills = allSkills();
  if (skills.length === 0) return "";
  return skills.map((skill) => `${skill.id} — ${skill.triggers.slice(0, 5).join(", ") || skill.title}`).join("\n");
}

/** Record a failure against a skill so the health pass can report it. */
export function reportSkillFailure(skillId: string, message: string): void {
  recordSkillError(skillId, message);
}

/** Errors seen for a skill this session. */
export function skillErrors(skillId: string): ReturnType<typeof getSkillErrors> {
  return getSkillErrors(skillId);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function catalogueLine(skill: Skill): string {
  const triggers = skill.triggers.length ? ` — triggers: ${skill.triggers.slice(0, 4).join(", ")}` : "";
  return `- ${skill.id}: ${skill.title}${triggers}`;
}

function renderCatalogue(): string {
  const report = loadRegistry();
  if (report.registered.length === 0) {
    return "No skills are registered. Add Markdown skill files to the skills directory (FIGMA_MCP_SKILLS_DIR).";
  }

  const lines = [
    `${report.registered.length} skill(s) available. Load one with figma_skill({name: "<id>"}).`,
    "",
    ...report.registered.map(catalogueLine),
  ];

  if (report.failures.length) {
    lines.push("", "Rejected (not loaded):");
    for (const failure of report.failures) lines.push(`- ${failure.id}: ${failure.reason}`);
  }

  return lines.join("\n");
}

/**
 * A skill as the model should receive it: the instructions, plus the small
 * amount of context that keeps it from going wrong — which tools it expects and
 * whether any of them are missing here.
 */
function renderForModel(skill: Skill): string {
  const parts = [`# Skill: ${skill.title} (${skill.id})`, "", skill.body];

  const missing = skill.uses.filter((tool) => !availableTools.has(tool));
  if (missing.length) {
    parts.push(
      "",
      "---",
      "",
      `NOTE: this skill references ${missing.length} tool(s) not advertised under the active profile: ` +
        `${missing.join(", ")}. They remain callable through figma_batch by name.`
    );
  }

  return parts.join("\n");
}
