/**
 * The central skill repository.
 *
 * Everything that reads or writes a skill goes through here. That is the point:
 * one place that knows what exists, what version it is at, whether it is healthy
 * and whether it duplicates something else — instead of the answer living in
 * several modules that drift apart.
 *
 * Skills come from two places and are treated identically once loaded:
 *
 *   - Built-ins, compiled into the bundle at build time from `skills/*.md` by
 *     `scripts/build-skills.js`. They ship inside the .dxt, so there is no disk
 *     read at startup and nothing to install.
 *   - User skills, read at runtime from FIGMA_MCP_SKILLS_DIR (default
 *     ~/.figma-mcp/skills). Drop a .md file there and it is live on the next
 *     start — no rebuild.
 *
 * A user skill with the same ID as a built-in wins, so a built-in can be
 * overridden without forking the extension.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Skill, SkillLoadFailure, parseSkillFile, asString, asList } from "./types";
import { parseSkillId, explainInvalidId, findSuperseded } from "./naming";
import { checkDuplicate, describeVerdict, blocksRegistration, DuplicateVerdict } from "./dedupe";
import { BUILTIN_SKILLS } from "./generated";
import { logger } from "../utils/logger";

export interface RegistryReport {
  registered: Skill[];
  failures: SkillLoadFailure[];
  /** Non-blocking duplication findings worth telling the author about. */
  warnings: string[];
  /** Older versions that were skipped because a newer one exists. */
  superseded: string[];
}

let cachedReport: RegistryReport | null = null;

/** Directory user skills are read from. */
export function userSkillsDir(): string {
  const configured = (process.env.FIGMA_MCP_SKILLS_DIR || "").trim();
  if (configured) return configured;
  return path.join(os.homedir(), ".figma-mcp", "skills");
}

/**
 * Load, validate and index every skill. Cached: the repository is read once per
 * process, so nothing on a request path ever touches the disk.
 */
export function loadRegistry(force = false): RegistryReport {
  if (cachedReport && !force) return cachedReport;

  const failures: SkillLoadFailure[] = [];
  const warnings: string[] = [];
  const candidates: Skill[] = [];

  for (const builtin of BUILTIN_SKILLS) {
    const skill = materialize(builtin.id, builtin.text, "builtin", undefined, failures);
    if (skill) candidates.push(skill);
  }

  for (const { id, text, file } of readUserSkillFiles(failures)) {
    const skill = materialize(id, text, "user", file, failures);
    if (skill) candidates.push(skill);
  }

  // A user skill overrides a built-in with the same ID.
  const byId = new Map<string, Skill>();
  for (const skill of candidates) {
    const existing = byId.get(skill.id);
    if (existing && existing.source === "user" && skill.source === "builtin") continue;
    if (existing && existing.source === "builtin" && skill.source === "user") {
      warnings.push(`"${skill.id}" from ${skill.path} overrides the built-in skill of the same ID.`);
    }
    byId.set(skill.id, skill);
  }

  // Retire older versions of the same family.
  const supersededIds = new Set(findSuperseded([...byId.keys()]));
  for (const id of supersededIds) byId.delete(id);

  // Duplication check, in a stable order so the outcome does not depend on
  // filesystem enumeration order.
  const ordered = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const registered: Skill[] = [];

  for (const skill of ordered) {
    const verdict: DuplicateVerdict = checkDuplicate(skill, registered);
    if (blocksRegistration(verdict)) {
      failures.push({
        id: skill.id,
        path: skill.path,
        reason: describeVerdict(skill.id, verdict),
        hint: "Bump the existing skill's version rather than adding a near-copy.",
      });
      continue;
    }
    if (verdict.kind !== "unique") warnings.push(describeVerdict(skill.id, verdict));
    registered.push(skill);
  }

  cachedReport = { registered, failures, warnings, superseded: [...supersededIds] };

  logger.info(
    `[skills] ${registered.length} registered` +
      (supersededIds.size ? `, ${supersededIds.size} superseded` : "") +
      (failures.length ? `, ${failures.length} rejected` : "") +
      (warnings.length ? `, ${warnings.length} warning(s)` : "")
  );
  for (const failure of failures) logger.warn(`[skills] rejected ${failure.id}: ${failure.reason}`);
  for (const warning of warnings) logger.info(`[skills] ${warning}`);

  return cachedReport;
}

