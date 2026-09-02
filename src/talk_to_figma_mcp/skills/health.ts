/**
 * Skill health: diagnosis, repair and versioning.
 *
 * What this can honestly do, and what it cannot, is worth stating plainly.
 *
 * It CAN fix the failure that actually breaks skills in practice: a skill naming
 * a tool that does not exist here. Skills get written against a different Figma
 * MCP server, or against a version of this one where a tool had another name,
 * and then the model dutifully calls something that was never registered. That
 * is mechanically detectable (compare `uses:` against the live tool set) and,
 * where a known equivalent exists, mechanically fixable. When it fixes one, it
 * writes a new version of the skill rather than editing in place, so the
 * previous version stays as the record of what changed.
 *
 * It CANNOT fix a skill whose *instructions* are wrong — prose that produces bad
 * designs, a missing step, an ordering mistake. Nothing here inspects meaning.
 * Those surface as recorded runtime errors against the skill, for a person to
 * read and act on; the system will not silently rewrite guidance it cannot
 * evaluate.
 */

import { Skill } from "./types";
import { parseSkillId, nextVersionId } from "./naming";
import { logger } from "../utils/logger";

/**
 * Tools that skills commonly name but this plugin does not have, mapped to the
 * tool that does the same job here.
 *
 * Every entry is a genuine one-for-one substitution. A tool with no real
 * equivalent belongs in UNAVAILABLE_TOOLS instead — silently swapping it for
 * something that behaves differently would be worse than reporting it.
 */
export const TOOL_EQUIVALENTS: Record<string, string> = {
  // From the official Figma MCP server, which renders a design to an image.
  get_screenshot: "export_node_as_image",
  get_image: "export_node_as_image",
  // Earlier names used by this plugin.
  get_node: "get_node_info",
  get_nodes: "get_nodes_info",
  set_text: "set_text_content",
  set_layout_mode: "set_auto_layout",
  get_components: "get_local_components",
};

/**
 * Tools that some skills reference and that have no equivalent here at all.
 * Reported, never substituted.
 */
export const UNAVAILABLE_TOOLS: Record<string, string> = {
  get_design_context: "no equivalent — use get_node_info plus export_node_as_image",
  get_variable_defs: "use get_variables",
  create_new_file: "no equivalent — this plugin edits the open file only",
};

export type SkillIssue =
  | { kind: "unknown-tool"; tool: string; replacement: string; repairable: true }
  | { kind: "unavailable-tool"; tool: string; note: string; repairable: false }
  | { kind: "undeclared-tool"; tool: string; repairable: false }
  | { kind: "runtime-error"; message: string; count: number; repairable: false };

export interface Diagnosis {
  skillId: string;
  issues: SkillIssue[];
  /** True when at least one issue can be fixed mechanically. */
  repairable: boolean;
}

/** A repair that has been computed but not yet written anywhere. */
export interface Repair {
  fromId: string;
  toId: string;
  body: string;
  uses: string[];
  changes: string[];
}

// ── Runtime error log ───────────────────────────────────────────────────────

interface ErrorRecord {
  message: string;
  count: number;
  lastSeen: number;
}

const runtimeErrors = new Map<string, Map<string, ErrorRecord>>();

/**
 * Record that something went wrong while a skill was driving the session.
 * Messages are collapsed by text so one repeated failure does not drown out
 * nine distinct ones.
 */
export function recordSkillError(skillId: string, message: string, now: number = Date.now()): void {
  let forSkill = runtimeErrors.get(skillId);
  if (!forSkill) {
    forSkill = new Map();
    runtimeErrors.set(skillId, forSkill);
  }

  const key = message.slice(0, 200);
  const existing = forSkill.get(key);
  if (existing) {
    existing.count++;
    existing.lastSeen = now;
  } else {
    forSkill.set(key, { message: key, count: 1, lastSeen: now });
  }
}

/** Errors recorded against a skill this session, most frequent first. */
export function getSkillErrors(skillId: string): ErrorRecord[] {
  const forSkill = runtimeErrors.get(skillId);
  if (!forSkill) return [];
  return [...forSkill.values()].sort((a, b) => b.count - a.count);
}

/** Clear the recorded errors for one skill, or all of them. */
export function clearSkillErrors(skillId?: string): void {
  if (skillId) runtimeErrors.delete(skillId);
  else runtimeErrors.clear();
}

// ── Diagnosis ───────────────────────────────────────────────────────────────

/**
 * Check a skill against the tools that actually exist.
 *
 * `availableTools` is the live registered set, so a skill is judged against the
 * profile the user is really running, not against a hard-coded list that would
 * drift the moment a tool is added.
 */
