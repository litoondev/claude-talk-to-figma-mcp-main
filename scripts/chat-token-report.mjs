#!/usr/bin/env node
/**
 * Per-chat token report.
 *
 * WHY THIS EXISTS
 * ---------------
 * The MCP server's own `get_token_usage` can only see traffic crossing the Figma
 * bridge — it sits outside the model's context window and cannot observe the
 * conversation. The true per-chat totals live somewhere else: Claude Code writes
 * one JSONL transcript per session under ~/.claude/projects/<slug>/, and every
 * assistant message in it carries the API's own `usage` block.
 *
 * This script sums those blocks, so "how many tokens did that chat cost?" has an
 * answer taken from the API's numbers rather than an estimate.
 *
 * USAGE
 *   node scripts/chat-token-report.mjs              # this project, newest first
 *   node scripts/chat-token-report.mjs --all        # every project
 *   node scripts/chat-token-report.mjs --limit 5
 *   node scripts/chat-token-report.mjs <session-id> # one chat, with its models
 */

import { readdirSync, statSync, createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** Claude Code slugifies the project path by replacing every non-alphanumeric run with "-". */
function slugFor(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function parseArgs(argv) {
  const opts = { all: false, limit: 10, session: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") opts.all = true;
    else if (arg === "--limit") opts.limit = Number(argv[++i]) || 10;
    else if (!arg.startsWith("-")) opts.session = arg;
  }
  return opts;
}

/**
 * Read one transcript and total its usage blocks.
 *
 * Streamed line by line: these files reach tens of megabytes, and a whole-file
 * read would be slower than the report is worth. Malformed lines are skipped —
 * a transcript being appended to while we read it is normal, not an error.
 */
async function readTranscript(file) {
  const totals = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    thinking: 0,
    turns: 0,
    userMessages: 0,
    models: new Map(),
    firstTs: null,
    lastTs: null,
    summary: null,
  };

  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.timestamp) {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(ts)) {
        if (totals.firstTs === null || ts < totals.firstTs) totals.firstTs = ts;
        if (totals.lastTs === null || ts > totals.lastTs) totals.lastTs = ts;
      }
    }

    // The first real user message doubles as the chat's title.
    if (entry.type === "user" && totals.summary === null) {
      const content = entry.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.find((c) => c?.type === "text")?.text
            : null;
      if (text && !text.startsWith("<")) {
        totals.summary = text.replace(/\s+/g, " ").slice(0, 70);
      }
    }
    if (entry.type === "user") totals.userMessages++;

    const usage = entry.message?.usage;
    if (!usage) continue;

    totals.turns++;
    totals.input += usage.input_tokens ?? 0;
    totals.output += usage.output_tokens ?? 0;
    totals.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    totals.cacheRead += usage.cache_read_input_tokens ?? 0;
    totals.thinking += usage.output_tokens_details?.thinking_tokens ?? 0;

    const model = entry.message?.model;
    if (model) totals.models.set(model, (totals.models.get(model) ?? 0) + 1);
  }

  return totals;
}

function fmt(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Local time, not UTC — this is read next to a clock, not a log aggregator. */
function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function collectFiles(opts) {
  if (!existsSync(PROJECTS_DIR)) {
    console.error(`No transcripts found at ${PROJECTS_DIR}.`);
    process.exit(1);
  }

  const dirs = opts.all
    ? readdirSync(PROJECTS_DIR).map((d) => join(PROJECTS_DIR, d))
    : [join(PROJECTS_DIR, slugFor(process.cwd()))];

  const files = [];
  for (const dir of dirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(dir, name);
      files.push({ path, mtime: statSync(path).mtimeMs, project: basename(dir) });
    }
  }

  return files.sort((a, b) => b.mtime - a.mtime);
}

const opts = parseArgs(process.argv.slice(2));
let files = collectFiles(opts);

if (files.length === 0) {
  console.error(
    opts.all
      ? "No transcripts found."
      : `No transcripts for ${process.cwd()}. Try --all.`
  );
  process.exit(1);
}

// A single-session report is a detail view, not a truncated list.
if (opts.session) {
  files = files.filter((f) => basename(f.path).startsWith(opts.session));
  if (files.length === 0) {
    console.error(`No transcript matching session id "${opts.session}".`);
    process.exit(1);
  }
} else {
  files = files.slice(0, opts.limit);
}

const rows = [];
for (const file of files) {
  const t = await readTranscript(file.path);
  if (t.turns === 0) continue;
  rows.push({ ...file, ...t });
}

if (opts.session && rows.length === 1) {
  const r = rows[0];
  console.log(`\nChat ${basename(r.path, ".jsonl")}`);
  if (r.summary) console.log(`  "${r.summary}"`);
  console.log(`  ${fmtDate(r.firstTs)} → ${fmtDate(r.lastTs)}`);
  console.log(`  ${r.turns} model turns · ${r.userMessages} user messages`);
  console.log("");
  console.log(`  fresh input        ${fmt(r.input).padStart(9)}`);
  console.log(`  cache writes       ${fmt(r.cacheWrite).padStart(9)}   billed above base input rate`);
  console.log(`  cache reads        ${fmt(r.cacheRead).padStart(9)}   billed far below base input rate`);
  console.log(`  output             ${fmt(r.output).padStart(9)}${r.thinking ? `   (${fmt(r.thinking)} thinking)` : ""}`);
  console.log(`  ────────────────────────────`);
  console.log(`  total              ${fmt(r.input + r.cacheWrite + r.cacheRead + r.output).padStart(9)}`);
  if (r.models.size > 0) {
    console.log(`\n  models: ${[...r.models].map(([m, n]) => `${m} (${n})`).join(", ")}`);
  }
  console.log(
    "\n  Cached input is not billed like fresh input, so the raw total overstates\n" +
      "  cost. For money rather than tokens, use /cost or the Anthropic Console.\n"
  );
} else {
  console.log(
    `\n${rows.length} chat${rows.length === 1 ? "" : "s"}${opts.all ? " (all projects)" : ` in ${basename(process.cwd())}`}, newest first:\n`
  );
  const head = `${"last active".padEnd(17)}${"turns".padStart(6)}${"input".padStart(9)}${"cache rd".padStart(10)}${"output".padStart(9)}${"total".padStart(9)}  chat`;
  console.log(head);
  console.log("─".repeat(head.length));

  let grand = 0;
  for (const r of rows) {
    const total = r.input + r.cacheWrite + r.cacheRead + r.output;
    grand += total;
    console.log(
      fmtDate(r.lastTs).padEnd(17) +
        String(r.turns).padStart(6) +
        fmt(r.input + r.cacheWrite).padStart(9) +
        fmt(r.cacheRead).padStart(10) +
        fmt(r.output).padStart(9) +
        fmt(total).padStart(9) +
        `  ${r.summary ?? basename(r.path, ".jsonl").slice(0, 8)}`
    );
  }
  console.log("─".repeat(head.length));
  console.log(`${"".padEnd(41)}${"grand total".padStart(0)} ${fmt(grand)}`);
  console.log(
    "\nPass a session id for a full breakdown of one chat:\n" +
      `  node scripts/chat-token-report.mjs ${basename(rows[0].path, ".jsonl")}\n`
  );
}
