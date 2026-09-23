/**
 * Operation prompts — the single source of truth.
 *
 * Every "Copy prompt" button in the plugin panel pastes one of these strings
 * into a Claude conversation. The user is not expected to add anything: the
 * prompt has to carry the goal, the tools to read the design with, the rules
 * that keep the result from breaking, the validation pass and the stop
 * conditions on its own.
 *
 * Rules for editing:
 *   - Only name tools this server actually registers. A prompt that calls a
 *     tool that does not exist produces exactly the broken run these prompts
 *     are meant to prevent.
 *   - Where a skill already encodes the procedure (Grid_Convert_v1,
 *     Layer_Rename_v1, Responsive_Apply_v1), tell the model to load it through
 *     `figma_skill` rather than restating it here and letting the two drift.
 *   - Keep the shared blocks shared. Consistency across the eight prompts is
 *     what makes them predictable to the user.
 *
 * `scripts/build-operation-prompts.js` injects the expanded list into
 * `ui.html` and `ui-v2.html`; never hand-edit the generated block in those
 * files.
 */

/** Opening line: what the model is attached to and how it must treat the file. */
const CONTEXT = [
  "You are connected to a live Figma file through the Claude Talk to Figma MCP server.",
  "The document, its layers, variables, styles and components are all readable through the MCP tools.",
  "Read the file before you change it — never infer a value you could have looked up, and never invent a token, style or component name.",
].join(" ");

/** Every prompt starts the session the same way. */
const CONNECT = [
  "1. CONNECT AND SCOPE",
  "   - Call join_channel first. If it reports no channel, tell me to open the plugin and copy the channel code, then stop.",
  "   - Call check_figma_connection, then get_selection.",
  "   - If nothing is selected, ask me which frame or section to work on and stop. Do not pick one yourself.",
  "   - Work only on the selection and its descendants. Do not touch, restructure or 'improve' anything else in the file, even if you notice problems there — report those instead.",
].join("\n");

/** Shared safety rules. These are the failure modes that produce broken files. */
const SAFETY = [
  "   - Never modify a layer whose position is absolute (layoutPositioning 'ABSOLUTE'); leave it and its coordinates exactly as they are.",
  "   - Check clipsContent before changing any size or layout; a clipped parent hides overflow, so a change that looks fine can silently cut content.",
  "   - Do not detach instances, break component links, delete masks, or remove layers used by prototype links or component properties.",
  "   - Do not change copy, colours, fonts, effects or imagery unless this task explicitly asks for it.",
].join("\n");

/** Shared close: prove it still looks right, then say what happened. */
const VERIFY = [
  "VALIDATE",
  "   - Call export_node_as_image on the top-level frame before you start and again when you finish, and compare them. The design must look the same unless this task explicitly asked for a visual change.",
  "   - Re-read the changed nodes with get_nodes_info and confirm the result is what you intended.",
  "   - If anything moved, resized, clipped, overlapped or wrapped differently by accident, put it back before reporting.",
].join("\n");

const REPORT = [
  "REPORT",
  "   - List what you changed, layer by layer, with the node ID and the before/after value.",
  "   - List what you deliberately left alone and why.",
  "   - List anything you could not do, and what you need from me to finish it.",
  "   - Do not claim a step succeeded unless a tool result confirmed it.",
].join("\n");

/** Compose a prompt from its body, with the standard opening and closing. */
function prompt(title, goal, body) {
  return [`${title.toUpperCase()} — ${goal}`, "", CONTEXT, "", CONNECT, "", body, "", VERIFY, "", REPORT].join("\n");
}

