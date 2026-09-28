#!/usr/bin/env node
/**
 * Push the current build into the installed extension, without repacking.
 *
 * `npm run build:dxt` rebuilds, repacks and leaves you to reinstall the .mcpb
 * by hand — three steps and a click-through for a one-line change. But Claude
 * Desktop installs an extension by *unpacking* it into
 *   ~/Library/Application Support/Claude/Claude Extensions/<id>/
 * and running `dist/talk_to_figma_mcp/server.cjs` from there. So for anything
 * that is not the manifest, copying the built files over that folder and
 * restarting Claude Desktop does the same job.
 *
 * Repack (`npm run build:dxt`) only when manifest.json changes — user_config
 * fields, env wiring, version, tool profiles — or when shipping the bundle to
 * someone else. Those live in the manifest the installer reads, not in files
 * this script copies.
 *
 *   node scripts/dev-push.js            build first, then copy
 *   node scripts/dev-push.js --no-build copy what is already in dist/
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Claude Desktop unpacks extensions on this platform. */
function extensionsDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "Claude Extensions");
  }
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Roaming", "Claude", "Claude Extensions");
  }
  return path.join(os.homedir(), ".config", "Claude", "Claude Extensions");
}

/**
 * The installed copy of *this* extension. The folder carries an install id
 * (`local.mcpb.<something>.claude-talk-to-figma-mcp`), so match on the suffix
 * rather than hard-coding one machine's id.
 */
function installedExtension() {
  const dir = extensionsDir();
  if (!fs.existsSync(dir)) return null;
  const match = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith("claude-talk-to-figma-mcp"))
    .map((name) => path.join(dir, name))
    .find((full) => fs.existsSync(path.join(full, "manifest.json")));
  return match ?? null;
}

/**
 * Files worth copying: the server bundle, the Figma plugin sources beside it,
 * and the manifest.
 *
 * The manifest is included deliberately. Leaving a stale one next to a fresh
 * server is the worse half-state: the server reads an env var the installed
 * manifest never declares, so the feature is dead while everything compiles —
 * the exact shape of the FIGMA_MCP_WEBFLOW_DESIGNER bug. Copying it keeps the
 * two halves honest. Whether Claude Desktop re-reads it on restart or only at
 * install is its business, not ours; the script says when it changed so you can
 * check the settings page and fall back to a reinstall if a new field is
 * missing.
 */
const PAYLOAD = [
  "manifest.json",
  "dist/talk_to_figma_mcp/server.cjs",
  "dist/talk_to_figma_mcp/server.js",
  "src/claude_mcp_plugin/code.js",
  "src/claude_mcp_plugin/ui.html",
  "src/claude_mcp_plugin/ui-v2.html",
  "src/claude_mcp_plugin/operations-menu.js",
  "src/claude_mcp_plugin/operation-prompts.js",
  "src/claude_mcp_plugin/setcharacters.js",
  "src/claude_mcp_plugin/manifest.json",
];

function main() {
  const target = installedExtension();
  if (!target) {
    console.error(
      `No installed copy found in ${extensionsDir()}.\n` +
        `Install the .mcpb once (npm run build:dxt, then add it in Claude Desktop); after that this script keeps it current.`
    );
    process.exit(1);
  }

  if (!process.argv.includes("--no-build")) {
    console.log("Building...");
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  }

  // Read the installed manifest *before* overwriting it, so we can tell whether
  // this push changes the part Claude Desktop may only read at install time.
  const installedManifest = path.join(target, "manifest.json");
  const manifestBefore = fs.existsSync(installedManifest)
    ? fs.readFileSync(installedManifest, "utf8")
    : null;
  const manifestChanged = manifestBefore !== fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");

  let copied = 0;
  const skipped = [];
  for (const rel of PAYLOAD) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) {
      skipped.push(rel);
      continue;
    }
    const to = path.join(target, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }

  console.log(`\nPushed ${copied} file(s) to ${target}`);
  if (skipped.length) console.log(`Skipped (not built): ${skipped.join(", ")}`);

  console.log("\nRestart Claude Desktop to load the new server.");
  console.log("Figma plugin edits also need the plugin reloaded in Figma.");

  if (manifestChanged) {
    const fields = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).user_config ?? {});
    const before = manifestBefore ? Object.keys(JSON.parse(manifestBefore).user_config ?? {}) : [];
    const added = fields.filter((f) => !before.includes(f));
    console.log(
      `\nmanifest.json changed and was copied over.` +
        (added.length ? ` New settings field(s): ${added.join(", ")}.` : "") +
        `\nAfter the restart, check Settings > Extensions > Claude Talk to Figma.` +
        `\nIf it does not reflect the change, this is the one case that needs the full route:` +
        `\n  npm run build:dxt   then Uninstall and add the .mcpb again.`
    );
  }
}

main();
