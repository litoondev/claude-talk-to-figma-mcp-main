# Changelog

📖 [**Commands**](COMMANDS.md) | 🚀 [**Installation**](INSTALLATION.md) | 🛠️ [**Contributing**](CONTRIBUTING.md) | 🆘 [**Troubleshooting**](TROUBLESHOOTING.md) | 📜 [**Changelog**](CHANGELOG.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **🚦 `webflow_preflight`**: one call that checks the Figma channel, the Webflow token and its scopes, and whether the Designer extension has joined — reporting every blocker together with the exact fix for each.
  - **Why.** A real session discovered them serially: it reported a missing `sites:read` scope, then that the extension was not connected, then that site creation needs Enterprise. Three round trips for a state that reads in one, and precisely the repetition CLAUDE.md §17.4 forbids — the user gives the same kind of instruction three times because the tool only ever surfaces one wall at a time.
  - Runs its three checks together and never throws: a failed leg is a line in the report, not an exception, because the report is only useful whole. It also says **what is possible right now** rather than only what is broken, so a half-configured setup can still do the half that works.
  - Distinguishes the states that need different fixes: a token rejected outright (401) from one valid but missing a named scope; canvas tools *switched off* (a checkbox) from *not connected* (a setup step). It names the channel the extension must join and offers `npm run webflow:harness -- <channel>` as the route that needs no Webflow account.
  - Probes the extension with a 15s timeout rather than inheriting the relay's two-minute command timeout — a slow checker would be worse than the serial discovery it replaces.
  - Advertised as soon as **either** Webflow feature is configured, not both: hiding it until everything works would make it useless exactly when it is needed.
  - `Webflow_Export_v1` now calls it first, and is told to relay every blocker at once and stop, rather than building against a half-configured setup.
  - 15 tests, including that all three blockers appear in one report even when the first check fails — a checker that short-circuits would pass a naive test and still be useless.
- **🔧 Fix — the Webflow Designer tools could not be switched on at all**: `FIGMA_MCP_WEBFLOW_DESIGNER` gated all 12 of them, was read correctly by `profiles.ts` and was documented in the readme, but was never added to `manifest.json`. In the shipped extension there was no field for it and no env entry, so the tools were unreachable however the user configured things. Everything typechecked and every test passed while the feature was dead.
  - Adds a `webflow_designer` boolean to `user_config`, wired to the env var, defaulting off — the tools cost schema on every request and do nothing without a running extension.
  - **A test for the class of bug, not just this instance.** `tests/unit/manifest-config.test.ts` walks the source for `process.env` reads and fails on any the manifest does not supply, checks every `${user_config.*}` placeholder resolves to a field that exists, and flags user_config fields wired to nothing. It also encodes *why* an allowlist entry is safe: a **default-on** escape hatch (`FIGMA_MCP_CACHE=off`) works fine undeclared, while a **default-off** gate is unreachable undeclared — so a test asserts nothing on the allowlist is a default-off gate in disguise. `FIGMA_MCP_CACHE` and `FIGMA_MCP_USAGE_FOOTER` were already undeclared and are correctly in the first category.
- **🔧 Fix — `Webflow_Export_v1` still told the model to use Webflow's own MCP server**: the skill predated this plugin's own Designer tools and still named `element_tool`, `style_tool`, `variable_tool`, `component_builder` and `get_designer_app_connection_info`. Following it, Claude reported that it could not build layout and asked the user to install the Webflow connector and Webflow's MCP Bridge App — which this plugin exists to replace.
  - Rewritten around `webflow_designer_*` and `webflow_*`, with a table per half saying which route each takes and what it needs, and an explicit instruction not to send the user to another integration.
  - When the canvas tools are absent the skill now gives the exact sentence to say — that they are switched off, and where the switch is — instead of concluding the capability does not exist.
  - The bulk-HTML path (`whtml_builder`) is gone with no replacement: the Designer API builds elements, not markup. The skill says so rather than leaving the model to look for a shortcut that is not there.
  - `webflow_designer_create_component`'s report of properties and variants it could not define is now passed on to the user, since CLAUDE.md §17.3 is not met until those are set by hand.
- **🪜 Figma → Webflow is now two stages, and the first one happens in Figma**: `Webflow_Prepare_v1` (new) restructures a duplicate of the page into Client-First shape, and `Webflow_Export_v1` becomes the stage that walks that prepared page and builds the site.
  - **Why.** A direct conversion asks one pass to read the Figma tree, decide the Webflow mapping and write the site at once, with every write a round trip through the Designer bridge. Splitting it puts the structural thinking where the mature tooling already is — `clean_layers`, `convert_layout`, `set_grid_layout`, variable binding, all tested against real files — and leaves stage 2 a near-mechanical walk. The prepared page is also reviewable in Figma, so the first time anyone sees the structural decisions is no longer after they are in a live site, and it stands on its own as something a developer can hand-build from.
  - **Client-First naming**, verified against Finsweet's docs rather than written from memory: the core structure nests `page-wrapper` › `main-wrapper` › `section_<id>` › `padding-global` (horizontal padding only) › `container-<size>` (max-width plus auto margins) › `padding-section-<size>` (vertical padding only), with nav and footer as siblings of `main-wrapper` rather than inside it. Custom classes use an underscore between component and part and hyphens within a part (`hero-header_image-wrapper`); utility classes are hyphenated (`heading-style-h1`, `text-size-medium`, `max-width-large`); combo classes carry an `is-` prefix and are written space-separated in the layer name exactly as Webflow shows them (`button is-primary`). Client-First's allowance for putting `padding-section` on the `padding-global` layer is noted, since it removes a frame per section.
  - **Layer names become class names verbatim in stage 2.** That is the whole point of the split: a prepared page turns `get_nodes_info` from evidence toward a decision into the decision itself, and the skill says so — do not re-derive, re-case or improve a name. A space means a combo class.
  - **Stage 2 checks for a prepared page first** (`Webflow Ready — …`) and offers stage 1 when there is none, rather than silently doing the expensive thing. Direct export still works and every rule still holds; where the prepared page and the rules disagree, the page wins on structure and the rules win on correctness — a fixed height that survived stage 1 is still built as `auto`.
  - **The design must not change in stage 1.** It is structural work only, proved by exporting both pages at every breakpoint and comparing section by section, not by assertion. Tokens are re-checked after restructuring too, since moving a layer into a new wrapper is the usual way a variable binding is lost.
  - **Breakpoints are deliberately left alone in stage 1**, because stage 2 needs the untouched Figma modes to map onto Webflow's. `analyze_responsive` still runs, to flag fixed heights and clipping while they are cheap to fix.
  - CLAUDE.md §17 now opens with the two-stage table and names Client-First as the convention, so both stages are judged against it.
  - Existing `Layer_Rename_v1` is untouched: it renames to Semantic HTML + BEM, which is a React/CSS convention and the wrong target for Webflow. The two coexist for different jobs.
- **🧩 Phase 2, part A: the Webflow Designer Extension** (`webflow_extension/`). The canvas half is now end to end — MCP tool → relay → extension → Designer API — and the 12 `webflow_designer_*` tools have something to talk to.
  - **No framework, no bundler, no dependencies.** `webflow.json` points `publicDir` at `public/`, so what is written is what runs: one HTML panel and one `app.js`. Webflow's reference bridge app pulls in React, Vite, Radix and socket.io for the same job; none of it survives contact with a command dispatcher, and every dependency is one more thing to keep working inside an iframe we do not control.
  - **A raw WebSocket, not socket.io.** The relay is a plain `Bun.serve` WebSocket server and the Figma plugin already speaks to it with the browser's own WebSocket. Matching that exactly leaves one protocol to reason about, and `app.js` can be read side by side with `src/claude_mcp_plugin/ui.html`.
  - **Joins a channel, not a site.** It sends `role: "webflow"` on join, which is what makes the relay route `target: "webflow"` commands here instead of to the Figma plugin. Both editors can therefore share one channel, and the relay's existing queue serialises writes across them.
  - **Twelve commands** over `elementPresets`/`append`/`setTag`/`setStyles`, `createStyle`/`setProperties`, `createVariableCollection` and its typed variable constructors, and `registerComponent`. Every API call was read out of Webflow's own bridge app source rather than guessed.
  - **Unsupported is reported, never flattened.** This Designer API version exposes no setter for component properties or variants, so `webflow_create_component` says which ones it could not define and tells the user to add them by hand. A silently hard-coded property is one the designer only discovers much later — the exact failure CLAUDE.md §17.3 forbids.
  - **Element ids survive the relay.** Webflow ids are objects (`{component, element}`) inside a component, not strings, so they travel as their serialised form and are matched back by string comparison, never reconstructed.
  - **29 tests** against a fake `webflow` global, with no Designer and no DOM: preset mapping for every documented tag, all six heading levels resolving to the shared Heading preset and then being set with `setTag`, class reuse instead of near-duplicates, the main-breakpoint default, variable type dispatch, empty-batch and unknown-type refusals naming the offending variable, and id serialisation. Two of them pin the extension's command table against the command names `webflow-designer-tools.ts` actually sends, in both directions — the two files never import each other, and the symptom of drift is a tool call that reaches the extension and returns "Unknown command" after the user has already pressed go.
  - **What the tests do not prove** is that Webflow's real API behaves as its bridge app implies. The README says so, so a green suite is not mistaken for "verified against Webflow"; the first live run is the real verification.
  - Excluded from the packaged `.mcpb` — it installs into a Webflow workspace, not into Claude Desktop.
- **🔌 Phase 2, parts B and C: the relay now carries a second editor**. `src/socket.ts` can route to a Webflow Designer extension alongside the Figma plugin, and 12 `webflow_designer_*` tools drive it. The extension itself (part A) is not built yet; these are the server and tool halves, testable without a Webflow account.
  - **Addressed by channel, not by site.** A command carries `target: "webflow"` and the relay delivers it to the client that joined with `role: "webflow"`. Webflow's own bridge keys on `siteId` and emits to *every* extension session registered for it, with no queue — so two agents on one site interleave silently. Here the existing channel isolation and `channelQueues` apply to both editors, and one channel queue serialises writes across them.
  - **Roles are declared, not inferred.** The Webflow extension and the Figma plugin are indistinguishable by traffic shape — both answer commands and never send them — so guessing would route by whichever connected first. The extension declares `role` on join; the Figma plugin sends none and is still classified from its first response, so every existing client is untouched. The Figma bootstrap path, which forwards to any unclassified non-agent client, now excludes Webflow clients: broadcasting blindly is exactly the misrouting being avoided.
  - **A missing editor is named.** Webflow's bridge app drops a site-mismatched message with `return` and no reply, so the caller waits out the timeout and is told the Designer app is not running — when the real cause was a mismatch. Here the sender gets "No Webflow Designer extension connected to this channel" immediately, and the error never blames Figma when Figma is connected and fine. Either editor disconnecting now flushes its in-flight command; previously only the Figma plugin did, so a Webflow command would have hung to the 2-minute timeout.
  - **12 tools** across the Designer API's groups, shaped so CLAUDE.md §17's compliant path is the easy one: `webflow_designer_create_variables` for §17.2's no-hard-coded-colour rule; `webflow_designer_set_tag_style` for typography on h1–h6/paragraph/body *before* any class, with a warning against restating a tag's values in a class; `webflow_designer_create_component` taking Figma property types (text, boolean, instance-swap, image, link) to Webflow property types and Figma variant values to Webflow variants, keeping the designer's exact names. Plus status, structure, styles and variable reads, element create/set-text/delete, and instance insertion. `webflow_designer_delete_element` is behind `confirm: true`.
  - **Gated on `FIGMA_MCP_WEBFLOW_DESIGNER`**, not on the Webflow token: a token proves nothing about whether an extension is running, so this is an explicit opt-in rather than an inference. Never in `core`, and still reachable through `figma_batch`. Full set is now 161 tools.
  - **Tested against the real relay, not a copy of it.** `socket-queue.test.ts` mirrors socket.ts's constants into the test file, which cannot catch routing drift. The new `socket-webflow-routing.test.ts` spawns the actual `src/socket.ts` on a spare port via `SOCKET_PORT` and drives it over WebSockets: targeted delivery reaching only the Webflow client, untargeted delivery still reaching Figma, the named-error path, the bootstrap path refusing a Webflow command, queue serialisation across both editors, and the `/status` counter. Runs in the bun lane beside the existing relay tests; jest ignores both.
- **📦 The extension stopped shipping its own `node_modules`**: the package went from **12.3MB / 5,985 files** to **1.4MB / 14 files**, and `npm run build:dxt` from ~3.6s to ~2.1s.
  - **The cause.** tsup externalises anything in `dependencies` by default, so the built server still did `require("ws")`, `require("zod")`, `require("uuid")` and `require("@modelcontextprotocol/sdk/...")` at startup — which meant the extension had to carry `node_modules` for them to resolve. `.dxtignore` pruned a handful of dev packages by name, but the rest stayed: packing walked 115MB to deliver ~1.5MB of code, and **99.7% of the archive was dependencies**, nearly all of them dev-only tooling (tsup, uglify-js, yargs, jest's tree) the server never loads.
  - **The fix.** `noExternal: ['@modelcontextprotocol/sdk', 'ws', 'uuid', 'zod']` in `tsup.config.ts` inlines the four runtime dependencies into `dist/talk_to_figma_mcp/server.cjs`, so the extension resolves nothing from disk and `node_modules/` leaves the package entirely.
  - **Verified, not assumed.** The concern with inlining is a lazy `require` that only fires at runtime — the SDK has an optional `ajv` validation path, and `ws` optionally loads `bufferutil`/`utf-8-validate`. The bundle was run in a directory containing nothing but `dist/`: `initialize`, `tools/list` (124 tools), a confirm-gated refusal, a Zod argument rejection and a local tool call all succeeded with no `MODULE_NOT_FOUND`. The same probe was then run against the **unpacked .mcpb**, which is what Claude Desktop actually executes.
  - **Also dropped**, being unreadable or unused inside an installed extension: `.github/` workflows, the two `images/cursor-config-*.png` documentation screenshots (472KB), and `src/activity.ts` / `src/activity-dashboard.ts`, which `socket.ts` imports and tsup already inlines into `dist/socket.js`. The manifest's icon is kept.
  - Install and Claude Desktop startup get the same reduction: 14 files to unpack instead of 5,985.
- **🔗 Webflow Data API tools (16)**: this server now talks to Webflow directly, with no second MCP server, no Designer and no bridge app. Sites, pages, page SEO, the copy inside existing text nodes, CMS collections and items, and publishing.
  - `webflow_list_sites`, `webflow_get_site`, `webflow_list_pages`, `webflow_get_page`, `webflow_update_page_settings`, `webflow_get_page_content`, `webflow_update_page_content`, `webflow_list_collections`, `webflow_get_collection`, `webflow_list_items`, `webflow_create_items`, `webflow_update_items`, `webflow_publish_items`, `webflow_delete_items`, `webflow_create_site`, `webflow_publish_site`.
  - **The boundary is stated, not implied.** Webflow splits its API the way Figma does: the **Designer API** owns elements, styles, classes, variables and components and runs only inside a Designer Extension; the **Data API** owns content and runs server-side. `utils/webflow-rest.ts` is the second half, mirroring `utils/figma-rest.ts`, which exists for the same reason (the Figma Plugin API cannot see comments). Every tool description carries the limit verbatim, because a model that believes it can build a layout here will plan one that cannot work. Canvas work stays with Webflow's own MCP server, as `Webflow_Export_v1` describes.
  - **These are the parallel-safe half.** Every call is addressed by an explicit id and holds no session state — no "current active page" to contend over — so several people on several machines can run them at once. The Designer half cannot promise that, which is why it is phase two rather than part of this change.
  - **Nothing is published or deleted without `confirm: true`.** `webflow_publish_site`, `webflow_publish_items` and `webflow_delete_items` refuse the call otherwise, and the refusal text tells the model to ask the user first. The site-publish refusal also states that publishing pushes *everyone's* staged changes, not only this session's — the failure mode a user finds out about only afterwards. Writes are staged until something publishes them, and that is said in every success message.
  - **Auth** via `WEBFLOW_TOKEN` (`WEBFLOW_API_TOKEN` accepted as an alias), read lazily at call time so the environment can change without a reimport. New `webflow_token` and `webflow_api_concurrency` fields in `manifest.json`. An unsubstituted `${user_config.*}` placeholder is caught and explained rather than sent to Webflow, where it returns a confusing 401 — the same trap `getFigmaToken()` guards.
  - **Errors say what to do.** 401 distinguishes an invalid token from a scope problem; 403 notes that a minted token cannot be widened, so a new one is needed; 409 names the usual cause (a duplicate slug); 429 points at `WEBFLOW_API_CONCURRENCY`. Webflow's field-level `details` — the single most useful part of a rejected CMS write — are appended to the message instead of being discarded.
  - **Retry policy** matches the Figma client: 429/408/5xx and network errors back off with jitter and honour `Retry-After`; 401/403/404 and parse failures fail at once rather than burning three attempts on a request that cannot succeed. Query strings drop undefined values instead of sending the literal string `"undefined"`, which Webflow rejects; ids are percent-encoded into the path.
  - **Profile gating** mirrors the REST comment tools: withheld from `standard` for schema cost, but un-withheld the moment `WEBFLOW_TOKEN` is set, because the cost of hiding them only buys anything while the user has no way to call them. Never in `core`, which is the Figma design loop. Still reachable through `figma_batch` in any profile. Full set is now 149 tools.
  - **Fix — a limit stated in the wrong place became a wrong answer.** The canvas note ("layout belongs to the Designer API") was appended to all 15 descriptions, and the model generalised it: asked to create a site named "demo 1", it reported that creating sites "requires Webflow's Designer API, which only runs inside a Webflow Designer Extension". That is false. Site creation is `POST /v2/workspaces/:workspace_id/sites` — a Data API call, gated on an **Enterprise** workspace and the `workspace:write` scope. The note now names what it governs ("canvas structure only, and says nothing about sites, pages, CMS or publishing") and sits only on the tools it governs; it is off the CMS, site and page-settings tools entirely, which also gives back the tokens it was costing there. `webflow_list_sites` gained the map of what this server implements, so an endpoint this server lacks (assets, forms, redirects, webhooks) is reported as a gap here rather than as a limit of Webflow.
  - **`webflow_create_site`** closes the same gap for real: creates a site in a workspace, behind `confirm: true` because it is a real change that may consume a site slot. Its description leads with the Enterprise requirement and points at the dashboard for every other plan, so the model does not offer something the user's plan will refuse. A 403 on a `/workspaces/` path now blames the plan and names the dashboard route; a 403 anywhere else still blames the scope, because telling a non-Enterprise user to re-mint a token would send them round a loop that cannot succeed. `formatSite` prints `workspaceId`, which is what the new tool needs and had no other source.
  - 30 new unit tests: DXT blank-field parsing, lazy token reads, the placeholder trap, retry-vs-fail-fast per status, validation-detail extraction, query building, path encoding, publish targets, profile gating including Webflow and Figma comments gating independently, the workspace-scoped create path, and the plan-vs-scope split on 403.
- **🌊 Figma → Webflow export (`Webflow_Export_v1` skill)**: rebuild a Figma frame as a Webflow page, with Auto Layout translated to flex and grid, Figma variables recreated as Webflow variables, and repeated elements turned into Webflow components. Documentation only — **this plugin gains no Webflow tools and calls no Webflow API**.
  - **Two servers, one conversation.** Webflow ships its own MCP server; this plugin reads Figma and instructs that server to write the site. The skill's Step 0 refuses to start unless both are live, and names which side failed. The Webflow tools it drives: `element_tool` / `element_builder` / `whtml_builder` / `element_snapshot_tool`, `style_tool`, `variable_tool`, `component_tool` / `component_builder` (`insert_in_element`, `insert_in_slot`), `de_page_tool`, `asset_tool` / `get_image_preview`, `data_sites_tool` / `data_pages_tool` / `data_cms_tool`, and `get_designer_app_connection_info`.
  - **The Bridge App must be running.** Webflow's element, style, variable and component tools reach the canvas only through the **Webflow MCP Bridge App**, launched from the Designer's Apps panel (`E`); they go quiet when the panel is closed or the tab is shut. The Data API tools (`data_sites_tool`, `data_pages_tool`, `data_cms_tool`) are addressed by ID and need none of it. The skill checks this in Step 0 rather than failing halfway through a section.
  - **One agent per site, stated as a precondition.** Webflow's bridge keys Designer calls by `siteId` and emits them to *every* Bridge App session connected for that site — `siteIdToSocketMap.get(siteId)` is a `Set<Socket>`, iterated — with no queue and no locking, unlike this plugin's per-channel command queue. Webflow's real-time collaboration (all plans since October 2025) resolves overlapping edits as last-write-wins. So a second agent, or a teammate editing by hand, silently overwrites the run. Step 0 asks the user to confirm the site is theirs alone and states that concurrent edits cannot be detected.
  - **Breakpoints do not line up, and the gap is not small.** Webflow's tablet holds from 768 to **991**, and **no Figma mode covers 480–767 at all** (`Desk` 1440 → Desktop base ≥992, `Tab` 768 → Tablet ≤991, `Mobi` 320 → Mobile portrait ≤479). The skill verifies tablet at both ends of its range, and asks the user what happens in the 480–767 band instead of letting it inherit by accident. Webflow's cascade also flows downward only, so Desktop is finished completely before anything else is touched, and a value the cascade already delivers is not re-authored — every unnecessary override is a future bug.
  - **Variables are mapped, modes are not.** Each Figma collection becomes a Webflow collection under the same names (`spacing/40`, `color/brand/primary`), typed COLOR → Color and FLOAT → Size. Figma resolves a mode per node while Webflow resolves per breakpoint, so a variable is created once from the desktop mode and the other modes become breakpoint overrides — not `spacing-40-tab`. BOOLEAN has no equivalent and is resolved at build time and reported. Text styles become classes, since Webflow has no composite type token.
  - **Layout translation** is specified rather than left to judgment: `layoutMode` → `flex-direction`, Grid Auto Layout → `display: grid`, `itemSpacing`/`counterAxisSpacing` → `column-gap`/`row-gap`, `primaryAxisAlignItems` → `justify-content`, `counterAxisAlignItems` → `align-items` (Figma has no `space-around`/`space-evenly`, reported as such), FILL → `100%` or `flex: 1`, HUG → `auto`, `layoutGrow: 1` → `flex: 1`, plus fills, gradients, strokes, radii, shadows, blurs and blend modes. Groups and single-child wrappers with no visual or layout job produce no element, but flattening is allowed only where the render is unchanged.
  - **Fixed heights are dropped on purpose.** A card, section or text block carrying a numeric height in Figma is built `auto`, so text can wrap to more lines without clipping; icons, avatars and deliberate image crops keep their size. A fixed height in the source is treated as a defect to report, not a spec to copy.
  - **No token is invented.** A value with no Figma variable behind it is written as a literal and listed in the Export Notes under "not tokenised"; if it looks like it deserves a token, the skill asks rather than expanding either design system. Repeated structure becomes a Webflow component and repeated styling a reused class, never two identically styled cards.
  - **Real content becomes CMS.** A row of cards driven by posts, people or products is proposed as a Collection plus Collection List via `data_cms_tool` — proposed, then waited on, because it is a decision about the user's site rather than their design.
  - **Verification is required to claim success.** A screenshot of the source frame is taken at every breakpoint in Step 0, the published staging page is compared against it section by section, and the text-node and asset counts are checked. Without that screenshot the skill states plainly that identity was not verified. Hover, focus and pressed states, SEO fields and form actions are reported as needing a human, never invented, since a Figma frame does not contain them.
  - **Acceptance standard.** The skill now opens with the four requirements the work is judged against, stated as binding rather than advisory: pixel-perfect replication with nothing approximated; global variables with **no hard-coded colour anywhere**; typography set on the **global tag selectors** (H1–H6, paragraph, body) before any class, with classes carrying only what differs; every repeated element a reusable component; and a self-audit before any preview link is shared.
  - **Typography moved to the tags.** The skill previously said Figma text styles become Webflow classes. That builds a pile of classes instead of a design system, and leaves an unstyled heading looking wrong anywhere it appears. Tag selectors are now set first from the matching text style, and a class may only carry the properties that genuinely differ — restating a tag's line-height in a class is called out as the thing that silently breaks when the base changes.
  - **Component properties and variants now cross over.** A mapping table takes Figma text / boolean / instance-swap / image / link properties to Webflow component properties, and Figma variant sets to Webflow variants, keeping the designer's exact names. Variants that change structure rather than styling are flagged as a decision to make and state, not to guess. A property Webflow cannot express is reported, never flattened into a hard-coded value.
  - **Resolved a rule that contradicted itself.** "Never invent a token" and "never hard-code a colour" collide whenever the design uses a colour the Figma file never tokenised — the old text silently chose the literal. The skill now escalates that case with a scripted question instead of picking for the user, and the answer lands in the Export Notes.
  - **A self-audit gate before handover**, as an explicit checklist: sections, copy, assets, borders and shadows, spacing, no hard-coded colour (hover states, borders and shadows named as where raw hex survives), tag-based typography, components and their variants, all four breakpoints with tablet checked at both 768 and 991, and no clipping or overflow. Plus a rule that a reported defect is fixed everywhere it occurs and the count reported — because being told the same thing twice is a process failure, not a user preference.
  - **Readme:** a "Send a Figma design to Webflow" section in the English guide and its mirror in the Bengali guide, covering the one-time connector setup (Claude Desktop → **`+`** → **Add connectors** → Webflow → **Authorize App**; custom connector URL `https://mcp.webflow.com/mcp` if it is not listed). Both note that `claude_desktop_config.json` starts local stdio servers only, so a bare remote URL there does nothing — the config-file route is Webflow's documented `npx mcp-remote https://mcp.webflow.com/sse` shim.
- **🪟 Resizable plugin window**: the panel is dragged to any size from the grip in its bottom-right corner, and reopens at the size it was left.
  - The UI posts each drag step to the main thread, which is the only side that can call `figma.ui.resize`; the drag handle in `ui.html` previously resized an inner `<div>`, so the window itself never changed.
  - Size is clamped to 320×320 and 2400×2400 on both sides, written to `figma.clientStorage` once per drag (on release, not on every mouse move), and re-applied on open.
  - The drag uses pointer capture and screen coordinates, so it keeps tracking when the cursor leaves the plugin iframe and still ends when the button is released outside it.
  - Layout follows the window: `html`/`body` carry a real height so the content area fills it and scrolls instead of being clipped, tabs shrink and wrap, and the grip is pinned to the window corner clear of the theme toggle. Measured at 320×320 through 1400×900: no overflow, nothing clipped.
- **📐 Convert static designs to Auto Layout or Grid (`convert_layout`)**: turns free-positioned frames and groups into Auto Layout or a Figma Grid that renders exactly where the layers were, with as few frames as possible.
  - **Scope:** the given node, the selection, or the whole current page when nothing is selected.
  - **Analysis:** layers are read by their absolute bounds and split into rows and columns wherever their projections leave a gap. Gap and padding are calculated. When one gap cannot describe a stack (heading 8px above its text, the button 24px below), the closest layers are grouped first, so a row/column frame is added only where it is needed. Alignment must be exactly left/centre/right (top/centre/bottom) within 0.5px; anything else is refused with the layer names and the offset, never snapped.
  - **Flattening:** groups and frames that only hold layers (no fill, stroke, effect, clip, radius, opacity, binding, interaction or hidden child) are dissolved. A planned row/column holding exactly one wrapper's layers keeps that wrapper's name, and keeps the frame itself when it was a frame.
  - **Overlays:** a layer overlapping another, or reaching past the container's edge, stays in place as absolute. Two or more such layers making up half the container is a composition and is left alone. Every overlapping pair must keep its paint order, measured on render bounds, so shadows never end up drawn over a neighbour.
  - **Grid mode:** rows and columns become a Grid. Columns are FLEX when all widths are equal, FIXED otherwise; rows hug. A single layer wider than a column in its own row spans every column. Cells that fill their column are set to Fill. Placement switches to auto-flow when auto-flow would place every cell the same way. Uneven spacing, staggered rows, a single column and hidden layers are refused with the reason.
  - **Sizing:** height becomes Hug (or keeps Fill); width keeps Fixed or Fill.
  - **Safety:** dry run first, apply only confirmed IDs; frames inside a proposal convert first. A hidden copy is taken before each conversion. If Figma refuses a step, or any layer's measured box moves more than 0.5px, the copy takes the original's place. Instances, main components, rotated frames, masks and vector drawings are never converted.
  - **Tokens:** measured gap and padding bind to `Gap/<n>` or `spacing/<n>` when that token resolves to the same value in every mode. Values with no token are reported with the question CLAUDE.md requires.
  - Real-file fixtures (Slider Button, Map Container, Hover Interactions page, Wave, Group 9437, Real Smiles Image Group) were probed read-only through the relay. The test harness gained an opt-in layout engine that computes Auto Layout, Grid and group geometry and refuses what Figma refuses: absolute positioning or Fill outside Auto Layout, and emptied groups being deleted. Duplicates go to the page, as confirmed live.
  - In the `core` profile; server instructions require scan → ask → apply and forbid imitating a refused conversion by hand.
  - **Frames already in Auto Layout:** a frame is rebuilt when it holds structural wrappers, so Frame › Frame › Card becomes the card directly in its row, and a heading and a paragraph that each had their own Auto Layout frame sit together in one. An Auto Layout section also becomes a Grid on request. Frames with nothing to remove are neither proposed nor listed as blocked. Frames whose Auto Layout paints the first layer on top are refused.
  - **Structural wrapper rule:** a frame is removed when it paints nothing: no fill, stroke, effect, opacity or blend, no absolutely positioned child, and clipping only when nothing is cut off and the corners are square. Auto Layout no longer stops removal. A variable bound to its gap or padding does not stop removal either; a variable on any other property still does.
  - **Kept tokens:** gap and padding variables stay bound when the value is unchanged. A rebuilt gap or padding with the same value takes the variable the container or a removed wrapper had, so Row Gap, Column Gap and Left-Right move to the Grid's row gap, column gap and padding.
  - **Fill:** a layer that filled its old Auto Layout parent is fixed at its rendered size before it moves, then gets Fill back when it spans the full width of the rebuilt vertical frame.
  - The test harness models main-axis Fill, `cornerRadius`, and unbinding a variable with `setBoundVariable(field, null)`.
  - **Full Grid system (`mode: "grid"`):** every frame inside the section is considered too, not only the section itself. A frame whose layers form rows × columns becomes a Grid. A single column, or items spaced further apart than an item is wide, gets Auto Layout, and `gridRefusal` gives the reason. A Grid first tries the frames the designer drew as its cells (three padded columns), then the layers inside their wrappers (two rows of two images). When the Grid does not fit, the Auto Layout keeps only rows that become Grids of their own, and wrappers that match their one layer's box are still removed.
  - **Hidden layers:** a hidden layer no longer blocks a wrapper or a Grid. It moves into the rebuilt frame as a hidden absolute layer where it was drawn.
  - **Kept behaviour:** space between set on the container or on a removed wrapper holding the same layers stays space between. A Grid cell that stretched to its row's height keeps Fill height. Frames with no children and icon drawings are skipped silently.
  - Real-file fixtures from the "Single Work" page: three Paragraphs columns, 4 Grid Home, 2 Overview.
  - Server instructions: "full Grid" requests go to `convert_layout` mode `grid`. Rebuilding a layout with an `execute_code` script is forbidden.
  - **One Grid planner:** `clean_layers`' Grid proposals now come from the `convert_layout` planner. The older heading-plus-one-row detector and its converter (~330 lines) are removed. Proposals and results have the same shape as `convert_layout` summaries, and IDs are still confirmed through `confirmedGridIds`.
  - **Grid first, then fewest layers:** for a Grid request, a Grid of the container's own layers and a Grid of the layers inside its wrappers are both planned, and the one leaving fewer layers wins (a tie goes to the designer's cells). Auto Layout is used only when neither Grid fits. Layer counts are not compared against Auto Layout, because a Grid's cells convert in turn and a count at one level undercounts what the Grid removes. Apply rebuilds the variant the scan proposed, so the result matches what the user approved even after frames inside it convert first.
  - **Spacer rows:** a larger gap between Grid rows becomes an empty FIXED row of (gap − 2 × row gap) instead of a wrapper frame. A gap between the row gap and twice the row gap is refused.
  - **Fix — "node ID keeps expiring":** a conversion that failed and was put back read the name of the node it had just replaced. Figma threw `in get_name: The node with id … does not exist`, which hid the real reason and left the section with a new ID on every retry. Names are now read beforehand, the reply gives the replacement as `→ now <id>` (`newId`), `clean_layers` finishes on the replacement, and the server tells the model not to retry. The test harness now refuses reads of removed nodes the way Figma does.
  - **Fix — "Title would move" on sections that change direction:** in Figma, turning a Fixed-width row into a column makes the width Hug, and `resize()` to the size a frame already has changes nothing (confirmed live on Page Header / 04). Removing a wrapper then shrank the section from 1859 to 889px, and the conversion was put back. Both axes are now pinned explicitly while layers move. The test harness models the swap, the no-op resize, and a hugging frame that grows with its Fill children.
  - **Fix — "Content would move" on sections with a stroke counted in layout:** with "include strokes in layout" on, a 1px top stroke pushes content 1px down. On # Partner Logo, the first layer sat 61px down with paddingTop 60. Padding was measured from the outer edge, so the plugin wrote 61, which unbound the 60 token, and Figma added the stroke again. Padding is now measured inside the strokes the layout counts, so the value and its token stay as they were. The test harness adds each side's stroke weight to layout padding when strokes are included.
  - **Built-in skill `Grid_Convert_v1`:** scan → explain → apply → verify through `convert_layout`, with the minimal-layer scale, what survives, refusal reasons, and Grid mechanics limited to the properties the plugin sets.
- **🌐 HTML / URL → Figma import**: rebuild a web page as a Figma design that uses the file's own design system, with a flat layer tree.
  - **`analyze_html`**: reads an http(s) URL or a local `.html` file with its linked stylesheets, `<style>` blocks and inline styles. It resolves `:root` variables, `rem` against the page's root font size, `clamp()` and the `font` shorthand. It reports the page outline, the exact copy, colours (with where they are used), typography, gaps, padding, margins and radii. Per container it recommends a Figma Grid (CSS grid, a heading above equal cards, equal items that wrap) or Auto Layout (flex rows and columns), including `@media` overrides. There is no browser: it reads what the CSS declares and leaves out values that only exist after layout. Local reads are limited to `.html`/`.htm` and `.css`. It also lists every visible image and icon (`<img>` including `srcset`/lazy `data-src`, `<picture>`, video posters, CSS backgrounds, inline SVG) with a stable `asset-N` id, section, absolute source, alt text and declared size. `url()`s in linked stylesheets are resolved against the stylesheet's own location. Inline SVGs are made self-contained: `<use href="#id">` is replaced with the sprite symbol's content, `currentColor` becomes the inherited colour, and `viewBox`/`xmlns` are added. The markup is returned through `svgMarkupFor`. Hidden elements (`hidden`, `display:none`) and sprite-only SVGs are skipped and listed; `aria-hidden` is not treated as hidden, since visible decorative icons carry it. Fixed overlays are built as sections at their declared position. Identical groups are merged with a count, and tables are summarised as rows × cells. Each layout recommendation also carries its alignment: flex `justify-content`/`align-items` → `primary`/`counter` (MIN, CENTER, MAX, SPACE_BETWEEN, BASELINE); `align-items: stretch`, the CSS default, → counter MIN plus children Fill on the cross axis. Grid `justify-items`/`align-items` → cell alignment, with stretch → FILL. `space-around`/`space-evenly` are reported as having no Figma equivalent.
  - **`match_design_tokens`**: compares those values with the file's colour variables and styles, text styles (family, size, weight parsed from the style name, line height in px or %, letter spacing), and spacing and radius variables filtered by scope and name, so an opacity of 16 never matches a 16px gap. It returns what to bind, what is close but not exact, and what is missing, plus an Import Notes draft ("built with the HTML's own values (Done)"). It never creates tokens.
  - **`set_grid_layout`**: turns a frame into a Figma Grid using its existing children in reading order. Spans are supported (e.g. a heading across every column). Children wait in a hidden staging frame and are placed with `appendChildAt`, each spanned before the next arrives, because Figma refuses a span over a placed neighbour. The grid then switches to auto-flow, and Fill sizing is restored. Rows hug; columns are FLEX, or HUG when the frame's width hugs, since FLEX is invalid there. On any refusal the frame is restored, and staging is deleted only once empty.
  - **`place_html_image`**: puts an image from the analysis into a Figma node. The server gets the bytes itself: it downloads the URL, reads a `.png`/`.jpg`/`.gif`/`.webp` inside the imported `.html` file's folder, or decodes a `data:` URI. It detects the format from the bytes, enforces the plugin's 5 MB limit, and sends base64 through the existing `set_image` command. So images from any host and from local imports can be placed, independent of the plugin's network allow-list. SVG sources are refused in favour of `set_svg`.
  - `gridRowGap` / `gridColumnGap` can now be bound to GAP variables with `apply_variable_bindings`.
  - **`Html_Import_v1` skill** and server instructions. The result must be identical to the page, linked to the style guide, with zero compromise. Flow: analyse (with a source screenshot as reference) → match → build. Build uses Grid or Auto Layout, flattening wrappers only when the render stays identical, places every image and icon, and positions fixed overlays. Then: an element repeated 2+ times with no exact component becomes a new component in a `Components — from HTML` frame beside the page, with instances used, while one-offs stay plain layers → Import Notes frame → compare an export with the screenshot until nothing differs → `clean_layers` scan → report. Near-match styles and components are never substituted, and no variables or styles are created.
  - The new tools are in the `core` profile.
- **🧹 Interactive layer optimization (`clean_layers`)**: cleanup now scans, asks, then applies. It no longer deletes anything the designer might want without asking.
  - **Scan** (`dryRun: true`) lists empty/zero-size layers, redundant single-child wrappers (double-nested frames, purposeless groups), hidden layers, layers needing confirmation, and protected layers, with node IDs.
  - **Hidden layers are never removed on inference.** Previously a hidden empty frame was deleted silently. Now hidden layers are removed only with `removeAllHidden: true` or when listed in `confirmedHiddenIds`.
  - **Layers with a prototype interaction, prototype flow start, effect, export setting or mask** (on the layer, or for removals on a child) are kept unless their ID is in `confirmedRiskyIds`. Previously a purposeless wrapper carrying a click interaction or export setting was collapsed and the interaction lost.
  - **Protected, never removed:** main components, component-property layers, and hidden layers inside a main component (variant/boolean-property states).
  - Hidden wrappers are no longer collapsed. Collapsing one made its child visible.
  - `scope: "page"` cleans the whole current page, and a multi-node selection now cleans every selected node, not just the first.
  - Generated responsive frames keep hidden and risky layers and report them as warnings.
  - Server instructions now require the scan → ask → apply flow.
  - **Double-nested Auto Layout wrappers are now collapsed** (e.g. `Container > 01 Block > 01 Block > Card` → `Container > Card`). Previously any frame with Auto Layout counted as "doing layout work" and was never collapsed, so a real file with this structure scanned as clean. A wrapper qualifies only when collapsing it cannot change the render: one child at its exact origin and size, zero padding, no fill/stroke/effect/clip/radius/opacity/blend, no variable binding, no min/max size. The wrapper's Fill sizing moves to the child. If Figma refuses any step, the move is undone.
  - A plain wrapper inside an Auto Layout parent is collapsed only when its child fills it exactly. Previously an offset or smaller child was pulled into the flow and shifted. In a parent without Auto Layout, the child's position is now preserved.
  - Nothing inside a main component is flattened.
  - An absolutely positioned layer *inside* the wrapper's child (e.g. a card instance's `BG`) no longer blocks collapsing. Only the direct child's positioning is checked. Before, the subtree search rejected every card wrapper in a real file and walked into every instance.
  - **Grid proposals.** A vertical section holding heading(s) and one row of equal items is proposed for conversion to Figma Grid layout. Wrappers around the items are allowed only if they are transparent. The row and item widths plus gaps must exactly fill the section's content width. Example: `# Work Process > Container > Frame > Frame > Card ×4` becomes `# Work Process (GRID) > Text_Container + Card ×4`.
    - The scan lists proposals, and apply converts only IDs in `confirmedGridIds`.
    - The result has N FLEX columns and HUG rows, auto-flowing. Headings span every column and keep the section's alignment. Items Fill their cell.
    - The section gap becomes the row gap and the row gap becomes the column gap, each keeping its variable binding. Padding (with bindings) and sizing are preserved.
    - The old row stays in the section, out of the flow, until every heading and item is confirmed at its previous position and size (±1px). Then it is deleted. If anything moved, or Figma refused a step, the section is restored and the reason reported.
    - Undo checkpoints are committed around each conversion.
    - The heading's full-width span is set before the items enter the Grid. Before this fix, Figma refused the span on a real file ("existing children in adjacent columns") because a card was already placed beside the heading, and every conversion rolled back. Proposals are limited to one heading per section until side-by-side placement of several headings is verified.
    - The test harness now refuses overlapping Grid spans with Figma's own error.
    - Not proposed: generated responsive frames, sections inside main components, and rows with padding, paint, wrap, space-between, unequal or hidden items, or a width that doesn't match the section's content box.
