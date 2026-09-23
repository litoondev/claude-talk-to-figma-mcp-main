# Talk to Figma — Webflow Bridge

A Webflow Designer Extension that joins the same relay the Figma plugin uses, so
Claude can build on the Webflow canvas: elements, classes, tag styles, variables
and components.

It is the counterpart to `src/claude_mcp_plugin/`. That runs inside Figma, this
runs inside Webflow, and both speak to `src/socket.ts`.

```
Claude Desktop
  └─ MCP server
       ├─ Figma tools ───────────► relay :3055 ─► Figma plugin
       └─ webflow_designer_* ────► relay :3055 ─► this extension
```

## Why this exists when Webflow ships its own bridge

Webflow's bridge app routes by `siteId` and emits each command to **every**
extension session registered for that site, with no queue, and drops a
mismatched message with no reply at all — so the caller waits out a two-minute
timeout and is told the Designer app is not running.

This one joins a **channel**, the same unit the Figma plugin uses. One agent gets
one editor, `channelQueues` in the relay serialises the writes, and a command
with nowhere to go is rejected immediately with the missing editor named.

## Install

Requires **Admin** on the Webflow workspace.

1. Install the CLI:
   ```bash
   npm i -g @webflow/webflow-cli
   ```
2. Register an App: Workspace Settings → **Apps & integrations** → **Develop** →
   create a Designer Extension.
3. Bundle and upload:
   ```bash
   cd webflow_extension
   webflow extension bundle
   ```
   Upload the resulting bundle to the App you registered.
4. Install the App to the sites that will use it.

For local development, `webflow extension serve` runs it on port 1337 and the
Designer can load it from there without a publish.

## Use

1. Start the relay: `npm run socket` in the repo root.
2. In Claude, start a session and note the **channel ID**.
3. In Webflow, open the site in the Designer, open the Apps panel (press `E`),
   and launch **Talk to Figma — Webflow Bridge**.
4. Paste the channel ID, press **Connect**.
5. In Claude, run `webflow_designer_status` to confirm the link.

The extension must stay open while Claude works. Closing the panel closes the
socket, and the relay will then reject Webflow commands rather than hang.

## Files

| File | What it is |
| --- | --- |
| `webflow.json` | Extension manifest. `publicDir` points at `public/`, so what is in there is what runs. |
| `public/index.html` | The panel: channel field, relay field, status, log. |
| `public/app.js` | The socket client and the command table. No framework, no bundler, no dependencies. |

Webflow's reference bridge app pulls in React, Vite, Radix and socket.io for the
same job. None of that survives contact with a command dispatcher, and every
dependency is one more thing to keep working inside an iframe we do not control.
The relay is a plain WebSocket server, so this uses the browser's own WebSocket —
the same choice the Figma plugin made, which means one protocol to reason about.

## Commands

Twelve, matching the `webflow_designer_*` MCP tools one for one. A test pins the
two lists together (`tests/unit/webflow-extension.test.ts`), because nothing else
stops them drifting and the symptom of drift is a tool call that reaches the
extension and comes back "Unknown command" after the user has already pressed go.

| Command | Designer API it uses |
| --- | --- |
| `webflow_status` | `getCurrentPage` |
| `webflow_get_structure` | `getRootElement`, `getChildren`, `getStyles` |
| `webflow_get_styles` | `getAllStyles`, `style.getProperties` |
| `webflow_get_variables` | `getAllVariableCollections`, `collection.getAllVariables` |
| `webflow_create_variables` | `createVariableCollection`, `createColorVariable` and friends |
| `webflow_set_tag_style` | `getStyleByName` / `createStyle`, `setProperties` |
| `webflow_set_style` | same, for a named class |
| `webflow_create_element` | `elementPresets`, `append` / `prepend`, `setTag`, `setStyles` |
| `webflow_set_text` | `setTextContent` |
| `webflow_delete_element` | `element.remove` |
| `webflow_create_component` | `registerComponent` |
| `webflow_insert_component` | `getAllComponents`, `append` |

## Testing without Webflow

Most of the chain can be exercised with no Webflow account, no CLI and no Admin
rights. `scripts/webflow-extension-harness.mjs` loads **this extension's real
`app.js`** against an in-memory fake Designer and joins the relay as the Webflow
editor:

```
Claude → MCP tool → relay (src/socket.ts) → harness → fake Designer
```

Every link is the shipping one except the Designer itself, so it proves routing,
the protocol, argument shapes and the command table.

```bash
npm run socket                      # terminal 1, the relay
npm run webflow:harness -- <channel-id>   # terminal 2, after Claude joins a channel
```

Then drive it from Claude with the `webflow_designer_*` tools. State persists for
the life of the process, so a create followed by a read behaves as the real
Designer would. The harness prints a line per command:

```
  ✓ webflow_create_variables (0ms)
  ✓ webflow_set_tag_style (0ms)
  ✗ webflow_create_element — No Webflow preset for "marquee". Supported: div, section, …
```

## What is verified, and what is not

The command layer has **29 tests** (`bun test tests/unit/webflow-extension.test.ts`)
covering preset mapping, heading levels, class reuse, breakpoint defaults,
variable type dispatch, error text and id serialisation, run against a fake
`webflow` global.

Those tests do **not** prove Webflow's real API behaves as expected. The calls
here were read out of Webflow's own bridge app source rather than guessed, but
only a live Designer settles it. Treat the first real run as the actual
verification, and expect to adjust `webflow_create_component` in particular: this
Designer API version exposes no setter for component properties or variants, so
those are **reported as unsupported** rather than silently flattened into
hard-coded values. Setting them by hand in the Designer is currently the answer.

## Element ids

Webflow element ids are objects (`{component, element}`) inside a component, not
strings. The relay carries JSON, so ids travel as their serialised form and are
matched back by string comparison — never reconstructed, because the shape is
Webflow's to define. Ids also change when the page changes, so re-read
`webflow_get_structure` rather than holding one across an edit.
