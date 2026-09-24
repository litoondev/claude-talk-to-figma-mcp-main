# ChatGPT ও Figma-র সঙ্গে MCP প্লাগইন সংযোগ: সম্ভাব্যতা প্রতিবেদন

## সংক্ষিপ্ত সিদ্ধান্ত

হ্যাঁ, এই প্লাগইনটি ChatGPT-এর সঙ্গে সংযুক্ত করা সম্ভব। বর্তমান কোড ইতিমধ্যে Model Context Protocol (MCP) ব্যবহার করে এবং Figma-তে পড়া ও পরিবর্তনের জন্য প্রয়োজনীয় টুল প্রকাশ করে। ফলে মূল Figma automation নতুন করে লিখতে হবে না।

বাস্তব local installation-এর ধাপগুলো [MULTI_AI_INSTALL_BN.md](MULTI_AI_INSTALL_BN.md)-এ দেওয়া হয়েছে।

তবে ChatGPT-কে সরাসরি Figma প্লাগইনের ভেতরে বসানো হবে না। সঠিক প্রবাহ হবে:

```text
ChatGPT / Codex
       | MCP (STDIO অথবা Streamable HTTP)
       v
এই প্রকল্পের MCP server
       | WebSocket
       v
localhost:3055 bridge
       | WebSocket channel
       v
Figma Desktop plugin -> খোলা Figma file
```

অর্থাৎ ব্যবহারকারী ChatGPT-তে স্বাভাবিক ভাষায় নির্দেশ দেবেন, ChatGPT প্রয়োজনমতো এই MCP-এর টুল কল করবে, এবং Figma প্লাগইন সেই নির্দেশ canvas-এ কার্যকর করবে।

## বর্তমান প্রকল্পের প্রস্তুতি

প্রকল্পের বর্তমান কাঠামো ChatGPT Desktop/Codex-এর local MCP ব্যবহারের জন্য প্রায় প্রস্তুত:

- `src/talk_to_figma_mcp/server.ts` একটি MCP server তৈরি করে এবং `StdioServerTransport` ব্যবহার করে।
- MCP server Figma bridge-এর সঙ্গে ডিফল্টভাবে `ws://localhost:3055`-এ যুক্ত হয়।
- `src/claude_mcp_plugin/`-এর Figma plugin খোলা Figma document-এ command চালায়।
- `package.json`-এ `claude-talk-to-figma-mcp-server` command আছে।
- ঐচ্ছিক Figma personal access token শুধু comment-related REST tools-এর জন্য দরকার; সাধারণ canvas tools-এর জন্য নয়।

নামগুলোতে এখনও `Claude` আছে, কিন্তু MCP protocol model-নিরপেক্ষ। তাই নাম পরিবর্তন না করেও ChatGPT এটি ব্যবহার করতে পারবে। ভবিষ্যতে public release-এর আগে product name ও description model-neutral করা ভালো।

## সবচেয়ে দ্রুত উপায়: ChatGPT Desktop/Codex-এ STDIO

ছবিতে দেখানো **Connect to a custom MCP** form-এ নিচের মান ব্যবহার করা যায়।

| Field | Value |
|---|---|
| Name | `FigmaTalkMCP` |
| Type | `STDIO` |
| Command to launch | `/usr/local/bin/npx` |
| Argument 1 | `-p` |
| Argument 2 | `claude-talk-to-figma-mcp@latest` |
| Argument 3 | `claude-talk-to-figma-mcp-server` |
| Working directory | খালি রাখা যায়, অথবা একটি বিদ্যমান absolute directory |

বর্তমান local repository-এর unpublished code পরীক্ষা করতে:

| Field | Value |
|---|---|
| Name | `FigmaTalkLocal` |
| Type | `STDIO` |
| Command to launch | `/usr/local/bin/node` |
| Argument 1 | `/Users/litoondev/Documents/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs` |
| Working directory | `/Users/litoondev/Documents/claude-talk-to-figma-mcp-main` |

Local version ব্যবহারের আগে repository root-এ `npm install` এবং `npm run build` চালানো থাকতে হবে।

## প্রতিবার ব্যবহারের ধাপ

1. Figma Desktop চালু করতে হবে এবং target design file খুলতে হবে।
2. repository root থেকে `npm run socket` চালু রাখতে হবে।
3. Figma-তে development plugin খুলতে হবে।
4. plugin-এ পাওয়া channel ID কপি করতে হবে।
5. ChatGPT Work/Codex conversation-এ MCP/plugin সক্রিয় করে লিখতে হবে: `Connect to Figma, channel YOUR_ID`।
6. একটি layer select করে পরীক্ষা করা যায়: `Figma-তে বর্তমানে কী select করা আছে?`

এই local পদ্ধতিতে ChatGPT/Codex host, bridge server এবং Figma Desktop একই computer-এ চলা সবচেয়ে সহজ।

## ChatGPT web-এ অন্য ব্যবহারকারীদের দেওয়ার পথ