- **📊 Token usage reporting (`get_token_usage`)**: the server now tallies the estimated token cost of every tool call — arguments sent and result text received — and reports it, so the user can see what a task cost instead of guessing.
  - Accounting is applied centrally in `registerTools` (`src/talk_to_figma_mcp/tools/index.ts`), alongside the existing response-size cap, so every tool — including any added later — is measured for free. Results are measured *after* capping, and image blocks are not charged as characters.
  - New `get_token_usage` tool with a `task` window (spend since the last report, reset on read) and a cumulative `session` window, a per-tool breakdown ranked by cost, and `text` / `json` output.
  - Server instructions now direct the agent to call it once at the end of a task and show the result to the user.
  - Estimated from payload size at ~4 chars/token, and covers Figma bridge traffic only — an MCP server cannot see the rest of the conversation. Both caveats are stated in the tool description and in its rendered output.
### Fixed
- **↔️ `align-items: stretch` was sent to Figma as `STRETCH`**: an HTML import set `counterAxisAlignItems` to `STRETCH`, which Figma rejects (it accepts only MIN, MAX, CENTER and BASELINE). `analyze_html` now prints the Figma alignment for every container (`primary …, counter … + children Fill …` for flex, `cells: …` for Grid), so the build no longer translates CSS alignment by guesswork. The Html_Import skill's Alignment rule and `execute_code`'s error hints cover the same mapping.
- **🅱️ Replacing text lost its inline formatting**: a bold lead-in in a component (e.g. "**Braces are just as effective in adulthood,** though…") spread over the whole node or landed on the wrong words after `set_text_content` / `set_multiple_text_contents`.
  - `text` now accepts `**bold**`, `<b>` and `<strong>`. The markers are removed, and only those ranges get the node's own bold segment style (font, size, colour); the rest keeps the regular style. A node with no bold segment gets its family's Bold, and a warning is returned if no bold style loads. `formatting: "plain"` writes asterisks literally.
  - Without markers, style boundaries stay attached to the unchanged start and end of the text instead of being scaled by length, and a boundary in a rewritten middle snaps to a word edge.
  - A linked text style is re-linked per range, then only the font override is replayed. Replaying size, line height and spacing as raw values could detach the range from the design system. Fill styles use the async API required by `documentAccess: "dynamic-page"`.
  - Styling that cannot be restored is reported in the result's `warnings` instead of only the console.
