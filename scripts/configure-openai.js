#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const serverPath = join(projectDir, "dist", "talk_to_figma_mcp", "server.cjs");
const serverName = "FigmaTalkMCP";

function printDesktopValues() {
  console.log("\nChatGPT Desktop manual values:");
  console.log(`  Name: ${serverName}`);
  console.log("  Type: STDIO");
  console.log(`  Command: ${process.execPath}`);
  console.log(`  Argument: ${serverPath}`);
  console.log(`  Working directory: ${projectDir}`);
}

if (!existsSync(serverPath)) {
  console.error(`Built MCP server not found: ${serverPath}`);
  console.error("Run npm install and npm run build, then try again.");
  process.exit(1);
}

const codexCheck = spawnSync("codex", ["mcp", "list"], { encoding: "utf8" });
if (codexCheck.error?.code === "ENOENT") {
  console.log("Codex CLI was not found, so no shared MCP configuration was changed.");
  printDesktopValues();
  process.exit(0);
}

const combinedList = `${codexCheck.stdout || ""}\n${codexCheck.stderr || ""}`;
if (combinedList.includes(serverName)) {
  console.log(`${serverName} is already present in the shared Codex MCP configuration.`);
  console.log("Restart ChatGPT Desktop or the Codex IDE extension before testing it.");
  printDesktopValues();
  process.exit(0);
}

const result = spawnSync(
  "codex",
  [
    "mcp",
    "add",
    serverName,
    "--",
    process.execPath,
    serverPath,
  ],
  { cwd: projectDir, encoding: "utf8", stdio: "inherit" },
);

if (result.error) {
  console.error(`Could not run Codex CLI: ${result.error.message}`);
  printDesktopValues();
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Codex could not add the MCP server. Use the manual values below.");
  printDesktopValues();
  process.exit(result.status || 1);
}

console.log(`\n${serverName} was added to the shared Codex MCP configuration.`);
console.log("Restart ChatGPT Desktop or the Codex IDE extension before testing it.");
printDesktopValues();
