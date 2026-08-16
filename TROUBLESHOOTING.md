# Troubleshooting

📖 [**Commands**](COMMANDS.md) | 🚀 [**Installation**](INSTALLATION.md) | 🛠️ [**Contributing**](CONTRIBUTING.md) | 🆘 [**Troubleshooting**](TROUBLESHOOTING.md) | 📜 [**Changelog**](CHANGELOG.md)

Guide to resolving the most common errors.

## Connection issues

### "Cannot connect to WebSocket"

**Cause:** The server is not running.

**Solution:**
1. Open a terminal
2. Run `npx claude-talk-to-figma-mcp`
3. Verify it's working at `http://localhost:3055/status`

### "Plugin not found"

**Cause:** The plugin is not correctly imported in Figma.

**Solution:**
1. In Figma: Menu → Plugins → Development → Import plugin from manifest
2. Select `manifest.json` from the `src/claude_mcp_plugin/` folder
3. Restart Figma if necessary

### "MCP not available"

**Claude Desktop:**
1. Download the latest version of `claude-talk-to-figma-mcp.dxt` from [releases](https://github.com/arinspunk/claude-talk-to-figma-mcp/releases).
2. Double-click the file to launch it. Claude Desktop will install and configure it automatically.
3. Restart Claude Desktop and verify that "ClaudeTalkToFigma" appears in the MCPs menu.

**Cursor:**
1. Go to Settings → Tools & MCP
2. Click on New MCP Server
3. Verify that the configuration in `mcp.json` is correct
```json
{
   "mcpServers": {
      "ClaudeTalkToFigma": {
         "command": "npx",
         "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"]
      },
      "another MCP": {},
      "etc": {}
   }
}
```
4. Restart Cursor


## Execution issues

### "Command failed"

**Cause:** Error during command execution in Figma.

**Solution:**
1. Open the Figma development console (Menu → Plugins → Development → Show/Hide console)
2. Check error messages
3. Verify that you have editing permissions on the document

### "Font not found"

**Cause:** The requested font is not available in Figma.

**Solution:**
1. Use `load_font_async` to check availability
2. Some team fonts require manual loading in Figma
3. Use an available alternative font

### "Permission denied"

**Cause:** You don't have editing permissions on the document.

**Solution:**
1. Verify that you have edit access (not just view-only)
2. If it's a team file, contact the administrator

### "Timeout error"

**Cause:** Complex operations may take longer than expected.

**Solution:**
1. Try again
2. Break the operation into smaller steps
3. In large documents, work with specific selections

## Comment tool issues

Comment tools use the Figma **REST API**, not the plugin — so socket/channel problems are irrelevant here, and token problems only affect these tools.

### "No Figma access token found"

`FIGMA_ACCESS_TOKEN` is not reaching the MCP server process.

- Add it to the `env` block of your client's MCP config (not your shell profile — most clients launch the server without inheriting your shell)
- Restart the client fully after editing the config
- Verify with `get_figma_account`

See [token setup](INSTALLATION.md#4-optional-enable-comment-tools-figma-rest-token).

### "401/403 — token rejected by Figma"

- The token was revoked, mistyped, or truncated (they are long; make sure the whole `figd_...` string was copied)
- The token lacks scopes: you need `files:read`, plus `file_comments:write` to reply or delete
- Your account cannot open that file — check it in the browser while signed in as the token owner

### "404 — not found"

- **File key** comes from `figma.com/design/<FILE_KEY>/<name>` — not the whole URL
- **Team id** comes from `figma.com/files/team/<TEAM_ID>/...`
- Replying requires the **root** comment id (`commentId` in the output), not a reply's id

### "Some files could not be read"

Expected when sweeping a whole team: it lists files your token cannot open. The sweep still returns everything else. Narrow the scope with `projectIds` or `fileKeys` if the noise is unhelpful.

### "429 — rate limit"

The sweep is hitting Figma too hard.

- Lower `FIGMA_API_CONCURRENCY` (default `4`, try `2`)
- Reduce `maxFiles`, or scope to `projectIds` instead of a whole `teamId`
- Retries with backoff are automatic; raise `FIGMA_API_MAX_RETRIES` if needed

### Comments appear missing

- Resolved threads are hidden unless you pass `includeResolved: true`
- `get_my_comments` filters to the token owner — use `get_file_comments` to see everyone's
- `authorScope: "root"` only returns threads you *started*; use `"any"` to include ones you replied in

## Performance issues

### Slow responses

**Cause:** Very large documents require more processing time.

**Solution:**
1. Work on specific pages, not the entire document
2. Close Figma tabs you're not using
3. Restart Figma if it has been open for a long time

### WebSocket disconnections

**Cause:** The server lost the connection.

**Solution:**
1. The server attempts to reconnect automatically
2. If it persists, restart the server: `npx claude-talk-to-figma-mcp`
3. Reconnect the channel from the plugin

### High memory usage

**Cause:** Prolonged sessions or complex documents.

**Solution:**
1. Close unnecessary Figma tabs
2. Restart Figma periodically
3. Restart the server if necessary

## General solutions

### Restart sequence

When nothing works, follow this order:

1. Stop the server (Ctrl+C in the terminal)
2. Close your MCP client (Claude, Cursor, etc.)
3. Close Figma
4. Start the server: `npx claude-talk-to-figma-mcp`
5. Open Figma and the plugin
6. Open your MCP client
7. Connect the channel

### Clean reinstall

If issues persist:

```bash
# If you cloned the repository
rm -rf node_modules
bun install
bun run build  # or bun run build:win on Windows
```

### Port conflicts

If port 3055 is occupied:

1. Identify which process is using it:
   - **macOS/Linux:** `lsof -i :3055`
   - **Windows:** `netstat -ano | findstr :3055`
2. Close that process or restart your computer

## Still having issues?

1. Check the [open issues](https://github.com/arinspunk/claude-talk-to-figma-mcp/issues) on GitHub
2. Open a new issue with:
   - Problem description
   - Steps to reproduce
   - Operating system
   - MCP client you're using
   - Error messages (if any)