- **🧩 `execute_code` failed on other pages and gave errors a script could not act on**:
  - Scripts that read another page's `children` failed with `Cannot access property children on a page that has not been explicitly loaded`, because the plugin runs with `documentAccess: "dynamic-page"` and only opened pages are readable. All pages are now loaded before the script runs (measured on a 10-page file: ~350ms the first time, ~1ms after).
  - A failure now reports the script line (`cannot read property 'Symbol.iterator' of undefined (line 3 of the script)`), and known causes get a hint: an undefined value in a `for...of`/spread, appending into an instance (edit the main component or detach with consent), or a page created after loading.
  - The tool description states these rules so the caller avoids them up front.
- **🔤 `FigmaCommand` was missing 15 commands the server sends**: `get_design_system`, `analyze_responsive`, `make_responsive`, `clean_layers`, `validate_responsive`, `get_activity_state`, `set_activity_overlay`, `detach_instance`, `set_reactions`, `get_reactions`, `create_text_style`, `create_paint_style`, `create_effect_style`, `fix_text_sizing` and `set_text_align` are now in the union. This is type-only and changes no runtime behaviour. Any test importing those tool modules failed to compile under ts-jest. `tsc --noEmit -p .` never reported it, because the root tsconfig's `rootDir: src` + `include: tests/**` raises TS6059 option errors that suppress semantic checking. Ten unrelated pre-existing type errors remain (prompts, activity-tools, section-scope-tools, websocket).
- **🟢 CI build, failing since the first commit**: `bun run build` died in the declaration step with `TS2315: Type 'Server' is not generic`, so tests never ran on any commit in the repo's history. `src/socket.ts` named bun's `Server` type for the `Bun.serve()` fetch handler, but that type changed shape between versions — generic in bun-types 1.3.x, non-generic in 1.2.x — and the repo resolves 1.3.x under an npm install while the committed `bun.lock` pins 1.2.9. Every spelling therefore built on a developer's machine and broke in CI. The handler is now unannotated, since `Bun.serve()` contextually types it, which compiles under both.

