/**
 * Skill types and the frontmatter parser.
 *
 * A skill is a Markdown file with YAML-ish frontmatter. Only the small subset of
 * YAML the format actually uses is parsed — scalars, folded scalars (`>`) and
 * string lists — rather than pulling in a YAML dependency for a handful of keys.
 */

/** Where a skill came from. Built-ins ship with the extension; user skills are read from disk. */
export type SkillSource = "builtin" | "user";

export interface Skill {
  /** Canonical ID, `Category_Action_vN`. Doubles as the MCP prompt name. */
  id: string;
  /** Short human title. */
  title: string;
  /** One-paragraph description of when to use the skill. */
  description: string;
  /** Phrases that should bring this skill to mind. Used for lookup and collision checks. */
  triggers: string[];
  /** Tool names the skill instructs the model to call. Validated against the live tool set. */
  uses: string[];
  /** The instruction body, everything after the frontmatter. */
  body: string;
  source: SkillSource;
  /** Absolute path for user skills; undefined for built-ins compiled into the bundle. */
  path?: string;
}

/** A skill file that could not be loaded, kept so the failure is reportable rather than silent. */
export interface SkillLoadFailure {
  id: string;
  path?: string;
  reason: string;
  hint?: string;
}

export interface RawSkill {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Split a skill file into frontmatter and body.
 * Returns null when the file has no frontmatter block at all.
 */
export function parseSkillFile(text: string): RawSkill | null {
  const match = FRONTMATTER.exec(text.replace(/^﻿/, ""));
  if (!match) return null;
  return { frontmatter: parseFrontmatter(match[1]), body: match[2].trim() };
}

/**
 * Parse the frontmatter subset this format uses:
 *
 *   key: value            scalar
 *   key: >                folded scalar, continued by indented lines
 *     more text
 *   key:                  list
 *     - item
 */
function parseFrontmatter(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = text.split(/\r?\n/);

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim() || line.trimStart().startsWith("#")) {
      index++;
      continue;
    }

    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!keyMatch) {
      index++;
      continue;
    }

    const key = keyMatch[1];
    const inline = keyMatch[2].trim();
    index++;

    // Folded scalar: join the indented continuation lines with spaces.
    if (inline === ">" || inline === ">-" || inline === "|") {
      const parts: string[] = [];
      while (index < lines.length && (lines[index].trim() === "" || /^\s+\S/.test(lines[index]))) {
        parts.push(lines[index].trim());
        index++;
      }
      out[key] = parts.join(inline === "|" ? "\n" : " ").trim();
      continue;
    }

    // List: indented "- item" lines.
    if (inline === "") {
      const items: string[] = [];
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(unquote(lines[index].replace(/^\s*-\s+/, "").trim()));
        index++;
      }
      out[key] = items;
      continue;
    }

    out[key] = unquote(inline);
  }

  return out;
}

function unquote(value: string): string {
  const match = /^(['"])([\s\S]*)\1$/.exec(value);
  return match ? match[2] : value;
}

/** Read a frontmatter value as a string, whatever shape it was written in. */
export function asString(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(" ") : value;
}

/** Read a frontmatter value as a list, accepting a comma-separated scalar too. */
export function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
