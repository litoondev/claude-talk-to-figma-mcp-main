![Claude Talk to Figma collage](images/claude-talk-to-figma.png)

# <del>Claude</del> <ins>AI Agents</ins> Talk to Figma MCP

Enable your AI agents to read, analyze, and modify Figma designs.

Works with your favorite agentic tools:

- [Claude Desktop](https://claude.ai/)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Cursor](https://cursor.com/)
- [Antigravity](https://antigravity.google/)
- [Windsurf](https://windsurf.com/)
- [VS Code](https://code.visualstudio.com/) + [GitHub Copilot](https://github.com/features/copilot)
- [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
- [Roo Code](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)

## 👩🏽‍💻 Who it's for

### UX/UI Teams

Automate repetitive design tasks and maintain brand consistency without manual effort:

- **Automated accessibility audits** - Detect and fix contrast issues in seconds
- **Bulk style updates** - Change colors, typography, or spacing across the entire document with a single command
- **Visual hierarchy analysis** - Get instant feedback on your design structure
- **Comment triage** - Read every review thread you're involved in and reply in bulk, without leaving the chat

### Developers

Generate production-ready code directly from designs:

- **React/Vue/SwiftUI components** - From design to code in one step
- **Code with design tokens** - Keep design and development in sync
- **Reduce handoff friction** - Fewer back-and-forth iterations with the design team

> **Key advantage**: Unlike [Figma's official MCP](https://www.figma.com/mcp-catalog/) which requires a Dev Mode license, this MCP **works with any Figma account** (even free ones).

> **Comments included**: Figma's Plugin API cannot see comments at all — they only exist in the REST API. This MCP bridges both, so your agent can read and reply to review threads as well as edit the canvas. See [Comment tools](#-comment-tools).

## 💡 Real-world use cases

**Accessibility:**
> "Find all text with contrast ratio <4.5:1 and suggest colors that meet WCAG AA"

**Rebranding:**
> "Change #FF6B6B to #E63946 in all primary buttons throughout the document"

**Design analysis:**
> "Analyze the visual hierarchy of this screen and suggest improvements based on design principles"

**Developer handoff:**
> "Generate the React component for 'CardProduct' including PropTypes and styles in CSS modules"

**Review triage:**
> "Show me every unresolved comment I'm involved in across the team, flag the ones waiting on my reply, and draft an answer for each"

## ⚡️ Quick installation

**Setup:** 5 minutes | **First automation:** 2 minutes

### Requirements

- [Node.js](https://nodejs.org/en/download) installed
- [Figma Desktop](https://www.figma.com/downloads/)
- AI client:
  - [Claude Desktop](https://claude.ai/download)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Cursor](https://cursor.com/downloads)
  - [Antigravity](https://antigravity.google/download)
  - [Windsurf](https://windsurf.com/download)
  - [VS Code](https://code.visualstudio.com/) + [GitHub Copilot](https://github.com/features/copilot)
  - [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
  - [Roo Code](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)

### Step 1: Install and start the websocket

*Enables the Agent to send commands to Figma.*

Clone this fork and build it:

```bash
git clone https://github.com/litoondev/claude-talk-to-figma-mcp-main.git
cd claude-talk-to-figma-mcp-main
npm install
npm run build        # on Windows: npm run build:win
npm run socket
```

> **⚠️ Don't use `npx claude-talk-to-figma-mcp`.** That installs the upstream package, which does **not** include the comment tools. This fork must be built from source (or installed via the DXT below).

> **💡 Tip**: In later sessions just run `npm run socket` from the project folder — you only build once per update.

### Step 2: Install the plugin in Figma

*Enables Figma to receive commands from the agent and return responses.*

In Figma Desktop go to Menu → Plugins → Development → Import plugin from manifest → inside the folder where you installed the MCP, select `src/claude_mcp_plugin/manifest.json`

### Step 3: Configure your Agentic Tool

*Enables the agent to use the MCP's read and modify tools.*

#### Claude Desktop

Build the extension with `npm run build:dxt`, then double-click the generated `.dxt`. Claude configures itself automatically and **prompts you for your Figma token** during install — no config file editing needed.

#### Cursor

1. Open **Cursor Settings → Tools & Integrations**
2. Click **"New MCP Server"** to open the `mcp.json` file
3. Add this configuration, pointing at your local build:
  ```json
  {
    "mcpServers": {
      "ClaudeTalkToFigma": {
        "command": "node",
        "args": ["/absolute/path/to/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs"],
        "env": { "FIGMA_ACCESS_TOKEN": "figd_your_token_here" }
      }
    }
  }
  ```
  On Windows, escape the backslashes: `"H:\\claude-talk-to-figma-mcp-main\\dist\\talk_to_figma_mcp\\server.cjs"`
4. Save the file and restart Cursor

#### Other Agentic Tools

For other tools (Claude Code, Windsurf, VS Code + GitHub Copilot, Cline, Roo Code), you can follow the instructions in the ["Configure your Agentic Tool" chapter of the detailed installation guide](INSTALLATION.md#3-configure-your-agentic-tool).

### Step 4: Start working

1. Open the plugin in Figma
2. Copy the channel ID (bold code inside the green box)
3. Type in the chat: `Connect to Figma, channel {your-ID}`

✅ Ready to design with AI!

## Subsequent work sessions

To use the MCP again in day-to-day work, you don't need to repeat the entire process:

1. **Start the socket**: In the terminal, enter the project folder `your-project/claude-talk-to-figma-mcp` and run `bun run socket` (or `npm run socket`).
2. **Open the plugin in Figma**: You'll find it in your recent plugins list.
3. **Connect the AI**: Copy the channel ID and tell your agent: `Connect to Figma, channel {your-ID}`.

## 🤖 Multi-Agent & Parallel execution

This MCP server supports **safe parallel execution** out of the box, allowing multiple AI agents (e.g. Claude Code's sub-agents or team swarms) to work simultaneously on your Figma file without locking up the plugin. A built-in command queue processes requests sequentially on the server side, preventing the Figma API from timing out.

> **Note**: Because multiple agents can modify the document simultaneously, relying on implicit page context is unsafe. As a result, stateful commands like `set_current_page` are **blocked**. All agents must explicitly provide the intended `parentId` parameter when executing any creation or structural modification command (e.g., `create_frame`, `create_text`).

*(Special thanks to [@mmabas77](https://github.com/mmabas77) for architecting and contributing this feature!)*

## 🐳 Alternative: Using Docker

If you prefer Docker or need to run the WebSocket server in a team environment, see the [Docker installation guide](INSTALLATION.md#alternative-using-docker) in the detailed installation documentation.

## 🛠️ Capabilities

**Design analysis**
- Get document information, current selection, styles
- Scan text, audit components, export assets

**Element creation**
- Shapes, text, frames with full style control
- Clone, group, organize elements

**Modification**
- Colors, borders, corners, shadows
- Auto-layout, advanced typography
- Local components and team library components

**Comments** — see [below](#-comment-tools)

See [complete command list](COMMANDS.md).

## 💬 Comment tools

Read and reply to Figma review threads directly from your agent.

Figma's Plugin API has **no access to comments** — they aren't part of the document tree and are never exposed to plugins. So these tools take a second route: they call Figma's REST API directly. That has two practical consequences:

- They need a personal access token (every other tool does not).
- They work **without** the socket running and **without** `join_channel`.

### No file URL required

`fileKey` is optional on every comment tool. Omit it and the server asks the connected plugin which file is open:

```
You: check all comments
→ reads the comments on whatever file you're looking at
```

Pass `fileKey` explicitly only to target a *different* file — which also works with no plugin channel connected.

> Automatic resolution uses `figma.fileKey`, which requires the private plugin API. It's available for locally imported and organisation plugins (this project sets `enablePrivatePluginApi: true`) and `undefined` on public plugin builds. If unavailable you get an explicit message rather than a silent failure.

### Setup

1. Create a token at Figma → Account settings → Security → Personal access tokens, with **file content: read** (add **comments: read/write** to post replies)
2. Expose it to the MCP server as `FIGMA_ACCESS_TOKEN`:

```json
{
  "mcpServers": {
    "ClaudeTalkToFigma": {
      "command": "node",
      "args": ["/absolute/path/to/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs"],
      "env": { "FIGMA_ACCESS_TOKEN": "figd_your_token_here" }
    }
  }
}
```

If you installed the DXT instead, skip this — the extension prompts for the token on install and stores it as a secret.

3. Restart your client and run `check my Figma account` to verify

Full details, DXT install and tuning options in the [installation guide](INSTALLATION.md#4-optional-enable-comment-tools-figma-rest-token).

### What you can ask

```
✅ "Check all comments"

✅ "Show me every unresolved comment I'm involved in across the team,
    and flag the ones waiting on my reply"

✅ "Read my open comments, look up the node each one is pinned to,
    and draft a reply explaining the fix"

✅ "Reply to all my threads from last week confirming they're addressed
    in v2 — dry run first"
```

Threads come back with author, pin location, resolved status, timestamps and the node id each comment is attached to — so you can hand that id straight to `get_node_info` and reason about what the feedback refers to.

## 📚 Documentation

- [Detailed installation](INSTALLATION.md) — Manual setup, Cursor, Windsurf and other IDEs
- [Available commands](COMMANDS.md) — Complete tool reference
- [Troubleshooting](TROUBLESHOOTING.md) — Common errors and how to fix them
- [Contributing](CONTRIBUTING.md) — Architecture, testing, contribution guide
- [Changelog](CHANGELOG.md) — Version history

## 🙏 Credits

Based on [cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) by Sonny Lazuardi. Adapted for Claude Desktop and extended with new tools by [Xúlio Zé](https://github.com/arinspunk).

This fork adds the Figma REST comment tools and automatic file-key resolution, maintained by [litoondev](https://github.com/litoondev). For the original project, see [arinspunk/claude-talk-to-figma-mcp](https://github.com/arinspunk/claude-talk-to-figma-mcp).

If you want to know about all project contributions, you can visit the ["Contributors" chapter of the contribution guide](CONTRIBUTING.md#contributors).

[MIT License](LICENSE)

---

## 📊 Project status

✅ **Stable production** - Tool ready for daily use in design and development teams

🆕 **New in 1.2.0:**
- Read and reply to Figma comments via the REST API
- Automatic file-key resolution — no pasting file URLs
- Token prompt built into the DXT package

🚀 **Under active development:**
- Complete support for Figma Variables
- Enhanced export to Tailwind CSS/SwiftUI

### Need something specific?

**[Propose new ones on GitHub Issues](https://github.com/litoondev/claude-talk-to-figma-mcp-main/issues)**

For issues with the underlying MCP (not the comment tools), consider [upstream](https://github.com/arinspunk/claude-talk-to-figma-mcp/issues) instead.

Your feedback and contributions keep the project alive. ❤️
