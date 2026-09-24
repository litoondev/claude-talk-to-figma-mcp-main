# ChatGPT, Codex ও Claude দিয়ে Figma MCP ইনস্টলেশন

এই guide-এ একই local MCP server দিয়ে ChatGPT Desktop, Codex এবং Claude AI থেকে Figma Desktop নিয়ন্ত্রণ করার setup দেখানো হয়েছে। এটি local installation; ChatGPT web-এ public plugin প্রকাশের পদ্ধতি নয়।

## কীভাবে কাজ করে

```text
ChatGPT Desktop / Codex / Claude
                 | MCP (STDIO)
                 v
       এই repository-এর MCP server
                 | WebSocket
                 v
        localhost:3055 bridge
                 | channel ID
                 v
          Figma Desktop plugin
```

## ১. প্রয়োজনীয় software

- Node.js LTS
- Bun
- Figma Desktop
- ব্যবহার করতে চাওয়া AI client: ChatGPT Desktop/Codex অথবা Claude Desktop/Code

Version যাচাই করুন:

```bash
node --version
bun --version
```

## ২. Project install ও build

Terminal-এ চালান:

```bash
cd /Users/litoondev/Documents/claude-talk-to-figma-mcp-main
npm install
npm run build
```

## ৩. Figma plugin install

1. Figma Desktop খুলুন।
2. **Figma menu -> Plugins -> Development -> Import plugin from manifest** নির্বাচন করুন।
3. নিচের file নির্বাচন করুন:

```text
/Users/litoondev/Documents/claude-talk-to-figma-mcp-main/src/claude_mcp_plugin/manifest.json
```

## ৪. ChatGPT Desktop ও Codex setup

সবচেয়ে সহজ পদ্ধতি:

```bash
cd /Users/litoondev/Documents/claude-talk-to-figma-mcp-main
npm run configure:openai
```

Codex CLI পাওয়া গেলে script `FigmaTalkMCP` নামে MCP server যোগ করবে। Official OpenAI documentation অনুযায়ী ChatGPT Desktop, Codex CLI এবং Codex IDE extension একই MCP configuration ব্যবহার করে। Setup-এর পরে ChatGPT Desktop বা IDE extension restart করুন।

### ছবির form-এ manually যোগ করলে

| Field | Value |
|---|---|
| Name | `FigmaTalkMCP` |
| Type | `STDIO` |
| Command to launch | `/usr/local/bin/node` |
| Argument | `/Users/litoondev/Documents/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs` |
| Working directory | `/Users/litoondev/Documents/claude-talk-to-figma-mcp-main` |

একটি argument field-এ শুধু server file-এর absolute path দিন। Environment variables সাধারণ canvas কাজের জন্য প্রয়োজন নেই।

Codex CLI থেকে manual command:

```bash
codex mcp add FigmaTalkMCP -- /usr/local/bin/node /Users/litoondev/Documents/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs
codex mcp list
```

## ৫. Claude setup

Claude Desktop-এর automated local configuration:

```bash
npm run configure-claude
```

অথবা existing `.mcpb` package install করা যায়। Claude Code-এর জন্য:

```bash
claude mcp add FigmaTalkMCP -- /usr/local/bin/node /Users/litoondev/Documents/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs
claude mcp list
```

একই client-এ একই server-এর npm এবং local copy দুটো একসঙ্গে enable করবেন না। এতে duplicate tools দেখা দিতে পারে।

## ৬. প্রতিবার Figma ব্যবহার করার নিয়ম

প্রথম Terminal window-এ bridge চালু রাখুন:

```bash
cd /Users/litoondev/Documents/claude-talk-to-figma-mcp-main
npm run socket
```

তারপর:

1. Figma Desktop-এ target file খুলুন।
2. **Plugins -> Development -> Claude Talk to Figma** চালু করুন।
3. plugin panel থেকে channel ID কপি করুন।
4. ChatGPT, Codex অথবা Claude-তে লিখুন:

```text
Connect to Figma, channel YOUR_CHANNEL_ID
```

5. একটি layer select করে পরীক্ষা করুন:

```text
Figma-তে বর্তমানে কী select করা আছে?
```

## ৭. Setup diagnostic

```bash
npm run check:setup
```

এটি Node.js, Bun, built MCP server, Figma manifest এবং `localhost:3055` bridge যাচাই করে। সবগুলোতে `PASS` এলে local runtime প্রস্তুত।

## সাধারণ সমস্যা

### WebSocket bridge FAIL

অন্য Terminal-এ `npm run socket` চালু রাখুন। Port 3055 অন্য process ব্যবহার করলে সেই process বন্ধ বা project-এর port configuration পরিবর্তন করতে হবে।

### MCP build FAIL

```bash
npm install
npm run build
```

### MCP server দেখা যাচ্ছে না

ChatGPT Desktop, Codex IDE extension বা Claude পুরোপুরি restart করুন। তারপর MCP server list-এ `FigmaTalkMCP` enabled আছে কি না দেখুন।

### Figma command কাজ করছে না

Figma Desktop plugin খোলা আছে, bridge চালু আছে এবং current channel ID দিয়ে connect করা হয়েছে কি না যাচাই করুন। Plugin পুনরায় খুললে নতুন channel ID তৈরি হতে পারে।

### Comments কাজ করছে না

Canvas tools-এর জন্য token লাগে না। Figma comments পড়া বা reply করার জন্য MCP configuration-এ `FIGMA_ACCESS_TOKEN` দিতে হবে। Token source control-এ commit করবেন না।

## গুরুত্বপূর্ণ সীমা

এই setup ChatGPT Desktop/Codex-এর local MCP support ব্যবহার করে। ChatGPT web-এর public distribution-এর জন্য public Streamable HTTP endpoint অথবা Secure MCP Tunnel, user authentication এবং secure session routing আলাদাভাবে বাস্তবায়ন করতে হবে।

## Official OpenAI documentation

- https://learn.chatgpt.com/docs/extend/mcp
- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/plugins/deploy/connect-chatgpt