export function diagnose(skill: Skill, availableTools: ReadonlySet<string>): Diagnosis {
  const issues: SkillIssue[] = [];

  for (const tool of skill.uses) {
    if (availableTools.has(tool)) continue;

    const replacement = TOOL_EQUIVALENTS[tool];
    if (replacement && availableTools.has(replacement)) {
      issues.push({ kind: "unknown-tool", tool, replacement, repairable: true });
      continue;
    }

    const note = UNAVAILABLE_TOOLS[tool];
    if (note) {
      issues.push({ kind: "unavailable-tool", tool, note, repairable: false });
      continue;
    }

    issues.push({
      kind: "unavailable-tool",
      tool,
      note: "not registered under the active tool profile — reachable via figma_batch",
      repairable: false,
    });
  }

  // A tool the body calls but the frontmatter never declared. Not an error the
  // model would hit, but it defeats this whole check, so it is worth surfacing.
  for (const tool of toolsMentionedIn(skill.body)) {
    if (!skill.uses.includes(tool) && availableTools.has(tool)) {
      issues.push({ kind: "undeclared-tool", tool, repairable: false });
    }
  }

  for (const error of getSkillErrors(skill.id)) {
    issues.push({ kind: "runtime-error", message: error.message, count: error.count, repairable: false });
  }

  return {
    skillId: skill.id,
    issues,
    repairable: issues.some((issue) => issue.repairable),
  };
}

/** Tool names the body calls out in backticks, e.g. `get_node_info`. */
function toolsMentionedIn(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/`([a-z][a-z0-9_]{4,})`/g)) {
    if (match[1].includes("_")) found.add(match[1]);
  }
  return [...found];
}

// ── Repair ──────────────────────────────────────────────────────────────────

/**
 * Compute the repaired version of a skill. Returns null when there is nothing
 * mechanically fixable — a diagnosis full of runtime errors produces no repair,
 * by design.
 */
export function repair(skill: Skill, diagnosis: Diagnosis): Repair | null {
  const fixes = diagnosis.issues.filter(
    (issue): issue is Extract<SkillIssue, { kind: "unknown-tool" }> => issue.kind === "unknown-tool"
  );
  if (fixes.length === 0) return null;

  const parsed = parseSkillId(skill.id);
  if (!parsed) return null;

  let body = skill.body;
  let uses = [...skill.uses];
  const changes: string[] = [];

  for (const fix of fixes) {
    // Replace whole-word occurrences only, so `get_node` never mangles
    // `get_node_info` on its way past.
    const pattern = new RegExp(`\\b${escapeRegExp(fix.tool)}\\b`, "g");
    const occurrences = (body.match(pattern) || []).length;
    body = body.replace(pattern, fix.replacement);
    uses = uses.map((tool) => (tool === fix.tool ? fix.replacement : tool));
    changes.push(
      `${fix.tool} -> ${fix.replacement}${occurrences ? ` (${occurrences} mention${occurrences === 1 ? "" : "s"} in body)` : ""}`
    );
  }

  // A substitution can collapse two names onto one; keep the list distinct.
  uses = [...new Set(uses)];

  return { fromId: skill.id, toId: nextVersionId(parsed), body, uses, changes };
}

/** Render a repaired skill back to a complete Markdown file. */
export function renderSkillFile(skill: Skill, repaired: Repair, reason: string): string {
  const lines = [
    "---",
    `id: ${repaired.toId}`,
    `title: ${skill.title}`,
    "description: >",
    ...wrap(skill.description, 76).map((line) => `  ${line}`),
  ];

  if (skill.triggers.length) {
    lines.push("triggers:");
    for (const trigger of skill.triggers) lines.push(`  - ${trigger}`);
  }

  lines.push("uses:");
  for (const tool of repaired.uses) lines.push(`  - ${tool}`);

  lines.push(`supersedes: ${repaired.fromId}`);
  lines.push("repaired: >");
  lines.push(`  ${reason}`);
  for (const change of repaired.changes) lines.push(`  ${change}`);
  lines.push("---", "", repaired.body, "");

  return lines.join("\n");
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One-line summary of a diagnosis, for the startup log. */
export function summarize(diagnosis: Diagnosis): string {
  if (diagnosis.issues.length === 0) return `${diagnosis.skillId}: healthy`;
  const parts = diagnosis.issues.map((issue) => {
    switch (issue.kind) {
      case "unknown-tool":
        return `${issue.tool} -> ${issue.replacement}`;
      case "unavailable-tool":
        return `${issue.tool} unavailable (${issue.note})`;
      case "undeclared-tool":
        return `${issue.tool} used but not declared`;
      case "runtime-error":
        return `runtime error x${issue.count}: ${issue.message}`;
    }
  });
  return `${diagnosis.skillId}: ${parts.join("; ")}`;
}

export function logDiagnosis(diagnosis: Diagnosis): void {
  if (diagnosis.issues.length === 0) return;
  logger.info(`[skills] ${summarize(diagnosis)}`);
}