/** Every registered skill. */
export function allSkills(): Skill[] {
  return loadRegistry().registered;
}

/** Look up one skill by exact ID. */
export function getSkill(id: string): Skill | undefined {
  return allSkills().find((skill) => skill.id === id);
}

/**
 * Find the skills most likely to apply to a request, best match first.
 *
 * Scoring is deliberately simple — an exact trigger phrase beats a partial one,
 * which beats a description word. Anything cleverer would need to be tuned, and
 * a wrong-but-confident match is worse here than an obvious one.
 */
export function findSkills(query: string, limit = 5): Skill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const words = needle.split(/\s+/).filter((word) => word.length > 3);

  const scored = allSkills().map((skill) => {
    let score = 0;

    for (const trigger of skill.triggers) {
      const lower = trigger.toLowerCase();
      if (needle.includes(lower)) score += 10;
      else if (words.some((word) => lower.includes(word))) score += 3;
    }

    const haystack = `${skill.title} ${skill.description}`.toLowerCase();
    for (const word of words) if (haystack.includes(word)) score += 1;

    return { skill, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, limit)
    .map((entry) => entry.skill);
}

// ── Loading helpers ─────────────────────────────────────────────────────────

/**
 * Turn raw file text into a validated Skill, or push a failure and return null.
 * A malformed skill never throws: one bad file must not stop the server.
 */
function materialize(
  fallbackId: string,
  text: string,
  source: Skill["source"],
  file: string | undefined,
  failures: SkillLoadFailure[]
): Skill | null {
  const parsed = parseSkillFile(text);
  if (!parsed) {
    failures.push({
      id: fallbackId,
      path: file,
      reason: "no frontmatter block",
      hint: "Start the file with a --- delimited block declaring at least id and description.",
    });
    return null;
  }

  const id = asString(parsed.frontmatter.id) || fallbackId;

  if (!parseSkillId(id)) {
    const problem = explainInvalidId(id);
    failures.push({ id, path: file, reason: problem.reason, hint: problem.hint });
    return null;
  }

  const description = asString(parsed.frontmatter.description);
  if (!description) {
    failures.push({
      id,
      path: file,
      reason: "no description",
      hint: "The description is what the model reads to decide whether the skill applies.",
    });
    return null;
  }

  if (!parsed.body.trim()) {
    failures.push({ id, path: file, reason: "empty body", hint: "A skill with no instructions does nothing." });
    return null;
  }

  return {
    id,
    title: asString(parsed.frontmatter.title) || id,
    description,
    triggers: asList(parsed.frontmatter.triggers),
    uses: asList(parsed.frontmatter.uses),
    body: parsed.body,
    source,
    path: file,
  };
}

/** Read every .md file in the user skills directory. Missing directory is normal. */
function readUserSkillFiles(
  failures: SkillLoadFailure[]
): Array<{ id: string; text: string; file: string }> {
  const dir = userSkillsDir();
  let names: string[];

  try {
    if (!fs.existsSync(dir)) return [];
    names = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".md"));
  } catch (error) {
    logger.warn(`[skills] could not read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  const out: Array<{ id: string; text: string; file: string }> = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      out.push({ id: name.replace(/\.md$/i, ""), text: fs.readFileSync(file, "utf8"), file });
    } catch (error) {
      failures.push({
        id: name.replace(/\.md$/i, ""),
        path: file,
        reason: `could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return out;
}

/**
 * Write a new skill version into the user skills directory.
 *
 * Used by the repair path. Built-ins live inside the bundle and cannot be
 * rewritten, so a repaired built-in is written out as a user skill — which then
 * overrides it, giving the same result without touching the shipped extension.
 */
export function writeUserSkill(id: string, contents: string): string {
  const dir = userSkillsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.md`);
  fs.writeFileSync(file, contents, "utf8");
  cachedReport = null; // next read picks it up
  logger.info(`[skills] wrote ${file}`);
  return file;
}

/** Drop the cache so the next call re-reads the repository. */
export function invalidateRegistry(): void {
  cachedReport = null;
}