ChatGPT web স্থানীয় `STDIO` process বা `localhost:3055` সরাসরি দেখতে পারে না। Web distribution-এর জন্য দুইটি বাস্তব পথ আছে:

### ১. Secure MCP Tunnel দিয়ে private beta

Local/private MCP server public internet-এ প্রকাশ না করে Secure MCP Tunnel-এর মাধ্যমে ChatGPT developer mode-এ সংযুক্ত করা যায়। এটি internal testing-এর জন্য উপযুক্ত। প্রত্যেক ব্যবহারকারীর computer-এ Figma Desktop plugin ও local bridge এখনও প্রয়োজন হবে।

### ২. Streamable HTTP MCP server দিয়ে public plugin

MCP server-এ public HTTPS `Streamable HTTP` endpoint, সাধারণত `/mcp`, যোগ করতে হবে। এরপর ChatGPT developer mode-এ endpoint যুক্ত করে test করা এবং পরে universal plugin directory-তে submission করা যাবে।

এই প্রকল্পে শুধু transport বদলালেই সব সমস্যার সমাধান হবে না। Figma Plugin API ব্যবহারকারীর desktop Figma app-এর মধ্যে চলে। তাই hosted MCP server থেকে প্রত্যেক ব্যবহারকারীর local Figma plugin session-এ নিরাপদে route করার ব্যবস্থা দরকার। সম্ভাব্য নকশা:

```text
ChatGPT web -> public HTTPS MCP service
            -> authenticated user/session routing
            -> secure local bridge or relay
            -> user's Figma Desktop plugin
```

প্রতিটি channel-এর সঙ্গে authenticated user/workspace binding, short-lived session token, TLS, rate limit এবং explicit write confirmation যোগ করা উচিত। শুধু ছয় অক্ষরের channel ID-কে production authentication হিসেবে ব্যবহার করা উচিত নয়।

## প্রয়োজনীয় উন্নয়ন

Public বা multi-user release-এর আগে নিচের কাজগুলো সুপারিশ করা হচ্ছে:

1. `STDIO`-র পাশাপাশি Streamable HTTP transport বা Secure MCP Tunnel configuration যোগ করা।
2. ব্যবহারকারীভিত্তিক authentication এবং channel authorization যোগ করা।
3. destructive/write tools-এ MCP annotations এবং user confirmation policy যাচাই করা।
4. tool name, description এবং JSON schema ChatGPT-এর tool selection-এর জন্য সংক্ষিপ্ত ও পরিষ্কার করা।
5. server ও package metadata-তে `Claude`-নির্ভর নামকে model-neutral branding-এ নেওয়া।
6. ChatGPT developer mode-এ direct, indirect, invalid এবং write-action evaluation prompts দিয়ে পরীক্ষা করা।
7. MCP metadata পরিবর্তনের পরে connection refresh করে নতুন conversation-এ regression test চালানো।

## সীমাবদ্ধতা

- Figma Desktop এবং Figma development plugin চালু না থাকলে canvas automation কাজ করবে না।
- local WebSocket bridge বন্ধ হলে MCP tool Figma-তে পৌঁছাবে না।
- Figma comments-এর জন্য আলাদা personal access token প্রয়োজন হতে পারে।
- ChatGPT account/workspace policy অনুযায়ী developer mode বা plugin availability ভিন্ন হতে পারে।
- ChatGPT-এর UI-তে সব tool একসঙ্গে প্রকাশ করলে token usage ও tool-selection error বাড়তে পারে; বর্তমান `core` বা `standard` profile দিয়ে শুরু করা ভালো।

## সুপারিশকৃত rollout

প্রথমে local `STDIO` setup দিয়ে এক computer-এ end-to-end proof of concept করা সবচেয়ে যুক্তিযুক্ত। এটি সফল হলে Secure MCP Tunnel দিয়ে কয়েকজন ব্যবহারকারীর private beta চালানো যায়। Authentication ও session routing শক্ত হওয়ার পর Streamable HTTP endpoint এবং public plugin submission করা উচিত।

## চূড়ান্ত মতামত

প্রযুক্তিগতভাবে এটি সম্ভব এবং বর্তমান repository ভালো ভিত্তি তৈরি করে রেখেছে। Local ChatGPT Desktop/Codex integration-এর জন্য বড় code rewrite দরকার নেই; configuration এবং existing bridge চালু রাখাই যথেষ্ট। কিন্তু ChatGPT web-এ বহু ব্যবহারকারীর জন্য প্রকাশ করতে হলে remote transport, authentication এবং user-to-Figma session routing নতুন করে যোগ করতে হবে।

## অফিসিয়াল রেফারেন্স

- OpenAI Plugins quickstart: https://developers.openai.com/plugins/quickstart
- Connect and test a plugin: https://developers.openai.com/plugins/deploy/connect-chatgpt
- Build an MCP server: https://developers.openai.com/plugins/build/mcp-server
- MCP connections: https://developers.openai.com/api/docs/guides/agents-api/tools/mcp
- ChatGPT/Codex MCP overview: https://learn.chatgpt.com/docs/extend/mcp