### Added
- **🧹 Instrumentation cleans itself up**: the ghost cursor and the "Claude Live Activity" card are removed once the agent has been idle for 4 seconds, so a finished design is not left with plugin nodes on it. The plugin never receives a "task finished" signal — only individual commands — so quiet is the proxy: a terminal event arms the timer, any new command disarms it, and the timer re-checks for an in-flight command before deleting anything. Nodes are found by their plugin-data marker, never by name. Off via `set_activity_overlay { autoCleanup: false }`.
- **🔍 Viewport follows at 100% instead of zooming out**: `scrollAndZoomIntoView` framed its target by changing the zoom, which on a page-sized node zoomed out far enough to make the work unreadable. The canvas now holds at 100% and moves instead, centred on the union of the targeted nodes. Off via `set_activity_overlay { lockZoom: false }`.
- **▶️ Text batches step visibly**: `set_multiple_text_contents` ran each chunk of five through `Promise.all`, so five `reportActivityStep` calls fired at the same instant and only the last was ever visible — a batch looked like one jump. Writes within a chunk are now sequential with a yield between them, so the cursor and selection walk node by node.
- **🧾 Usage footer on every tool result**: each response now ends with `[figma-usage: ~N tokens over N calls this task]`. Relying on the agent to remember a closing tool call was not reliable enough — a report nobody sees is the same as no feature — so the running total is carried in the results themselves. Costs ~12 tokens per call; disable with `FIGMA_MCP_USAGE_FOOTER=off`.
- **📈 Per-chat token report (`npm run tokens`)**: `scripts/chat-token-report.mjs` sums the API's own `usage` blocks out of Claude Code's session transcripts (`~/.claude/projects/**/*.jsonl`), giving true per-conversation totals — fresh input, cache writes, cache reads, output and thinking — which an MCP server cannot observe. Supports `--all`, `--limit`, and a per-session breakdown.

