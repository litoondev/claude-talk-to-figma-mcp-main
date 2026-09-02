#!/usr/bin/env node
/**
 * Compile `skills/*.md` into a TypeScript module the bundler can inline.
 *
 * Why compile rather than read at runtime: tsup produces a single bundled file
 * and `.dxtignore` excludes `*.md`, so loose Markdown would simply not be in the
 * shipped extension. Inlining also means no disk I/O at startup.
 *
 * Run automatically before every build. Safe to run by hand:
 *   node scripts/build-skills.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const OUT_FILE = path.join(ROOT, "src", "talk_to_figma_mcp", "skills", "generated.ts");

function main() {
  let files = [];
  if (fs.existsSync(SKILLS_DIR)) {
    files = fs
      .readdirSync(SKILLS_DIR)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .sort();
  }

  const entries = files.map((name) => ({
    id: name.replace(/\.md$/i, ""),
    text: fs.readFileSync(path.join(SKILLS_DIR, name), "utf8"),
  }));

  const body = entries
    .map((entry) => `  {\n    id: ${JSON.stringify(entry.id)},\n    text: ${JSON.stringify(entry.text)},\n  },`)
    .join("\n");

  const source = `/**
 * GENERATED FILE — do not edit.
 *
 * Produced by scripts/build-skills.js from the Markdown files in skills/.
 * Edit those and rebuild; edits here are overwritten.
 */

export interface BuiltinSkill {
  id: string;
  text: string;
}

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
${body}
];
`;

  const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
  if (previous === source) {
    console.log(`skills: ${entries.length} skill(s), generated.ts already current`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, source, "utf8");
  console.log(
    `skills: compiled ${entries.length} skill(s) into generated.ts` +
      (entries.length ? ` — ${entries.map((e) => e.id).join(", ")}` : "")
  );
}

main();
