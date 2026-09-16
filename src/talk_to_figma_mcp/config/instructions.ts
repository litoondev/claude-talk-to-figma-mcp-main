/**
 * System-level instructions for Claude Desktop and other MCP clients.
 *
 * Returned during MCP initialize so the model has the critical workflow
 * rules in its context from the very first turn.
 */
export const SERVER_INSTRUCTIONS = `
# Talk to Figma MCP Server Instructions

## 1. Autonomous Layer Renaming (MANDATORY)
- NEVER ask the user "What would you like to rename it to?" or ask for naming preferences when the user asks to rename layers, clean up layer names, organize layers, or rename selected groups/frames without specifying explicit names.
- When layer renaming is requested (e.g., "rename the layer", "rename layers", "clean up figma layers", "selected group need to rename"):
  1. Use get_selection to identify the selected node(s).
  2. Use get_nodes_info (and/or export_node_as_image) to inspect the node and all children to understand their visual roles, layout structure, and text content.
  3. Autonomously assign professional frontend semantic names using the Prefix-DescriptiveName convention in PascalCase:
     - Section frames: Section-Header, Section-Hero, Section-Pricing, Section-Footer
     - Containers/wrappers: Container-Content, Wrapper-UserActions, Card-Product
     - Grids/Rows/Columns: Grid-Features, Row-Actions, Col-Sidebar
     - Visual elements: Heading-Title, Text-Description, Btn-Primary-Submit, Icon-ArrowRight, Img-Thumbnail
     - Never leave default names (e.g., "Group 197", "Frame 24", "Rectangle 1", "Vector").
     - Never rename inside component instances.
  4. Batch the renames using figma_batch (with rename_node ops) or rename_node immediately.
  5. Provide a clear, concise confirmation of renamed layers to the user.

## 2. Report Token Usage When a Task Finishes (MANDATORY)
- After completing any task that used Figma tools, call \`get_token_usage\` once as the final step and show its output to the user, so they can see what the work cost.
- Present it verbatim as a short footer under your summary. Do not paraphrase the numbers and do not omit the estimate caveat.
- Report it as the cost of Figma tool traffic — it is not the conversation's total token usage, which this server cannot see.
- Call it once per task, not after each individual tool call.

## 3. Layer Optimization — Scan, Ask, Then Apply (MANDATORY)
- When the user asks to optimize, clean up or simplify layers (remove unwanted layers, empty groups, double/nested frames), use clean_layers in two steps:
  1. **Scan** — call clean_layers with dryRun: true on the selected section (or nodeId; scope: "page" only when the user asked for the whole page/file). Nothing is modified.
  2. **Ask** — before applying, put every decision the scan reports in front of the user, in the user's language:
     - Hidden layers: never remove them on your own. Ask: "N hidden layer(s) were found. Do you want to remove them?"
     - Needs confirmation (prototype interaction, effect, export setting, mask): ask about each one specifically, naming the layer and the reason, e.g. "\"Card\" has a prototype interaction — removing it may break the prototype. Remove it?"
     - If the scan lists neither, skip this step.
  3. **Apply** — call clean_layers without dryRun. Pass removeAllHidden: true (or confirmedHiddenIds for a subset) only if the user said yes to removing hidden layers, and put only the IDs the user approved in confirmedRiskyIds. Never fill these from your own judgement.
- If the apply result lists new layers needing confirmation, ask again before touching them.
- Protected layers (main components, component-property and variant layers) are never removed. Report them; do not try to delete them another way.
- Grid proposals: when the scan lists a section under "Grid proposals" (heading + one row of equal items buried in wrappers), ask by name whether to convert it to a Grid with the items directly inside. Pass only the approved section IDs in confirmedGridIds. The plugin undoes any conversion that would move something and reports why. Report that too; do not rebuild the section by hand with other tools.
- If a Grid conversion is not applied, report the reason and stop. NEVER imitate it with ungroup_nodes, move_node, or set_auto_layout layoutMode NONE. Ungrouping an Auto Layout row stacks its items in the parent, and pinning them with x/y leaves a frame that looks right but has no layout and no longer adapts.

## 3b. Convert to Auto Layout / Grid — Scan, Ask, Then Apply (MANDATORY)
- When the user asks to convert a static (free-positioned) design, selection or page to Auto Layout or Grid, use convert_layout — mode "auto_layout" or "grid" as the user asked:
  1. **Scan** — convert_layout with dryRun: true (nodeId or the selection; nothing selected scans the whole page). Nothing is modified.
  2. **Ask** — name each proposal and its layout, and say which layers cannot convert and why, in the user's language.
  3. **Apply** — convert_layout without dryRun, with only the approved IDs in confirmedIds.
- Hidden or empty layers the user wants removed first: run clean_layers' scan → ask → apply before converting.
- A layer reported as not convertible stays as it is. NEVER force it with set_auto_layout, move_node or manual x/y — the tool refuses exactly when the result would look different.
- If the apply result lists spacing values with no token, ask whether to keep the manual values or add tokens. Never create tokens without a yes.

## 4. HTML / URL → Figma Import (MANDATORY)
- When the user shares an HTML file, a web page URL or website code and asks to convert, import or rebuild it in Figma, load the Html_Import_v1 skill with figma_skill and follow it in order:
  1. analyze_html (sections, copy, colours, typography, spacing, images and icons, Grid/Auto Layout recommendations); ask for a screenshot of the source if there is none
  2. get_design_system, then match_design_tokens with the token lists analyze_html prints
  3. Build: bind matched variables and text styles; build values that are not in the system with the HTML's own values; use set_grid_layout where the analysis says Figma Grid and set_auto_layout otherwise; never mirror the DOM's wrapper divs unless removing one would change the render; place every image and icon — images with place_html_image (the server fetches the bytes; pass pageSource for a local .html), inline SVG icons with set_svg using the markup from analyze_html's svgMarkupFor
  4. Create an "Import Notes" frame with the IMPORT NOTES text from match_design_tokens, then report it to the user
  5. clean_layers dryRun → ask → apply, then export the page and compare it with the source until nothing differs
- The result must look identical to the page: nothing left out, nothing restyled, no near-match token swapped in. Report every remaining difference; never call it identical without a comparison.
- An element with no exact design-system component that appears 2+ times becomes a new component in a "Components — from HTML" frame beside the page, with instances in the page. A one-off element stays plain layers.
- Never create new variables or styles for values that are missing from the design system unless the user asks.

## 5. Design System and Scope Rules
- Prefer local components and design library styles/variables over ad-hoc primitives.
- Confine modifications strictly to the user's requested scope (e.g., selected node, active section).
`;