## [1.3.0] - 2026-09-03

### Added
- **🏷️ Direct Variable Renaming (`rename_variable` & `rename_variables`)**:
  - Implemented `rename_variable` to rename variables directly in the document via the official Figma Plugin API (`variable.name = newName`), with support for lookup by `variableId` or `name` (with case-insensitive fallback) and optional collection filtering.
  - Implemented `rename_variables` for bulk variable renaming, supporting both explicit arrays of renames and pattern-based find & replace (e.g. `find: "Pages/", replace: "Layout/Section/"`).
  - Enhanced `set_variable` to support `newName`, enabling seamless variable renaming even when `value` is omitted, eliminating the `Missing value parameter` error on rename attempts.
- **⚡ Execute Code Tool (`execute_code`)**:
  - Direct Plugin API JavaScript execution sandbox (`execute_code`), allowing Claude and agents to run arbitrary asynchronous JavaScript scripts directly in Figma with `figma` and `params` in scope, with cyclic-safe object serialization.
- **🔗 File Key Persistence & Fallback (`set_file_key`, `get_file_key`, and UI input)**:
  - Added `set_file_key` command/tool to configure or override the Figma file key or file URL. Full Figma URLs (e.g. `https://www.figma.com/design/:fileKey/...`) are parsed automatically.
  - Stored in `figma.clientStorage` and in-memory cache, so `getFileKey()` falls back to this key whenever native `figma.fileKey` is unavailable or null.
  - Added an interactive "File URL or Key" input field directly inside the Figma plugin UI (`ui.html`).

