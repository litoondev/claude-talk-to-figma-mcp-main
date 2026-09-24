#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");

const checks = [];

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error?.code === "ENOENT") return null;
  if (result.status !== 0) return null;
  return (result.stdout || result.stderr || "installed").trim().split("\n")[0];
}

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
}

addCheck("Node.js", Boolean(commandVersion("node")), commandVersion("node") || "not found");
addCheck("Bun", Boolean(commandVersion("bun")), commandVersion("bun") || "not found; required by the WebSocket bridge");
addCheck(
  "MCP build",
  existsSync(join(projectDir, "dist", "talk_to_figma_mcp", "server.cjs")),
  existsSync(join(projectDir, "dist", "talk_to_figma_mcp", "server.cjs")) ? "server.cjs found" : "run npm run build",
);
addCheck(
  "Figma manifest",
  existsSync(join(projectDir, "src", "claude_mcp_plugin", "manifest.json")),
  "src/claude_mcp_plugin/manifest.json",
);

try {
  const response = await fetch("http://localhost:3055/status", {
    signal: AbortSignal.timeout(1500),
  });
  addCheck("WebSocket bridge", response.ok, response.ok ? "running on localhost:3055" : `HTTP ${response.status}`);
} catch {
  addCheck("WebSocket bridge", false, "not running; start it with npm run socket");
}

const failed = checks.filter((check) => !check.ok);
console.log(failed.length === 0 ? "\nSetup is ready." : `\n${failed.length} check(s) need attention.`);
process.exitCode = failed.length === 0 ? 0 : 1;
