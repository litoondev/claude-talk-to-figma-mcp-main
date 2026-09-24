/**
 * Operation prompts — the single source of truth.
 *
 * Every "Copy prompt" button in the plugin panel pastes one of these strings
 * into a Claude conversation. The user is not expected to add anything: the
 * prompt has to carry the goal, the tools to read the design with, the rules
 * that keep the result from breaking, the check and the stop conditions.
 *
 * Written to be dense, not long. Every prompt is paid for in tokens on each
 * use, and a paragraph of prose buys nothing that a sharp imperative line does
 * not — so the style here is telegraphic: tool chains with arrows, rules as
 * clauses, and nothing restated that a skill or a tool already enforces.
 *
 * Rules for editing:
 *   - Only name tools this server actually registers. A prompt that calls a
 *     tool that does not exist produces exactly the broken run these prompts
 *     are meant to prevent.
 *   - Where a skill already encodes the procedure (Grid_Convert_v1,
 *     Layer_Rename_v1, Responsive_Apply_v1), point at it with `figma_skill`
 *     instead of restating it and letting the two drift.
 *   - Keep the shared lines shared, and keep them short.
 *
 * `scripts/build-operation-prompts.js` injects the expanded list into the UI
 * files; never hand-edit the generated block there.
 */

/** How every run starts. */
const SETUP =
  "Setup: join_channel -> check_figma_connection -> get_selection. Nothing selected: ask which frame, then stop. Work only inside that selection; report problems elsewhere instead of fixing them.";

/** The failure modes that produce a broken file. */
const NEVER =
  "Never: move or resize an absolute-positioned layer - change size or layout without checking clipsContent - detach instances - break masks, variants, component properties or prototype links - alter copy, colour, type or imagery unasked - invent a token, style or component name.";

/** How every run ends. */
const CLOSE =
  "Verify: export_node_as_image before and after - it must look identical unless this task asked otherwise; re-read changed nodes with get_nodes_info and undo anything that moved, clipped or overlapped by accident.\n" +
  "Report: per change, node ID and before -> after; what you skipped and why; what you need from me. Never report a step no tool result confirmed.";