## [1.2.0] - 2026-08-16

### Added
- **🔑 Automatic file-key resolution — no more pasting file URLs**: `fileKey` is now optional on every comment tool. When omitted, the server asks the connected Figma plugin which file is open and uses that. `get_my_comments` with no arguments at all defaults to the open file.
  - New plugin command `get_file_key` (`src/claude_mcp_plugin/code.js`) returning `figma.fileKey`, the file name and the current page.
  - New `get_current_file` tool to inspect that resolution directly.
  - `reply_to_comments` resolves the open file **once per batch**, not per entry.
  - Passing `fileKey` explicitly still bypasses the plugin entirely, so the tools remain usable with no channel connected.
  - `figma.fileKey` requires the private plugin API. It is populated for locally imported and organisation plugins (this project sets `enablePrivatePluginApi: true`) but is `undefined` on public plugin builds; that case produces an explicit message instead of a silent failure.

### Fixed
- **🧩 Unsubstituted DXT placeholders**: if a host fails to expand `${user_config.figma_access_token}`, the literal template used to reach Figma and return a misleading `403 Invalid token`. `getFigmaToken()` now detects the placeholder and explains how to configure the token directly in `claude_desktop_config.json`.

### Changed
- **⚠️ `get_my_comments` no longer errors on an empty scope.** It previously required one of `teamId` / `projectIds` / `fileKeys`; it now falls back to the currently open file.

## [1.1.0] - 2026-08-16