const OPERATION_PROMPTS = [
  {
    id: "convert_to_grid",
    category: "Layout",
    title: "Convert to Grid",
    description: "Convert to Figma Grid with minimal layers",
    triggers: ["convert to grid", "gridify", "grid layout", "fewer layers"],
    icon: "📊",
    prompt: prompt(
      "Convert to Grid",
      "rebuild the selection as a Figma Grid that renders identically with the fewest layers",
      [
        "2. LOAD THE PROCEDURE",
        "   - Call figma_skill with name \"Grid_Convert_v1\" and follow it. It is the authoritative procedure for this job; this prompt only sets the scope and the limits.",
        "",
        "3. PLAN BEFORE YOU APPLY",
        "   - Read the structure with get_nodes_info so you know the real geometry of every layer.",
        "   - Use convert_layout with mode \"grid\" to plan the conversion. Show me the plan — track count, spans, which wrappers disappear, which layers stay as they are — and wait for my approval before applying it.",
        "   - Where a Grid cannot reproduce the current render exactly, keep Auto Layout or leave the layer alone and say so. Never approximate the layout and never nudge a layer to make a Grid fit.",
        "",
        "4. RULES",
        "   - Identical render first, fewest layers second. A layer survives only if it does something a Grid cell cannot.",
        "   - Keep gap and padding bound to their existing variables. Do not replace a bound token with a raw number.",
        "   - Remove only empty or purely structural wrappers, through clean_layers.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "rename_layers",
    category: "Organization",
    title: "Rename Layers",
    description: "Semantic naming conventions (BEM-like)",
    triggers: ["rename layers", "clean up layers", "naming conventions", "developer handoff"],
    icon: "📝",
    prompt: prompt(
      "Rename Layers",
      "give every layer in the selection the name a senior frontend developer would use",
      [
        "2. LOAD THE PROCEDURE",
        "   - Call figma_skill with name \"Layer_Rename_v1\" and follow its naming conventions exactly. It defines the semantic-HTML + BEM-like system to use; do not invent your own scheme.",
        "",
        "3. UNDERSTAND BEFORE YOU NAME",
        "   - Read the structure with get_nodes_info and look at the frame with export_node_as_image, so each name describes what the layer actually is on screen, not what its type is.",
        "   - Name from role and content: header, nav, hero, card, card__title, card__media, button--primary, footer__column. Never leave 'Frame 24', 'Group 5', 'Rectangle 1' or a duplicate suffix like 'Copy 3'.",
        "   - Apply the renames with rename_node, batched through figma_batch. Rename every layer in one pass; do not stop halfway and ask which convention I prefer.",
        "",
        "4. RULES — THIS IS A RENAME, NOTHING ELSE",
        "   - Change names only. No spacing, typography, colour, sizing, Auto Layout, structure or responsive work, and no new components or variables, even if you can see something worth fixing. Report those separately instead.",
        "   - Do not rename component properties, variant names or variable names; renaming those breaks bindings.",
        "   - Leave locked layers and the internals of instances alone; rename the instance itself, not what is inside it.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "make_responsive",
    category: "Responsive",
    title: "Make Responsive",
    description: "Adapt for tablet (768px) and mobile (320px)",
    triggers: ["make responsive", "responsive", "tablet", "mobile"],
    icon: "📱",
    prompt: prompt(
      "Make Responsive",
      "adapt the selection to one breakpoint, on a duplicate, without redesigning it",
      [
        "2. LOAD THE PROCEDURE",
        "   - Call figma_skill with name \"Responsive_Apply_v1\" and follow it.",
        "",
        "3. ONE BREAKPOINT, ON A COPY",
        "   - Ask me which breakpoint you are building — Tablet 768px or Mobile 320px — and stop until I answer. Never do both in one run.",
        "   - Duplicate the source frame with clone_node and do all the work on the duplicate, named for its breakpoint. Leave the original untouched unless I tell you otherwise.",
        "   - Finish that breakpoint completely, validate it, report it, then stop and ask before starting another one.",
        "",
        "4. USE THE FILE'S OWN VARIABLES",
        "   - Call get_variables and get_design_system before typing any width, padding, gap or radius.",
        "   - Find the variable that governs the property with find_variable, select the mode for this breakpoint (switch_variable_mode), and bind it with apply_variable_to_node. A manual number is a last resort.",
        "   - If no suitable variable exists, ask me whether to use the current value or add a token. Never create a token on your own.",
        "",
        "5. SIZING RULES — THE PART THAT BREAKS DESIGNS",
        "   - Containers, cards, text blocks and content columns: width Fill Container, height Hug Contents (set_layout_sizing). Buttons hug both, unless the design calls for a full-width CTA.",
        "   - Never give responsive content a fixed numeric height. Height comes from content.",
        "   - Let text wrap and grow. Never shrink a font, change a text style or clip a text layer to make something fit.",
        "   - Keep the existing typography, colours and content. This is adaptation, not redesign.",
        "   - Add Auto Layout only where it genuinely carries the responsive behaviour; do not wrap every layer.",
        "",
        "6. CHECK THE RESULT",
        "   - Run analyze_responsive before you start and validate_responsive when you finish, and act on what they report.",
        "   - Confirm no content layer is left on a fixed height, nothing is clipped, and nothing overlaps.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "optimize_layers",
    category: "Organization",
    title: "Optimize Layers",
    description: "Remove wrappers and flatten structure",
    triggers: ["optimize layers", "fewer layers", "clean up", "flatten"],
    icon: "✨",
    prompt: prompt(
      "Optimize Layers",
      "flatten the structure to the smallest tree that renders identically",
      [
        "2. SCAN BEFORE YOU REMOVE ANYTHING",
        "   - Read the whole selection with get_nodes_info first and give me a short list of what you intend to remove or merge, and why. Wait for my approval before deleting anything.",
        "",
        "3. WHAT TO SIMPLIFY",
        "   - Empty frames and groups, wrappers with a single child that add nothing, duplicated and accidental copies, redundant nested frames, Auto Layout frames with no layout function, and layers with no visual or layout effect.",
        "   - Collapse to one layer of Auto Layout wherever a single frame does the job. Use clean_layers to apply the removals.",
        "   - Where a repeating row or column of items would be clearer as a Grid, propose convert_layout with mode \"grid\" — but only if spacing, alignment and wrapping stay identical. If it would shift anything, keep the current structure and tell me.",
        "   - Keep padding and gap bound to their existing variables; check with get_node_variable_bindings before and after.",
        "",
        "4. NEVER REMOVE",
        "   - Component layers, component properties, variant structure, masks, design-system elements, or layers used for interaction or prototyping.",
        "",
        "5. THIS IS STRUCTURAL CLEANUP ONLY",
        "   - No redesign, no typography or colour changes, no content changes, no resizing, no spacing changes beyond what removing a redundant wrapper implies.",
        "   - The design must look pixel-identical afterwards.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "design_system",
    category: "Design System",
    title: "Design System First",
    description: "Reuse existing components & variables",
    triggers: ["design system", "reuse", "components", "variables"],
    icon: "🎨",
    prompt: prompt(
      "Design System First",
      "inventory what the file already has, and reuse it instead of creating anything new",
      [
        "2. INVENTORY THE SYSTEM — READ ONLY",
        "   - Call get_design_system, get_variables, get_styles, get_local_components and get_remote_components.",
        "   - Report what exists: variable collections and their modes, colour/text/effect styles, local components and library components.",
        "",
        "3. MAP THE SELECTION AGAINST IT",
        "   - For the selected layers, call get_node_variable_bindings and match_design_tokens.",
        "   - Produce a table: property, current raw value, the existing variable or style that matches it, and the node ID. Mark anything with no match as 'no token found'.",
        "",
        "4. THEN ASK, THEN APPLY",
        "   - Show me the table and wait. Apply bindings only for the rows I approve, using apply_variable_to_node, apply_variable_bindings, set_text_style_id or set_instance_variant.",
        "   - Where a raw value is close to a token but not equal, say so and let me decide — do not snap it silently.",
        "   - Never create a new variable, style or component to close a gap. If something is genuinely missing, describe it and ask.",
        "   - Never replace a bound token with a raw value.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "fix_typography",
    category: "Typography",
    title: "Fix Typography",
    description: "Bind to text styles and ensure hierarchy",
    triggers: ["fix typography", "text styles", "font consistency", "hierarchy"],
    icon: "🔤",
    prompt: prompt(
      "Fix Typography",
      "bind text to the file's existing text styles and make the hierarchy consistent",
      [
        "2. READ THE TEXT AND THE STYLES",
        "   - Call get_styles for the text styles that exist, and scan_text_nodes over the selection for the text that exists.",
        "   - For mixed-format text, call get_styled_text_segments before touching it, so per-segment formatting is not flattened.",
        "",
        "3. MATCH, THEN ASK, THEN BIND",
        "   - Build a table: text layer, node ID, current font/size/weight/line-height, and the existing text style whose values match exactly.",
        "   - Show it to me and wait for approval. Then bind the approved rows with set_text_style_id.",
        "   - A near match is not a match. If no style has the same values, list it as unmatched and ask — do not resize text to make a style fit and do not create a new style.",
        "",
        "4. HIERARCHY AND SIZING",
        "   - Check that heading levels descend sensibly and that repeated elements (all card titles, all body copy) use the same style; report anything inconsistent before changing it.",
        "   - Text layers must be Auto Height and grow with their content — use fix_text_sizing or set_layout_sizing, never a fixed height.",
        "   - Never shrink a font size, tighten line height or truncate copy to solve a height or overflow problem. Fix the container instead, or report it.",
        "   - Do not change the wording.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "audit_spacing",
    category: "Layout",
    title: "Audit Spacing",
    description: "Standardize padding & gaps with tokens",
    triggers: ["audit spacing", "spacing review", "padding", "gaps"],
    icon: "📐",
    prompt: prompt(
      "Audit Spacing",
      "report every padding and gap in the selection, then bind the approved ones to existing tokens",
      [
        "2. AUDIT FIRST — CHANGE NOTHING YET",
        "   - Read the spacing variables with get_variables and get_design_system, and the current values with get_nodes_info and get_node_variable_bindings.",
        "   - Run match_design_tokens over the selection.",
        "   - Report a table: layer, node ID, property (padding-top/right/bottom/left, item spacing, counter-axis spacing), current value, bound token or 'raw', and the existing token that matches.",
        "   - Group the findings: already bound correctly / raw value with an exact token match / raw value with no match / inconsistent with a sibling.",
        "",
        "3. THEN APPLY WHAT I APPROVE",
        "   - Wait for my approval, then bind with apply_variable_to_node or apply_variable_bindings, and set values through set_auto_layout where a property is not bindable.",
        "   - Change only spacing. Do not resize layers, restructure the tree, or adjust typography as a side effect.",
        "   - Only an exact match may be bound automatically. A value that is 'close' to a token gets reported, not rounded.",
        "   - If a needed token does not exist, say which value needs one and ask. Never create one yourself.",
        "   - Remember that changing a gap or padding changes the height of every ancestor — re-check the frame afterwards.",
        SAFETY,
      ].join("\n")
    ),
  },
  {
    id: "hug_heights",
    category: "Responsive",
    title: "Apply Hug Heights",
    description: "Replace fixed heights with Hug Contents",
    triggers: ["hug height", "hug contents", "fixed height", "auto height"],
    icon: "📏",
    prompt: prompt(
      "Apply Hug Heights",
      "replace fixed numeric heights on content layers with Hug Contents, so the design grows with its content",
      [
        "2. FIND THE FIXED HEIGHTS",
        "   - Read the selection with get_nodes_info and list every layer carrying a fixed height, with its node ID, current height and what it contains.",
        "   - Mark each one as 'should hug' or 'legitimately fixed' and show me the list before changing anything.",
        "",
        "3. WHAT MUST HUG",
        "   - Sections, content wrappers, text and heading containers, cards, feature blocks, hero content, CTA blocks, form wrappers, navigation content, footer columns, and any Auto Layout frame whose height depends on its children.",
        "   - Apply with set_layout_sizing (vertical: HUG). A frame can only hug if it has Auto Layout — if it does not, tell me before adding one, and add it only where it genuinely carries the layout.",
        "   - Text layers go to Auto Height (fix_text_sizing), not a fixed box.",
        "",
        "4. WHAT KEEPS ITS FIXED HEIGHT",
        "   - Icons, avatars, small controls, deliberate image crops, brand assets, and components with an intentionally fixed spec. If you are unsure whether a height is deliberate, ask instead of converting it.",
        "",
        "5. AFTER THE CHANGE",
        "   - Heights will shift as parents start hugging. Walk up the tree and confirm no text is clipped, nothing overlaps, and no layer collapsed to zero height.",
        "   - Never solve an overflow by shrinking text, changing a text style or re-fixing the height.",
        "   - Run validate_responsive and report what it says.",
        SAFETY,
      ].join("\n")
    ),
  },
];

export { OPERATION_PROMPTS };