/** Compose a prompt: one-line brief, setup, the work, the limits, the close. */
function prompt(title, goal, body) {
  return [`${title} - ${goal}.`, "", SETUP, "", body, "", NEVER, "", CLOSE].join("\n");
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
        "Load figma_skill \"Grid_Convert_v1\" and follow it; this prompt only sets scope and limits.",
        "Read geometry with get_nodes_info, plan via convert_layout mode \"grid\", show me the plan (tracks, spans, which wrappers go) and wait for approval before applying.",
        "Identical render beats fewer layers: where a Grid cannot reproduce the render exactly, keep Auto Layout or leave it and say so. Never nudge a layer to make a Grid fit.",
        "Keep gap and padding bound to their variables. Remove wrappers only through clean_layers, and only ones a Grid cell makes redundant.",
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
      "give every layer the name a senior frontend developer would write",
      [
        "Load figma_skill \"Layer_Rename_v1\" and use its convention; do not invent one.",
        "Read get_nodes_info and export_node_as_image first, so each name says what the layer is on screen: header, hero, card, card__title, button--primary. Nothing stays \"Frame 24\", \"Group 5\" or \"Copy 3\".",
        "Apply with rename_node batched through figma_batch - the whole selection in one pass, no mid-way questions about which convention I prefer.",
        "Names only: no spacing, typography, colour, sizing, structure or responsive work. Do not rename component properties, variants or variables (it breaks bindings); skip locked layers and instance internals.",
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
      "adapt the selection to one breakpoint, on a duplicate, using the components and tokens the file already has",
      [
        "Load figma_skill \"Responsive_Apply_v1\".",
        "Ask which breakpoint - Tablet 768 or Mobile 320 - and stop until I answer. One per run. clone_node the frame and work on the duplicate; leave the original alone.",
        "Component-first: adapt by swapping a raw element for the component that already exists and by changing variant properties on the instance - never detach and rebuild by hand. Raw frames only where no component matches.",
        "Every value comes from the file: get_local_components, get_design_system and get_variables -> find_variable -> switch_variable_mode for this breakpoint -> apply_variable_to_node. No token for it? Ask; never create one.",
        "Sizing: containers, cards, text blocks and columns Fill width + Hug height (set_layout_sizing); buttons hug both. No fixed height on content, ever. Text wraps and grows - never shrink a font, change a style or clip text to fit.",
        "analyze_responsive before, validate_responsive after. Finish this breakpoint, report, stop - do not start the other one.",
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
        "Scan the whole selection with get_nodes_info, list what you would remove or merge and why, and wait for approval before deleting anything.",
        "Remove through clean_layers: empty frames and groups, single-child wrappers that do nothing, accidental duplicates, Auto Layout frames with no layout job. Collapse to one level of Auto Layout where one frame does the work.",
        "For repeating rows or cards, propose convert_layout mode \"grid\" - but only if spacing, alignment and wrapping stay identical; otherwise keep the structure and say why.",
        "Keep: components, properties, variants, masks, prototype layers, and every bound padding/gap token (check get_node_variable_bindings before and after).",
        "Structure only - no redesign, typography, colour, content or spacing changes. The result must be pixel-identical.",
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
      "inventory what the file already has and reuse it instead of creating anything",
      [
        "Inventory: get_design_system, get_variables, get_styles, get_local_components, get_remote_components. Report the collections, modes, styles and components that exist.",
        "Map the selection with get_node_variable_bindings and match_design_tokens. Table: node ID, property, current raw value, the existing variable or style that matches, or \"no match\".",
        "Show the table and wait. Bind only the rows I approve - apply_variable_to_node, apply_variable_bindings, set_text_style_id, set_instance_variant.",
        "Exact matches only: a near value gets reported, never snapped. Never create a variable, style or component to close a gap, and never replace a bound token with a raw value.",
      ].join("\n")
    ),
  },
  {
    id: "local_styles_only",
    category: "Design System",
    title: "Local Styles Only",
    description: "Drop foreign library sections from the style picker",
    triggers: [
      "remote styles",
      "library styles",
      "created in this file",
      "one style source",
      "foreign variables",
    ],
    icon: "🧹",
    prompt: prompt(
      "Local Styles Only",
      "leave one source in every style and variable picker - \"Created in this file\"",
      [
        "Diagnose first: audit_remote_styles scope \"document\" - one binding anywhere keeps a section in the picker, so a selection scan cannot clear the file. Report sourceFiles, names and usage counts; verdict \"incomplete\" means stop - a partial scan is no all-clear.",
        "Two causes, two fixes. Bindings found: styles carried in by pasted layers or dragged-in instances - this prompt repairs those. Audit clean but the section still shows: the file subscribes to that library, which no plugin can change - tell me to switch it off in Assets -> Libraries, then stop.",
        "Name each foreign style's local target from get_styles and get_variables first. No local equivalent - report and ask; never create one, never detach a binding to make the section disappear.",
        "rebind_remote_styles scope \"document\", matchBy \"leaf\", dry run. Show every row - node ID, property, remote -> local - then wait. dryRun false on approved rows only; pass map for any row leaf matching got wrong.",
        "Re-run audit_remote_styles scope \"document\", paste the verdict, and list anything still foreign with its reason.",
      ].join("\n")
    ),
  },
  {
    id: "local_mode_only",
    category: "Design System",
    title: "Local Mode Only",
    description: "Design system scope: local only, never a remote library",
    triggers: [
      "only local mode",
      "one variable mode",
      "remove library",
      "hip master",
      "local only",
    ],
    icon: "🎯",
    prompt: prompt(
      "Design System Scope - Local Only",
      "use only the styles and variables created in this file, and treat every remote or team library as off-limits",
      [
        "1. Apply only nodes, styles and variables where .remote === false. Never read from, apply or reference HIP Master V3, Kidder Dental or any other remote source - even when the picker offers it.",
        "2. Verify .remote directly before using anything: get_nodes_info per node, audit_remote_styles scope \"document\" for what the file still binds to. Do not trust the Libraries panel - it misses unpublished and detached remote sources.",
        "3. A colour, type, effect or spacing value with no local equivalent gets created locally - create_paint_style, create_text_style, create_effect_style, set_variable - never borrowed from a library. Tell me the name you will use before creating it.",
        "4. Resolve every token - colour, typography, effect, spacing - against the local collection only: get_styles, get_variables, find_variable.",
        "Foreign bindings already in the file: rebind_remote_styles matchBy \"leaf\" as a dry run, wait for my approval, then dryRun false.",
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
        "Read get_styles for the styles and scan_text_nodes for the text; call get_styled_text_segments before touching anything with mixed formatting, so per-segment styling is not flattened.",
        "Table: text layer, node ID, current font/size/weight/line-height, and the text style whose values match exactly. Show it, wait, then bind approved rows with set_text_style_id.",
        "A near match is not a match - list it as unmatched and ask. Never resize text to make a style fit, and never create a style.",
        "Text is Auto Height (fix_text_sizing / set_layout_sizing), never a fixed box. Never shrink type, tighten line height or cut copy to solve overflow - fix the container or report it. Do not change wording.",
        "Flag inconsistent hierarchy - heading levels, repeated card titles, body copy - before changing it.",
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
      "report every padding and gap, then bind the approved ones to existing tokens",
      [
        "Audit first, change nothing: get_variables and get_design_system for the tokens, get_nodes_info and get_node_variable_bindings for current values, then match_design_tokens.",
        "Report per layer: node ID, property (padding sides, item spacing, counter-axis spacing), value, bound or raw, matching token. Group as: already bound / exact token available / no token / inconsistent with a sibling.",
        "After approval, bind with apply_variable_to_node or apply_variable_bindings and set unbindable values through set_auto_layout.",
        "Exact matches only - never round to a \"close\" token and never create one; say which value needs a token and ask.",
        "Spacing only: no resizing, restructuring or typography. A changed gap changes every ancestor's height, so re-check the frame afterwards.",
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
      "replace fixed heights on content layers with Hug Contents so the design grows with its content",
      [
        "List every fixed height (get_nodes_info) with node ID, value and content, each marked \"should hug\" or \"deliberately fixed\". Show the list before changing anything.",
        "Hug: sections, wrappers, text and heading containers, cards, hero, CTA, form, nav and footer blocks - any frame whose height follows its children. Apply set_layout_sizing vertical HUG; it needs Auto Layout, so ask before adding one. Text goes to Auto Height via fix_text_sizing.",
        "Adding Auto Layout: get_local_components first - if a component already matches the pattern, instance it instead of building a frame; otherwise add Auto Layout to the frame and bind gap and padding with find_variable.",
        "Keep fixed: icons, avatars, small controls, deliberate image crops, brand assets, components with an intentional spec. Unsure whether a height is deliberate? Ask.",
        "Heights shift as parents start hugging: walk up the tree and confirm nothing is clipped, overlapping or collapsed to zero. Never re-fix a height or shrink text to solve overflow. Finish with validate_responsive.",
      ].join("\n")
    ),
  },
];

export { OPERATION_PROMPTS };