### Added
- **📦 Token prompt in the DXT package**: `manifest.json` now declares a `user_config` block, so Claude Desktop prompts for the Figma personal access token on install (stored as `sensitive`, never written into a config file by hand) and injects it as `FIGMA_ACCESS_TOKEN`. Comment sweep concurrency is exposed the same way. Both are optional — leaving them blank keeps every non-comment tool working exactly as before.
- **💬 Comment tools (Figma REST API)**: Read and reply to Figma comments across a whole team, selected projects, or an explicit file list. Figma's Plugin API has no comment access, so this introduces a second, independent transport alongside the WebSocket relay: a REST client authenticated with a personal access token (`FIGMA_ACCESS_TOKEN`). These tools work without the socket running and without `join_channel`; all existing tools are unaffected and need no token.
  - `get_figma_account` – validate the token and resolve the caller's user id.
  - `list_figma_files` – expand a `teamId` / `projectIds` into file keys.
  - `get_file_comments` – threaded comments for a single file, with author, anchor, resolved status and timestamps.
  - `get_my_comments` – the full sweep: resolve scope → fetch per file with bounded concurrency → thread → filter to the token owner. Supports `authorScope` (`root` vs `any`), `includeResolved`, `onlyAwaitingReply`, `since`, `maxFiles` and `format` (`text` | `json`).
  - `reply_to_comment` – post a reply into an existing thread (inherits the thread's pin).
  - `reply_to_comments` – batch replies with per-item success/failure reporting and a `dryRun` preview.
  - `delete_comment` – delete your own comment or reply.
- **🌐 Figma REST client** (`utils/figma-rest.ts`): `X-Figma-Token` auth read lazily from the environment, retry with exponential backoff honouring `Retry-After` on `429`/`408`/`5xx`/network errors, no retries on `401`/`403`/`404`, per-request timeouts, and a `mapWithConcurrency` helper that keeps team-wide sweeps under Figma's rate limits.
- **🧵 Comment threading helpers** (`utils/comment-helpers.ts`): pure, network-free logic for grouping Figma's flat comment list into threads, describing pin anchors, filtering, and rendering digests — orphaned replies (deleted root) are promoted rather than dropped.
- **⚙️ REST configuration**: `FIGMA_API_BASE_URL`, `FIGMA_API_CONCURRENCY`, `FIGMA_API_MAX_RETRIES` and `FIGMA_API_TIMEOUT_MS` environment overrides.
- **🧪 Tests**: 48 new tests — unit coverage for the REST client and threading logic, plus an integration suite that drives the real tool handlers against a stub Figma API (including partial-failure and dry-run paths).

### Fixed
- **🏗️ Declaration build**: `src/socket.ts` passed a bare `Server` type to `Bun.serve`'s `fetch` handler, but `Server` is generic in current `bun-types`. This failed the `tsup --dts` step with `TS2314`, breaking `npm run build` and `npm run build:dxt` (the JS bundles emitted fine, so the failure only surfaced at declaration generation). Now parameterised as `Server<any>`, matching the `ServerWebSocket<any>` usage elsewhere in the file.

### Notes
- Comment tools are deliberately absent from the `FigmaCommand` union in `types/index.ts`, since they never travel over the WebSocket relay.
- Files a token cannot open are reported at the end of a sweep rather than aborting it — expected when sweeping an entire team.

## [1.0.0] - 2026-04-18

### Added
- **🤖 Multi-Agent / Parallel Execution**: Added a server-side FIFO command queue to the WebSocket relay. This allows multiple AI agents (e.g. Claude Code sub-agents or Cursor parallel processes) to work on the same Figma file simultaneously without blocking the single-threaded Figma plugin or causing timeouts. Achieves up to ~1.87x speedup for complex generation tasks. (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #77](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/77))
- **🛡️ Node Info Depth Control**: Added `depth` parameter to `get_node_info` and `get_nodes_info` (default 1) to prevent token overflow in giant documents. Children beyond the depth limit return as minimal stubs with a `_childrenTruncated: true` flag, allowing for progressive disclosure. (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #90](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/90))
- **✨ Plugin Quality Improvements**: Enhanced stability and usability across core tools. (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #87](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/87))
  - Robust layout grids (properly handling STRETCH vs fixed-pixel modes).
  - Enhanced `clone_node` with `parentId` support for direct container injection.
  - Smart text wrapping and numeric font weight mapping (mapping 100-900 to Figma styles).
  - Unified styling (fill/stroke) for all basic shape creation tools.
  - Automatic column grids for top-level frames for better alignment.
  - Safe color utilities to prevent accidental black-fills on malformed input data.
- **🎯 Unicast Response Routing**: Responses from Figma are now exclusively routed to the exact agent that requested them via session tracking, eliminating broadcast noise across multiple connected clients.
- **🧱 Component Detaching**: Added `detach_instance` tool to convert component instances back into regular frames. (Thanks to [hoxinzhen](https://github.com/hoxinzhen) - [PR #85](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/85))
- **🎨 Local Style Creation**: New tools to create and manage reusable styles in Figma's local library. (Thanks to [Kejsaren](https://github.com/hello-amed) - [PR #83](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/83))
  - `create_text_style` – Create typography styles (font, size, spacing, etc).
  - `create_paint_style` – Create reusable SOLID color styles.
  - `create_effect_style` – Create reusable shadow and blur styles.
- **✨ Prototype Interaction Tools**: Added two new tools for managing Figma prototype logic. (Thanks to [ravszmig](https://github.com/ravszmig) - [PR #82](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/82))
  - `set_reactions` – Programmatically configure triggers (CLICK, HOVER, etc.), actions (NAVIGATE, OVERLAY, BACK), and transitions. Includes smart logic to handle overlay position and background behavior.
  - `get_reactions` – Inspect and debug existing interactions on any node.
- **🛡️ Robust Type Coercion**: Implementation of Zod-based coercion helpers (`coerce.number()`, `coerceBoolean`, `coerceJson`) to guarantee that all tools correctly handle parameters sent as strings (common in MCP/WebSocket environments). (Thanks to [ehs208](https://github.com/ehs208) - [PR #79](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/79))
- **🛠️ Integration & DX Fixes**:
  - **Fixed `get_pages`**: Added automatic `figma.loadAllPagesAsync()` to prevent "unloaded page" runtime errors.
  - **`parentId` in Components**: Added `parentId` support to `create_component_from_node` for deterministic container injection via the relay server.
  - **Plugin Compatibility**: Fixed syntax errors in `code.js` to ensure support for diverse Figma plugin execution environments.


### Changed
- **⚠️ Breaking Changes for State Independence**: To guarantee race-condition-free parallel execution, implicit page caching has been completely ripped out:
  - `set_current_page` is now completely **blocked** and deprecated by the server.
  - State-altering creation tools (e.g. `create_frame`, `create_rectangle`, `create_text`) now strictly require the `parentId` argument explicitly to declare where elements should be instantiated.
  - Updated tool descriptions to explicitly guide LLMs towards using the `parentId`.

## [0.9.2] - 2026-02-28

### Fixed
- **🔧 Zod compatibility**: Updated `zod` dependency from `^3.24.0` to `^3.25.0` to align with `@modelcontextprotocol/sdk@latest` (v1.27.1+) which requires `zod: "^3.25 || ^4.0"`. This resolves the `Cannot read properties of undefined (reading '_zod')` error that caused `tools/list` to fail and prevented all 54 tools from loading in Claude Desktop and Cursor ([#80](https://github.com/arinspunk/claude-talk-to-figma-mcp/issues/80), [#81](https://github.com/arinspunk/claude-talk-to-figma-mcp/issues/81)).

## [0.9.1] - 2026-02-28

### Added
- **🗒️ FigJam Support**: Six new tools for reading and writing FigJam boards (Thanks to [Rob Dearborn](https://github.com/rfdearborn))
  - `get_figjam_elements` – read all stickies, connectors, shapes-with-text, sections, and stamps on the current page
  - `create_sticky` – create a sticky note with text and colour (yellow, pink, green, blue, purple, red, orange, teal, gray, white)
  - `set_sticky_text` – update the text on an existing sticky note
  - `create_shape_with_text` – create a labelled FigJam shape (SQUARE, ELLIPSE, ROUNDED_RECTANGLE, DIAMOND, TRIANGLE_UP, TRIANGLE_DOWN, PARALLELOGRAM_RIGHT, PARALLELOGRAM_LEFT)
  - `create_connector` – draw an arrow or line between two nodes (by ID) or between canvas positions, with configurable line style and arrowheads
  - `create_section` – create a labelled colour region for grouping board content
- **🖼️ Image Manipulation Tools**: Complete image handling support for Figma nodes (Thanks to [ehs208](https://github.com/ehs208) - [PR #61](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/61))
  - `set_image_fill`: Apply images from URL or base64 data with scaleMode options (FILL, FIT, CROP, TILE).
  - `get_image_from_node`: Extract image metadata (hash, scaleMode, rotation, filters).
  - `replace_image_fill`: Replace existing images while preserving transforms and filters.
  - `apply_image_transform`: Adjust image position, scale, rotation (90° increments), and scaleMode.
  - `set_image_filters`: Apply 7 types of color/light adjustments (exposure, contrast, saturation, temperature, tint, highlights, shadows).
- **📐 Coordinate Consistency**: Added `localPosition` support to `get_node_info` and `get_nodes_info` (batch) for full parity with local coordinate transforms (Thanks to [ehs208](https://github.com/ehs208) - [PR #57](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/57)).
- **📝 Fixed-Width Text**: Added `width` parameter to `create_text` tool for better layout control and wrapping (Thanks to [leeyc09](https://github.com/leeyc09) - [PR #59](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/59)).

### Fixed
- **🔄 Image Features**: 
  - Image rotation properly implemented (90-degree increments) inside node fills (#61).
  - Image filters are now preserved when replacing images using `replace_image_fill` (#61).
- **🎯 Coordinate System**: Fixed mismatch between `get_node_info` and `move_node` by clarifying and unifying local vs global coordinate usage across all tools (Thanks to [ehs208](https://github.com/ehs208) - [PR #57](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/57)).
- **⚡ Performance & Stability**:
  - Optimized `get_nodes_info` using a high-performance native batch implementation in the plugin.
  - Fixed plugin race condition by awaiting `setCharacters` in text node creation (#59).
  - Pinned `zod` dependency to `^3.24.0` to resolve installation failures in containerized/fresh environments (#59).
- **🐳 Docker**: Fixed Dockerfile to run as a network bridge (WebSocket server) and added comprehensive setup documentation (Thanks to [ehs208](https://github.com/ehs208) - [PR #56](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/56)).

### Notes
- **Image Handling**: `apply_image_transform` rotates the image fill inside the node boundary; to rotate the entire node, use `rotate_node`. External URLs are subject to the `allowedDomains` list in `manifest.json`.
- **API Parity**: Standardized `x`/`y` descriptions across all creation and modification tools to explicitly reference local coordinates.

## [0.9.0] - 2026-02-20

### Added
- **🛠️ 20 New Tools**: Massive expansion of Figma capabilities including:
  - **Transformation**: `rotate_node`, `reorder_node`, `convert_to_frame`.
  - **Properties**: `set_node_properties` (visibility, lock, opacity).
  - **Visuals**: `set_gradient`, `boolean_operation`, `set_svg`, `get_svg`, `set_image`.
  - **Layout & Guides**: `set_grid`, `get_grid`, `set_guide`, `get_guide`.
  - **Documentation**: `set_annotation`, `get_annotation`.
  - **Variables**: `get_variables`, `set_variable`, `apply_variable_to_node`, `switch_variable_mode`.
  - **Pages**: `duplicate_page`.
  (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #76](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/76))
- **🌓 Dark Mode**: Added a dark and light mode toggle to the plugin UI for better integration with Figma's themes.
- **📋 Enhanced Clipboard**: The plugin now copies the full connection instruction instead of just the channel name, making it easier to paste into Claude.

### Fixed
- **⚡ Error propagation**: Error responses from Figma now resolve immediately instead of waiting for the 60s timeout. The WebSocket message handler in `websocket.ts` now robustly checks for errors at both the root level (`myResponse.error`) and nested inside the result (`myResponse.result.error`).
- **🎨 UI Refinement**: Adjusted plugin dimensions and mode selector opacity for a cleaner look. Structured the UI script into a class for better maintainability.

## [0.8.2] - 2026-02-15

### Added
- **🔄 Component Variants**: New `set_instance_variant` tool to change variant properties without recreating the instance. Preserves instance overrides like text and colors. (Thanks to [ehs208](https://github.com/ehs208) - [PR #50](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/50))
- **📁 Custom Installation Path**: The launcher now supports an optional second argument to specify a custom installation directory (e.g., `npx claude-talk-to-figma-mcp ./my-folder`).
- **🇰🇷 Korean Localization**: Added UX/UI specialist prompt in Korean (`prompts/prompt-ux-ui-specialist-ko.md`). (Thanks to [ehs208](https://github.com/ehs208) - [PR #54](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/54))

### Fixed
- **📡 Channel Reliability**: Added verification via ping when joining a channel to prevent false success messages and ensure the Figma plugin is active. (Thanks to [ehs208](https://github.com/ehs208) - [PR #52](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/52))
- **🔗 Channel Verification**: Fixed `join_channel` accepting invalid channel codes. Now verifies connection by sending a ping after join, providing fast feedback (12s timeout) instead of waiting for first command to timeout (60s). Added internal `ping` command for connection verification.

## [0.8.1] - 2026-02-11

### Added
- **🎨 Selection Colors**: New `set_selection_colors` tool to recursively change colors of all vector nodes within the current selection. Ideal for coloring icon sets. (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #49](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/49))
- **📝 Enhanced Text Alignment**: Added full support for horizontal and vertical text alignment (Top/Middle/Bottom and Left/Center/Right/Justified). (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #49](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/49))
- **🌍 RTL Support**: Improved text alignment handling for Right-to-Left languages like Arabic. (Thanks to [mmabas77](https://github.com/mmabas77) - [PR #49](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/49))

### Fixed
- **🚀 Setup Command**: Fixed incorrect MCP server command in `configure-claude.js` and `README.md` that was causing connection failures. (Thanks to [ehs208](https://github.com/ehs208) - [PR #47](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/47))
- **🛡️ Type Safety**: Added missing `set_selection_colors` to `FigmaCommand` union type to resolve TypeScript compilation errors.

## [0.8.0] - 2026-02-01

### Added
- **🚀 Unified Launcher**: New `npx claude-talk-to-figma-mcp` command that handles repository setup, dependencies, and execution in a single step.
- **🛠️ Smart Bootstrapping**: Automated Bun detection and installation prompts for an optimized experience.

### Fixed
- **🛡️ Type Safety**: Updated `FigmaCommand` union types to include all new tools, resolving TypeScript compilation errors during CI/CD.
- **🏗️ CI/CD Permissions**: Fixed 403 errors in GitHub Actions by granting explicit write permissions for DXT package releases.

## [0.7.0] - 2026-01-31

### Added
- **🎨 Text Styles**: New `set_text_style_id` tool to apply local text styles to nodes (Thanks to [Rob Dearborn](https://github.com/rfdearborn) - [PR #43](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/43))
- **🏷️ Rename Node**: New `rename_node` tool for better document organization (Thanks to [Beomsu Koh](https://github.com/GoBeromsu) - [PR #36](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/36))
- **📑 Page Management**: Comprehensive suite of tools for managing document pages: `create_page`, `delete_page`, `rename_page`, `get_pages`, and `set_current_page` (Thanks to [sk (kovalevsky)](https://github.com/kovalevsky) - [PR #32](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/32))

### Fixed
- **🚀 Performance**: Optimized component lookup using `findAllWithCriteria` to resolve initialization timeouts (Thanks to [Rob Dearborn](https://github.com/rfdearborn) - [PR #42](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/42))
- **📸 SVG Export**: Corrected format parameter handling for SVG exports and increased timeouts for large exports (Thanks to [sk (kovalevsky)](https://github.com/kovalevsky) - [PR #32](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/32))
- **🛡️ Validation**: Improved Zod validation for `join_channel` by making the channel parameter strictly mandatory (Thanks to [Timur](https://github.com/Mirsmog) - [PR #29](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/29))

## [0.6.1] - 2025-08-02

### Fixed
- **`set_stroke_color` Tool**: Corrected a validation rule that incorrectly rejected a `strokeWeight` of `0`. This change allows for the creation of invisible strokes, aligning the tool's behavior with Figma's capabilities. (Thanks to [Taylor Smits](https://github.com/smitstay) - [PR #16](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/16))

## [0.6.0] - 2025-07-15

### Added
- **🚀 DXT Package Support**: Complete implementation of Anthropic's Desktop Extensions format for Claude Desktop
- **📦 Automated CI/CD Pipeline**: GitHub Actions workflow for automatic DXT package generation and release distribution
- **🔧 DXT Build Scripts**: New npm scripts for DXT packaging (`pack`, `build:dxt`, `sync-version`)
- **📋 .dxtignore Configuration**: Optimized package exclusions for minimal DXT file size (11.6MB compressed)
- **🎯 Dual Distribution Strategy**: NPM registry for developers + DXT packages for end users

### Changed
- **⚡ Installation Experience**: Reduced setup time from 15-30 minutes to 2-5 minutes via one-click DXT installation
- **📖 Documentation**: Enhanced README with comprehensive DXT installation instructions and troubleshooting
- **🏗️ Build Process**: Improved version synchronization between package.json and manifest.json
- **🔄 Release Workflow**: Automated DXT package attachment to GitHub releases

### Technical Details
- Added `@anthropic-ai/dxt@^0.2.0` development dependency for DXT packaging
- Implemented robust error handling and validation in CI/CD pipeline
- Enhanced build artifacts with 90-day retention for testing and rollback capabilities
- Established quality gates ensuring DXT packages only build after successful test suites

### Credits
- **DXT Implementation**: [Taylor Smits](https://github.com/smitstay) - [PR #17](https://github.com/arinspunk/claude-talk-to-figma-mcp/pull/17)

## [0.5.3] - 2025-06-20

### Added
- Added Windows-specific build command (`build:win`: `tsup`) for improved cross-platform compatibility
- Enhanced build process to support development on Windows systems without chmod dependency

### Fixed
- Resolved Windows build compatibility issues where `chmod` command would fail on Windows systems
- Improved developer experience for Windows users by providing dedicated build script

### Changed
- Separated Unix/Linux build process (with executable permissions) from Windows build process
- Updated installation documentation to reflect platform-specific build commands

## [0.5.2] - 2025-06-19

### Fixed
- Fixed critical opacity handling bug in `set_stroke_color` where `a: 0` (transparent) was incorrectly converted to `a: 1` (opaque)
- Fixed stroke weight handling where `strokeWeight: 0` (no border) was incorrectly converted to `strokeWeight: 1`
- Resolved problematic `||` operator usage that affected falsy values in color and stroke operations

### Added
- Extended `applyDefault()` utility function to handle stroke weight defaults safely
- Added `FIGMA_DEFAULTS.stroke.weight` constant for centralized stroke configuration
- Comprehensive test suite for `set_stroke_color` covering edge cases and integration scenarios
- Enhanced validation for RGB components in stroke operations

### Changed
- Improved architectural consistency by applying the same safe defaults pattern from `set_fill_color` to `set_stroke_color`
- Enhanced separation of concerns between MCP layer (business logic) and Figma plugin (pure translator)
- Renamed `weight` parameter to `strokeWeight` for better clarity and consistency
- Updated Figma plugin to expect complete data from MCP layer instead of handling defaults internally

### Technical Details
- Replaced `strokeWeight: strokeWeight || 1` with `applyDefault(strokeWeight, FIGMA_DEFAULTS.stroke.weight)`
- Enhanced type safety with proper `Color` and `ColorWithDefaults` interface usage
- Improved error messages and validation for better debugging experience

## [0.5.1] - 2025-06-15

### Fixed
- Fixed opacity handling in `set_fill_color` to properly respect alpha values
- Added `applyColorDefaults` function to ensure appropriate default values for colors

### Added
- Added automated tests for color functions and node manipulation

### Changed
- Improved TypeScript typing for colors and related properties
- General code cleanup and better utility organization

## [0.5.0] - 2025-05-28

### Changed
- Implemented modular tool structure for better maintainability
- Enhanced handling of complex operations with timeouts and chunking
- Improved error handling and recovery for all tools
- Improved TypeScript typing and standardized error handling

### Fixed
- Fixed channel connection issues with improved state management
- Resolved timeout problems in `flatten_node`, `create_component_instance`, and `set_effect_style_id`
- Enhanced remote component access with better error handling

### Added
- Comprehensive documentation of tool categories and capabilities

## [0.4.0] - 2025-04-15

### Added
- New tools for creating advanced shapes:
  - `create_ellipse`: Creation of ellipses and circles
  - `create_polygon`: Creation of polygons with customizable sides
  - `create_star`: Creation of stars with customizable points and inner radius
  - `create_vector`: Creation of complex vector shapes
  - `create_line`: Creation of straight lines
- Advanced text and font manipulation capabilities
- New commands for controlling typography: font styles, spacing, text case, and more
- Support for accessing team library components
- Improved error handling and timeout management
- Enhanced text scanning capabilities

### Changed
- Improvements in documentation and usage examples

## [0.3.0] - 2025-03-10

### Added
- Added `set_auto_layout` command to configure auto layout properties for frames and groups
- Support for settings for layout direction, padding, item spacing, alignment and more

## [0.2.0] - 2025-02-01

### Added
- Initial public release with Claude Desktop support
