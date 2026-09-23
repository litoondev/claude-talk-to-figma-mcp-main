![Claude Talk to Figma collage](images/claude-talk-to-figma.png)

# <del>Claude</del> <ins>AI Agents</ins> Talk to Figma MCP

Enable your AI agents to read, analyze, and modify Figma designs.

> 🌐 **Language / ভাষা:** [English guide](#english) · [বাংলা নির্দেশিকা](#bangla)

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

---

<a id="english"></a>

# 🚀 Installation — complete beginner's guide

**Time needed:** ~15 minutes the first time. About 20 seconds every day after that.

This guide assumes **zero prior experience**. Every command is written out in full. If you have never opened a terminal before, that's fine — start at [Step 0](#step-0-open-the-terminal).

> 💡 Written for **macOS**. Windows differences are called out in `🪟 Windows` notes under each step.

## 🧠 First, understand what you're installing

This is not a single app. It's **three pieces that talk to each other**. Knowing this makes every later step (and every error message) make sense.

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│  Claude Desktop │◄──────►│  WebSocket server│◄──────►│  Figma Desktop  │
│                 │  MCP   │  (localhost:3055)│   WS   │  + this plugin  │
│  1. Extension   │        │  2. Terminal     │        │  3. Plugin      │
└─────────────────┘        └──────────────────┘        └─────────────────┘
```

| # | Piece | What it does | Where it lives |
|---|-------|--------------|----------------|
| **1** | **The extension** (`.mcpb`) | Gives Claude the ~120 Figma tools | Installed inside Claude Desktop |
| **2** | **The WebSocket server** | The bridge/messenger between Claude and Figma | Runs in a Terminal window you keep open |
| **3** | **The Figma plugin** | Receives commands and actually edits your canvas | Installed inside Figma Desktop |

**All three must be running at the same time.** If any one is missing, Claude will say it can't reach Figma. That's the single most common problem people hit — see [Troubleshooting](#-troubleshooting-common-errors).

---

## Step 0: Open the Terminal

You'll need it for a few copy-paste commands. You do **not** need to understand them.

1. Press `Cmd` + `Space`
2. Type `Terminal`
3. Press `Enter`

A window with white or black text appears. That's the terminal. To run a command: copy it, paste it (`Cmd` + `V`), press `Enter`, and **wait** until the text stops scrolling and you get a fresh prompt line back.

> 🪟 **Windows:** press `Win`, type `PowerShell`, press `Enter`.

---

## Step 1: Install the four prerequisites

### 1a. Node.js

Check whether you already have it — paste this and press Enter:

```bash
node -v
```

- ✅ You see something like `v22.14.0` (any number **18 or higher**) → skip to 1b.
- ❌ You see `command not found` → go to **[nodejs.org](https://nodejs.org/en/download)**, click the green **"Download Node.js (LTS)"** button, open the downloaded `.pkg` file, and click **Continue** through every screen of the installer.

Then **quit and reopen Terminal** and run `node -v` again to confirm.

### 1b. Bun (required, do not skip)

The bridge server (piece #2) is built on Bun and **will not run on Node alone**. Skipping this is the #1 reason the setup fails.

Check:

```bash
bun -v
```

If you get `command not found`, install it:

```bash
curl -fsSL https://bun.sh/install | bash
```

When it finishes, **quit and reopen Terminal**, then verify:

```bash
bun -v
```

You should see a version number like `1.2.4`.

> 🪟 **Windows:** run `powershell -c "irm bun.sh/install.ps1 | iex"` instead.

### 1c. Figma **Desktop** app

Download from **[figma.com/downloads](https://www.figma.com/downloads/)**.

> ⚠️ The browser version of Figma **will not work**. Local plugin development requires the desktop app. Install it even if you normally use Figma in Chrome.

### 1d. Claude Desktop

Download from **[claude.ai/download](https://claude.ai/download)**. Sign in.

> ⚠️ Same rule: the **desktop app**, not claude.ai in a browser. Browser Claude cannot load extensions.

**✅ Checkpoint —** before continuing, `node -v` and `bun -v` should both print version numbers, and both Figma Desktop and Claude Desktop should open.

---

## Step 2: Download this project and build it

Copy this **whole block** at once, paste it into Terminal, press Enter:

```bash
cd ~/Documents
git clone https://github.com/litoondev/claude-talk-to-figma-mcp-main.git
cd claude-talk-to-figma-mcp-main
npm install
npm run build
```

Plain English, line by line:

| Line | What it does |
|------|--------------|
| `cd ~/Documents` | Moves into your Documents folder |
| `git clone …` | Downloads the project into `Documents/claude-talk-to-figma-mcp-main` |
| `cd claude-talk…` | Moves inside the folder you just downloaded |
| `npm install` | Downloads the code libraries it needs (takes 1–3 min, lots of scrolling text — normal) |
| `npm run build` | Compiles the source into runnable files |

> 💡 **There is one more important command: `npm run socket`.** It starts the bridge server that connects Claude to Figma. You'll run it in [Step 6a](#6a-start-the-bridge-server) every time you use the tool — **not** during install.

**This folder is now your home base.** You'll come back to it every time you use the tool. Remember where it is: `Documents/claude-talk-to-figma-mcp-main`.

<details>
<summary>❓ <code>git: command not found</code></summary>

Install Apple's developer tools, then re-run the block above:

```bash
xcode-select --install
```

A dialog appears — click **Install** and wait for it to finish.

Alternatively, skip git entirely: download the project as a ZIP from the [GitHub page](https://github.com/litoondev/claude-talk-to-figma-mcp-main) (green **Code** button → **Download ZIP**), unzip it into `Documents`, then run `npm install` and `npm run build` inside the unzipped folder.
</details>

<details>
<summary>❓ <code>npm install</code> printed red warnings</summary>

Warnings (`WARN`, `deprecated`) are cosmetic — ignore them. Only stop if you see the word **`ERR!`** and the command exits without finishing.
</details>

> 🪟 **Windows:** use `npm run build:win` instead of `npm run build`, and `cd $HOME\Documents` instead of `cd ~/Documents`.

---

## Step 3: Build the Claude Desktop extension

The GitHub Releases page only carries an old build, so build the current one yourself. Still inside the project folder, run:

```bash
npx dxt pack . claude-talk-to-figma-mcp.mcpb
```

When it finishes (about 30 seconds), the project folder contains **`claude-talk-to-figma-mcp.mcpb`**, the file you install in the next step.

> 💡 `npx dxt` is the packaging tool that `npm install` already downloaded. Nothing else to install.
>
> 🪟 **Windows:** the command is the same.

<details>
<summary>❓ I also see <code>.dxt</code> files in the folder</summary>

Older instructions (`npm run build:dxt`, `npm run pack`) create extra copies named `.dxt`. They contain exactly the same thing, since Anthropic renamed the format from **DXT** to **MCPB**. Use the `.mcpb` and delete the `.dxt` copies if you like. Only use a `.dxt` if a very old Claude Desktop refuses the `.mcpb`.
</details>

---

## Step 4: Install the extension into Claude Desktop

1. Open **Finder** — click the blue-and-white smiley-face icon in your Dock, or press `Cmd` + `Space`, type `Finder`, press `Enter`
2. In the **sidebar** on the left, click **Documents**, then open the `claude-talk-to-figma-mcp-main` folder
3. **Double-click `claude-talk-to-figma-mcp.mcpb`**
4. Claude Desktop opens and shows an install prompt → click **Install**
5. It will ask for a **Figma personal access token** → **leave the field blank and click Continue.** This is optional and only needed for comment tools — you can add it later in [Step 7](#step-7-optional-comment-tools).
6. **Quit Claude Desktop completely** — press `Cmd` + `Q` (do **not** just click the red × to close the window) — then reopen it

**Alternative if double-clicking does nothing:** Open Claude Desktop → **Settings** (gear icon or top menu) → **Extensions** tab → drag the `.mcpb` file and drop it anywhere onto that Extensions page.

**✅ Checkpoint —** go to Claude Desktop → Settings → Extensions. You should see **Claude Talk to Figma** listed and enabled.

<details>
<summary>❓ macOS opened the file in Archive Utility or another app</summary>

Right-click the file → **Open With** → **Claude**. If Claude isn't listed, choose **Other…**, navigate to `Applications`, and pick Claude.
</details>

<details>
<summary>❓ Claude says the file is invalid or refuses it</summary>

Try the other file — double-click the `.dxt` instead of the `.mcpb`. If both fail, update Claude Desktop to the latest version and retry.
</details>

---

## Step 5: Install the plugin inside Figma

1. Open the **Figma Desktop app**
2. Open any design file (or create a new one)
3. Click the **Figma logo (the "F" icon)** in the very top-left corner of the app → **Plugins** → **Development** → **Import plugin from manifest…**
4. In the file picker, navigate to:
   ```
   Documents → claude-talk-to-figma-mcp-main → src → claude_mcp_plugin → manifest.json
   ```
5. Select **`manifest.json`** and click **Open**

> 💡 Can't see the `src` folder in the picker? Press `Cmd` + `Shift` + `G` and paste `~/Documents/claude-talk-to-figma-mcp-main/src/claude_mcp_plugin` to jump straight there.

**✅ Checkpoint —** **Plugins** → **Development** now lists **Claude Talk to Figma**. You only do this once, ever.

---

## Step 6: Run it — the daily routine

These are the only steps you repeat in future sessions.

### 6a. Start the bridge server

Open Terminal and run:

```bash
cd ~/Documents/claude-talk-to-figma-mcp-main
npm run socket
```

You should see:

```
Claude to Figma WebSocket server running on port 3055
Status endpoint available at http://localhost:3055/status
```

> 🚨 **Leave this Terminal window open.** Closing it, or pressing `Ctrl` + `C`, kills the bridge and Claude immediately loses Figma. Just push the window aside.

Want to double-check it's alive? Open **http://localhost:3055/status** in a browser.

<details>
<summary>❓ <code>ReferenceError: Bun is not defined</code></summary>

Bun isn't installed. Go back to [Step 1b](#1b-bun-required-do-not-skip). This server genuinely cannot run on Node.
</details>

<details>
<summary>❓ <code>EADDRINUSE</code> / port 3055 already in use</summary>

The server is already running in another Terminal window — you're done, just use that one. To force-stop it: `pkill -f socket.js`
</details>

### 6b. Open the plugin in Figma

In your Figma file: **Plugins** → **Development** → **Claude Talk to Figma**.

A small panel opens showing a **channel ID** in bold inside a green box — something like `a4f9c2`.

> ⚠️ **This ID changes every time you reopen the plugin.** Never reuse an old one — always copy a fresh one.

**→ Copy that 6-character ID now. You'll paste it into Claude in the very next step.**

> 💡 See a **Connect** button instead of an ID? Click it. The ID appears once the plugin reaches the bridge server. If it never does, the server from Step 6a isn't running.
>
> 💡 **Shortcut:** click the ID itself. It copies the whole message `Connect to Figma, channel …` so you can paste it straight into Claude.

### 6c. Connect Claude

In Claude Desktop, type the message below — but **replace `a4f9c2` with the ID you just copied from the plugin panel**:

```
Connect to Figma, channel a4f9c2
```

> 🔑 **`a4f9c2` is just an example.** Your real ID will look similar but be different — something like `d7b3f1` or `c90ae4`. You must use your own ID or Claude won't connect.

Claude confirms the connection. Now test it:

```
What's currently selected in Figma?
```

Select any layer in Figma first, then ask. If Claude describes it — **you're fully set up.** 🎉

---

## Step 7: Optional comment tools

Skip unless you want Claude to **read and reply to Figma comments**. Everything else already works without this.

Figma's Plugin API cannot see comments at all, so those specific tools go through Figma's REST API, which needs a token.

1. In Figma: **your avatar** → **Settings** → **Security** tab → **Personal access tokens** → **Generate new token**
2. Enable these scopes:
   - **`files:read`** — read files and comments
   - **`file_comments:write`** — post replies
3. Copy the token immediately (Figma shows it only once). It starts with `figd_`.
4. In Claude Desktop: **Settings** → **Extensions** → **Claude Talk to Figma** → paste the token into the **Figma personal access token** field
5. Quit Claude (`Cmd` + `Q`) and reopen
6. Verify by asking: `Check my Figma account`

> 🔒 This token can read **every file your account can open**. Never commit it to a repo or paste it into a chat.

---

## 📅 Every session after the first

Setup is permanent. Daily use is three things, ~20 seconds:

```bash
cd ~/Documents/claude-talk-to-figma-mcp-main && npm run socket
```

1. ✅ Run the command above (leave the Terminal window open)
2. ✅ Figma → **Plugins** → **Development** → **Claude Talk to Figma** → copy the channel ID from the green box
3. ✅ Tell Claude: `Connect to Figma, channel` and then paste your ID — e.g. `Connect to Figma, channel d7b3f1`

---

## 🧹 Optimize layers & convert to Grid

Clean up messy layer trees (empty frames, useless groups, `Frame > Frame > Card` double nesting) and turn card rows into a real Figma **Grid**, **without changing how the design looks**.

### How to use it

1. In Figma, **select one section or frame**, for example `# Work Process`. Don't select a whole page of 100+ sections.
2. Tell Claude:
   ```
   Optimize the layers of the selected section
   ```
3. Claude first **scans** (nothing changes yet), then asks you about anything that needs a decision:

   | Claude asks | What it means | Your answer |
   |---|---|---|
   | "N hidden layers were found. Do you want to remove them?" | Hidden layers may be alternate states you kept on purpose | **Yes** to delete them, **No** to keep them |
   | "\"Card\" has a prototype interaction — remove it?" | Removing it could break your prototype, an effect, an export or a mask | Decide for each one |
   | "\"# Work Process\" can become a 4-column Grid… Convert it?" | The heading and cards can sit directly inside a Grid, with the wrapper frames removed | **Yes** to convert |

4. Claude applies only what you approved and reports what changed.

### What it does automatically (no question needed)

- Removes empty and zero-size layers
- Collapses wrapper frames that do nothing: a single child exactly the same size, no padding, no fill, no stroke, no clip
- Hands the wrapper's **Fill** sizing to the child, so the layout stays identical

### What it never does

- Never deletes a **hidden** layer, or a layer with a **prototype interaction, effect, export setting or mask**, without your "yes"
- Never deletes **main components**, **component-property** layers or **variant** layers
- Never changes text, fonts, colours, spacing values or variables
- Never enters **component instances**

### How the Grid conversion stays safe

| Your design | After conversion |
|---|---|
| `# Work Process` (vertical Auto Layout) → `Text_Container` + `Container` → `Frame` → `Frame` → `Card` ×4 | `# Work Process` (**Grid**, 4 columns) → `Text_Container` (spans all 4) + `Card` ×4 |

- The **column count is read from your design**: 4 equal cards means 4 equal columns (`repeat(4, 1fr)`).
- Gaps and padding keep their **variables** (row gap = the section's gap, column gap = the row's gap).
- After converting, the plugin **measures every heading and card**. If anything moved by more than 1px, or Figma refuses a step, **it undoes the conversion** and tells you why. Each conversion is one `Cmd` + `Z`.
- A section is only proposed when a Grid can reproduce it exactly: one heading, one row of equal-width items, no padding or background on the row.

> ⚠️ **If a Grid conversion is not applied, don't "fix" it by ungrouping.** Ungrouping an Auto Layout row stacks the cards, and moving them back by hand leaves a frame with **fixed positions and no layout**. It looks right but no longer adapts. Report the reason instead.

---

## 🌐 Convert an HTML file or website to Figma

Turn a web page into a Figma design that **looks exactly like the page**: every section, text, image and icon. It's linked to your file's own styles and variables, with a clean, flat layer tree.

### How to use it

1. In Figma, open the file whose design system (colour variables, text styles, spacing tokens) you want the import to use.
2. Take a **full-page screenshot** of the website or HTML page and send it to Claude. It's the reference Claude compares the result against at the end.
3. Tell Claude one of these:
   ```
   Convert https://example.com to Figma
   ```
   ```
   Convert /Users/YOUR_NAME/Desktop/page.html to Figma
   ```
   > 💡 A local file needs its **full path**, and must be on the same computer as Claude Desktop. To get the path on a Mac: select the file in Finder, hold `Option`, right-click → **Copy "page.html" as Pathname**.
4. Claude works through these steps and tells you what it is doing:

   | Step | What happens |
   |---|---|
   | **1. Analyse** | Reads the page and its CSS: sections, text, colours, fonts, spacing, radii, **every image and icon**, and whether each block is a grid or a row/column |
   | **2. Match** | Compares every value with your design system: **use from the system** / **close but not exact** / **not in the system** |
   | **3. Build** | Binds your variables and text styles where they match **exactly**; builds everything else with the page's own values. Places every image and icon. Uses **Grid** or **Auto Layout** per container (table below) |
   | **4. Components** | An element that appears **2 or more times** with no exact component in your file becomes a **new component** in a frame named **Components — from HTML** beside the page, and the page uses instances of it. Elements that appear once stay plain layers |
   | **5. Import Notes** | A frame beside the design listing what was not in your design system, the new components, and anything that could not be made identical |
   | **6. Compare** | Exports the result and compares it with your screenshot, fixing differences until nothing differs; then runs the layer scan, asking before removing anything |

### The rules it follows

- **Identical.** Nothing is left out, nothing is added, nothing is restyled or simplified. If something truly can't be reproduced, Claude says so in Import Notes instead of approximating it.
- **Linked to your style guide.** A colour, text style, spacing or radius that exists in your design system is bound to it, never typed. A "close" style or component is not used, because it would change the design.
- **No new variables or styles.** The only things created are components for repeated elements.

### Grid or Auto Layout?

| The page uses | Built in Figma as |
|---|---|
| `display: grid` with equal columns | **Grid** with the same number of columns |
| A heading above a row of equal cards | **One Grid**: heading spans all columns, cards directly inside, no row wrapper |
| A row of equal items that wraps | **Grid** |
| A single row (menu, buttons, logos) | **Auto Layout — horizontal** |
| Stacked blocks / a column | **Auto Layout — vertical** |
| A button or banner pinned to the screen (`position: fixed`) | Built at the same position, on top of the page |
| A `div` that only wraps one element | **No frame**, as long as removing it changes nothing visually |

### Good to know

- **Images** are downloaded by the plugin's server (`place_html_image`) and placed at their exact size, from websites or from files next to a local `.html` page. **Icons** (inline SVG) are placed as vectors, including icons that come from an icon sprite. An image that can't be fetched keeps its exact-size frame, named `Image-Missing-…`, so the layout doesn't shift.
- **It reads the page's HTML and CSS, not a live browser.** Pages that build their content with JavaScript after loading may come in incomplete. For those, open the page in Chrome → **File → Save Page As… → Webpage, Complete**, and convert the saved `.html` file.
- **Pages behind a login** can't be read. Save them as above.
- **Fonts** must be installed on your computer for Figma to use them.

---

## 🌊 Send a Figma design to Webflow

Rebuild a Figma frame as a real Webflow page — every section, text, image and icon — with Auto Layout translated to flex and grid, your Figma variables recreated as Webflow variables, and repeated elements turned into Webflow components.

This is the **opposite** of the HTML import above: that one reads a page and builds Figma, this one reads Figma and builds a page.

### First, connect Webflow to Claude

This plugin has no Webflow tools. Webflow ships its **own** MCP server, and Claude runs both side by side: this plugin reads Figma, Webflow's server writes the site. You only have to do this once.

1. In Claude Desktop, click the **`+`** in the chat box → **Add connectors**.
2. Search for **Webflow**. If you don't see it, switch the list from **Featured** to **All**.
3. Click it → **Connect**, then log in to Webflow and **Authorize App**, choosing which sites and Workspaces Claude may touch.
4. Open the Webflow connector → **Configure** to decide whether Claude may act on its own or must ask you before every change. Asking is the safer default while you're learning what it does.

> 💡 **If the Webflow connector isn't in the list**, add it by hand as a custom connector with the URL `https://mcp.webflow.com/mcp`.
>
> ⚠️ **A bare URL in `claude_desktop_config.json` won't work.** That file only starts local (stdio) servers, and Webflow's is remote. Use **Add connectors** above — or, if you prefer the config file, Webflow's own docs bridge it with the `mcp-remote` shim: `"command": "npx", "args": ["mcp-remote", "https://mcp.webflow.com/sse"]`. Restart Claude Desktop afterwards and an OAuth page opens.
>
> 🔓 **Open the Designer *and* launch the Bridge App** before Claude builds anything. In the Designer, open the Apps panel (press `E`) and launch **Webflow MCP Bridge App**. The tools that create elements, styles, variables and components reach the canvas through it, so they go quiet if the panel is closed or the tab is shut. The CMS and site tools work without it.

### How to use it

1. Start the bridge server and connect the Figma plugin as usual ([Step 6](#step-6-run-it--the-daily-routine)).
2. In Figma, **select the frame** you want to export.
3. Tell Claude:
   ```
   Export this frame to Webflow
   ```
   Claude will ask which site and which page before it creates anything.
4. It works through these steps, one section at a time:

   | Step | What happens |
   |---|---|
   | **1. Check** | Confirms Figma is connected, the Webflow Designer bridge is live, and which site and page to build on. Takes a screenshot of your frame to compare against at the end |
   | **2. Read** | Reads the frame's layout, sizing, spacing, colours, text and **variable bindings** — the difference between "this is 40px" and "this is `spacing/40`" |
   | **3. Variables** | Recreates your Figma variable collections as Webflow variables, keeping the same names. Text styles become Webflow classes |
   | **4. Build** | Section by section: Auto Layout becomes flex, Grid becomes CSS grid, Fill/Hug become `100%`/`auto`. Every repeated element gets the **same class**; anything appearing twice or more becomes a **Webflow component** |
   | **5. Breakpoints** | Desktop first and complete, then tablet, then mobile — re-reading each Figma mode and overriding only what actually differs |
   | **6. Export Notes** | A record of every variable, class and component created, every value that had no token behind it, and anything that couldn't be made identical |
   | **7. Compare** | Publishes to staging and compares with your screenshot at each breakpoint, fixing differences until nothing differs |

### The breakpoint trap — read this one

**Figma's breakpoints and Webflow's are not the same numbers**, and this is where most Figma-to-Webflow work quietly breaks:

| Webflow breakpoint | Applies at | Closest Figma mode |
|---|---|---|
| Desktop (base) | 992px and up | `Desk` 1440 |
| Tablet | up to 991px | `Tab` 768 |
| Mobile landscape | up to 767px | **nothing** |
| Mobile portrait | up to 479px | `Mobi` 320 |

So a layout you designed at 768 has to hold all the way to **991** in Webflow, and **no Figma mode covers 480–767 at all**. Claude won't guess: it checks the tablet layout at both ends, and asks you what should happen in the 480–767 band rather than leaving it to chance.

Webflow's cascade also only flows **downward** — a value set on Desktop reaches Tablet and Mobile, but not the other way round. That's why Desktop is finished completely before anything else is touched.

### Good to know

- **It never invents a token.** A value with no Figma variable behind it is written as a plain number and listed in the Export Notes. If Claude thinks it deserves a variable, it asks.
- **Fixed heights are dropped.** A card or text block with a fixed height in Figma is built `auto` in Webflow, so text can wrap to more lines without clipping. Icons, avatars and deliberate image crops keep their size.
- **Repeating real content** (blog posts, team members, products) is better as a CMS Collection than eight hand-built divs. Claude proposes it and waits for your answer — it's a decision about your site, not your design.
- **Fonts** used in Figma must also be uploaded to the Webflow site, or the page falls back to something else and the fallback is not your design.
- **Hover, focus and pressed states** aren't in a Figma frame at all. Claude lists them under "needs a human" instead of making them up.
- **The full procedure** lives in [`skills/Webflow_Export_v1.md`](skills/Webflow_Export_v1.md). Edit it if your team does things differently — see [Skills](#-skills).

### Built in: Webflow content tools

The section above uses Webflow's **own** MCP server for canvas work. Separately, this plugin now has **16 Webflow tools of its own** that talk straight to Webflow's Data API — no second MCP server, no Designer, no bridge app.

They appear only when you set a **Webflow API token**: Claude Desktop → Settings → Extensions → this extension → **Webflow API token**. Leave it blank and they stay hidden, costing you nothing. (Token: Webflow → Site settings → **Apps & integrations → API access → Generate API token**. Read-only is enough for every `webflow_get_*` and `webflow_list_*` tool.)

| Group | Tools |
|---|---|
| **Sites** | `webflow_list_sites`, `webflow_get_site`, `webflow_create_site` (Enterprise workspaces only) |
| **Pages** | `webflow_list_pages`, `webflow_get_page`, `webflow_update_page_settings` |
| **Page copy** | `webflow_get_page_content`, `webflow_update_page_content` |
| **CMS** | `webflow_list_collections`, `webflow_get_collection`, `webflow_list_items`, `webflow_create_items`, `webflow_update_items`, `webflow_publish_items`, `webflow_delete_items` |
| **Publishing** | `webflow_publish_site` |

Try: *"List my Webflow sites"*, *"Show me the fields on the Blog collection"*, *"Rewrite the hero heading on the About page"*, *"Add these 12 team members to the Team collection as drafts"*.

#### What they can and cannot do

Webflow splits its API exactly the way Figma does, and this repo already lives with that split — [`figma-rest.ts`](src/talk_to_figma_mcp/utils/figma-rest.ts) exists because Figma's Plugin API can't see comments.

| | Runs **inside** the app | Runs **from this server** |
|---|---|---|
| Figma | Plugin API → the plugin + bridge | REST API → `figma-rest.ts` |
| Webflow | **Designer API** → needs a Designer Extension | **Data API** → `webflow-rest.ts` |

So these tools own **content**: sites, pages, SEO, the copy inside existing text nodes, CMS collections and items, and publishing. They **cannot create or restyle elements, classes, variables or components** — that is the Designer API, reachable only from code running inside Webflow.

That limit is stated on the tools it actually governs, not on all of them. It used to be on every one, and Claude learned to reach for it as a general excuse: asked to create a site, it replied that site creation "requires the Designer API". It doesn't — creating a site is a plain Data API call, just gated on an **Enterprise** workspace. `webflow_list_sites` now also carries the map of what this server does and doesn't implement, so a missing endpoint is reported as a gap here rather than as a limit of Webflow.

> 💡 **"Create a new site" not working?** On any plan below Enterprise, Webflow refuses site creation over the API however your token is scoped. Create it in the Webflow dashboard (**+ New site**), then every other tool here works on it normally. This is a Webflow plan limit, not a token or setup problem.

#### Stuck? Ask once, not three times

```
webflow_preflight
```

One call checks all three legs — the Figma channel, the Webflow token and its
scopes, and whether the Designer extension is joined — and reports every blocker
together with the exact fix:

```
❌ Figma channel: not joined
❌ Webflow token: valid, but missing the sites:read scope
❌ Webflow Designer extension: not on channel 6zas1rep
```

It exists because the alternative is discovering these one at a time: fix the
token, come back, find the extension is not connected, come back again. It
appears as soon as **either** Webflow feature is configured, since a
half-configured setup is exactly what it is for.

#### Turning on the canvas tools

The 16 tools above are the **content** half. There are 12 more that build on the
Webflow canvas — elements, classes, tag styles, variables, components — through
this plugin's own Webflow Designer Extension.

They are **off by default**, because they cost schema on every request and do
nothing without the extension running. Turn them on in Claude Desktop →
Settings → Extensions → this extension → **Webflow Designer tools**, then quit
Claude Desktop completely and reopen.

> ⚠️ **If Claude says it cannot build layout and asks you to install Webflow's
> own connector or MCP Bridge App, this switch is off.** This plugin replaces
> both; you do not need them.

Setting up the extension itself is in [`webflow_extension/README.md`](webflow_extension/README.md).
To try the canvas tools with no Webflow account at all, `npm run webflow:harness -- <channel-id>`
stands in for the extension.

#### Why these are the safe ones for a team

Every call is addressed by an explicit id and holds no session state. There is no "current active page" to fight over, so **several people on several machines can run these at the same time**. That is the opposite of the Designer half, which must be serialised to one agent per site.

#### Safety

- **Nothing is published by accident.** `webflow_publish_site`, `webflow_publish_items` and `webflow_delete_items` all refuse to run without `confirm: true`, and the refusal tells Claude to ask you first.
- **Publishing a site pushes *everyone's* staged changes**, not just Claude's. The tool says this in its refusal, so you find out before it happens rather than after.
- **Writes are staged, not live.** Page edits and CMS changes sit in Webflow until something publishes them.
- **Token scope is yours to set.** A read-only token makes the whole inspect-and-report half of the work impossible to get wrong.

---

## 🔄 Update to the newest version

When this repository gets new features, update like this (about 3 minutes):

```bash
cd ~/Documents/claude-talk-to-figma-mcp-main
git pull
npm install
npm run build
npx dxt pack . claude-talk-to-figma-mcp.mcpb
```

Then:

1. Double-click the new **`claude-talk-to-figma-mcp.mcpb`** → **Install / Replace**
2. **Quit Claude Desktop completely** (`Cmd` + `Q`) and reopen it
3. In the Terminal running the bridge, press `Ctrl` + `C`, then start it again with `npm run socket`
4. In Figma, **close the plugin and open it again** (it loads the new plugin code), and connect with the new channel ID

> 🔑 **Skipping step 1 or 2 is the #1 reason "nothing changed".** Claude Desktop keeps running the extension you installed before until you reinstall it and restart. The version number in Settings → Extensions may not change, so don't rely on it.
>
> 🪟 **Windows:** use `npm run build:win` instead of `npm run build`, and `cd $HOME\Documents\claude-talk-to-figma-mcp-main`.

---

<a id="bangla"></a>

# 🇧🇩 বাংলা নির্দেশিকা — একদম নতুনদের জন্য

**সময় লাগবে:** প্রথমবার প্রায় ১৫ মিনিট। এরপর প্রতিদিন মাত্র ২০ সেকেন্ড।

এই নির্দেশিকা ধরে নিচ্ছে আপনি আগে কখনো Terminal ব্যবহার করেননি। প্রতিটি কমান্ড পুরোটা লেখা আছে, শুধু কপি করে পেস্ট করবেন। কমান্ডগুলো ইংরেজিতেই থাকবে, এগুলো বদলাবেন না।

> 💡 নির্দেশিকাটি **macOS**-এর জন্য লেখা। Windows-এ যেখানে আলাদা, সেখানে `🪟 Windows` লেখা আছে।

## 🧠 আগে বুঝে নিন কী ইনস্টল করছেন

এটা একটা অ্যাপ নয়, **তিনটি অংশ একসাথে কাজ করে**:

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│  Claude Desktop │◄──────►│  ব্রিজ সার্ভার      │◄──────►│  Figma Desktop  │
│  ১. এক্সটেনশন     │        │  ২. Terminal-এ চলে │        │  ৩. প্লাগইন        │
└─────────────────┘        └──────────────────┘        └─────────────────┘
```

| # | অংশ | কী কাজ করে | কোথায় থাকে |
|---|---|---|---|
| **১** | **এক্সটেনশন** (`.mcpb` ফাইল) | Claude-কে Figma-র টুলগুলো দেয় | Claude Desktop-এর ভেতরে |
| **২** | **ব্রিজ সার্ভার** | Claude আর Figma-র মধ্যে বার্তা আদান-প্রদান করে | একটা খোলা Terminal উইন্ডোতে |
| **৩** | **Figma প্লাগইন** | নির্দেশ পেয়ে আসলে ডিজাইনে পরিবর্তন করে | Figma Desktop-এর ভেতরে |

**তিনটিই একসাথে চালু থাকতে হবে।** যেকোনো একটা বন্ধ থাকলে Claude বলবে সে Figma-তে পৌঁছাতে পারছে না। এটাই সবচেয়ে সাধারণ সমস্যা।

---

## ধাপ ০: Terminal খুলুন

1. কিবোর্ডে `Cmd` + `Space` চাপুন
2. `Terminal` লিখুন
3. `Enter` চাপুন

একটা লেখাভরা উইন্ডো খুলবে, এটাই Terminal। কমান্ড চালাতে: কমান্ড কপি করুন → Terminal-এ পেস্ট করুন (`Cmd` + `V`) → `Enter` চাপুন → লেখা থামা পর্যন্ত **অপেক্ষা করুন**।

> 🪟 **Windows:** `Win` কী চাপুন, `PowerShell` লিখে `Enter` চাপুন।

---

## ধাপ ১: চারটি প্রয়োজনীয় জিনিস ইনস্টল করুন

### ১ক. Node.js

আগে থেকে আছে কিনা দেখুন:

```bash
node -v
```

- ✅ `v22.14.0`-এর মতো কিছু দেখালে (**18 বা তার বেশি**) → ১খ-তে যান।
- ❌ `command not found` দেখালে → **[nodejs.org](https://nodejs.org/en/download)**-এ গিয়ে সবুজ **"Download Node.js (LTS)"** বাটনে ক্লিক করুন, ডাউনলোড হওয়া ফাইল খুলে **Continue** চাপতে থাকুন।

তারপর Terminal **বন্ধ করে আবার খুলুন**, আর `node -v` আবার চালিয়ে দেখুন।

### ১খ. Bun (অবশ্যই লাগবে, বাদ দেবেন না)

ব্রিজ সার্ভার Bun ছাড়া **চলবেই না**। এই ধাপ বাদ দেওয়াই সেটআপ ব্যর্থ হওয়ার ১ নম্বর কারণ।

```bash
bun -v
```

`command not found` দেখালে ইনস্টল করুন:

```bash
curl -fsSL https://bun.sh/install | bash
```

শেষ হলে Terminal **বন্ধ করে আবার খুলুন**, তারপর `bun -v` চালান। `1.2.4`-এর মতো ভার্সন দেখাবে।

> 🪟 **Windows:** এর বদলে চালান `powershell -c "irm bun.sh/install.ps1 | iex"`

### ১গ. Figma **Desktop** অ্যাপ

**[figma.com/downloads](https://www.figma.com/downloads/)** থেকে ডাউনলোড করুন।

> ⚠️ ব্রাউজারের Figma-তে **কাজ করবে না**। ডেস্কটপ অ্যাপ লাগবেই।

### ১ঘ. Claude Desktop

**[claude.ai/download](https://claude.ai/download)** থেকে ডাউনলোড করে সাইন ইন করুন।

> ⚠️ ব্রাউজারের claude.ai নয়, **ডেস্কটপ অ্যাপ** লাগবে। ব্রাউজারে এক্সটেনশন চলে না।

**✅ যাচাই:** `node -v` আর `bun -v` দুটোই ভার্সন দেখাচ্ছে, আর Figma Desktop ও Claude Desktop দুটোই খুলছে।

---

## ধাপ ২: প্রজেক্ট ডাউনলোড করে বিল্ড করুন

নিচের **পুরো ব্লকটা একসাথে** কপি করে Terminal-এ পেস্ট করুন, তারপর `Enter`:

```bash
cd ~/Documents
git clone https://github.com/litoondev/claude-talk-to-figma-mcp-main.git
cd claude-talk-to-figma-mcp-main
npm install
npm run build
```

| লাইন | কী করে |
|---|---|
| `cd ~/Documents` | Documents ফোল্ডারে যায় |
| `git clone …` | প্রজেক্টটা `Documents/claude-talk-to-figma-mcp-main`-এ ডাউনলোড করে |
| `cd claude-talk…` | সেই ফোল্ডারের ভেতরে ঢোকে |
| `npm install` | দরকারি লাইব্রেরি ডাউনলোড করে (১–৩ মিনিট, অনেক লেখা আসবে, এটা স্বাভাবিক) |
| `npm run build` | প্রজেক্টকে চালানোর উপযোগী করে |

**এই ফোল্ডারটাই আপনার মূল জায়গা:** `Documents/claude-talk-to-figma-mcp-main`। প্রতিবার এখানেই ফিরে আসবেন।

> ❓ **`git: command not found` দেখালে:** `xcode-select --install` চালান, যে উইন্ডো আসবে সেখানে **Install** চাপুন, তারপর উপরের ব্লকটা আবার চালান। অথবা [GitHub পেজ](https://github.com/litoondev/claude-talk-to-figma-mcp-main) থেকে সবুজ **Code** বাটন → **Download ZIP** → Documents-এ unzip করুন → সেই ফোল্ডারে `npm install` আর `npm run build` চালান।
>
> ❓ **লাল রঙের `WARN` বা `deprecated` লেখা এলে:** চিন্তার কিছু নেই, উপেক্ষা করুন। শুধু **`ERR!`** লেখা এসে কমান্ড মাঝপথে থেমে গেলে সমস্যা।
>
> 🪟 **Windows:** `npm run build`-এর বদলে `npm run build:win`, আর `cd ~/Documents`-এর বদলে `cd $HOME\Documents` লিখুন।

---

## ধাপ ৩: Claude Desktop-এর এক্সটেনশন ফাইল তৈরি করুন

একই ফোল্ডারে থেকে এটা চালান:

```bash
npx dxt pack . claude-talk-to-figma-mcp.mcpb
```

প্রায় ৩০ সেকেন্ড পর ফোল্ডারে **`claude-talk-to-figma-mcp.mcpb`** ফাইল তৈরি হবে। পরের ধাপে এটাই ইনস্টল করবেন।

> 💡 ফোল্ডারে `.dxt` ফাইলও দেখলে ঘাবড়াবেন না। ওগুলো একই জিনিসের পুরোনো নামের কপি। **সবসময় `.mcpb` ব্যবহার করুন।**

---

## ধাপ ৪: Claude Desktop-এ এক্সটেনশন ইনস্টল করুন

1. **Finder** খুলুন → বাঁ পাশে **Documents** → `claude-talk-to-figma-mcp-main` ফোল্ডার খুলুন
2. **`claude-talk-to-figma-mcp.mcpb`** ফাইলে **ডাবল-ক্লিক** করুন
3. Claude Desktop খুলে ইনস্টলের অনুমতি চাইবে → **Install** চাপুন (আগে থেকে থাকলে **Replace**)
4. **Figma personal access token** চাইলে → **খালি রেখে Continue চাপুন।** এটা শুধু কমান্ড টুলের জন্য, পরে দিলেও চলবে ([ধাপ ৭](#bangla-step7))
5. **Claude Desktop পুরো বন্ধ করুন:** `Cmd` + `Q` চাপুন (লাল × চাপলে পুরো বন্ধ হয় না), তারপর আবার খুলুন

**ডাবল-ক্লিকে কিছু না হলে:** Claude Desktop → **Settings** → **Extensions** → `.mcpb` ফাইলটা টেনে এনে ওই পেজে ছেড়ে দিন।

**✅ যাচাই:** Claude Desktop → Settings → Extensions-এ **Claude Talk to Figma** দেখা যাচ্ছে এবং চালু আছে।

> ❓ ফাইলটা অন্য কোনো অ্যাপে খুলে গেলে: ফাইলে রাইট-ক্লিক → **Open With** → **Claude**।

---

## ধাপ ৫: Figma-তে প্লাগইন ইনস্টল করুন

1. **Figma Desktop** অ্যাপ খুলুন, যেকোনো ডিজাইন ফাইল খুলুন
2. উপরে বাঁ কোণে **Figma লোগো ("F" আইকন)** → **Plugins** → **Development** → **Import plugin from manifest…**
3. এই পথে যান:
   ```
   Documents → claude-talk-to-figma-mcp-main → src → claude_mcp_plugin → manifest.json
   ```
4. **`manifest.json`** সিলেক্ট করে **Open** চাপুন

> 💡 `src` ফোল্ডার খুঁজে না পেলে ফাইল পিকারে `Cmd` + `Shift` + `G` চাপুন আর পেস্ট করুন: `~/Documents/claude-talk-to-figma-mcp-main/src/claude_mcp_plugin`

**✅ যাচাই:** **Plugins** → **Development**-এ **Claude Talk to Figma** দেখা যাচ্ছে। এটা জীবনে একবারই করতে হয়।

---

<a id="bangla-step6"></a>

## ধাপ ৬: চালু করুন (প্রতিদিনের কাজ)

### ৬ক. ব্রিজ সার্ভার চালু করুন

Terminal খুলে চালান:

```bash
cd ~/Documents/claude-talk-to-figma-mcp-main
npm run socket
```

এমন লেখা আসবে:

```
Claude to Figma WebSocket server running on port 3055
```

> 🚨 **এই Terminal উইন্ডো খোলা রাখুন।** বন্ধ করলে বা `Ctrl` + `C` চাপলে ব্রিজ বন্ধ হয়ে যাবে আর Claude Figma হারাবে। উইন্ডোটা শুধু একপাশে সরিয়ে রাখুন।
>
> 💡 চালু আছে কিনা দেখতে ব্রাউজারে খুলুন: **http://localhost:3055/status**

### ৬খ. Figma-তে প্লাগইন খুলুন

আপনার Figma ফাইলে: **Plugins** → **Development** → **Claude Talk to Figma**

একটা ছোট প্যানেল খুলবে। সেখানে সবুজ বক্সে একটা **channel ID** দেখাবে, যেমন `a4f9c2`।

- **Connect** বাটন দেখালে সেটায় ক্লিক করুন।
- **ID-টার উপর ক্লিক করলে** পুরো বার্তা `Connect to Figma, channel …` কপি হয়ে যায়।

> ⚠️ **প্লাগইন যতবার খুলবেন, ID ততবার বদলাবে।** পুরোনো ID কখনো ব্যবহার করবেন না।

### ৬গ. Claude-কে কানেক্ট করুন

Claude Desktop-এ লিখুন, তবে **`a4f9c2`-এর জায়গায় আপনার নিজের ID দিন**:

```
Connect to Figma, channel a4f9c2
```

তারপর Figma-তে যেকোনো লেয়ার সিলেক্ট করে জিজ্ঞেস করুন:

```
What's currently selected in Figma?
```

Claude সেই লেয়ারের বর্ণনা দিলে **সেটআপ সম্পূর্ণ।** 🎉

---

<a id="bangla-step7"></a>

## ধাপ ৭ (ঐচ্ছিক): Figma কমেন্ট টুল

শুধু যদি চান Claude Figma-র **কমেন্ট পড়ুক ও উত্তর দিক**। বাকি সব এটা ছাড়াই কাজ করে।

1. Figma: **আপনার ছবি** → **Settings** → **Security** → **Personal access tokens** → **Generate new token**
2. এই দুটো scope চালু করুন: **`files:read`** আর **`file_comments:write`**
3. টোকেনটা সাথে সাথে কপি করুন (Figma একবারই দেখায়), এটা `figd_` দিয়ে শুরু হয়
4. Claude Desktop → **Settings** → **Extensions** → **Claude Talk to Figma** → টোকেন পেস্ট করুন
5. `Cmd` + `Q` দিয়ে Claude বন্ধ করে আবার খুলুন

> 🔒 এই টোকেন দিয়ে আপনার অ্যাকাউন্টের **সব ফাইল** পড়া যায়। কখনো কারো সাথে শেয়ার করবেন না, চ্যাটে পেস্ট করবেন না।

---

## 📅 প্রথমবারের পর প্রতিদিন

সেটআপ স্থায়ী। প্রতিদিন শুধু তিনটি কাজ:

```bash
cd ~/Documents/claude-talk-to-figma-mcp-main && npm run socket
```

1. ✅ উপরের কমান্ড চালান (Terminal খোলা রাখুন)
2. ✅ Figma → **Plugins** → **Development** → **Claude Talk to Figma** → নতুন channel ID কপি করুন
3. ✅ Claude-কে লিখুন: `Connect to Figma, channel` তারপর আপনার ID

---

## 🧹 লেয়ার অপটিমাইজ ও Grid-এ রূপান্তর

অগোছালো লেয়ার পরিষ্কার করে (খালি ফ্রেম, অকেজো গ্রুপ, `Frame > Frame > Card`-এর মতো ডাবল নেস্টিং) আর কার্ডের সারিকে আসল Figma **Grid**-এ রূপান্তর করে, **ডিজাইন দেখতে একটুও না বদলে**।

### কীভাবে ব্যবহার করবেন

1. Figma-তে **একটা সেকশন বা ফ্রেম সিলেক্ট করুন**, যেমন `# Work Process`। একসাথে পুরো পেজ সিলেক্ট করবেন না।
2. Claude-কে লিখুন:
   ```
   Optimize the layers of the selected section
   ```
3. Claude আগে **শুধু স্ক্যান করবে** (কিছুই বদলাবে না), তারপর যেখানে আপনার সিদ্ধান্ত লাগবে সেখানে জিজ্ঞেস করবে:

   | Claude যা জিজ্ঞেস করবে | এর মানে | আপনার উত্তর |
   |---|---|---|
   | "N টি হিডেন লেয়ার পাওয়া গেছে, রিমুভ করবেন?" | হিডেন লেয়ার হয়তো আপনি ইচ্ছে করে রেখেছেন | মুছতে **হ্যাঁ**, রাখতে **না** |
   | "\"Card\"-এ প্রোটোটাইপ ইন্টারঅ্যাকশন আছে, রিমুভ করবেন?" | মুছলে প্রোটোটাইপ, ইফেক্ট, এক্সপোর্ট বা মাস্ক নষ্ট হতে পারে | প্রতিটির জন্য আলাদা সিদ্ধান্ত |
   | "\"# Work Process\" ৪-কলাম Grid হতে পারে, রূপান্তর করবেন?" | হেডিং আর কার্ডগুলো সরাসরি Grid-এর ভেতরে বসবে, অপ্রয়োজনীয় র‍্যাপার সরে যাবে | রূপান্তর করতে **হ্যাঁ** |

4. Claude শুধু আপনার অনুমতি দেওয়া কাজগুলোই করবে, আর কী বদলেছে জানাবে।

### নিজে থেকে যা করে (জিজ্ঞেস না করেই)

- খালি ও শূন্য-মাপের লেয়ার সরায়
- অকেজো র‍্যাপার ফ্রেম সরায়: যার ভেতরে একটাই চাইল্ড হুবহু সমান মাপের, কোনো প্যাডিং, fill, stroke বা clip নেই
- র‍্যাপারের **Fill** সাইজিং চাইল্ডকে দিয়ে দেয়, তাই লেআউট হুবহু একই থাকে

### যা কখনো করে না

- আপনার "হ্যাঁ" ছাড়া **হিডেন** লেয়ার, বা **প্রোটোটাইপ, ইফেক্ট, এক্সপোর্ট সেটিং বা মাস্ক** থাকা লেয়ার মোছে না
- **মেইন কম্পোনেন্ট**, **কম্পোনেন্ট প্রপার্টি** বা **ভ্যারিয়েন্ট** লেয়ার কখনো মোছে না
- লেখা, ফন্ট, রং, স্পেসিং ভ্যালু বা ভেরিয়েবল বদলায় না
- **কম্পোনেন্ট ইনস্ট্যান্সের** ভেতরে হাত দেয় না

### Grid রূপান্তর কেন নিরাপদ

| আপনার ডিজাইন | রূপান্তরের পর |
|---|---|
| `# Work Process` (vertical Auto Layout) → `Text_Container` + `Container` → `Frame` → `Frame` → `Card` ×4 | `# Work Process` (**Grid**, ৪ কলাম) → `Text_Container` (৪ কলাম জুড়ে) + `Card` ×4 |

- **কলাম সংখ্যা ডিজাইন থেকেই নেয়:** ৪টি সমান কার্ড মানে ৪টি সমান কলাম (`repeat(4, 1fr)`)।
- গ্যাপ আর প্যাডিং তাদের **ভেরিয়েবল** সহ থাকে।
- রূপান্তরের পর প্লাগইন **প্রতিটি হেডিং ও কার্ডের পজিশন মেপে দেখে**। ১px-এর বেশি নড়লে বা Figma কোনো ধাপ মানতে না চাইলে **রূপান্তর বাতিল করে আগের অবস্থায় ফিরিয়ে দেয়** আর কারণ জানায়। প্রতিটি রূপান্তর একবার `Cmd` + `Z` চাপলেই ফেরানো যায়।
- শুধু তখনই প্রস্তাব করে যখন Grid হুবহু একই রকম দেখাতে পারবে: একটা হেডিং, সমান চওড়ার কার্ডের একটা সারি, সারিতে প্যাডিং বা ব্যাকগ্রাউন্ড নেই।

> ⚠️ **Grid রূপান্তর না হলে নিজে ungroup করে "ঠিক" করতে যাবেন না।** Auto Layout সারি ungroup করলে কার্ডগুলো একটার নিচে আরেকটা চলে যায়। হাতে আবার সাজালে ফ্রেমটা **fixed পজিশনের, লেআউটহীন** হয়ে যায়: দেখতে ঠিক, কিন্তু আর রেসপন্সিভ থাকে না। বরং Claude যে কারণ জানিয়েছে সেটা দেখুন।

---

<a id="bangla-html"></a>

## 🌐 HTML ফাইল বা ওয়েবসাইট থেকে Figma ডিজাইন

একটা ওয়েব পেজকে Figma ডিজাইনে রূপান্তর করে, **দেখতে হুবহু পেজের মতো**: প্রতিটি সেকশন, লেখা, ছবি আর আইকন সহ। ডিজাইনটা **আপনার ফাইলের নিজস্ব স্টাইল ও ভেরিয়েবলের সাথে যুক্ত** থাকে, আর লেয়ার থাকে পরিষ্কার ও কম নেস্টেড।

### কীভাবে ব্যবহার করবেন

1. Figma-তে সেই ফাইলটি খুলুন যার ডিজাইন সিস্টেম (কালার ভেরিয়েবল, টেক্সট স্টাইল, স্পেসিং টোকেন) ব্যবহার করতে চান।
2. ওয়েবসাইট বা HTML পেজের **পুরো পেজের একটা স্ক্রিনশট** নিয়ে Claude-কে দিন। শেষে Claude এটার সাথেই ফলাফল মিলিয়ে দেখবে।
3. Claude-কে লিখুন:
   ```
   Convert https://example.com to Figma
   ```
   ```
   Convert /Users/YOUR_NAME/Desktop/page.html to Figma
   ```
   > 💡 কম্পিউটারের ফাইল হলে **পুরো path** দিতে হবে, আর ফাইলটা Claude Desktop যে কম্পিউটারে চলছে সেখানেই থাকতে হবে। Mac-এ path পেতে: Finder-এ ফাইল সিলেক্ট করুন → `Option` চেপে ধরে রাইট-ক্লিক → **Copy "page.html" as Pathname**।
4. Claude এই ধাপগুলোতে কাজ করবে আর জানাবে কী করছে:

   | ধাপ | কী হয় |
   |---|---|
   | **১. বিশ্লেষণ** | পেজ আর তার CSS পড়ে: সেকশন, লেখা, কালার, ফন্ট, স্পেসিং, radius, **প্রতিটি ছবি ও আইকন**, আর কোন অংশ গ্রিড বা সারি/কলাম |
   | **২. মিলিয়ে দেখা** | প্রতিটি ভ্যালু আপনার ডিজাইন সিস্টেমের সাথে মেলায়: **সিস্টেম থেকে ব্যবহার** / **কাছাকাছি কিন্তু হুবহু না** / **সিস্টেমে নেই** |
   | **৩. তৈরি** | যেখানে **হুবহু** মেলে সেখানে আপনার ভেরিয়েবল ও টেক্সট স্টাইল বসায়; বাকিগুলো পেজের নিজের ভ্যালু দিয়ে তৈরি করে। প্রতিটি ছবি ও আইকন বসায়। প্রতিটি অংশে **Grid** বা **Auto Layout** বেছে নেয় (নিচের টেবিল) |
   | **৪. কম্পোনেন্ট** | যে জিনিস **২ বা তার বেশি বার** আসে আর আপনার ফাইলে যার হুবহু কম্পোনেন্ট নেই, সেটা পেজের পাশে **Components — from HTML** নামের ফ্রেমে **নতুন কম্পোনেন্ট** হিসেবে তৈরি হয়, আর পেজে তার instance বসে। একবার আসা জিনিস সাধারণ লেয়ার হিসেবেই থাকে |
   | **৫. Import Notes** | ডিজাইনের পাশে একটা ফ্রেম, যেখানে লেখা থাকে কী আপনার ডিজাইন সিস্টেমে ছিল না, কোন নতুন কম্পোনেন্ট তৈরি হয়েছে, আর কোনো কিছু হুবহু করা না গেলে সেটা |
   | **৬. মিলিয়ে দেখা** | ফলাফল এক্সপোর্ট করে আপনার স্ক্রিনশটের সাথে মেলায়, পার্থক্য না থাকা পর্যন্ত ঠিক করে; তারপর লেয়ার স্ক্যান চালায়, কিছু মোছার আগে জিজ্ঞেস করে |

### যে নিয়ম মেনে চলে

- **হুবহু।** কিছু বাদ যায় না, কিছু যোগ হয় না, কোনো স্টাইল বদলানো বা সরল করা হয় না। কোনো কিছু সত্যিই তৈরি করা না গেলে Claude আন্দাজে কাছাকাছি বানায় না, Import Notes-এ জানিয়ে দেয়।
- **আপনার স্টাইল গাইডের সাথে যুক্ত।** যে কালার, টেক্সট স্টাইল, স্পেসিং বা radius আপনার ডিজাইন সিস্টেমে আছে, সেটা ভ্যালু টাইপ করে নয়, টোকেনের সাথে যুক্ত করে বসানো হয়। "কাছাকাছি" স্টাইল বা কম্পোনেন্ট ব্যবহার করা হয় না, কারণ তাতে ডিজাইন বদলে যায়।
- **নতুন ভেরিয়েবল বা স্টাইল তৈরি হয় না।** নতুন তৈরি হয় শুধু বারবার আসা জিনিসের কম্পোনেন্ট।

### Grid নাকি Auto Layout?

| পেজে যা আছে | Figma-তে যেভাবে তৈরি হবে |
|---|---|
| সমান কলামের `display: grid` | একই সংখ্যক কলামের **Grid** |
| হেডিং, নিচে সমান কার্ডের সারি | **একটাই Grid**: হেডিং সব কলাম জুড়ে, কার্ড সরাসরি ভেতরে, আলাদা row wrapper নেই |
| সমান আইটেমের সারি যা নিচে নেমে যায় (wrap) | **Grid** |
| এক সারির জিনিস (মেনু, বাটন, লোগো) | **Auto Layout — horizontal** |
| একটার নিচে আরেকটা ব্লক | **Auto Layout — vertical** |
| স্ক্রিনে আটকে থাকা বাটন বা ব্যানার (`position: fixed`) | একই জায়গায়, পেজের উপরে তৈরি হয় |
| শুধু একটা এলিমেন্টকে ঘিরে থাকা `div` | **কোনো ফ্রেম তৈরি হয় না**, যদি সরালে দেখতে কিছুই না বদলায় |

### জেনে রাখুন

- **ছবি** প্লাগইনের সার্ভার নিজেই ডাউনলোড করে (`place_html_image`) আর হুবহু মাপে বসায়, ওয়েবসাইট থেকে হোক বা লোকাল `.html` পেজের পাশের ফাইল থেকে। **আইকন** (inline SVG) ভেক্টর হিসেবে বসে, আইকন স্প্রাইট থেকে আসা আইকনও। কোনো ছবি আনা না গেলে তার হুবহু মাপের ফ্রেম `Image-Missing-…` নামে থেকে যায়, তাই লেআউট সরে যায় না।
- **এটা পেজের HTML ও CSS পড়ে, ব্রাউজারে চালিয়ে দেখে না।** যে পেজ লোড হওয়ার পর JavaScript দিয়ে কনটেন্ট বানায়, সেটা অসম্পূর্ণ আসতে পারে। তখন Chrome-এ পেজ খুলে **File → Save Page As… → Webpage, Complete** দিয়ে সেভ করুন, তারপর সেই `.html` ফাইল দিন।
- **লগইন লাগে এমন পেজ** পড়া যায় না। উপরের মতো সেভ করে দিন।
- **ফন্ট** আপনার কম্পিউটারে ইনস্টল থাকতে হবে, তবেই Figma ব্যবহার করতে পারবে।

---

<a id="bangla-webflow"></a>

## 🌊 Figma ডিজাইন থেকে Webflow পেজ

একটা Figma ফ্রেমকে সত্যিকারের Webflow পেজ বানিয়ে দেয় — প্রতিটি সেকশন, টেক্সট, ছবি আর আইকনসহ। Auto Layout হয়ে যায় flex ও grid, আপনার Figma ভেরিয়েবলগুলো Webflow ভেরিয়েবল হিসেবে তৈরি হয়, আর যেসব এলিমেন্ট বারবার আসে সেগুলো Webflow কম্পোনেন্ট হয়ে যায়।

এটা উপরের HTML ইমপোর্টের **উল্টো কাজ**: ওটা পেজ পড়ে Figma বানায়, এটা Figma পড়ে পেজ বানায়।

### আগে Webflow-কে Claude-এর সাথে জুড়ে নিন

এই প্লাগইনে Webflow-এর কোনো টুল নেই। Webflow-এর **নিজস্ব** MCP সার্ভার আছে, আর Claude দুটোকে পাশাপাশি চালায়: এই প্লাগইন Figma পড়ে, Webflow-এর সার্ভার সাইট বানায়। এটা একবারই করতে হবে।

১. Claude Desktop-এ চ্যাট বক্সের **`+`** চিহ্নে ক্লিক করুন → **Add connectors**।
২. **Webflow** লিখে খুঁজুন। না পেলে তালিকাটা **Featured** থেকে **All**-এ বদলে নিন।
৩. সেটায় ক্লিক করে **Connect** দিন, Webflow-এ লগইন করুন, তারপর কোন সাইট ও Workspace-এ Claude হাত দিতে পারবে সেগুলো বেছে **Authorize App** চাপুন।
৪. Webflow কানেক্টরটা খুলে **Configure**-এ গিয়ে ঠিক করুন Claude নিজে থেকে কাজ করবে নাকি প্রতিবার আপনার অনুমতি নেবে। শুরুর দিকে **অনুমতি নেওয়াটাই** নিরাপদ।

> 💡 **তালিকায় Webflow কানেক্টর না থাকলে** নিজে হাতে custom connector হিসেবে যোগ করুন, URL: `https://mcp.webflow.com/mcp`।
>
> ⚠️ **`claude_desktop_config.json`-এ শুধু URL বসালে চলবে না।** ওই ফাইল শুধু লোকাল (stdio) সার্ভার চালু করে, আর Webflow-এরটা রিমোট। উপরের **Add connectors** ব্যবহার করুন — অথবা config ফাইলই যদি পছন্দ হয়, Webflow-এর নিজের ডকে `mcp-remote` শিম দিয়ে সেতু বানানো আছে: `"command": "npx", "args": ["mcp-remote", "https://mcp.webflow.com/sse"]`। এরপর Claude Desktop রিস্টার্ট করলে OAuth পেজ খুলবে।
>
> 🔓 **Designer খুলুন, সাথে Bridge App-ও চালু করুন।** Designer-এ Apps প্যানেল খুলে (`E` চাপুন) **Webflow MCP Bridge App** চালু করুন। এলিমেন্ট, স্টাইল, ভেরিয়েবল আর কম্পোনেন্ট বানানোর টুলগুলো এটার মাধ্যমেই ক্যানভাসে পৌঁছায়, তাই প্যানেল বন্ধ থাকলে বা ট্যাব বন্ধ হলে ওগুলো চুপ হয়ে যায়। CMS আর সাইটের টুল অবশ্য এটা ছাড়াই চলে।

### কীভাবে ব্যবহার করবেন

১. আগের মতোই ব্রিজ সার্ভার চালু করে Figma প্লাগইন কানেক্ট করুন ([ধাপ ৬](#bangla-step6))।
২. Figma-তে যে ফ্রেমটা পাঠাতে চান সেটা **সিলেক্ট করুন**।
৩. Claude-কে বলুন:
   ```
   এই ফ্রেমটা Webflow-এ এক্সপোর্ট করো
   ```
   কিছু বানানোর আগে Claude জিজ্ঞেস করবে কোন সাইট আর কোন পেজে কাজ হবে।
৪. এরপর এক সেকশন করে এই ধাপগুলো পার হয়:

   | ধাপ | যা হয় |
   |---|---|
   | **১. যাচাই** | Figma কানেক্টেড কিনা, Webflow Designer ব্রিজ চালু আছে কিনা, আর কোন সাইট-পেজে কাজ হবে — সব নিশ্চিত করে। শেষে মেলানোর জন্য আপনার ফ্রেমের স্ক্রিনশট নিয়ে রাখে |
   | **২. পড়া** | ফ্রেমের লেআউট, সাইজিং, স্পেসিং, রং, টেক্সট আর **ভেরিয়েবল বাইন্ডিং** পড়ে — "এটা ৪০px" আর "এটা `spacing/40`"-এর পার্থক্যটাই এখানে আসল |
   | **৩. ভেরিয়েবল** | আপনার Figma ভেরিয়েবল কালেকশনগুলো একই নামে Webflow ভেরিয়েবল হিসেবে বানায়। টেক্সট স্টাইলগুলো হয় Webflow ক্লাস |
   | **৪. বানানো** | সেকশন ধরে ধরে: Auto Layout → flex, Grid → CSS grid, Fill/Hug → `100%`/`auto`। একই রকম এলিমেন্ট পায় **একই ক্লাস**; যেটা দুইবার বা তার বেশি আসে সেটা হয় **Webflow কম্পোনেন্ট** |
   | **৫. ব্রেকপয়েন্ট** | আগে ডেস্কটপ পুরোপুরি শেষ, তারপর ট্যাবলেট, তারপর মোবাইল — প্রতিটা Figma মোড আলাদা করে পড়ে, আর যা সত্যিই আলাদা শুধু সেটুকুই ওভাররাইড করে |
   | **৬. Export Notes** | কী কী ভেরিয়েবল, ক্লাস ও কম্পোনেন্ট বানানো হলো, কোন মানগুলোর পেছনে কোনো টোকেন ছিল না, আর কোনটা হুবহু করা গেল না — সবের হিসাব |
   | **৭. মেলানো** | স্টেজিং-এ পাবলিশ করে প্রতিটা ব্রেকপয়েন্টে আপনার স্ক্রিনশটের সাথে মেলায়, আর পার্থক্য না মেটা পর্যন্ত ঠিক করতে থাকে |

### ব্রেকপয়েন্টের ফাঁদ — এটুকু অবশ্যই পড়ুন

**Figma আর Webflow-এর ব্রেকপয়েন্টের সংখ্যা এক নয়**, আর বেশিরভাগ Figma-থেকে-Webflow কাজ এখানেই চুপচাপ ভেঙে যায়:

| Webflow ব্রেকপয়েন্ট | কোথায় খাটে | কাছাকাছি Figma মোড |
|---|---|---|
| Desktop (base) | ৯৯২px ও তার উপরে | `Desk` 1440 |
| Tablet | ৯৯১px পর্যন্ত | `Tab` 768 |
| Mobile landscape | ৭৬৭px পর্যন্ত | **কিছুই নেই** |
| Mobile portrait | ৪৭৯px পর্যন্ত | `Mobi` 320 |

অর্থাৎ ৭৬৮-এ আঁকা লেআউটকে Webflow-এ **৯৯১ পর্যন্ত** টিকে থাকতে হবে, আর **৪৮০–৭৬৭ ব্যান্ডের জন্য Figma-তে কোনো মোডই নেই**। Claude এখানে অনুমান করে না: ট্যাবলেট লেআউটটা দুই প্রান্তেই পরখ করে, আর ৪৮০–৭৬৭ ব্যান্ডে কী হবে সেটা ভাগ্যের হাতে না ছেড়ে আপনাকে জিজ্ঞেস করে।

Webflow-এর cascade আবার শুধু **নিচের দিকে** নামে — ডেস্কটপে বসানো মান ট্যাবলেট ও মোবাইলে পৌঁছায়, কিন্তু উল্টোটা হয় না। এজন্যই আগে ডেস্কটপ পুরোপুরি শেষ করা হয়, তারপর অন্য কিছুতে হাত দেওয়া হয়।

### জেনে রাখুন

- **নিজে থেকে কোনো টোকেন বানায় না।** যে মানের পেছনে Figma ভেরিয়েবল নেই, সেটা সাধারণ সংখ্যা হিসেবেই বসে আর Export Notes-এ লেখা থাকে। Claude-এর মনে হলে যে এটার ভেরিয়েবল থাকা উচিত, সে জিজ্ঞেস করে।
- **ফিক্সড হাইট বাদ দেয়।** Figma-তে কার্ড বা টেক্সট ব্লকে ফিক্সড হাইট থাকলেও Webflow-এ সেটা `auto` হয়, যাতে টেক্সট বেশি লাইনে গেলে কেটে না যায়। আইকন, অ্যাভাটার আর ইচ্ছাকৃত ইমেজ ক্রপ নিজের মাপেই থাকে।
- **বারবার আসা আসল কনটেন্ট** (ব্লগ পোস্ট, টিম মেম্বার, প্রোডাক্ট) আটটা হাতে বানানো div-এর চেয়ে **CMS Collection** হিসেবে ভালো। Claude প্রস্তাব দিয়ে আপনার উত্তরের অপেক্ষা করে — এটা আপনার সাইটের সিদ্ধান্ত, ডিজাইনের নয়।
- **ফন্ট** Figma-তে যেটা ব্যবহার করেছেন সেটা Webflow সাইটেও আপলোড করা থাকতে হবে, নইলে পেজ অন্য ফন্টে নেমে যাবে — আর সেই ফন্ট আপনার ডিজাইন নয়।
- **Hover, focus আর pressed স্টেট** Figma ফ্রেমে থাকেই না। Claude এগুলো বানিয়ে না নিয়ে "মানুষের সিদ্ধান্ত দরকার" তালিকায় রাখে।
- **পুরো প্রসিডিওরটা** আছে [`skills/Webflow_Export_v1.md`](skills/Webflow_Export_v1.md) ফাইলে। আপনার টিমের নিয়ম আলাদা হলে ওটা এডিট করে নিন — দেখুন [Skills](#-skills)।

---

<a id="bangla-update"></a>

## 🔄 নতুন ভার্সনে আপডেট করবেন যেভাবে

এই রিপোজিটরিতে নতুন ফিচার এলে (প্রায় ৩ মিনিট):

```bash
cd ~/Documents/claude-talk-to-figma-mcp-main
git pull
npm install
npm run build
npx dxt pack . claude-talk-to-figma-mcp.mcpb
```

তারপর:

1. নতুন **`claude-talk-to-figma-mcp.mcpb`**-এ ডাবল-ক্লিক → **Install / Replace**
2. **Claude Desktop পুরো বন্ধ করুন** (`Cmd` + `Q`), তারপর আবার খুলুন
3. ব্রিজ চলা Terminal-এ `Ctrl` + `C` চাপুন, তারপর আবার `npm run socket` চালান
4. Figma-তে **প্লাগইন বন্ধ করে আবার খুলুন** (তাহলে নতুন কোড লোড হবে), নতুন channel ID দিয়ে কানেক্ট করুন

> 🔑 **"কিছুই বদলায়নি" মনে হওয়ার ১ নম্বর কারণ ১ বা ২ নম্বর ধাপ বাদ দেওয়া।** আবার ইনস্টল করে রিস্টার্ট না করা পর্যন্ত Claude Desktop পুরোনো এক্সটেনশনই চালায়। Settings-এ ভার্সন নম্বর নাও বদলাতে পারে, তাই সেটা দেখে বিচার করবেন না।

---

## 🆘 সমস্যা ও সমাধান

| যা দেখছেন | আসলে কী হয়েছে | সমাধান |
|---|---|---|
| "I can't connect to Figma" | ব্রিজ সার্ভার চলছে না | ধাপ ৬ক আবার করুন, Terminal খোলা রাখুন |
| "Channel not found" | পুরোনো channel ID | প্লাগইন আবার খুলে **নতুন** ID দিন |
| Claude-এর কাছে Figma টুলই নেই | এক্সটেনশন ইনস্টল হয়নি বা Claude রিস্টার্ট হয়নি | Settings → Extensions দেখুন, ধাপ ৪ আবার করুন, `Cmd` + `Q` দিয়ে বন্ধ করুন |
| `ReferenceError: Bun is not defined` | Bun নেই | ধাপ ১খ |
| `EADDRINUSE` / port 3055 | সার্ভার আগেই অন্য উইন্ডোতে চলছে | সেটাই ব্যবহার করুন, অথবা `pkill -f socket.js` |
| Figma মেনুতে প্লাগইন নেই | ব্রাউজারের Figma-তে ইমপোর্ট করেছেন | **Figma Desktop**-এ ধাপ ৫ আবার করুন |
| নতুন ফিচার কাজ করছে না, পুরোনো আচরণ করছে | Claude Desktop পুরোনো এক্সটেনশন চালাচ্ছে | [আপডেট করুন](#bangla-update): নতুন `.mcpb` ইনস্টল → `Cmd` + `Q` → প্লাগইন আবার খুলুন |
| "Grid conversion not applied" | Grid হুবহু একই রকম দেখাতে পারত না, তাই প্লাগইন বাতিল করেছে | ডিজাইন অক্ষত আছে। Claude-এর দেখানো কারণ পড়ুন, ungroup করবেন না |
| গতকাল চলছিল, আজ চলছে না | Terminal বন্ধ বা কম্পিউটার রিস্টার্ট হয়েছে | স্বাভাবিক। প্রতিদিনের ৩টি কাজ আবার করুন |

তবুও সমস্যা থাকলে [TROUBLESHOOTING.md](TROUBLESHOOTING.md) দেখুন অথবা [GitHub-এ Issue খুলুন](https://github.com/litoondev/claude-talk-to-figma-mcp-main/issues)।

---

## 🎨 Local design library first

The plugin will not design from scratch when your file already answers the
question. Before creating or modifying anything, it inspects the current file
and reuses what's there.

### One call, the whole system

`get_design_system` replaces four separate lookups and returns:

| | |
|---|---|
| **Variables & tokens** | Every collection, with modes (light/dark) and colour values resolved to hex |
| **Components** | Standalone components *and* component sets with their **variant properties**, so an existing variant can be selected instead of a new component built |
| **Typography** | Text styles with family, size, line height, letter spacing, case |
| **Colours** | Paint styles as hex, with opacity |
| **Effects & grids** | Shadows, blurs, column grids |
| **Observed conventions** | The padding, gap, radius and font-size values **actually used in the file**, ranked by frequency |

That last row is the part styles alone can't tell you. Most real files encode
their spacing rhythm in usage rather than in named tokens, so "match the
existing spacing" is unanswerable without it. You get output like:

```
── OBSERVED CONVENTIONS — match this rhythm ──────────────
  Padding values:  16 (×24), 32 (×8)
  Gap values:      24 (×6), 12 (×2)
  Corner radii:    8 (×6), 4 (×2)
```

Now the agent knows to use `16` and `8`, not a plausible-looking `20` and `10`.

### The rule it follows

Loaded as the `design_system_first` prompt:

1. **Reuse an existing component exactly** when it solves the need
2. **Reuse an existing variant** when a suitable variation exists
3. **Compose existing components** when it can be built from current primitives
4. **Extend the system** when a new variant is genuinely required
5. **Create something new only as a last resort**

It also binds rather than hardcodes — `apply_variable_to_node` for colour,
`set_text_style_id` for type, `create_component_instance` for components —
and when editing, preserves variable bindings and avoids detaching instances.

> The existing `design_strategy` prompt used to say "plan your layout, then
> create elements", which pulled the other way. It now opens by deferring to
> this rule and describes *how* to build only once you've confirmed the thing
> you need doesn't already exist.

### Using it

Usually nothing to do — the agent calls it on its own. To be explicit:

> "Check the design system first, then build the settings page"

> "What components and tokens does this file already have?"

Components often live on a dedicated library page. If a scan comes back empty,
widen it:

> "Scan the whole document for components, not just this page"

---

## 📱 Responsive Website

Turn an approved desktop design into tablet and mobile versions — by adapting
layout behaviour, not by shrinking the frame.

### How it works: clone, then adapt

Responsive frames are produced by **cloning** the source and changing how the
clone *flows*. That single choice is what makes the safety guarantees real
rather than aspirational:

- component instances stay **connected** — nothing is detached
- variable and style **bindings survive** untouched
- **copy is never rewritten**, images never replaced
- the **original desktop frame is never modified**

### Behaviour, not scaling

Each section is classified and given its own responsive behaviour:

| Section | Tablet 768 | Mobile 320 |
|---|---|---|
| **Navigation** | keep horizontal | switch to existing mobile variant; hamburger flagged if none exists |
| **Hero** | equalise the split | stack, copy above media |
| **Card grid** | 4 → 2 per row | 1 per row |
| **Form** | stack if >4 fields | rows stack, inputs fill width |
| **Table** | horizontal scroll + **flagged** | horizontal scroll + **flagged** |
| **Footer** | 4 → 2 columns | 1 column |

Nothing is ever scaled proportionally like an image.

### Breakpoints

Default design frames are **1440 → 768 → 320**. Intermediate widths are handled
by Auto Layout, fill/hug sizing and wrapping rather than by more frames.

An exact designer-specified width always overrides the defaults. Pass
`targetWidth` with the breakpoint behaviour: an 834px Tablet is named and built
at 834px, while a 390px Mobile is named and built at 390px. Existing 768px or
320px frames are kept separate and are not overwritten by a different width.

Breakpoints are processed separately. Generate and validate Tablet first; begin
Mobile only in a later run after the designer confirms it.

Absolute-positioned layers are copied with the desktop frame and left completely
unchanged. The responsive engine does not ungroup, restructure, detach, rebuild,
convert, resize, rebind, rename, reorder, or optimize those subtrees. They are
reported for manual designer adjustment even when they do not fit the new width.

Desktop spacing is the maximum reference for responsive output. Tablet and
mobile gaps and padding may stay the same or decrease, but they are never allowed
to increase accidentally. The final responsive pass compares each matched
container with desktop after variable modes resolve and caps increases while
preserving variable bindings.

**QA runs at both 390px and 320px.** A layout that survives 390 and breaks at
320 is not responsive.

### The three tools

| Tool | Does |
|---|---|
| `analyze_responsive` | Classifies sections, reports the plan, finds existing responsive frames. **Changes nothing.** |
| `make_responsive` | Reuses an exact-width matching frame or duplicates desktop beside it, then renames, resizes, adapts, and validates one requested breakpoint (default 768/320, or exact `targetWidth`) |
| `validate_responsive` | QA at any widths — overflow, off-canvas, overlap, tiny text, small tap targets |

### Preservation modes

- **`strict`** (default) — layout flow only; typography untouched
- **`balanced`** — allows minor layout restructuring; typography remains untouched
- **`flexible`** — allows larger restructuring

The automatic pass preserves linked text styles in every mode. If layout changes
still leave an oversized heading unreadable, use only an existing responsive
style/token from the same family; never invent or manually override type values.

### Using it

> "Analyze this page for responsive issues"

> "Make this responsive"

> "Make a Tablet version at 834px"

> "Make a Mobile version at 390px"

> "Check the mobile frame at 320"

### What it flags rather than guesses

When no safe pattern exists, it applies the least destructive change and tells
you — it does not guess confidently:

```
Warnings — manual review required:
  ⚠ Pricing Table (table): no safe automatic responsive pattern.
    Least-destructive adjustment applied; manual review required.
  ⚠ Header: no mobile navigation variant exists in the component set.
    The desktop link list was hidden to prevent overflow — a hamburger
    menu and open/close states still need to be added.
```

---

## 👀 Watch the AI work — live activity tracking

By default an AI agent works silently and you only see the finished result. Live
activity tracking makes the work visible **while it happens** — what's running
right now, what it just changed, and how long each step took.

There are four places to watch, each covering a different audience.

### 1. The plugin panel

Nothing to turn on. The plugin panel now shows a scrolling feed of every action
with timestamps, durations and the names of the nodes touched, plus a status
chip that reads **`create frame · 3s`** while work is in flight and **`Idle · 12
done`** when it isn't.

### 2. The web dashboard — `http://localhost:3055/dashboard`

Open that URL in any browser while the socket server is running. It streams live
over Server-Sent Events and shows every connected channel, whether each is
working, the queue depth, and the full activity log with search and filtering.

Useful when you want a big readable view on a second monitor instead of the
narrow plugin panel.

### 3. On the Figma canvas — a live cursor, like a real collaborator

The two surfaces above are only visible to *you*. These make the work visible to
**anyone with the file open**:

| Setting | What collaborators see | Modifies your file? |
|---|---|---|
| **Live cursor** (off by default) | A cursor with a name pill that glides to each element as it's edited — just like watching a teammate | **Yes** — adds a node, auto-removed on close |
| **Highlight nodes** (on by default) | Your selection outline jumps to each element as it's edited, synced through Figma multiplayer | No |
| **Canvas overlay** (off by default) | A locked status card showing the current action and recent history | **Yes** — adds a frame |
| **Follow viewport** (off by default) | Nothing extra; pans *your* canvas to follow the work | No |

Toggle them at the bottom of the plugin panel, or just ask:

> "Turn on the live cursor so I can watch you work"

> "Turn on the live cursor and call it Orange Toolz"

#### How the live cursor works — and one honest limitation

**A Figma plugin cannot move your real multiplayer cursor.** That pointer is
driven by your physical mouse and the Plugin API gives no way to write to it.

So this draws its own: a cursor arrow plus a label pill, built from ordinary
Figma nodes. Because they *are* ordinary nodes, Figma's multiplayer sync
broadcasts every position change to everyone in the file — which produces the
same effect as watching a collaborator move around the canvas.

The label also carries the current action, so observers see not just *where* the
agent is but *what it's doing there*:

```
  ↖ Claude — create frame
```

It glides between elements over ~300ms rather than teleporting, stays locked so
nobody can drag it by accident, drops back to just the name after 4 seconds of
quiet, and is **removed automatically when the plugin closes**.

> ⚠️ **The live cursor and the canvas overlay both write real nodes into your
> document**, so they show up in version history and the undo stack. That's why
> both are off by default. Node highlighting gives you a good deal of the
> collaborator visibility and changes nothing at all.

### 4. Ask Claude directly

Three tools are available to the agent:

| Tool | What it does |
|---|---|
| `get_activity_log` | Full history from the socket server — works even if the plugin disconnected |
| `get_activity_state` | The plugin's in-document view, with resolved node names |
| `set_activity_overlay` | Turn the live cursor, canvas overlay, highlighting and viewport following on or off |

> "What have you changed so far?"

> "Are you still working on that, and how long has it been running?"

### Running a second server on another port

The socket server listens on `3055`. Set `SOCKET_PORT` to run another alongside
it — handy for testing without disturbing a live session:

```bash
SOCKET_PORT=3056 npm run socket
```

Point the MCP server at it with `--port=3056`.

---

## ⚡ Speed and cost

A Figma session is expensive for two reasons, and neither is the thinking: the
tool list is re-sent on every single message, and every write is its own round
trip. Four things in this plugin attack that directly.

### 1. Batch your writes — `figma_batch`

Building one section normally takes 20–40 separate tool calls, and each one is a
full round trip. `figma_batch` runs them all in a single call:

```json
[
  {"command": "create_frame",    "params": {"x": 0, "y": 0, "width": 1440, "height": 600, "name": "Hero", "parentId": "0:1"}},
  {"command": "set_auto_layout", "params": {"nodeId": "$0.id", "layoutMode": "VERTICAL", "itemSpacing": 24}},
  {"command": "create_text",     "params": {"text": "Headline", "parentId": "$0.id"}},
  {"command": "set_font_size",   "params": {"nodeId": "$last.id", "fontSize": 56}}
]
```

Ops run in order. `$0.id` refers to the first op's result and `$last.id` to the
previous one, so a frame's ID can feed its children without a trip back to the
model. `stopOnError` defaults to `true`; set it to `false` for independent work
such as recolouring many unrelated nodes.

Ask the AI to load the **`efficient_execution`** prompt at the start of a session
and it will batch by default.

### 2. Pick a tool profile

The tool list costs about **25,000 tokens on every message**, whether or not any
of those tools get used. A profile trims what is advertised:

| Profile | Tools | Tokens per message | |
|---|---|---|---|
| `core` | 48 | ~10,400 | Layout, text, colour, variables, responsive, section scope |
| `standard` | 87 | ~18,600 | Everything except FigJam, REST comments, activity tracking — **default** |
| `full` | 115 | ~25,900 | Everything advertised, the original behaviour |

Nothing is ever lost. A tool a profile withholds is still callable through
`figma_batch` by name.

**Comments are an exception to `standard`.** The eight REST comment and account
tools (`get_file_comments`, `get_my_comments`, `reply_to_comment`, …) are
withheld only while no `FIGMA_ACCESS_TOKEN` is configured. Setting a token is
what tells the server you intend to use comments, so it advertises them — about
1,800 extra tokens per message. Without that, the model is never shown the tools
and will tell you it cannot read Figma comments, which is true of what it can
see but not of what the server can do.

Set it in the extension's settings (**Tool profile**), or with the
`FIGMA_MCP_PROFILE` environment variable for a manual install.

### 3. Repeated library reads are cached

`get_design_system`, `get_styles`, `get_local_components`, `get_variables`,
`get_document_info` and `get_pages` are served from a short-lived cache, so the
"check what already exists before creating" rule stops costing a round trip every
time it fires. Any command that changes the document clears the cache
immediately, so you never act on a stale read. Disable with `FIGMA_MCP_CACHE=off`.

### 4. Responses have a ceiling

One deep `get_node_info` on a large page could previously fill the context window
by itself. Tool responses are now capped (~24,000 characters, roughly 6,000
tokens) and truncated with a note telling the AI to narrow the query. Adjust with
the **Maximum tool response size** setting or `FIGMA_MCP_MAX_RESPONSE_CHARS`.

### 5. See what it cost — `get_token_usage`

Every Figma task spends context twice — once for the arguments the agent writes,
and again for the result text, which the model re-reads on every later turn. The
expensive calls are rarely the obvious ones: reading a deep node tree costs far
more than creating a frame.

The server tallies both halves of every tool call and reports them, so a task can
end with a plain statement of what it cost:

```
This task — ~18k tokens across 47 Figma tool calls in 2m 14s
  sent ~2.1k · received ~16k
  most expensive:
    get_node_info — 9×, ~11k tokens
    scan_text_nodes — 3×, ~3.4k tokens
    figma_batch — 12×, ~2.0k tokens
  (Estimated from payload size at ~4 chars/token. Covers Figma tool traffic only,
  not the rest of the conversation.)
```

Every tool result also carries a one-line running total:

```
[figma-usage: ~4.2k tokens over 12 calls this task — report this to the user when the task is done]
```

That footer is the part that makes this reliable. An instruction telling the
agent to call a tool at the end of a task is only as good as its compliance, and
a report nobody sees is the same as no feature — so the number rides along in
every result instead. It costs about a dozen tokens per call. Turn it off with
`FIGMA_MCP_USAGE_FOOTER=off` if you would rather rely on the tool alone.

The agent is instructed to call `get_token_usage` once at the end of a task and
show you the result, so you get this without asking. You can also ask for it
directly:

> "How many tokens has that cost so far?"

| Argument | Effect |
|---|---|
| `scope` | `task` (default) — spend since the last report. `session` — everything since the relay started |
| `reset` | Start a fresh task window after reporting. Defaults to on for `task`; session totals never reset |
| `topTools` | How many tools to list in the breakdown (default 5, `0` for none) |
| `format` | `text` (default) for the block above, `json` for the raw numbers |

**Two limits worth knowing.** The counts are estimated from payload size at
~4 chars/token, not produced by a tokenizer, so treat them as a close
approximation rather than a bill. And an MCP server sits outside the model's
context window: it can measure the traffic crossing this bridge, but not your
system prompt, your messages, or the model's own reasoning. The figure is the
cost of the Figma work, not of the conversation.

### 6. Per-chat totals — `npm run tokens`

`get_token_usage` measures the Figma bridge. It cannot measure the *chat*, because
an MCP server sits outside the model's context window. Those numbers come from
elsewhere: Claude Code writes one JSONL transcript per session under
`~/.claude/projects/`, and every assistant message in it carries the API's own
`usage` block. `scripts/chat-token-report.mjs` sums them.

```bash
npm run tokens                 # this project's chats, newest first
npm run tokens -- --all        # every project
npm run tokens -- <session-id> # one chat, broken down
```

```
last active       turns    input  cache rd   output    total  chat
──────────────────────────────────────────────────────────────────
2026-09-07 17:00     70   147.5k     4.70M    40.8k    4.89M  add token reporting
2026-09-04 09:35      7    36.0k    299.8k     1.6k   337.4k  push to main branch
```

Read the `cache rd` column before the `total` one. Most of a long chat's tokens are
cache reads — the same context re-sent each turn — and those are billed far below
the base input rate, so the raw total badly overstates cost. For money rather than
tokens, use `/cost` in Claude Code or the Anthropic Console.

**In Claude Desktop** there is no equivalent: it keeps no local transcript and
exposes no token counter, so `get_token_usage` is the only per-task figure
available there.

### Also faster

`scan_text_nodes` and `set_multiple_text_contents` used to tint each text node
orange and wait half a second for the tint to be visible — on a page with 60 text
nodes that is 30 seconds of pure waiting, and it wrote to the document during
what should have been a read. That highlighting is gone; live progress now comes
from moving the selection instead, which touches nothing. `scan_text_nodes` also
works in larger chunks, and the one-second pause between text-replacement chunks
(which only existed to let the tint animate) is down to a short yield.

---

## 🧩 Skills

A **skill** is a vetted, step-by-step procedure for a recurring design job —
"rename every layer semantically", "audit contrast", "build a pricing section".
Written once, it produces the same quality every time instead of the AI working
the job out from scratch and landing somewhere different each run.

Skills live in [`skills/`](skills/) as Markdown files and are compiled into the
extension at build time.

### Using one

Two ways, both serving the same skill:

- **Prompt picker** — every skill is registered as an MCP prompt under its ID
  (`Layer_Rename_v1`), so it appears in Claude's prompt list.
- **`figma_skill` tool** — how the AI reaches one on its own mid-conversation:

  ```
  figma_skill()                                    → the catalogue
  figma_skill({query: "messy layer names"})        → best matches
  figma_skill({name: "Layer_Rename_v1"})           → full instructions
  ```

### Writing one

Drop a Markdown file into your skills directory — `~/.figma-mcp/skills` by
default, or wherever `FIGMA_MCP_SKILLS_DIR` points. It is live on the next
restart; no rebuild. A file placed there with the same ID as a built-in
overrides it, so you can adapt a shipped skill without forking anything.

```markdown
---
id: Audit_Contrast_v1
title: Contrast Auditor
description: >
  Checks text colour contrast across a frame and reports failures.
triggers:
  - check contrast
  - accessibility audit
uses:
  - get_node_info
  - export_node_as_image
---

# Contrast Auditor

1. Call `export_node_as_image` on the frame...
```

### Naming: `Category_Action_vN`

The ID is not decoration — the registry reads it. `Layer_Rename_v1` and
`Layer_Rename_v2` are the same skill at two versions, so the older one is
retired automatically; `Layer_Clean_v1` is a different skill in the same
category. Category and Action are PascalCase, the version is `v` plus a whole
number. A file that breaks the convention is rejected at startup with the reason
printed in the log, and the rest keep working.

### What the system checks

| Check | What happens |
|---|---|
| **Naming** | Malformed IDs are rejected with an actionable reason — never silently ignored |
| **Duplication** | A near-copy of an existing skill (≥82% content match) is blocked. Overlapping triggers are registered but flagged, since two skills claiming one phrase make selection a coin toss |
| **Versioning** | Older versions of a family are superseded automatically and stop being advertised |
| **Tool references** | Every tool a skill names is checked against the tools actually registered under your profile |

### Self-repair, and its limits

Skills are often written against a *different* Figma MCP server, then name a
tool that does not exist here — `get_screenshot` instead of
`export_node_as_image`. The AI dutifully calls it and the step fails.

At startup, every skill is checked against the live tool set. When a name has a
known one-for-one equivalent, the skill is rewritten with the correct name and
saved as the **next version** (`Audit_Contrast_v1` → `Audit_Contrast_v2`). The
original stays on disk as the record of what changed. Turn this off with
`FIGMA_MCP_SKILL_AUTOREPAIR=off` to review repairs instead of applying them.

**What it will not do:** repair a skill whose *instructions* are wrong — prose
that produces bad designs, a missing step, a wrong order. Nothing here evaluates
meaning, and a system that rewrites guidance it cannot judge would do more harm
than the bug. Those failures are recorded against the skill and reported for a
person to read. Substitutions are limited to a curated table of genuine
equivalents; a tool with no real counterpart is reported, never swapped for
something that behaves differently.

---

## 🆘 Troubleshooting common errors

| What you see | What's actually wrong | Fix |
|---|---|---|
| "I can't connect to Figma" | Bridge server isn't running | [Step 6a](#6a-start-the-bridge-server) — restart it and leave the window open |
| "Channel not found" / connection refused | Channel ID is stale | Reopen the plugin, copy the **new** ID, connect again |
| Claude has no Figma tools at all | Extension not installed, or Claude wasn't restarted | Settings → Extensions. If missing, redo [Step 4](#step-4-install-the-extension-into-claude-desktop). Quit with `Cmd`+`Q`, not the window X |
| `ReferenceError: Bun is not defined` | Bun missing | [Step 1b](#1b-bun-required-do-not-skip) |
| `EADDRINUSE` on port 3055 | Server already running elsewhere | Use the existing window, or `pkill -f socket.js` |
| Plugin missing from Figma's menu | Imported into browser Figma, not desktop | Use **Figma Desktop** and redo [Step 5](#step-5-install-the-plugin-inside-figma) |
| Commands work, comments don't | No Figma token | [Step 7](#step-7-optional-comment-tools) |
| `git: command not found` | Xcode CLI tools missing | `xcode-select --install`, or download the ZIP |
| Everything worked yesterday, nothing today | Server stopped when you closed Terminal / rebooted | Normal. Redo the [3-step daily routine](#-every-session-after-the-first) |
| New features don't work, old behaviour | Claude Desktop still runs the extension you installed before | [Update](#-update-to-the-newest-version): install the new `.mcpb` → `Cmd` + `Q` → reopen the plugin |
| "Grid conversion not applied" | A Grid could not reproduce the section exactly, so the plugin undid it | Your design is untouched. Read the reason; don't ungroup by hand |

Still stuck? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md), or [open an issue](https://github.com/litoondev/claude-talk-to-figma-mcp-main/issues).

---

## 🔧 Other AI tools (Cursor, Claude Code, Windsurf, VS Code…)

Steps 1, 2, 5 and 6 are identical for every tool — only Steps 3 and 4 are Claude-Desktop-specific. Other clients read a JSON config file instead of installing an extension.

> **⚠️ Don't use `npx claude-talk-to-figma-mcp`.** That pulls the upstream package, which does **not** include the comment tools. This fork must be built from source.

### Cursor

1. **Cursor Settings** → **Tools & Integrations** → **New MCP Server** (opens `mcp.json`)
2. Add this, replacing the path with **your** absolute path:

```json
{
  "mcpServers": {
    "ClaudeTalkToFigma": {
      "command": "node",
      "args": ["/Users/YOUR_NAME/Documents/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs"],
      "env": { "FIGMA_ACCESS_TOKEN": "figd_your_token_here" }
    }
  }
}
```

3. Save and restart Cursor

> 💡 To get the exact path, run `pwd` inside the project folder and paste the result.
>
> 🪟 **Windows:** double the backslashes — `"C:\\Users\\You\\claude-talk-to-figma-mcp-main\\dist\\talk_to_figma_mcp\\server.cjs"`

### Claude Code

```bash
claude mcp add ClaudeTalkToFigma \
  --env FIGMA_ACCESS_TOKEN=figd_your_token_here \
  -- node ~/Documents/claude-talk-to-figma-mcp-main/dist/talk_to_figma_mcp/server.cjs
```

Check with `claude mcp list`, or `/mcp` inside Claude Code.

### Everything else

Windsurf, Antigravity, VS Code + Copilot, Cline and Roo Code follow the same pattern with slightly different file locations — see the ["Configure your Agentic Tool" chapter of the detailed installation guide](INSTALLATION.md#3-configure-your-agentic-tool).

## 🐳 Alternative: Using Docker

If you prefer Docker or need to run the WebSocket server in a team environment, see the [Docker installation guide](INSTALLATION.md#alternative-using-docker).

---

## 🤖 Multi-Agent & Parallel execution

This MCP server supports **safe parallel execution** out of the box, allowing multiple AI agents (e.g. Claude Code's sub-agents or team swarms) to work simultaneously on your Figma file without locking up the plugin. A built-in command queue processes requests sequentially on the server side, preventing the Figma API from timing out.

> **Note**: Because multiple agents can modify the document simultaneously, relying on implicit page context is unsafe. As a result, stateful commands like `set_current_page` are **blocked**. All agents must explicitly provide the intended `parentId` parameter when executing any creation or structural modification command (e.g., `create_frame`, `create_text`).

*(Special thanks to [@mmabas77](https://github.com/mmabas77) for architecting and contributing this feature!)*

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

See [Step 7](#step-7-optional-comment-tools) above for the click-by-click version. For non-Claude-Desktop clients, expose the token as `FIGMA_ACCESS_TOKEN` in the `env` block of your MCP config:

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

Restart your client and run `check my Figma account` to verify.

Full details and tuning options in the [installation guide](INSTALLATION.md#4-optional-enable-comment-tools-figma-rest-token).

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

🆕 **New — HTML / URL → Figma:**
- Converts a web page or `.html` file into a Figma design that looks identical, images and icons included
- Binds your own variables and text styles; repeated elements without a component become new components beside the page
- Chooses Figma Grid or Auto Layout per container, and lists anything not in your design system in Import Notes

🆕 **New — layer optimization:**
- Scan → ask → apply: hidden and risky layers are removed only with your confirmation
- Double-nested Auto Layout wrappers collapsed without changing the design
- Heading + card rows converted to Figma Grid, verified to 1px and undone if anything moves

🆕 **New in 1.2.0:**
- Read and reply to Figma comments via the REST API
- Automatic file-key resolution — no pasting file URLs
- Token prompt built into the DXT/MCPB package

🚀 **Under active development:**
- Complete support for Figma Variables
- Enhanced export to Tailwind CSS/SwiftUI

### Need something specific?

**[Propose new ones on GitHub Issues](https://github.com/litoondev/claude-talk-to-figma-mcp-main/issues)**

For issues with the underlying MCP (not the comment tools), consider [upstream](https://github.com/arinspunk/claude-talk-to-figma-mcp/issues) instead.

Your feedback and contributions keep the project alive. ❤️
